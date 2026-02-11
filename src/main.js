/**
 * App entry: orchestration only.
 */
import "./styles/main.css";
import { state } from "./state/index.js";
import {
  initViewer,
  getPlateMesh,
  getPillarMeshes
} from "./viewer/index.js";
import { runAnalysis, updateResults } from "./analysis/index.js";
import { setupUI, setupInteraction } from "./ui/index.js";

const canvas = document.getElementById("canvas");
const viewport = document.getElementById("viewport");

const viewer = initViewer(canvas, viewport);

viewer.gridHelper.visible = state.showMainGrid;

const runAnalysisBound = () =>
  runAnalysis(
    state,
    (s) => updateResults(s),
    (s) => viewer.updatePlateDeformation(s)
  );

const api = {
  createPlate: (s) => viewer.createPlate(s),
  updatePillars: (s) => viewer.updatePillars(s),
  updatePlateDeformation: (s) => viewer.updatePlateDeformation(s),
  runAnalysis: runAnalysisBound,
  setMeshGridVisible: viewer.setMeshGridVisible,
  setGridVisible: viewer.setGridVisible,
  getPlateMesh: () => getPlateMesh(),
  getPillarMeshes: () => getPillarMeshes()
};

const { applyPillarPreset } = setupUI(state, api);
setupInteraction(canvas, viewer.camera, state, api);

window.addEventListener("resize", () => viewer.onResize(viewport));

viewer.onResize(viewport);

applyPillarPreset(state, 1);
viewer.createPlate(state);
viewer.updatePillars(state);
runAnalysisBound();
viewer.animate();
