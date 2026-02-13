/**
 * FEA analysis orchestration.
 */
import { solveFEA } from "../solver/index.js";
import { getMeshDivisions } from "../viewer/index.js";

export async function runAnalysis(state, updateResults, updatePlateDeformation) {
  const t0 = performance.now();

  const { nx, ny } = getMeshDivisions(state);
  const { width, length } = state.plate;
  const pillarsLocal = state.pillars.map((p) => ({
    x: p.x + width / 2,
    z: p.z + length / 2,
    bc: p.bc
  }));

  const results = await solveFEA(
    {
      plate: state.plate,
      material: state.material,
      load: state.load,
      pillars: pillarsLocal,
      edgeSupported: state.edgeSupported,
      nx,
      ny
    },
    state.feaCache
  );

  state.results = results;
  updateResults(state);
  updatePlateDeformation(state);

  state.results.totalTime = performance.now() - t0;
  updateTotalTime(state);
}

export function updateResults(state) {
  if (!state.results) return;

  const { minDeflection, dof, backend, solveTime } =
    state.results;

  const maxMm = Math.abs(minDeflection * 1000);

  const maxEl = document.getElementById("maxDeflection");
  if (maxEl) {
    maxEl.textContent = maxMm.toFixed(2) + " mm";
    maxEl.className =
      "result-value " + (maxMm > 50 ? "bad" : maxMm > 20 ? "warn" : "good");
  }

  const dofEl = document.getElementById("dofCount");
  if (dofEl) dofEl.textContent = dof.toLocaleString();

  const solverLabel = document.getElementById("solverLabel");
  if (solverLabel) solverLabel.textContent = backend ? `FEA (${backend})` : "FEA";

  const backendLabel = document.getElementById("backendLabel");
  if (backendLabel) backendLabel.textContent = backend ?? "--";

  const solveTimeEl = document.getElementById("solveTime");
  if (solveTimeEl && solveTime != null) {
    solveTimeEl.textContent = solveTime.toFixed(1) + " ms";
  }

  const legendMax = document.getElementById("legendMax");
  if (legendMax) legendMax.textContent = "0";
  const legendMid = document.getElementById("legendMid");
  if (legendMid) legendMid.textContent = (maxMm / 2).toFixed(1);
  const legendMin = document.getElementById("legendMin");
  if (legendMin) legendMin.textContent = maxMm.toFixed(1);
}

function updateTotalTime(state) {
  const totalTime = state.results?.totalTime;
  if (totalTime == null) return;
  const el = document.getElementById("totalTime");
  if (el) {
    el.textContent = totalTime.toFixed(1) + " ms";
    el.className =
      "result-value " +
      (totalTime > 50 ? "bad" : totalTime > 20 ? "warn" : "good");
  }
}
