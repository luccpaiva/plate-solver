// The slab in raw WebGL: a banded contour surface that takes the deflected
// shape, on its columns and walls, under an SVG layer that carries what a
// drawing would: dimensions, the section mark, the load and the peak.
// Nothing is drawn unless something changed.
import { easeInOut, easeOut, tween } from "./clock.js";

const STOREY = 3.2;     // what the supports stand on, metres below the slab
const COLUMN = 0.45;
const WALL = 0.22;
const UPSTAND = 0.8;    // a built-in edge shows its wall carrying on above
const FOV = 0.5;
const HOME = { azimuth: -0.62, elevation: 0.44 };

const BACKGROUND = [0.098, 0.122, 0.149];
const LIGHT = normalize([0.35, 0.9, 0.45]);
// walls are drawn as glass, so the slab still reads as a plate standing on them
const CONCRETE = { column: [0.56, 0.61, 0.66], wall: [0.6, 0.68, 0.76, 0.2], skirt: [0.43, 0.48, 0.53] };

// One colour per contour band. Deflection runs from bare concrete to gold;
// moments run from blue (hogging) through zero to orange (sagging), and with
// an even count the zero line is itself a contour.
const RAMPS = {
  sequential: ["#48525d", "#5d5c56", "#766b53", "#917b50", "#ab8b4e", "#c59b4f", "#d9ab57", "#e8bd6a", "#f2d085", "#f9e3a2"],
  diverging: ["#b3d9ff", "#86bffa", "#5ea3ee", "#4387d6", "#3c6aa6", "#41546d", "#6f574d", "#a05f42", "#cb6b3a", "#ea7f45", "#f9a172", "#ffc6a3"],
};

const SURFACE_VERTEX = `
attribute vec2 aPlan;
attribute vec4 aState;
uniform mat4 uView;
uniform float uGain;
varying float vValue;
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
  vWorld = vec3(aPlan.x, aState.x * uGain, -aPlan.y);
  vNormal = vec3(-aState.z * uGain, 1.0, aState.w * uGain);
  vValue = aState.y;
  gl_Position = uView * vec4(vWorld, 1.0);
}`;

const SURFACE_FRAGMENT = `
#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#endif
precision mediump float;
uniform sampler2D uRamp;
uniform vec3 uEye;
uniform vec3 uLight;
uniform float uBands;
uniform float uInk;
varying float vValue;
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
  if (uInk > 0.0) { gl_FragColor = vec4(1.0, 1.0, 1.0, uInk); return; }
  float level = clamp(vValue, 0.0, 1.0) * uBands;
  vec3 color = texture2D(uRamp, vec2((min(floor(level), uBands - 1.0) + 0.5) / uBands, 0.5)).rgb;
#ifdef GL_OES_standard_derivatives
  float edge = abs(fract(level - 0.5) - 0.5) / max(fwidth(level), 1e-5);
  color *= 1.0 - 0.3 * (1.0 - smoothstep(0.4, 1.4, edge));
#endif
  vec3 normal = normalize(vNormal);
  if (dot(normal, uEye - vWorld) < 0.0) { normal = -normal; color = vec3(0.2, 0.235, 0.27); }
  gl_FragColor = vec4(color * (0.74 + 0.26 * max(dot(normal, uLight), 0.0)), 1.0);
}`;

const SOLID_VERTEX = `
attribute vec3 aPosition;
attribute vec3 aNormal;
uniform mat4 uView;
uniform vec3 uLight;
varying float vShade;
void main() {
  vShade = 0.62 + 0.38 * max(dot(aNormal, uLight), 0.0);
  gl_Position = uView * vec4(aPosition, 1.0);
}`;

const SOLID_FRAGMENT = `
precision mediump float;
uniform vec4 uColor;
varying float vShade;
void main() { gl_FragColor = vec4(uColor.rgb * vShade, uColor.a); }`;

const LINE_VERTEX = `
attribute vec4 aPoint;
uniform mat4 uView;
varying float vAlpha;
void main() {
  vAlpha = aPoint.w;
  gl_Position = uView * vec4(aPoint.xyz, 1.0);
}`;

const LINE_FRAGMENT = `
precision mediump float;
uniform vec4 uColor;
varying float vAlpha;
void main() { gl_FragColor = vec4(uColor.rgb, uColor.a * vAlpha); }`;

