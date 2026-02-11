/**
 * Mindlin-Reissner Plate FEA Solver
 * Gauss elimination with partial pivoting. 3 DOF/node: w, βx, βy.
 * Pillars expect coords in [0,width]×[0,length] (local).
 *
 * ## Mindlin-Reissner plate
 * First-order shear deformation; transverse normals remain straight but not necessarily
 * perpendicular to the midplane. Valid for moderate thickness (t/L roughly up to 0.2).
 *
 * ## Main assumptions
 * - **Linear elasticity**: small deflections, Hooke's law, no geometric nonlinearity.
 *   Large deflections (e.g. w ~ t) develop membrane stiffening not captured here.
 * - **Homogeneous isotropic material**: E, ν constant; no orthotropy or layers.
 * - **Uniform thickness**: t constant across the plate.
 * - **Rectangular domain**: regular nx×ny grid of 4-node bilinear elements.
 *
 * ## Simplifications
 * - **Load**: Uniform pressure only; no point loads or varying pressure.
 * - **Boundary conditions**: Penalty method (diagonal scaling) instead of elimination;
 *   edge supports fix w only (no rotation constraints); pillar "pinned" = w fixed,
 *   "fixed" = w, βx, βy fixed.
 * - **Numerics**: Dense global stiffness; Gauss elimination O(n³). No sparse solver,
 *   no iterative solvers, no factorization reuse.
 * - **Integration**: 2×2 Gauss for bending, reduced 1-point for shear (common to avoid
 *   shear locking; κ = 5/6 for shear correction).
 */

export function solvePlate(params) {
  const t0 = performance.now();
  const reportTiming = params.reportTiming === true;

  const { plate, material, load, pillars = [], edgeSupported = {}, nx, ny } = params;
  const { width, length, thickness } = plate;
  const { E, nu } = material;

  const nodesX = nx + 1;
  const nodesY = ny + 1;
  const numNodes = nodesX * nodesY;
  const dofPerNode = 3;
  const totalDof = numNodes * dofPerNode;
  const elemWidth = width / nx;
  const elemLength = length / ny;

  let t = performance.now();
  const Ke = computeElementStiffness(elemWidth, elemLength, thickness, E, nu);
  if (reportTiming) console.log(`  [solver] element stiffness: ${(performance.now() - t).toFixed(1)} ms`);

  t = performance.now();
  const K = new Float64Array(totalDof * totalDof);
  assembleGlobalDense(K, Ke, nx, ny, nodesX, dofPerNode, totalDof);
  if (reportTiming) console.log(`  [solver] global assembly (dense): ${(performance.now() - t).toFixed(1)} ms`);

  t = performance.now();
  const rhs = new Float64Array(totalDof);
  assembleLoads(rhs, load, elemWidth, elemLength, nx, ny, nodesX);
  if (reportTiming) console.log(`  [solver] load assembly: ${(performance.now() - t).toFixed(1)} ms`);

  const constrainedDofs = new Set();

  for (const p of pillars) {
    const ni = Math.round(p.x / elemWidth);
    const nj = Math.round(p.z / elemLength);
    const ci = Math.max(0, Math.min(nx, ni));
    const cj = Math.max(0, Math.min(ny, nj));
    const nodeIdx = cj * nodesX + ci;

    constrainedDofs.add(nodeIdx * 3);
    if (p.bc === "fixed") {
      constrainedDofs.add(nodeIdx * 3 + 1);
      constrainedDofs.add(nodeIdx * 3 + 2);
    }
  }

  const es = edgeSupported;
  if (es.left) for (let j = 0; j <= ny; j++) constrainedDofs.add(j * nodesX * 3);
  if (es.right) for (let j = 0; j <= ny; j++) constrainedDofs.add((j * nodesX + nx) * 3);
  if (es.bottom) for (let i = 0; i <= nx; i++) constrainedDofs.add(i * 3);
  if (es.top) for (let i = 0; i <= nx; i++) constrainedDofs.add((ny * nodesX + i) * 3);

  t = performance.now();
  const PENALTY = 1e10;
  for (const d of constrainedDofs) {
    K[d * totalDof + d] *= PENALTY;
    rhs[d] = 0;
  }
  if (reportTiming) console.log(`  [solver] BC penalty: ${(performance.now() - t).toFixed(1)} ms`);

  t = performance.now();
  gaussSolve(K, rhs, totalDof);
  if (reportTiming) console.log(`  [solver] gauss solve: ${(performance.now() - t).toFixed(1)} ms`);

  const deflections = new Float64Array(numNodes);
  let maxDefl = -Infinity, minDefl = Infinity;
  for (let n = 0; n < numNodes; n++) {
    const w = rhs[n * 3];
    deflections[n] = w;
    if (w > maxDefl) maxDefl = w;
    if (w < minDefl) minDefl = w;
  }

  const solveTime = performance.now() - t0;

  return {
    deflections,
    maxDeflection: Math.max(Math.abs(maxDefl), Math.abs(minDefl)),
    minDeflection: minDefl,
    dof: totalDof,
    solveTime
  };
}

