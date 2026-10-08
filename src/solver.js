// Mindlin-Reissner plate bending on a regular mesh of four-node elements.
// Each node carries the deflection w (up positive) and the two rotations of the
// normal. The stiffness is symmetric positive definite and banded, so it is
// kept as a band and factorised by Cholesky.
//
// The heavy part (assembly, factorisation, substitution) is a kernel with two
// builds: the one in this file, and the same steps in C++ compiled to
// WebAssembly (wasm/solver.cpp, loaded by wasm.js). Everything around it is
// shared: what is held, what is loaded, and the recovery of moments and
// reactions from the solution.
//
// Plan coordinates: x in [0, width] runs west to east, y in [0, length] south to
// north. Everything is SI: metres, newtons, pascals. Fields come back per node,
// row by row from the south-west corner.

export const FREE = 0, SIMPLE = 1, FIXED = 2;
// Simple support that also holds the rotation about the edge normal. It has the
// closed-form solution the convergence study is measured against.
export const HARD = 3;

const SHEAR_FACTOR = 5 / 6;
const PIVOT_FLOOR = 1e-9;   // of the diagonal: below it the slab is a mechanism
const now = () => performance.now();

// `reduced` gives the element this solver started with: shear sampled once, at
// the centre. That cures locking but leaves an hourglass mode in w that only a
// supported edge holds down, so a slab standing on columns alone is singular.
// The default ties the shear strain at the middle of each side instead (MITC4),
// which has no such mode. The old element is kept to show the difference.
function elementStiffness(a, b, t, E, nu, reduced) {
  const Ke = new Float64Array(144);
  const D = (E * t ** 3) / (12 * (1 - nu * nu));
  const Dnu = D * nu, Dxy = (D * (1 - nu)) / 2;
  const area = (a * b) / 4;
  const g = 1 / Math.sqrt(3);

  for (const xi of [-g, g]) {
    for (const eta of [-g, g]) {
      const dx = [-(1 - eta), 1 - eta, 1 + eta, -(1 + eta)].map((v) => v / (2 * a));
      const dy = [-(1 - xi), -(1 + xi), 1 + xi, 1 - xi].map((v) => v / (2 * b));
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          const r = i * 3, c = j * 3;
          Ke[(r + 1) * 12 + c + 1] += area * (D * dx[i] * dx[j] + Dxy * dy[i] * dy[j]);
          Ke[(r + 1) * 12 + c + 2] += area * (Dnu * dx[i] * dy[j] + Dxy * dy[i] * dx[j]);
          Ke[(r + 2) * 12 + c + 1] += area * (Dnu * dy[i] * dx[j] + Dxy * dx[i] * dy[j]);
          Ke[(r + 2) * 12 + c + 2] += area * (D * dy[i] * dy[j] + Dxy * dx[i] * dx[j]);
        }
      }
    }
  }

  // shear strains are w,x + bx and w,y + by
  const shear = SHEAR_FACTOR * (E / (2 * (1 + nu))) * t;
  if (reduced) {
    const dx = [-1, 1, 1, -1].map((v) => v / (2 * a));
    const dy = [-1, -1, 1, 1].map((v) => v / (2 * b));
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const r = i * 3, c = j * 3, k = 4 * area * shear;
        Ke[r * 12 + c] += k * (dx[i] * dx[j] + dy[i] * dy[j]);
        Ke[r * 12 + c + 1] += k * dx[i] * 0.25;
        Ke[r * 12 + c + 2] += k * dy[i] * 0.25;
        Ke[(r + 1) * 12 + c] += k * 0.25 * dx[j];
        Ke[(r + 2) * 12 + c] += k * 0.25 * dy[j];
        Ke[(r + 1) * 12 + c + 1] += k * 0.0625;
        Ke[(r + 2) * 12 + c + 2] += k * 0.0625;
      }
    }
    return Ke;
  }

  // Along a side from one corner to the next, the strain at its middle.
  const tie = (from, to, side, rotation) => {
    const B = new Float64Array(12);
    B[from * 3] = -1 / side;
    B[to * 3] = 1 / side;
    B[from * 3 + rotation] = B[to * 3 + rotation] = 0.5;
    return B;
  };
  // Each strain varies linearly between its two sides: south and north, west and east.
  for (const [P, Q] of [[tie(0, 1, a, 1), tie(3, 2, a, 1)], [tie(0, 3, b, 2), tie(1, 2, b, 2)]]) {
    for (let p = 0; p < 12; p++) {
      for (let q = 0; q < 12; q++) {
        Ke[p * 12 + q] += ((shear * a * b) / 3) * (P[p] * P[q] + Q[p] * Q[q] + 0.5 * (P[p] * Q[q] + Q[p] * P[q]));
      }
    }
  }
  return Ke;
}

