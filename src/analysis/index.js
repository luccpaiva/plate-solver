/**
 * FEA analysis orchestration.
 */
import { solveFEA } from "../solver/index.js";
import { getMeshDivisions } from "../viewer/index.js";

export function runAnalysis(state, updateResults, updatePlateDeformation) {
  const { nx, ny } = getMeshDivisions(state);
  const { width, length } = state.plate;
  const pillarsLocal = state.pillars.map((p) => ({
    x: p.x + width / 2,
    z: p.z + length / 2,
    bc: p.bc
  }));

  const results = solveFEA(
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
}

export function updateResults(state) {
  if (!state.results) return;

  const { maxDeflection, minDeflection, dof, solveTime, factorTime } =
    state.results;

  const maxMm = Math.abs(minDeflection * 1000);
  const minMm = Math.abs(maxDeflection * 1000);

  const maxEl = document.getElementById("maxDeflection");
  if (maxEl) {
    maxEl.textContent = maxMm.toFixed(2) + " mm";
    maxEl.className =
      "result-value " + (maxMm > 50 ? "bad" : maxMm > 20 ? "warn" : "good");
  }

  const minEl = document.getElementById("minDeflection");
  if (minEl) minEl.textContent = minMm.toFixed(2) + " mm";

  const dofEl = document.getElementById("dofCount");
  if (dofEl) dofEl.textContent = dof.toLocaleString();

  const timeEl = document.getElementById("solveTime");
  if (timeEl) {
    timeEl.textContent = solveTime.toFixed(1) + " ms";
    timeEl.className =
      "result-value " +
      (solveTime > 50 ? "bad" : solveTime > 20 ? "warn" : "good");
  }

  const solverLabel = document.getElementById("solverLabel");
  if (solverLabel) solverLabel.textContent = "FEA";

  const factorTimeRow = document.getElementById("factorTimeRow");
  if (factorTimeRow) {
    if (factorTime != null) {
      document.getElementById("factorTime").textContent =
        factorTime.toFixed(1) + " ms";
      factorTimeRow.style.display = "";
    } else {
      factorTimeRow.style.display = "none";
    }
  }

  const legendMax = document.getElementById("legendMax");
  if (legendMax) legendMax.textContent = "0";
  const legendMid = document.getElementById("legendMid");
  if (legendMid) legendMid.textContent = (maxMm / 2).toFixed(1);
  const legendMin = document.getElementById("legendMin");
  if (legendMin) legendMin.textContent = maxMm.toFixed(1);
}