/* ---- small vector and matrix kit, column-major like WebGL ----------- */

function normalize([x, y, z]) {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2), range = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * range, -1, 0, 0, 2 * far * near * range, 0];
}

function lookAt(eye, target) {
  const back = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  const right = normalize(cross([0, 1, 0], back));
  const up = cross(back, right);
  return [right[0], up[0], back[0], 0, right[1], up[1], back[1], 0, right[2], up[2], back[2], 0, -dot(right, eye), -dot(up, eye), -dot(back, eye), 1];
}

function multiply(a, b) {
  const out = new Array(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      out[column * 4 + row] = a[row] * b[column * 4] + a[4 + row] * b[column * 4 + 1] + a[8 + row] * b[column * 4 + 2] + a[12 + row] * b[column * 4 + 3];
    }
  }
  return out;
}

const hex = (colour) => [1, 3, 5].map((at) => parseInt(colour.slice(at, at + 2), 16));

// The colour of each band, for the legend beside the view.
export const bandColours = (kind) => RAMPS[kind];

/* ---- geometry builders ---------------------------------------------- */

// Six lit faces between two corners.
function pushBox(out, [x0, y0, z0], [x1, y1, z1]) {
  const quad = (a, b, c, d, n) => { for (const p of [a, b, c, a, c, d]) out.push(...p, ...n); };
  quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
  quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]);
  quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]);
  quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]);
  quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]);
  quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
}