/* ---- the kernel ------------------------------------------------------ */

// Only the lower band of K is kept, a row at a time: row i holds columns
// i - bw .. i, with its diagonal at offset bw. Factorising row by row then
// multiplies two runs that are each contiguous in memory.

// Four partial sums, as in the C++ build, so the two round alike.
function dot(band, p, q, count) {
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, k = 0;
  for (; k + 3 < count; k += 4) {
    s0 += band[p + k] * band[q + k];
    s1 += band[p + k + 1] * band[q + k + 1];
    s2 += band[p + k + 2] * band[q + k + 2];
    s3 += band[p + k + 3] * band[q + k + 3];
  }
  for (; k < count; k++) s0 += band[p + k] * band[q + k];
  return (s0 + s1) + (s2 + s3);
}

// A kernel assembles a system and hands back a factor to solve with. `holds`
// says whether that factor is still good; this one keeps as many as it is given.
export const kernel = {
  name: "js",

  // `pinned` lists the rows that get a unit row and column of their own. Nodes
  // are numbered along x when `alongX`, else along y.
  assemble({ nx, ny, alongX, dof, bw, hx, hy, thickness, E, nu, reduced, pinned }) {
    const stride = bw + 1, band = new Float64Array(dof * stride);
    const Ke = elementStiffness(hx, hy, thickness, E, nu, reduced);
    const nodesX = nx + 1, nodesY = ny + 1, nodes = [0, 0, 0, 0];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (alongX) {
          nodes[0] = j * nodesX + i; nodes[1] = nodes[0] + 1; nodes[3] = nodes[0] + nodesX; nodes[2] = nodes[3] + 1;
        } else {
          nodes[0] = i * nodesY + j; nodes[3] = nodes[0] + 1; nodes[1] = nodes[0] + nodesY; nodes[2] = nodes[1] + 1;
        }
        for (let p = 0; p < 12; p++) {
          const row = nodes[(p / 3) | 0] * 3 + (p % 3);
          for (let q = 0; q < 12; q++) {
            const column = nodes[(q / 3) | 0] * 3 + (q % 3);
            if (column <= row) band[row * stride + column - row + bw] += Ke[p * 12 + q];
          }
        }
      }
    }
    for (const row of pinned) {
      for (let column = Math.max(0, row - bw); column < row; column++) band[row * stride + column - row + bw] = 0;
      for (let below = row + 1, last = Math.min(dof - 1, row + bw); below <= last; below++) band[below * stride + row - below + bw] = 0;
      band[row * stride + bw] = 1;
    }
    return { band, dof, bw, stride };
  },

  // In place: the band of K becomes the band of L, with K = L L'. False when a
  // pivot vanishes, which means the slab is a mechanism.
  factorise({ band, dof, bw, stride }) {
    for (let i = 0; i < dof; i++) {
      const first = Math.max(0, i - bw), row = i * stride + first - i + bw;
      for (let j = first; j < i; j++) {
        band[row + j - first] = (band[row + j - first] - dot(band, row, j * stride + first - j + bw, j - first)) / band[j * stride + bw];
      }
      const diagonal = band[i * stride + bw], pivot = diagonal - dot(band, row, row, i - first);
      if (!(pivot > PIVOT_FLOOR * diagonal)) return false;
      band[i * stride + bw] = Math.sqrt(pivot);
    }
    return true;
  },

  // Solves L L' x = b in place.
  substitute({ band, dof, bw, stride }, x) {
    for (let i = 0; i < dof; i++) {
      const first = Math.max(0, i - bw), row = i * stride + first - i + bw;
      let sum = x[i];
      for (let k = first; k < i; k++) sum -= band[row + k - first] * x[k];
      x[i] = sum / band[i * stride + bw];
    }
    for (let i = dof - 1; i >= 0; i--) {
      const first = Math.max(0, i - bw), row = i * stride + first - i + bw, value = x[i] / band[i * stride + bw];
      x[i] = value;
      for (let k = first; k < i; k++) x[k] -= band[row + k - first] * value;
    }
  },

  holds: () => true,
};