function computeElementStiffness(a, b, t, E, nu) {
  const Ke = new Float64Array(144);
  const D = (E * t * t * t) / (12 * (1 - nu * nu));
  const Db = [D, D * nu, 0, D * nu, D, 0, 0, 0, D * (1 - nu) / 2];
  const kappa = 5 / 6;
  const G = E / (2 * (1 + nu));
  const Ds0 = kappa * G * t;
  const detJ = (a * b) / 4;
  const gp = 1 / Math.sqrt(3);
  const gaussPts2 = [-gp, gp];
  const gaussWts2 = [1, 1];

  for (let gi = 0; gi < 2; gi++) {
    for (let gj = 0; gj < 2; gj++) {
      const xi = gaussPts2[gi], eta = gaussPts2[gj];
      const wt = gaussWts2[gi] * gaussWts2[gj];
      const dNdx = [
        -(1 - eta) / (2 * a), (1 - eta) / (2 * a), (1 + eta) / (2 * a), -(1 + eta) / (2 * a)
      ];
      const dNdy = [
        -(1 - xi) / (2 * b), -(1 + xi) / (2 * b), (1 + xi) / (2 * b), (1 - xi) / (2 * b)
      ];

      for (let ni = 0; ni < 4; ni++) {
        for (let nj = 0; nj < 4; nj++) {
          const dix = dNdx[ni], diy = dNdy[ni], djx = dNdx[nj], djy = dNdy[nj];
          const c1_0 = Db[0] * djx + Db[2] * djy;
          const c1_1 = Db[3] * djx + Db[5] * djy;
          const c1_2 = Db[6] * djx + Db[8] * djy;
          const c2_0 = Db[1] * djy + Db[2] * djx;
          const c2_1 = Db[4] * djy + Db[5] * djx;
          const c2_2 = Db[7] * djy + Db[8] * djx;
          const factor = wt * detJ;
          const r = ni * 3, c = nj * 3;
          Ke[(r + 1) * 12 + (c + 1)] += factor * (dix * c1_0 + diy * c1_2);
          Ke[(r + 1) * 12 + (c + 2)] += factor * (dix * c2_0 + diy * c2_2);
          Ke[(r + 2) * 12 + (c + 1)] += factor * (diy * c1_1 + dix * c1_2);
          Ke[(r + 2) * 12 + (c + 2)] += factor * (diy * c2_1 + dix * c2_2);
        }
      }
    }
  }

  {
    // const xi = 0, eta = 0;
    const wt = 4;
    const N = [0.25, 0.25, 0.25, 0.25];
    const dNdx = [-1 / (2 * a), 1 / (2 * a), 1 / (2 * a), -1 / (2 * a)];
    const dNdy = [-1 / (2 * b), -1 / (2 * b), 1 / (2 * b), 1 / (2 * b)];
    const factor = wt * detJ * Ds0;

    for (let ni = 0; ni < 4; ni++) {
      for (let nj = 0; nj < 4; nj++) {
        const dix = dNdx[ni], diy = dNdy[ni], Ni = N[ni];
        const djx = dNdx[nj], djy = dNdy[nj], Nj = N[nj];
        const r = ni * 3, c = nj * 3;
        Ke[r * 12 + c] += factor * (dix * djx + diy * djy);
        Ke[r * 12 + (c + 1)] += factor * (dix * Nj);
        Ke[r * 12 + (c + 2)] += factor * (diy * Nj);
        Ke[(r + 1) * 12 + c] += factor * (Ni * djx);
        Ke[(r + 1) * 12 + (c + 1)] += factor * (Ni * Nj);
        Ke[(r + 2) * 12 + c] += factor * (Ni * djy);
        Ke[(r + 2) * 12 + (c + 2)] += factor * (Ni * Nj);
      }
    }
  }

  return Ke;
}

