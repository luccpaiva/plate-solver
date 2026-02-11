/**
 * Application state.
 */
export const state = {
  plate: { width: 20, length: 20, thickness: 0.2 },
  material: { E: 20e9, nu: 0.3 },
  load: 1000, // N/m² (1 kN/m²)
  pillars: [],
  editMode: "add", // 'add' or 'remove'
  boundaryCondition: "fixed", // pillar type: 'fixed', 'pinned', 'roller'
  edgeSupported: { left: true, right: true, top: true, bottom: true },
  meshNx: 9,
  meshNy: 9,
  results: null,
  feaCache: null,
  showMainGrid: true,
  showMeshGrid: true,
  deflectionScale: 50
};