/* ---- the analysis ---------------------------------------------------- */

// Three supports off one line, or any built-in edge, hold the slab still.
function restrained(nodes, fixed, nodesX, hx, hy) {
  if (fixed) return true;
  if (nodes.length < 3) return false;
  const at = (n) => [(n % nodesX) * hx, Math.floor(n / nodesX) * hy];
  const [x0, y0] = at(nodes[0]);
  let far = 0, reach = 0;
  for (const n of nodes) {
    const [x, y] = at(n), d = Math.hypot(x - x0, y - y0);
    if (d > reach) { reach = d; far = n; }
  }
  if (!reach) return false;
  const [x1, y1] = at(far);
  return nodes.some((n) => {
    const [x, y] = at(n);
    return Math.abs((x1 - x0) * (y - y0) - (y1 - y0) * (x - x0)) > 1e-6 * reach * reach;
  });
}

// `cache` is any object kept between calls. While the stiffness is unchanged
// (same slab, mesh and supports) its factor is reused, and a new load costs
// one substitution. `using` is the kernel that does the work.
export function analyse(model, cache = {}, using = kernel) {
  const { width, length, thickness, E, nu, nx, ny } = model;
  const edges = { west: FREE, east: FREE, south: FREE, north: FREE, ...model.edges };
  const nodesX = nx + 1, nodesY = ny + 1, count = nodesX * nodesY, dof = count * 3;
  const hx = width / nx, hy = length / ny;

  // Numbering runs along the shorter side, which is what sets the bandwidth.
  const alongX = nx <= ny;
  const id = alongX ? (i, j) => j * nodesX + i : (i, j) => i * nodesY + j;
  const bw = 3 * ((alongX ? nodesX : nodesY) + 1) + 2;

  const nearest = (x, y) => [Math.max(0, Math.min(nx, Math.round(x / hx))), Math.max(0, Math.min(ny, Math.round(y / hy)))];
  const columnNodes = (model.columns ?? []).map(({ x, y }) => { const [i, j] = nearest(x, y); return j * nodesX + i; });

  // constrained unknowns, as node * 3 + component in output numbering
  const held = new Set();
  const hold = (i, j, component) => held.add((j * nodesX + i) * 3 + component);
  const edge = (kind, i0, j0, di, dj, steps, tangent) => {
    if (kind === FREE) return;
    for (let s = 0; s <= steps; s++) {
      const i = i0 + di * s, j = j0 + dj * s;
      hold(i, j, 0);
      if (kind === FIXED) { hold(i, j, 1); hold(i, j, 2); }
      if (kind === HARD) hold(i, j, tangent);
    }
  };
  edge(edges.west, 0, 0, 0, 1, ny, 2);
  edge(edges.east, nx, 0, 0, 1, ny, 2);
  edge(edges.south, 0, 0, 1, 0, nx, 1);
  edge(edges.north, 0, ny, 1, 0, nx, 1);
  for (const node of columnNodes) held.add(node * 3);

  const supports = [...held].filter((d) => d % 3 === 0).map((d) => d / 3);
  const base = { nx, ny, dof, band: bw, backend: using.name };
  if (!restrained(supports, Object.values(edges).includes(FIXED), nodesX, hx, hy)) return { ...base, ok: false };

  const time = { assemble: 0, factor: 0, solve: 0, recover: 0 };
  const key = [using.name, width, length, thickness, E, nu, nx, ny, !!model.reduced, ...[...held].sort((a, b) => a - b)].join();
  const reused = cache.key === key && using.holds(cache.factor);

  if (!reused) {
    let t = now();
    // where each held unknown sits in the kernel's own numbering
    const pinned = Int32Array.from(held, (d) => { const n = (d / 3) | 0; return id(n % nodesX, (n / nodesX) | 0) * 3 + (d % 3); });
    const factor = using.assemble({ nx, ny, alongX, dof, bw, hx, hy, thickness, E, nu, reduced: !!model.reduced, pinned });
    time.assemble = now() - t;

    t = now();
    const sound = using.factorise(factor);
    time.factor = now() - t;
    cache.key = sound ? key : null;
    if (!sound) return { ...base, ok: false };
    Object.assign(cache, { factor, pinned, Ke: elementStiffness(hx, hy, thickness, E, nu, model.reduced) });
  }
  const { factor, pinned, Ke } = cache;

  // loads, as nodal forces on w in output numbering
  let t = now();
  const force = new Float64Array(count);
  if (model.q) {
    const share = (model.q * hx * hy) / 4;
    for (let j = 0; j < nodesY; j++) {
      for (let i = 0; i < nodesX; i++) {
        force[j * nodesX + i] = -share * (i > 0 && i < nx ? 2 : 1) * (j > 0 && j < ny ? 2 : 1);
      }
    }
  }
  if (model.point?.P) {
    const { x, y, P } = model.point;
    const i = Math.max(0, Math.min(nx - 1, Math.floor(x / hx))), j = Math.max(0, Math.min(ny - 1, Math.floor(y / hy)));
    const u = Math.max(0, Math.min(1, x / hx - i)), v = Math.max(0, Math.min(1, y / hy - j));
    force[j * nodesX + i] -= P * (1 - u) * (1 - v);
    force[j * nodesX + i + 1] -= P * u * (1 - v);
    force[(j + 1) * nodesX + i + 1] -= P * u * v;
    force[(j + 1) * nodesX + i] -= P * (1 - u) * v;
  }

  const x = new Float64Array(dof);
  for (let j = 0; j < nodesY; j++) for (let i = 0; i < nodesX; i++) x[id(i, j) * 3] = force[j * nodesX + i];
  for (const row of pinned) x[row] = 0;
  using.substitute(factor, x);
  time.solve = now() - t;
  // `bare` stops at the solution, for timing the solve alone
  if (model.bare) return { ...base, ok: true, reused, time };

  t = now();
  const w = new Float64Array(count), bx = new Float64Array(count), by = new Float64Array(count);
  for (let j = 0; j < nodesY; j++) {
    for (let i = 0; i < nodesX; i++) {
      const from = id(i, j) * 3, n = j * nodesX + i;
      w[n] = x[from]; bx[n] = x[from + 1]; by[n] = x[from + 2];
    }
  }

  // What the slab's own stiffness puts on each w, for the reactions.
  const internal = new Float64Array(count);
  const ue = new Float64Array(12), corner = [0, 0, 0, 0];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      corner[0] = j * nodesX + i; corner[1] = corner[0] + 1; corner[3] = corner[0] + nodesX; corner[2] = corner[3] + 1;
      for (let k = 0; k < 4; k++) { ue[k * 3] = w[corner[k]]; ue[k * 3 + 1] = bx[corner[k]]; ue[k * 3 + 2] = by[corner[k]]; }
      for (let k = 0; k < 4; k++) {
        let sum = 0;
        for (let q = 0; q < 12; q++) sum += Ke[k * 36 + q] * ue[q];
        internal[corner[k]] += sum;
      }
    }
  }

  // Moments from the curvature at each node. Inside the mesh the central
  // difference of the rotations is exactly the average of the four elements
  // that meet there; on an edge the one-sided difference keeps second order.
  const slope = (f, n, step, at, last, h) => (at === 0 ? -3 * f[n] + 4 * f[n + step] - f[n + 2 * step]
    : at === last ? 3 * f[n] - 4 * f[n - step] + f[n - 2 * step] : f[n + step] - f[n - step]) / (2 * h);
  const D = (E * thickness ** 3) / (12 * (1 - nu * nu));
  const mx = new Float64Array(count), my = new Float64Array(count), mxy = new Float64Array(count);
  let sag = 0, hog = 0;
  for (let j = 0; j < nodesY; j++) {
    for (let i = 0; i < nodesX; i++) {
      const n = j * nodesX + i;
      const kx = slope(bx, n, 1, i, nx, hx), ky = slope(by, n, nodesX, j, ny, hy);
      const kxy = slope(bx, n, nodesX, j, ny, hy) + slope(by, n, 1, i, nx, hx);
      // sagging positive
      mx[n] = -D * (kx + nu * ky);
      my[n] = -D * (nu * kx + ky);
      mxy[n] = (-D * (1 - nu) * kxy) / 2;
      sag = Math.max(sag, mx[n], my[n]);
      hog = Math.min(hog, mx[n], my[n]);
    }
  }

  // A support pushes back with whatever the slab's own stiffness does not balance.
  const reaction = (n) => internal[n] - force[n];
  const taken = new Set();
  const columns = columnNodes.map((n) => {
    if (taken.has(n)) return 0;
    taken.add(n);
    return reaction(n);
  });
  const edgeTotal = { west: 0, east: 0, south: 0, north: 0 };
  const sides = (i, j) => [i === 0 && "west", i === nx && "east", j === 0 && "south", j === ny && "north"].filter((side) => side && edges[side] !== FREE);
  let reacted = 0, applied = 0, deepest = 0;
  for (const n of supports) {
    reacted += reaction(n);
    if (taken.has(n)) continue;
    const on = sides(n % nodesX, (n / nodesX) | 0);
    for (const side of on) edgeTotal[side] += reaction(n) / on.length;
  }
  for (let n = 0; n < count; n++) {
    applied -= force[n];
    if (w[n] < w[deepest]) deepest = n;
  }

  // Span to judge the deflection by: twice the distance to the nearest support.
  // Between two walls that is the clear span, in a flat-slab bay its diagonal,
  // on a cantilever twice its length.
  const px = (deepest % nodesX) * hx, py = ((deepest / nodesX) | 0) * hy;
  let reach = Infinity;
  for (const n of supports) reach = Math.min(reach, Math.hypot((n % nodesX) * hx - px, ((n / nodesX) | 0) * hy - py));
  time.recover = now() - t;

  return {
    ...base, ok: true, reused, time, w, bx, by, mx, my, mxy,
    peak: { w: -w[deepest], node: deepest, x: px, y: py, span: 2 * reach },
    moment: { sag, hog },
    reactions: { columns, edges: edgeTotal, columnNodes, total: reacted, applied },
  };
}

// Centre deflection of a rectangular plate, hard simply supported on all four
// edges, under uniform load: Navier's double sine series, with the shear term
// that Mindlin theory adds. `shear: false` leaves the thin-plate value.
export function navier({ width, length, thickness, E, nu, q }, shear = true) {
  const D = (E * thickness ** 3) / (12 * (1 - nu * nu));
  const S = SHEAR_FACTOR * (E / (2 * (1 + nu))) * thickness;
  let sum = 0;
  for (let m = 1; m < 400; m += 2) {
    for (let n = 1; n < 400; n += 2) {
      const lambda = Math.PI ** 2 * ((m / width) ** 2 + (n / length) ** 2);
      const sign = ((m + n) / 2) % 2 ? 1 : -1;
      sum += (sign * 16 * q) / (Math.PI ** 2 * m * n) * (1 / (D * lambda * lambda) + (shear ? 1 / (S * lambda) : 0));
    }
  }
  return sum;
}