export function createViewer(canvas, overlay) {
  const gl = canvas.getContext("webgl", { antialias: true, alpha: false, powerPreference: "low-power" });
  if (!gl) return null;
  gl.getExtension("OES_standard_derivatives");

  function program(vertex, fragment) {
    const handle = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(shader));
      gl.attachShader(handle, shader);
    }
    gl.linkProgram(handle);
    const locate = (kind, count, lookup) => Object.fromEntries(Array.from({ length: gl.getProgramParameter(handle, kind) || 0 }, (_, i) => {
      const { name } = count(handle, i);
      return [name, lookup(handle, name)];
    }));
    return {
      handle,
      attributes: locate(gl.ACTIVE_ATTRIBUTES, gl.getActiveAttrib.bind(gl), gl.getAttribLocation.bind(gl)),
      uniforms: locate(gl.ACTIVE_UNIFORMS, gl.getActiveUniform.bind(gl), gl.getUniformLocation.bind(gl)),
    };
  }

  const surface = program(SURFACE_VERTEX, SURFACE_FRAGMENT);
  const solid = program(SOLID_VERTEX, SOLID_FRAGMENT);
  const line = program(LINE_VERTEX, LINE_FRAGMENT);

  const buffers = Object.fromEntries(["plan", "state", "triangles", "grid", "columns", "walls", "skirt", "ground"].map((name) => [name, gl.createBuffer()]));
  const counts = { triangles: 0, grid: 0, columns: 0, walls: 0, skirt: 0, ground: 0 };
  // a texel per band
  const ramps = Object.fromEntries(Object.entries(RAMPS).map(([kind, bands]) => {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, bands.length, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(bands.flatMap((colour) => [...hex(colour), 255])));
    for (const [key, value] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, key, value);
    return [kind, texture];
  }));

  /* ---- state --------------------------------------------------------- */

  let scene = null;                 // slab, mesh and supports as last given
  let shown = new Float32Array(0);  // per node: w, value 0..1, dw/dx, dw/dy
  let aim = shown;
  let gain = 1;
  let ramp = "sequential";
  let meshLines = false;
  let notes = {};
  let pixels = 1;
  let run = 0;
  let glide = 0;
  let queued = false;
  const camera = { ...HOME, distance: 40, reach: 40 };
  const frame = { matrix: null, eye: [0, 0, 1], width: 1, height: 1 };

  const nodes = () => (scene ? (scene.nx + 1) * (scene.ny + 1) : 0);
  const fit = () => (0.5 * Math.hypot(scene.width, scene.length) + 2.2) / Math.sin(FOV / 2) * 0.8;

  function upload(name, data, usage = gl.STATIC_DRAW, target = gl.ARRAY_BUFFER) {
    gl.bindBuffer(target, buffers[name]);
    gl.bufferData(target, data, usage);
  }

  // Rebuilt when the slab, its mesh or its supports change.
  function setScene(next) {
    const remesh = !scene || scene.nx !== next.nx || scene.ny !== next.ny;
    const resized = !scene || scene.width !== next.width || scene.length !== next.length;
    scene = next;
    const { width, length, thickness, nx, ny } = scene;
    const hx = width / nx, hy = length / ny;

    if (remesh || resized) {
      const plan = new Float32Array(nodes() * 2);
      for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) plan.set([i * hx - width / 2, j * hy - length / 2], (j * (nx + 1) + i) * 2);
      upload("plan", plan);
    }
    if (remesh) {
      const triangles = new Uint16Array(nx * ny * 6), grid = new Uint16Array((nx * (ny + 1) + ny * (nx + 1)) * 2);
      let t = 0, g = 0;
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const n = j * (nx + 1) + i;
          triangles.set([n, n + 1, n + nx + 2, n, n + nx + 2, n + nx + 1], t);
          t += 6;
        }
      }
      for (let j = 0; j <= ny; j++) for (let i = 0; i < nx; i++) { grid[g++] = j * (nx + 1) + i; grid[g++] = j * (nx + 1) + i + 1; }
      for (let i = 0; i <= nx; i++) for (let j = 0; j < ny; j++) { grid[g++] = j * (nx + 1) + i; grid[g++] = (j + 1) * (nx + 1) + i; }
      upload("triangles", triangles, gl.STATIC_DRAW, gl.ELEMENT_ARRAY_BUFFER);
      upload("grid", grid, gl.STATIC_DRAW, gl.ELEMENT_ARRAY_BUFFER);
      counts.triangles = triangles.length;
      counts.grid = grid.length;
      shown = aim = new Float32Array(nodes() * 4);
      run++;
    }

    // columns and walls stop under the slab; world z runs south
    const X = width / 2, Z = length / 2, top = -thickness, base = -STOREY;
    const columns = [], walls = [];
    for (const { x, y } of scene.columns) {
      // a column on the slab's edge stands inside it
      const half = COLUMN / 2, cx = Math.max(half - X, Math.min(X - half, x - X)), cz = Math.max(half - Z, Math.min(Z - half, Z - y));
      pushBox(columns, [cx - half, base, cz - half], [cx + half, top, cz + half]);
    }
    const runs = { west: [[-X, -Z], [-X + WALL, Z]], east: [[X - WALL, -Z], [X, Z]], south: [[-X, Z - WALL], [X, Z]], north: [[-X, -Z], [X, -Z + WALL]] };
    for (const [side, [[x0, z0], [x1, z1]]] of Object.entries(runs)) {
      if (!scene.edges[side]) continue;
      pushBox(walls, [x0, base, z0], [x1, top, z1]);
      if (scene.edges[side] === 2) pushBox(walls, [x0, 0, z0], [x1, UPSTAND, z1]);
    }
    upload("columns", new Float32Array(columns));
    upload("walls", new Float32Array(walls));
    counts.columns = columns.length / 6;
    counts.walls = walls.length / 6;

    if (resized) {
      const reachOut = Math.ceil(Math.max(width, length) * 0.9 / 2) * 2, ground = [];
      for (let at = -reachOut; at <= reachOut; at += 2) {
        const fade = 1 - Math.abs(at) / (reachOut + 2);
        ground.push(at, base, -reachOut, 0, at, base, 0, fade, at, base, 0, fade, at, base, reachOut, 0);
        ground.push(-reachOut, base, at, 0, 0, base, at, fade, 0, base, at, fade, reachOut, base, at, 0);
      }
      upload("ground", new Float32Array(ground));
      counts.ground = ground.length / 4;
      const before = camera.reach;
      camera.reach = fit();
      camera.distance *= camera.reach / before;
    }
    invalidate();
  }

  // Slopes of the field being shown, so the shading follows the shape.
  function pack(w, values) {
    const { width, length, nx, ny } = scene, state = new Float32Array(nodes() * 4);
    const hx = width / nx, hy = length / ny, row = nx + 1;
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const n = j * row + i;
        state[n * 4] = w ? w[n] : 0;
        state[n * 4 + 1] = values ? values[n] : 0;
        if (!w) continue;
        state[n * 4 + 2] = (w[n + (i < nx ? 1 : 0)] - w[n - (i > 0 ? 1 : 0)]) / ((i > 0 && i < nx ? 2 : 1) * hx);
        state[n * 4 + 3] = (w[n + (j < ny ? row : 0)] - w[n - (j > 0 ? row : 0)]) / ((j > 0 && j < ny ? 2 : 1) * hy);
      }
    }
    return state;
  }

  // `values` is the field already scaled to 0..1 across the ramp. The slab
  // eases into a new state on the same mesh, and jumps when the mesh changed.
  function show({ w, values, kind, exaggeration }, ms = 0) {
    const from = shown, fromGain = gain, mine = ++run;
    ramp = kind;
    aim = pack(w, values);
    if (!ms || from.length !== aim.length) {
      shown = aim;
      gain = exaggeration;
      return invalidate();
    }
    const to = aim;
    shown = new Float32Array(to.length);
    tween(ms, (progress) => {
      const k = easeOut(progress);
      for (let i = 0; i < to.length; i++) shown[i] = from[i] + (to[i] - from[i]) * k;
      gain = fromGain + (exaggeration - fromGain) * k;
      invalidate();
    }, () => mine === run).catch(() => {});
  }

  /* ---- camera -------------------------------------------------------- */

  function place() {
    const { azimuth, elevation, distance } = camera, target = [0, -1.1, 0];
    frame.eye = [target[0] + distance * Math.cos(elevation) * Math.sin(azimuth), target[1] + distance * Math.sin(elevation), target[2] + distance * Math.cos(elevation) * Math.cos(azimuth)];
    frame.matrix = multiply(perspective(FOV, frame.width / frame.height, 0.5, 600), lookAt(frame.eye, target));
  }

  // To canvas layout pixels; null behind the eye.
  function project([x, y, z]) {
    const m = frame.matrix, depth = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (depth <= 0.01) return null;
    return [(0.5 + 0.5 * (m[0] * x + m[4] * y + m[8] * z + m[12]) / depth) * frame.width, (0.5 - 0.5 * (m[1] * x + m[5] * y + m[9] * z + m[13]) / depth) * frame.height];
  }

  // Deflection being shown at a plan point, between the nodes around it.
  function height(x, y) {
    const { width, length, nx, ny } = scene;
    const u = Math.max(0, Math.min(nx - 1e-6, (x / width) * nx)), v = Math.max(0, Math.min(ny - 1e-6, (y / length) * ny));
    const i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j, n = (j * (nx + 1) + i) * 4, up = (nx + 1) * 4;
    return ((shown[n] * (1 - a) + shown[n + 4] * a) * (1 - b) + (shown[n + up] * (1 - a) + shown[n + up + 4] * a) * b) * gain;
  }

  const world = (x, y, lift = 0) => [x - scene.width / 2, height(x, y) + lift, scene.length / 2 - y];
  const locate = (x, y, lift = 0) => project(world(x, y, lift));

  // Plan point under a screen point: the ray is met with the deflected slab
  // by a few steps of meeting it with a level plane.
  function pick(clientX, clientY, margin = 0) {
    if (!scene) return null;
    const rect = canvas.getBoundingClientRect();
    const sx = ((clientX - rect.left) / rect.width) * 2 - 1, sy = 1 - ((clientY - rect.top) / rect.height) * 2;
    const back = normalize([frame.eye[0], frame.eye[1] + 1.1, frame.eye[2]]);
    const right = normalize(cross([0, 1, 0], back)), up = cross(back, right);
    const tan = Math.tan(FOV / 2), aspect = frame.width / frame.height;
    const ray = normalize([0, 1, 2].map((k) => right[k] * sx * tan * aspect + up[k] * sy * tan - back[k]));
    let level = 0, x = 0, y = 0;
    for (let step = 0; step < 4; step++) {
      if (Math.abs(ray[1]) < 1e-6) return null;
      const along = (level - frame.eye[1]) / ray[1];
      if (along <= 0) return null;
      x = frame.eye[0] + ray[0] * along + scene.width / 2;
      y = scene.length / 2 - (frame.eye[2] + ray[2] * along);
      level = height(x, y);
    }
    if (x < -margin || y < -margin || x > scene.width + margin || y > scene.length + margin) return null;
    return { x: Math.max(0, Math.min(scene.width, x)), y: Math.max(0, Math.min(scene.length, y)) };
  }

  function look(next, ms = 0) {
    const from = { ...camera }, to = { ...camera, ...next }, mine = ++glide;
    if (!ms) {
      Object.assign(camera, to);
      invalidate();
      return Promise.resolve();
    }
    // the short way round
    to.azimuth = from.azimuth + ((((to.azimuth - from.azimuth) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    return tween(ms, (progress) => {
      const k = easeInOut(progress);
      for (const key of ["azimuth", "elevation", "distance"]) camera[key] = from[key] + (to[key] - from[key]) * k;
      invalidate();
    }, () => mine === glide).catch(() => {});
  }

  function orbit(dx, dy) {
    camera.azimuth -= dx * 0.008;
    camera.elevation = Math.max(-0.3, Math.min(1.52, camera.elevation + dy * 0.008));
    glide++;
    invalidate();
  }

  function zoom(factor) {
    camera.distance = Math.max(camera.reach * 0.45, Math.min(camera.reach * 2.2, camera.distance * factor));
    glide++;
    invalidate();
  }

  /* ---- drawing ------------------------------------------------------- */

  function attribute(shader, name, buffer, size, stride = 0, offset = 0) {
    const at = shader.attributes[name];
    if (at === undefined || at < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers[buffer]);
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, size, gl.FLOAT, false, stride, offset);
  }

  function drawSolid(buffer, count, colour) {
    if (!count) return;
    attribute(solid, "aPosition", buffer, 3, 24, 0);
    attribute(solid, "aNormal", buffer, 3, 24, 12);
    gl.uniform4fv(solid.uniforms.uColor, colour);
    gl.drawArrays(gl.TRIANGLES, 0, count);
  }

  // The slab's edge, given its thickness: follows the deflected rim.
  function buildSkirt() {
    const { width, length, thickness, nx, ny } = scene, out = [];
    const hx = width / nx, hy = length / ny;
    const rim = (i, j) => [i * hx - width / 2, shown[(j * (nx + 1) + i) * 4] * gain, length / 2 - j * hy];
    const strip = (a, b, normal) => {
      const [ax, ay, az] = a, [bx, by, bz] = b;
      for (const p of [[ax, ay, az], [bx, by, bz], [bx, by - thickness, bz], [ax, ay, az], [bx, by - thickness, bz], [ax, ay - thickness, az]]) out.push(...p, ...normal);
    };
    for (let i = 0; i < nx; i++) { strip(rim(i, 0), rim(i + 1, 0), [0, 0, 1]); strip(rim(i, ny), rim(i + 1, ny), [0, 0, -1]); }
    for (let j = 0; j < ny; j++) { strip(rim(0, j), rim(0, j + 1), [-1, 0, 0]); strip(rim(nx, j), rim(nx, j + 1), [1, 0, 0]); }
    upload("skirt", new Float32Array(out), gl.DYNAMIC_DRAW);
    counts.skirt = out.length / 6;
  }

  function draw() {
    queued = false;
    if (!scene || !frame.width) return;
    place();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(...BACKGROUND, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(line.handle);
    gl.uniformMatrix4fv(line.uniforms.uView, false, frame.matrix);
    gl.uniform4f(line.uniforms.uColor, 0.62, 0.7, 0.78, 0.2);
    attribute(line, "aPoint", "ground", 4);
    gl.enable(gl.BLEND);
    gl.depthMask(false);
    gl.drawArrays(gl.LINES, 0, counts.ground);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    gl.useProgram(solid.handle);
    gl.uniformMatrix4fv(solid.uniforms.uView, false, frame.matrix);
    gl.uniform3fv(solid.uniforms.uLight, LIGHT);
    buildSkirt();
    drawSolid("columns", counts.columns, [...CONCRETE.column, 1]);
    drawSolid("skirt", counts.skirt, [...CONCRETE.skirt, 1]);

    gl.useProgram(surface.handle);
    gl.uniformMatrix4fv(surface.uniforms.uView, false, frame.matrix);
    gl.uniform3fv(surface.uniforms.uEye, frame.eye);
    gl.uniform3fv(surface.uniforms.uLight, LIGHT);
    gl.uniform1f(surface.uniforms.uGain, gain);
    gl.uniform1f(surface.uniforms.uBands, RAMPS[ramp].length);
    gl.uniform1f(surface.uniforms.uInk, 0);
    gl.bindTexture(gl.TEXTURE_2D, ramps[ramp]);
    upload("state", shown, gl.DYNAMIC_DRAW);
    attribute(surface, "aPlan", "plan", 2);
    attribute(surface, "aState", "state", 4);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.triangles);
    gl.drawElements(gl.TRIANGLES, counts.triangles, gl.UNSIGNED_SHORT, 0);
    gl.disable(gl.POLYGON_OFFSET_FILL);

    gl.enable(gl.BLEND);
    if (meshLines) {
      gl.uniform1f(surface.uniforms.uInk, 0.16);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.grid);
      gl.drawElements(gl.LINES, counts.grid, gl.UNSIGNED_SHORT, 0);
    }
    gl.useProgram(solid.handle);
    gl.depthMask(false);
    drawSolid("walls", counts.walls, CONCRETE.wall);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    annotate();
  }

  /* ---- the drawing layer --------------------------------------------- */

  const number = (value, digits) => value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const pair = (point) => `${point[0].toFixed(1)} ${point[1].toFixed(1)}`;

  // A dimension the way a drawing gives one: extension lines, oblique ticks
  // and the figure set along the line, read from below or from the right. It
  // lies on the ground, clear of the slab and of what the slab stands on.
  function dimension(from, to, outward, text) {
    const step = (point, by) => [point[0] + outward[0] * by, -STOREY, point[2] + outward[2] * by];
    const a = project(step(from, 1.3)), b = project(step(to, 1.3));
    const feet = [[from, 0.3, 1.7], [to, 0.3, 1.7]].map(([point, near, far]) => [project(step(point, near)), project(step(point, far))]);
    if (!a || !b || feet.flat().includes(null)) return "";
    let angle = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
    if (angle > 90 || angle < -90) angle += 180;
    const middle = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const tick = (point) => `<path d="M${point[0] - 4} ${point[1] + 4}L${point[0] + 4} ${point[1] - 4}"/>`;
    return `<g class="pl-dimension">
      <path d="M${pair(a)}L${pair(b)}"/>${feet.map(([near, far]) => `<path d="M${pair(near)}L${pair(far)}"/>`).join("")}${tick(a)}${tick(b)}
      <text transform="translate(${pair(middle)}) rotate(${angle.toFixed(1)})" y="-6">${text}</text>
    </g>`;
  }

  function annotate() {
    if (!overlay) return;
    const { width, length, columns } = scene, X = width / 2, Z = length / 2;
    const parts = [], taken = [];

    // dimensions sit along the two edges that face the eye
    const south = Math.cos(camera.azimuth) >= 0, east = Math.sin(camera.azimuth) >= 0;
    parts.push(dimension([-X, 0, south ? Z : -Z], [X, 0, south ? Z : -Z], [0, 0, south ? 1 : -1], `${number(width, 2)} m`));
    parts.push(dimension([east ? X : -X, 0, Z], [east ? X : -X, 0, -Z], [east ? 1 : -1, 0, 0], `${number(length, 2)} m`));

    // The slab hides most of what it stands on, so each column is also marked
    // on top of it, the way a plan shows the columns below.
    for (const [index, column] of columns.entries()) {
      const half = COLUMN / 2, x = Math.max(half, Math.min(width - half, column.x)), y = Math.max(half, Math.min(length - half, column.y));
      const head = [[-half, -half], [half, -half], [half, half], [-half, half]].map(([dx, dy]) => locate(x + dx, y + dy, 0.01));
      if (head.includes(null)) continue;
      parts.push(`<path class="pl-column" d="M${head.map(pair).join("L")}Z"/>`);
      if (columns.length <= 14) parts.push(`<text class="pl-tag" x="${((head[0][0] + head[2][0]) / 2).toFixed(1)}" y="${(Math.min(...head.map((point) => point[1])) - 6).toFixed(1)}">C${index + 1}</text>`);
    }

    const cut = notes.section;
    if (cut) {
      const along = cut.axis === "x", steps = along ? scene.nx : scene.ny, span = along ? width : length;
      const at = (s) => (along ? [(s / steps) * span, cut.at] : [cut.at, (s / steps) * span]);
      const points = Array.from({ length: steps + 1 }, (_, s) => locate(...at(s), 0.02));
      const marks = [[-1.1, 0], [span + 1.1, steps]].map(([reach, s]) => {
        const [x, y] = along ? [reach, cut.at] : [cut.at, reach];
        return project([x - X, height(...at(s)), Z - y]);
      });
      if (!marks.includes(null)) taken.push(...marks);
      if (!points.includes(null) && !marks.includes(null)) {
        parts.push(`<path class="pl-cut" d="M${pair(marks[0])}L${points.map(pair).join("L")}L${pair(marks[1])}"/>`);
        parts.push(...marks.map((mark) => `<g class="pl-cut-mark" transform="translate(${pair(mark)})"><circle r="9"/><text y="4">A</text></g>`));
      }
    }

    const load = notes.load;
    if (load) {
      const tip = locate(load.x, load.y), tail = locate(load.x, load.y, 3.1);
      if (tip && tail) {
        const angle = Math.atan2(tip[1] - tail[1], tip[0] - tail[0]) * 180 / Math.PI - 90;
        parts.push(`<g class="pl-load${load.held ? " is-held" : ""}"><path d="M${pair(tail)}L${pair(tip)}"/>
          <path class="head" d="M0 0L-5 -13L5 -13Z" transform="translate(${pair(tip)}) rotate(${angle.toFixed(1)})"/>
          <text x="${tail[0].toFixed(1)}" y="${(tail[1] - 8).toFixed(1)}">${load.label}</text></g>`);
      }
    }

    const peak = notes.peak;
    if (peak) {
      const at = locate(peak.x, peak.y);
      if (at) {
        // the label leans to whichever side is clearer of the section marks and the frame
        const room = (lean) => Math.min(lean > 0 ? frame.width - at[0] - 150 : at[0] - 150, ...taken.map((mark) => Math.hypot(mark[0] - at[0] - lean * 70, mark[1] - at[1] + 44) - 40));
        const side = room(1) >= room(-1) ? 1 : -1, label = [at[0] + side * 46, at[1] - 44];
        parts.push(`<g class="pl-peak"><path d="M${pair(at)}L${pair(label)}h${side * 10}"/><circle cx="${at[0].toFixed(1)}" cy="${at[1].toFixed(1)}" r="4"/>
          <text x="${(label[0] + side * 15).toFixed(1)}" y="${(label[1] + 4).toFixed(1)}" text-anchor="${side > 0 ? "start" : "end"}">${peak.label}</text></g>`);
      }
    }

    const ghost = notes.ghost;
    if (ghost) {
      const at = locate(ghost.x, ghost.y);
      if (at) parts.push(`<g class="pl-ghost ${ghost.kind}" transform="translate(${pair(at)})"><circle r="9"/><path d="M-13 0h26M0 -13v26"/></g>`);
    }

    overlay.setAttribute("viewBox", `0 0 ${frame.width} ${frame.height}`);
    overlay.innerHTML = parts.join("");
  }

  function invalidate() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(draw);
  }

  // `scale` is how much the stage is scaled on screen, so the backing store
  // matches the pixels the canvas really covers.
  function resize(scale) {
    frame.width = canvas.clientWidth;
    frame.height = canvas.clientHeight;
    pixels = Math.min(window.devicePixelRatio || 1, 2) * Math.min(1.25, Math.max(0.35, scale));
    const width = Math.max(1, Math.round(frame.width * pixels)), height = Math.max(1, Math.round(frame.height * pixels));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    invalidate();
  }

  // a lost context comes back empty; starting over is simpler than rebuilding it
  canvas.addEventListener("webglcontextlost", (event) => event.preventDefault());
  canvas.addEventListener("webglcontextrestored", () => location.reload());

  return {
    camera, setScene, show, look, orbit, zoom, pick, locate, resize, invalidate,
    note(next) { notes = { ...notes, ...next }; invalidate(); },
    setMesh(visible) { meshLines = visible; invalidate(); },
    home: () => ({ ...HOME, distance: camera.reach }),
    plan: () => ({ azimuth: 0, elevation: 1.52, distance: camera.reach * 0.92 }),
  };
}