function assembleGlobalDense(K, Ke, nx, ny, nodesX, dofPerNode, n) {
  for (let ej = 0; ej < ny; ej++) {
    for (let ei = 0; ei < nx; ei++) {
      const n0 = ej * nodesX + ei;
      const elemNodes = [n0, n0 + 1, n0 + nodesX + 1, n0 + nodesX];
      for (let li = 0; li < 4; li++) {
        for (let lj = 0; lj < 4; lj++) {
          for (let di = 0; di < dofPerNode; di++) {
            const gi = elemNodes[li] * dofPerNode + di;
            for (let dj = 0; dj < dofPerNode; dj++) {
              const gj = elemNodes[lj] * dofPerNode + dj;
              const keVal = Ke[(li * dofPerNode + di) * 12 + (lj * dofPerNode + dj)];
              K[gi * n + gj] += keVal;
            }
          }
        }
      }
    }
  }
}

function gaussSolve(K, rhs, n) {
  const swapBuf = new Float64Array(n);

  for (let j = 0; j < n; j++) {
    const jn = j * n;
    let p = j;
    let maxVal = Math.abs(K[jn + j]);
    for (let i = j + 1; i < n; i++) {
      const v = Math.abs(K[i * n + j]);
      if (v > maxVal) { maxVal = v; p = i; }
    }
    if (p !== j) {
      const pn = p * n;
      swapBuf.set(K.subarray(jn, jn + n));
      K.copyWithin(jn, pn, pn + n);
      K.set(swapBuf.subarray(0, n), pn);
      const tmp = rhs[j]; rhs[j] = rhs[p]; rhs[p] = tmp;
    }
    const pivot = K[jn + j];
    if (Math.abs(pivot) < 1e-30) continue;
    const invPivot = 1.0 / pivot;
    for (let i = j + 1; i < n; i++) {
      const in_ = i * n;
      const m = K[in_ + j] * invPivot;
      if (m === 0) continue;
      K[in_ + j] = 0;
      for (let c = j + 1; c < n; c++) K[in_ + c] -= m * K[jn + c];
      rhs[i] -= m * rhs[j];
    }
  }
  for (let j = n - 1; j >= 0; j--) {
    const jn = j * n;
    let s = rhs[j];
    for (let c = j + 1; c < n; c++) s -= K[jn + c] * rhs[c];
    rhs[j] = s / K[jn + j];
  }
}

function assembleLoads(rhs, q, a, b, nx, ny, nodesX) {
  const elemLoad = (q * a * b) / 4;
  for (let ej = 0; ej < ny; ej++) {
    for (let ei = 0; ei < nx; ei++) {
      const n0 = ej * nodesX + ei;
      rhs[n0 * 3] -= elemLoad;
      rhs[(n0 + 1) * 3] -= elemLoad;
      rhs[(n0 + nodesX + 1) * 3] -= elemLoad;
      rhs[(n0 + nodesX) * 3] -= elemLoad;
    }
  }
}
