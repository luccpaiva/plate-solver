/**
 * Pillar mesh visualization.
 */
import * as THREE from "three";

const pillarMeshes = [];

export function createPillarMesh(pillar) {
  const geometry = new THREE.BoxGeometry(0.6, 3, 0.6);
  const material = new THREE.MeshPhongMaterial({
    color:
      pillar.bc === "fixed"
        ? 0xe94560
        : pillar.bc === "pinned"
        ? 0xfbbf24
        : 0x4ade80
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(pillar.x, -1.5, pillar.z);
  mesh.userData.pillarId = pillar.id;
  return mesh;
}

export function updatePillars(scene, state) {
  pillarMeshes.forEach((m) => scene.remove(m));
  pillarMeshes.length = 0;

  state.pillars.forEach((pillar) => {
    const mesh = createPillarMesh(pillar);
    scene.add(mesh);
    pillarMeshes.push(mesh);
  });

  const el = document.getElementById("pillarCount");
  if (el) el.textContent = state.pillars.length;
}

export function getPillarMeshes() {
  return pillarMeshes;
}
