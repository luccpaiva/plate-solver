/**
 * UI event handlers and setup.
 */
import * as THREE from "three";
import { setSolverBackend } from "../solver/index.js";
import { getNearestVertexIndex } from "../viewer/plate.js";

function setupSlider(
  id,
  stateKey,
  subKey,
  multiplier = 1,
  formatter = (v) => v,
  displayId,
  onChange
) {
  const slider = document.getElementById(id);
  const display = document.getElementById(displayId);
  if (!slider) return;

  slider.addEventListener("input", () => {
    const value = parseFloat(slider.value);
    if (subKey) {
      onChange.state[stateKey][subKey] = value * multiplier;
    } else {
      onChange.state[stateKey] = value * multiplier;
    }
    if (display) display.textContent = formatter(value);
    onChange.onChange();
  });
}

function applyPillarPreset(state, preset) {
  const { width, length } = state.plate;
  const r = Math.min(width, length) / 4;
  let positions;
  if (preset === 1) {
    positions = [{ x: 0, z: 0 }];
  } else if (preset === 3) {
    positions = [0, 120, 240].map((deg) => {
      const rad = (deg * Math.PI) / 180;
      return { x: r * Math.cos(rad), z: r * Math.sin(rad) };
    });
  } else {
    positions = [0, 60, 120, 180, 240, 300].map((deg) => {
      const rad = (deg * Math.PI) / 180;
      return { x: r * Math.cos(rad), z: r * Math.sin(rad) };
    });
  }
  state.pillars = positions.map((p, i) => ({
    id: Date.now() + i,
    x: p.x,
    z: p.z,
    bc: state.boundaryCondition
  }));
}

function updateEdgeDiagramUI(state) {
  ["left", "right", "top", "bottom"].forEach((key) => {
    const el = document.querySelector(
      `#edgeDiagram .edge-strip[data-edge="${key}"]`
    );
    if (el) {
      el.classList.toggle("supported", state.edgeSupported[key]);
      el.classList.toggle("unsupported", !state.edgeSupported[key]);
    }
  });
}

export function setupUI(state, api) {
  const onChange = () => {
    api.createPlate(state);
    api.updatePillars(state);
    api.runAnalysis();
  };

  setupSlider(
    "plateWidth",
    "plate",
    "width",
    1,
    (v) => v,
    "widthValue",
    { state, onChange }
  );
  setupSlider(
    "plateLength",
    "plate",
    "length",
    1,
    (v) => v,
    "lengthValue",
    { state, onChange }
  );
  setupSlider(
    "plateThickness",
    "plate",
    "thickness",
    0.001,
    (v) => v,
    "thicknessValue",
    { state, onChange }
  );
  setupSlider(
    "eMod",
    "material",
    "E",
    1e9,
    (v) => v,
    "eValue",
    { state, onChange }
  );
  setupSlider(
    "poisson",
    "material",
    "nu",
    1,
    (v) => v.toFixed(2),
    "nuValue",
    { state, onChange }
  );
  setupSlider(
    "uniformLoad",
    "load",
    null,
    1000,
    (v) => v.toFixed(1),
    "loadValue",
    { state, onChange }
  );

  const meshRes = document.getElementById("meshResolution");
  if (meshRes) {
    meshRes.addEventListener("input", (e) => {
      const targetNodes = Math.max(
        100,
        Math.min(100000, parseFloat(e.target.value))
      );
      const n = Math.max(2, Math.floor(Math.sqrt(targetNodes)) - 1);
      state.meshNx = n;
      state.meshNy = n;
      const valEl = document.getElementById("meshResolutionValue");
      if (valEl) valEl.textContent = ((n + 1) * (n + 1)).toLocaleString();
      onChange();
    });
  }

  const modeAdd = document.getElementById("modeAddPillar");
  const modeRemove = document.getElementById("modeRemove");
  const modeInspect = document.getElementById("modeInspect");
  const editButtons = [modeAdd, modeRemove, modeInspect];

  function setEditMode(mode, activeBtn) {
    state.editMode = mode;
    state.inspectMode = mode === "inspect";
    editButtons.forEach((b) => b?.classList.remove("active"));
    activeBtn?.classList.add("active");
    if (!state.inspectMode) {
      const tooltip = document.getElementById("inspectTooltip");
      if (tooltip) tooltip.style.display = "none";
    }
  }

  if (modeAdd) modeAdd.addEventListener("click", () => setEditMode("add", modeAdd));
  if (modeRemove) modeRemove.addEventListener("click", () => setEditMode("remove", modeRemove));
  if (modeInspect) modeInspect.addEventListener("click", () => setEditMode("inspect", modeInspect));

  const showMainGrid = document.getElementById("showMainGrid");
  if (showMainGrid) {
    showMainGrid.addEventListener("change", (e) => {
      state.showMainGrid = e.target.checked;
      api.setGridVisible(state.showMainGrid);
    });
  }

  const showMeshGrid = document.getElementById("showMeshGrid");
  if (showMeshGrid) {
    showMeshGrid.addEventListener("change", (e) => {
      state.showMeshGrid = e.target.checked;
      api.setMeshGridVisible(state.showMeshGrid);
    });
  }

  const deflectionScale = document.getElementById("deflectionScale");
  if (deflectionScale) {
    deflectionScale.addEventListener("input", (e) => {
      state.deflectionScale = Math.max(
        1,
        Math.min(200, parseFloat(e.target.value) || 50)
      );
      e.target.value = state.deflectionScale;
      const valEl = document.getElementById("deflectionScaleValue");
      if (valEl) valEl.textContent = state.deflectionScale;
      api.updatePlateDeformation(state);
    });
  }

  const edgeDiagram = document.getElementById("edgeDiagram");
  if (edgeDiagram) {
    edgeDiagram.addEventListener("click", (e) => {
      const edge = e.target.closest(".edge-strip")?.getAttribute("data-edge");
      if (edge && Object.hasOwn(state.edgeSupported, edge)) {
        state.edgeSupported[edge] = !state.edgeSupported[edge];
        updateEdgeDiagramUI(state);
        onChange();
      }
    });
  }
  updateEdgeDiagramUI(state);

  const pillar1 = document.getElementById("pillar1Center");
  const pillar3 = document.getElementById("pillar3Spaced");
  const pillar6 = document.getElementById("pillar6Spaced");
  const pillarConfig = document.querySelectorAll(".pillar-config button");

  function setPillarPreset(preset, activeEl) {
    pillarConfig?.forEach((el) => el.classList.remove("active"));
    activeEl?.classList.add("active");
    applyPillarPreset(state, preset);
    onChange();
  }

  if (pillar1) pillar1.addEventListener("click", () => setPillarPreset(1, pillar1));
  if (pillar3) pillar3.addEventListener("click", () => setPillarPreset(3, pillar3));
  if (pillar6) pillar6.addEventListener("click", () => setPillarPreset(6, pillar6));

  const clearPillars = document.getElementById("clearPillars");
  if (clearPillars) {
    clearPillars.addEventListener("click", () => {
      state.pillars = [];
      pillarConfig?.forEach((el) => el.classList.remove("active"));
      onChange();
    });
  }

  const backendButtons = document.querySelectorAll(".solver-backend button");
  backendButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      backendButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const backend = btn.dataset.backend;
      state.solverBackend = backend;
      setSolverBackend(backend);
      onChange();
    });
  });

  const openBenchmark = document.getElementById("openBenchmark");
  if (openBenchmark) {
    openBenchmark.addEventListener("click", () => {
      window.open("/tools/benchmarks/wasm-vs-js-benchmark.html", "_blank");
    });
  }

  return { applyPillarPreset };
}

