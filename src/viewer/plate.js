/**
 * Plate mesh: creation, deformation visualization, mesh divisions.
 */
import * as THREE from "three";

const MAX_MESH_FOR_PILLARS = 80;

/**
 * Return mesh divisions so that every pillar sits exactly on a node when possible.
 */
export function getMeshDivisions(state) {
  const { width, length } = state.plate;
  let nx = Math.max(2, state.meshNx);
  let ny = Math.max(2, state.meshNy);

  if (state.pillars.length === 0) {
    return { nx, ny };
  }

  const cap = Math.max(nx, ny, MAX_MESH_FOR_PILLARS);
  const TOL = 1e-12;
  for (const p of state.pillars) {
    const lx = p.x + width / 2;
    const lz = p.z + length / 2;
    const tx = lx / width;
    const tz = lz / length;
    let nxt = nx;
    while (nxt <= cap && Math.abs(tx * nxt - Math.round(tx * nxt)) > TOL) nxt++;
    nx = Math.max(nx, nxt > cap ? nx : nxt);
    let nyt = ny;
    while (nyt <= cap && Math.abs(tz * nyt - Math.round(tz * nyt)) > TOL) nyt++;
    ny = Math.max(ny, nyt > cap ? ny : nyt);
  }
  return { nx, ny };
}

function hslToRgb(h, s, l) {
  h = h / 360;
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToChannel(p, q, h + 1 / 3);
    g = hueToChannel(p, q, h);
    b = hueToChannel(p, q, h - 1 / 3);
  }
  return { r, g, b };
}

function hueToChannel(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function getDeflectionColor(t) {
  const hue = 240 * (1 - Math.max(0, Math.min(1, t)));
  return hslToRgb(hue, 0.9, 0.55);
}

function deflectionToColorParam(u) {
  const v = Math.max(0, Math.min(1, u));
  if (v <= 0.5) return 4 * v * v * v;
  return 1 - 4 * (1 - v) * (1 - v) * (1 - v);
}

let plateMesh = null;
let plateWireframe = null;

/**
 * Create or recreate the plate mesh in the scene.
 */
export function createPlate(scene, state) {
  if (plateMesh) scene.remove(plateMesh);

  const { width, length, thickness } = state.plate;
  const { nx, ny } = getMeshDivisions(state);

  const geometry = new THREE.PlaneGeometry(width, length, nx, ny);
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.MeshPhongMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    flatShading: false
  });

  const colors = new Float32Array(geometry.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = 0.2;
    colors[i + 1] = 0.5;
    colors[i + 2] = 0.8;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  plateMesh = new THREE.Mesh(geometry, material);
  plateMesh.position.y = thickness / 2;
  scene.add(plateMesh);

  const wireframe = new THREE.LineSegments(
    new THREE.WireframeGeometry(geometry),
    new THREE.LineBasicMaterial({
      color: 0x0f3460,
      opacity: 0.3,
      transparent: true
    })
  );
  plateWireframe = wireframe;
  plateWireframe.visible = state.showMeshGrid;
  plateMesh.add(plateWireframe);
}

export function setMeshGridVisible(visible) {
  if (plateWireframe) plateWireframe.visible = visible;
}

/**
 * Update plate deformation and colors from FEA results.
 */
export function updatePlateDeformation(_scene, state) {
  if (!plateMesh || !state.results) return;

  const positions = plateMesh.geometry.attributes.position;
  const colors = plateMesh.geometry.attributes.color;
  const { deflections, maxDeflection, minDeflection } = state.results;
  const range = maxDeflection - minDeflection || 1;

  for (let i = 0; i < positions.count; i++) {
    const deflection = deflections[i] || 0;
    const scaledDeflection = deflection * (state.deflectionScale ?? 50);
    positions.setY(i, state.plate.thickness / 2 + scaledDeflection);

    const t = (deflection - minDeflection) / range;
    const u = deflectionToColorParam(1 - t);
    const color = getDeflectionColor(u);
    colors.setXYZ(i, color.r, color.g, color.b);
  }

  positions.needsUpdate = true;
  colors.needsUpdate = true;
  plateMesh.geometry.computeVertexNormals();
}

export function getPlateMesh() {
  return plateMesh;
}

export function getPlateWireframe() {
  return plateWireframe;
}

/**
 * Given a raycast intersection on the plate mesh, return the nearest vertex index.
 */
/**
 * Given a raycast intersection on the plate mesh, return the nearest vertex index.
 */
export function getNearestVertexIndex(intersection) {
  const mesh = intersection.object;
  const face = intersection.face;
  const pos = mesh.geometry.attributes.position;

  // Convert world-space intersection point to local (geometry) space
  const local = mesh.worldToLocal(intersection.point.clone());

  let bestIdx = face.a;
  let bestDist = Infinity;
  for (const idx of [face.a, face.b, face.c]) {
    const dx = pos.getX(idx) - local.x;
    const dy = pos.getY(idx) - local.y;
    const dz = pos.getZ(idx) - local.z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestDist) {
      bestDist = d;
      bestIdx = idx;
    }
  }
  return bestIdx;
}
