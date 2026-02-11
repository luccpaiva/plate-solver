/**
 * Viewer: Three.js scene, plate mesh, pillars.
 */
import { createScene } from "./scene.js";
import {
  createPlate,
  updatePlateDeformation,
  setMeshGridVisible
} from "./plate.js";
import { updatePillars } from "./pillars.js";

export { getMeshDivisions, getPlateMesh, setMeshGridVisible } from "./plate.js";
export { getPillarMeshes } from "./pillars.js";

export function initViewer(canvas, _viewport) {
  const sceneApi = createScene(canvas);

  return {
    ...sceneApi,
    createPlate: (state) => createPlate(sceneApi.scene, state),
    updatePlateDeformation: (state) =>
      updatePlateDeformation(sceneApi.scene, state),
    updatePillars: (state) => updatePillars(sceneApi.scene, state),
    setMeshGridVisible,
    setGridVisible: (visible) => {
      sceneApi.gridHelper.visible = visible;
    }
  };
}