export function setupInteraction(canvas, camera, state, api) {
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const tooltip = document.getElementById("inspectTooltip");

  canvas.addEventListener("mousemove", (event) => {
    if (!state.inspectMode || !state.results || !tooltip) return;

    const rect = canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const plateMesh = api.getPlateMesh();
    if (!plateMesh) { tooltip.style.display = "none"; return; }

    const intersects = raycaster.intersectObject(plateMesh, false);
    if (intersects.length > 0) {
      const vertexIndex = getNearestVertexIndex(intersects[0]);
      const deflection = state.results.deflections[vertexIndex] || 0;
      const mm = (deflection * 1000).toFixed(2);
      tooltip.textContent = `${mm} mm`;
      tooltip.style.left = `${event.clientX - rect.left + 14}px`;
      tooltip.style.top = `${event.clientY - rect.top - 14}px`;
      tooltip.style.display = "block";
    } else {
      tooltip.style.display = "none";
    }
  });

  canvas.addEventListener("mouseleave", () => {
    if (tooltip) tooltip.style.display = "none";
  });

  canvas.addEventListener("click", (event) => {
    if (state.inspectMode) return;

    const rect = canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const plateMesh = api.getPlateMesh();
    const pillarMeshes = api.getPillarMeshes();

    if (state.editMode === "add" && plateMesh) {
      const intersects = raycaster.intersectObject(plateMesh, false);
      if (intersects.length > 0) {
        const point = intersects[0].point;
        const existing = state.pillars.find(
          (p) =>
            Math.abs(p.x - point.x) < 1 && Math.abs(p.z - point.z) < 1
        );
        if (!existing) {
          state.pillars.push({
            id: Date.now(),
            x: point.x,
            z: point.z,
            bc: state.boundaryCondition
          });
          api.createPlate(state);
          api.updatePillars(state);
          api.runAnalysis();
        }
      }
    } else if (pillarMeshes?.length) {
      const intersects = raycaster.intersectObjects(pillarMeshes, false);
      if (intersects.length > 0) {
        const pillarId = intersects[0].object.userData.pillarId;
        state.pillars = state.pillars.filter((p) => p.id !== pillarId);
        api.createPlate(state);
        api.updatePillars(state);
        api.runAnalysis();
      }
    }
  });
}
