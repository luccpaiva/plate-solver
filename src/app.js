// The workspace around the solver: inputs on the left, the slab in the middle
// with a section through it underneath, results on the right. One plain state
// object; every change to it asks the worker for a new solution.
import { icons } from "./icons.js";
import { CANCELLED, wait } from "./clock.js";
import { FIXED, SIMPLE } from "./solver.js";
import { bandColours, createViewer } from "./viewer.js";
import { createChecks } from "./checks.js";
import { number, power, signed } from "./format.js";

const PAGES = [["model", "Model"], ["verify", "Verification"], ["perform", "Performance"]];
const TOOLS = [
  ["orbit", "Orbit", "Drag to turn the view, scroll to zoom"],
  ["column", "Column", "Click the slab to stand a column there. Click a column to remove it"],
  ["load", "Load", "Press and drag a point load across the slab"],
  ["section", "Section", "Click or drag to cut section A–A there"],
];
const FIELDS = {
  w: ["Deflection", "mm", "Deflection"],
  mx: ["Mx", "kNm/m", "Bending moment in strips that span west to east"],
  my: ["My", "kNm/m", "Bending moment in strips that span south to north"],
  mxy: ["Mxy", "kNm/m", "Twisting moment"],
};
const EDGES = { west: "West", east: "East", south: "South", north: "North" };
const SUPPORT = ["Free", "Simply supported", "Fixed"];
const SLIDERS = {
  width: ["Width", 6, 24, 1, (s) => s.slab.width, (s, v) => { s.slab.width = v; }, (v) => `${number(v, 1)} m`],
  length: ["Length", 6, 24, 1, (s) => s.slab.length, (s, v) => { s.slab.length = v; }, (v) => `${number(v, 1)} m`],
  thickness: ["Thickness", 150, 500, 10, (s) => Math.round(s.slab.thickness * 1000), (s, v) => { s.slab.thickness = v / 1000; }, (v) => `${v} mm`],
  modulus: ["Elastic modulus", 10, 45, 1, (s) => s.material.E / 1e9, (s, v) => { s.material.E = v * 1e9; }, (v) => `${v} GPa`],
  poisson: ["Poisson’s ratio", 0.1, 0.3, 0.01, (s) => s.material.nu, (s, v) => { s.material.nu = v; }, (v) => v.toFixed(2)],
  imposed: ["Imposed load", 0, 15, 0.5, (s) => s.load.imposed / 1000, (s, v) => { s.load.imposed = v * 1000; }, (v) => `${number(v, 1)} kN/m²`],
  point: ["Point load", 50, 500, 10, (s) => s.pointLoad / 1000, (s, v) => { s.pointLoad = v * 1000; }, (v) => `${v} kN`],
};
const LIMITS = [250, 360, 500];
const KERNELS = { js: "JavaScript", wasm: "WebAssembly" };
const MESHES = [1, 0.5, 0.25];
const DENSITY = 25e3;       // reinforced concrete, N/m3
const WORK_BUDGET = 5e8;    // multiplications a factorisation may cost before a mesh is refused
const TIMES = [["assemble", "Assemble", "#3987e5"], ["factor", "Factorise", "#d95926"], ["solve", "Substitute", "#199e70"], ["recover", "Recover", "#c98500"]];

const millimetres = (metres) => number(metres * 1000, Math.abs(metres) < 0.1 ? 1 : 0);
const kilo = (value, digits = 0) => number(value / 1000, digits);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function createApp(shell, solve) {
  const main = shell.querySelector("#main");
  const tip = shell.querySelector("#tooltip");
  const $ = (selector) => shell.querySelector(selector);
  const state = {};
  let viewer = null;
  let epoch = 0;
  let wanted = null;
  let busy = false;
  let fresh = true;
  let idle = [];

  function initial() {
    return {
      page: "model",
      slab: { width: 18, length: 12, thickness: 0.25 },
      material: { E: 30e9, nu: 0.2 },
      load: { selfWeight: true, imposed: 3000 },
      point: null, pointLoad: 150e3,
      edges: { west: SIMPLE, east: SIMPLE, south: SIMPLE, north: SIMPLE },
      columns: [],
      mesh: 0.5, kernel: "auto",
      tool: "orbit", field: "w", meshLines: false, view: "3d",
      cut: null, cutAxis: "x",
      limit: 250,
      solved: null, result: null, gain: 0, scale: null, placing: false,
    };
  }

  /* ---- the model ----------------------------------------------------- */

  const uniform = () => (state.load.selfWeight ? DENSITY * state.slab.thickness : 0) + state.load.imposed;

  function divisions(size) {
    const nx = Math.max(2, Math.round(state.slab.width / size)), ny = Math.max(2, Math.round(state.slab.length / size));
    return { nx, ny, work: 27 * nx * ny * Math.min(nx, ny) ** 2 };
  }

  // The finest mesh asked for that stays inside the budget.
  function mesh() {
    const size = MESHES.filter((option) => option >= state.mesh).reverse().find((option) => divisions(option).work <= WORK_BUDGET) ?? MESHES[0];
    return { size, ...divisions(size) };
  }

  function model() {
    const { nx, ny } = mesh(), { width, length } = state.slab;
    // a column stands on the nearest node, and is drawn there
    const columns = state.columns.map(({ x, y }) => ({ x: (Math.round((x / width) * nx) / nx) * width, y: (Math.round((y / length) * ny) / ny) * length }));
    return { ...state.slab, ...state.material, q: uniform(), point: state.point && { ...state.point, P: state.pointLoad }, columns, edges: { ...state.edges }, nx, ny, kernel: state.kernel };
  }

  // Only the newest request is worth solving: while one is out, later ones
  // replace each other and the last goes when the worker answers.
  function refresh(ms = 240) {
    wanted = { ms };
    if (busy) return;
    busy = true;
    (async () => {
      while (wanted) {
        const { ms: ease } = wanted, mine = epoch, asked = model();
        wanted = null;
        const result = await solve("model", { ...asked, fresh });
        fresh = false;
        if (mine === epoch) apply(asked, result, ease);
      }
      busy = false;
      for (const done of idle.splice(0)) done();
    })();
  }

  const settled = () => (busy ? new Promise((resolve) => idle.push(resolve)) : Promise.resolve());

  function apply(asked, result, ms) {
    state.solved = asked;
    state.result = result;
    viewer?.setScene({ width: asked.width, length: asked.length, thickness: asked.thickness, nx: asked.nx, ny: asked.ny, columns: asked.columns, edges: asked.edges });
    paint(ms);
    renderResults();
    renderPlan();
    renderStatus();
    $("#notice").hidden = result.ok;
  }

  const passes = (result) => result.peak.w <= result.peak.span / state.limit;

  // How much the shape is exaggerated: a round figure that changes only when
  // the drawn deflection would leave a comfortable share of the slab's size.
  function exaggeration(peak) {
    const size = Math.max(state.solved.width, state.solved.length), drawn = state.gain * peak;
    if (state.gain && drawn > 0.03 * size && drawn < 0.13 * size) return state.gain;
    const target = (0.065 * size) / Math.max(peak, 1e-9);
    state.gain = [5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2].find((step) => step <= target) ?? 1;
    return state.gain;
  }

  // The field in view, scaled across its colour ramp, and the notes drawn over it.
  function paint(ms = 0) {
    const { result, solved, field } = state;
    if (!result.ok) {
      state.scale = null;
      viewer?.show({ w: null, values: null, kind: "sequential", exaggeration: 1 }, ms);
    } else {
      const values = new Float32Array(result.w.length);
      if (field === "w") {
        for (let n = 0; n < values.length; n++) values[n] = Math.max(0, -result.w[n] / (result.peak.w || 1));
        state.scale = { kind: "sequential", top: result.peak.w * 1000 };
      } else {
        // Hogging peaks over a column dwarf the sagging between supports, so each
        // sign is spread over its own half of the ramp, and the legend says so.
        const source = result[field];
        let sag = 0, hog = 0;
        for (let n = 0; n < source.length; n++) { sag = Math.max(sag, source[n]); hog = Math.max(hog, -source[n]); }
        const floor = 0.05 * Math.max(sag, hog, 1e-9);
        sag = Math.max(sag, floor);
        hog = Math.max(hog, floor);
        for (let n = 0; n < values.length; n++) values[n] = 0.5 + (0.5 * source[n]) / (source[n] > 0 ? sag : hog);
        state.scale = { kind: "diverging", top: sag / 1000, low: hog / 1000 };
      }
      viewer?.show({ w: result.w, values, kind: state.scale.kind, exaggeration: exaggeration(result.peak.w) }, ms);
    }
    const cut = section();
    viewer?.note({
      peak: result.ok && field === "w" ? { x: result.peak.x, y: result.peak.y, label: `${millimetres(result.peak.w)} mm` } : null,
      section: result.ok ? cut : null,
      load: solved.point ? { x: solved.point.x, y: solved.point.y, label: `${kilo(solved.point.P)} kN` } : null,
    });
    renderLegend();
    renderDock();
  }

  /* ---- sampling ------------------------------------------------------ */

  // A nodal field between the nodes, in the units it is shown in.
  function sample(field, x, y) {
    const { result, solved } = state, { nx, ny } = solved;
    const u = clamp((x / solved.width) * nx, 0, nx - 1e-9), v = clamp((y / solved.length) * ny, 0, ny - 1e-9);
    const i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j, n = j * (nx + 1) + i, source = result[field];
    const value = (source[n] * (1 - a) + source[n + 1] * a) * (1 - b) + (source[n + nx + 1] * (1 - a) + source[n + nx + 2] * a) * b;
    return field === "w" ? -value * 1000 : value / 1000;
  }

  // Section A-A follows the deepest point until it has been placed by hand.
  function section() {
    const { result, solved } = state;
    if (!result?.ok) return null;
    const axis = state.cut?.axis ?? state.cutAxis, along = axis === "x";
    const lines = along ? solved.ny : solved.nx, size = along ? solved.length : solved.width;
    const wish = state.cut?.at ?? (along ? result.peak.y : result.peak.x);
    return { axis, at: (Math.round((clamp(wish, 0, size) / size) * lines) / lines) * size };
  }

  /* ---- small pieces -------------------------------------------------- */

  const seg = (id, label, options, tips = {}) => `
    <div class="ui-seg" id="${id}" role="group" aria-label="${label}">${options.map(([value, text]) => `<button data-act="${id}" data-value="${value}"${tips[value] ? ` data-tip="${tips[value]}"` : ""}>${text}</button>`).join("")}</div>`;

  const slider = (key) => {
    const [label, min, max, step] = SLIDERS[key];
    return `
      <label class="pl-slider" data-slider="${key}">
        <span>${label}</span><output></output>
        <input type="range" min="${min}" max="${max}" step="${step}" data-input="${key}" aria-label="${label}">
      </label>`;
  };

  const group = (title, body, action = "") => `
    <section class="pl-group">
      <header><h2>${title}</h2>${action}</header>
      ${body}
    </section>`;

  const cell = (id, title, aside = "") => `<section class="pl-cell" id="${id}"><header><h2>${title}</h2>${aside}</header><div class="pl-cell-body"></div></section>`;
  const row = (label, value, extra = "") => `<div class="pl-row ${extra}"><span>${label}</span><b>${value}</b></div>`;

  function mark(id, value) {
    shell.querySelectorAll(`#${id} button`).forEach((button) => button.classList.toggle("is-on", button.dataset.value === String(value)));
  }

  // Position of an element inside the unscaled 1280 x 800 stage.
  function box(element) {
    const frame = shell.getBoundingClientRect(), rect = element.getBoundingClientRect();
    const ratio = frame.width / shell.offsetWidth || 1;
    return { x: (rect.left - frame.left) / ratio, y: (rect.top - frame.top) / ratio, w: rect.width / ratio, h: rect.height / ratio };
  }

  // Where a plan point of the slab sits on the stage, and on the screen.
  function spot(x, y) {
    const frame = box($("#canvas")), at = viewer.locate(x, y) ?? [frame.w / 2, frame.h / 2];
    return { x: frame.x + at[0], y: frame.y + at[1] };
  }

  function client({ x, y }) {
    const frame = shell.getBoundingClientRect(), ratio = frame.width / shell.offsetWidth || 1;
    return { clientX: frame.left + x * ratio, clientY: frame.top + y * ratio };
  }

  function showTip(target) {
    tip.textContent = target.dataset.tip;
    const at = box(target);
    const left = clamp(at.x + at.w / 2 - tip.offsetWidth / 2, 8, shell.offsetWidth - tip.offsetWidth - 8);
    const below = at.y + at.h + 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${below + tip.offsetHeight > shell.offsetHeight - 8 ? at.y - tip.offsetHeight - 8 : below}px`;
    tip.classList.add("is-shown");
  }

  const hideTip = () => tip.classList.remove("is-shown");

  /* ---- skeleton ------------------------------------------------------ */

  function build() {
    shell.querySelector("#topbar").innerHTML = `
      <div class="pl-brand">
        <svg viewBox="0 0 30 18" aria-hidden="true"><path d="M2 5c7 6 19 6 26 0" fill="none" stroke="var(--pl-gold)" stroke-width="2.6" stroke-linecap="round"/><path d="M2 5v10M28 5v10M15 9.6V15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity=".7"/></svg>
        <span>Plate Solver</span>
      </div>
      <nav class="pl-tabs" id="tabs" aria-label="Pages">${PAGES.map(([key, label]) => `<button data-act="page" data-page="${key}">${label}</button>`).join("")}</nav>
      <div class="pl-status" id="status" role="status"></div>`;

    main.innerHTML = `
      <div class="pl-page pl-model" data-page="model">
        <aside class="pl-inputs" id="inputs">
          ${group("Slab", ["width", "length", "thickness"].map(slider).join(""))}
          ${group("Concrete", ["modulus", "poisson"].map(slider).join(""))}
          ${group("Load", `
            <button class="ui-check" id="self-weight" data-act="self-weight"><i>${icons.check()}</i><span>Self-weight</span><output></output></button>
            ${slider("imposed")}${slider("point")}
            <button class="pl-link" data-act="remove-load" id="remove-load">Remove the point load</button>`, '<output class="pl-group-note" id="total-load"></output>')}
          ${group("Supports", `
            <svg class="pl-plan" id="plan" role="group" aria-label="Plan of the slab: click an edge to change its support"></svg>
            <p class="pl-key"><span class="free">Free</span><span class="simple">Simple</span><span class="fixed">Fixed</span></p>`,
            '<button class="pl-link" data-act="clear-columns" id="clear-columns">Clear columns</button>')}
          ${group("Mesh", seg("mesh", "Element size", MESHES.map((size) => [size, `${size} m`])), '<output class="pl-group-note" id="mesh-note"></output>')}
        </aside>
        <div class="pl-work">
          <div class="pl-toolbar">
            ${seg("tool", "Tool", TOOLS, Object.fromEntries(TOOLS.map(([key, , hint]) => [key, hint])))}
            ${seg("field", "Result shown", Object.entries(FIELDS).map(([key, [label]]) => [key, label]), Object.fromEntries(Object.entries(FIELDS).map(([key, [, , hint]]) => [key, hint])))}
            <button class="ui-toggle" id="mesh-lines" data-act="mesh-lines" aria-pressed="false">Mesh</button>
            ${seg("view", "View", [["3d", "3D"], ["plan", "Plan"]])}
          </div>
          <div class="pl-view" id="view">
            <canvas id="canvas"></canvas>
            <svg class="pl-overlay" id="overlay" aria-hidden="true"></svg>
            <div class="pl-legend" id="legend"></div>
            <div class="pl-readout" id="readout"></div>
            <div class="pl-notice" id="notice" hidden>${icons.warning()}<div><b>Nothing holds this slab still.</b><span>Support an edge, or stand three columns that are not in one line.</span></div></div>
          </div>
          <div class="pl-dock" id="dock">
            <header>
              <h2>Section A–A</h2><span class="pl-dock-where" id="dock-where"></span>
              ${seg("cut-axis", "Section direction", [["x", "West–east"], ["y", "South–north"]])}
            </header>
            <div class="pl-dock-plot" id="dock-plot"></div>
          </div>
        </div>
        <aside class="pl-results" id="results">
          ${cell("deflection", "Deflection")}${cell("moments", "Bending moment")}${cell("reactions", "Reactions")}
          ${cell("solve", "Solve", seg("kernel", "Kernel", [["auto", "Auto"], ["wasm", "WASM"], ["js", "JS"]], { auto: "WebAssembly where it loads, JavaScript otherwise", wasm: "The kernel compiled from C++", js: "The same kernel in JavaScript" }))}
        </aside>
      </div>
      <div class="pl-page" data-page="verify" hidden></div>
      <div class="pl-page" data-page="perform" hidden></div>`;

    viewer = createViewer($("#canvas"), $("#overlay"));
    if (!viewer) $("#view").insertAdjacentHTML("beforeend", '<div class="pl-notice">This view needs WebGL, which this browser has turned off. The numbers on the right are still live.</div>');
  }

  const checks = createChecks({ solve, kernel: () => state.kernel, verify: () => main.querySelector('[data-page="verify"]'), perform: () => main.querySelector('[data-page="perform"]') });

  /* ---- rendering ----------------------------------------------------- */

  function renderInputs() {
    for (const [key, [, min, max, , get, , text]] of Object.entries(SLIDERS)) {
      const host = $(`[data-slider="${key}"]`), value = get(state);
      host.querySelector("input").value = value;
      host.querySelector("input").style.setProperty("--fill", `${((value - min) / (max - min)) * 100}%`);
      host.querySelector("output").textContent = key === "point" && !state.point ? "not placed" : text(value);
    }
    $("#self-weight").classList.toggle("is-on", state.load.selfWeight);
    $("#self-weight output").textContent = `${number((DENSITY * state.slab.thickness) / 1000, 2)} kN/m²`;
    $("#total-load").textContent = `${number(uniform() / 1000, 2)} kN/m²`;
    $("#clear-columns").disabled = !state.columns.length;
    $("#remove-load").disabled = !state.point;

    const { size, nx, ny } = mesh();
    mark("mesh", size);
    shell.querySelectorAll("#mesh button").forEach((button) => { button.disabled = divisions(Number(button.dataset.value)).work > WORK_BUDGET; });
    $("#mesh-note").textContent = `${nx} × ${ny} elements`;
    mark("tool", state.tool);
    mark("field", state.field);
    mark("view", state.view);
    mark("cut-axis", state.cut?.axis ?? state.cutAxis);
    mark("kernel", state.kernel);
    $("#mesh-lines").classList.toggle("is-on", state.meshLines);
    $("#mesh-lines").setAttribute("aria-pressed", state.meshLines);
    $("#canvas").dataset.tool = state.tool;
  }

  // The slab from above, the way a drawing marks its edges: a free edge is
  // dashed, a supported one solid, a built-in one hatched.
  function renderPlan() {
    const { width, length } = state.slab, room = { w: 212, h: 118 }, pad = 13;
    const k = Math.min((room.w - 2 * pad) / width, (room.h - 2 * pad) / length);
    const w = width * k, h = length * k, x0 = (room.w - w) / 2, y0 = (room.h - h) / 2;
    const at = (x, y) => [x0 + x * k, y0 + (length - y) * k];
    const ends = { west: [at(0, 0), at(0, length), [-1, 0]], east: [at(width, 0), at(width, length), [1, 0]], south: [at(0, 0), at(width, 0), [0, 1]], north: [at(0, length), at(width, length), [0, -1]] };
    const edges = Object.entries(ends).map(([side, [a, b, out]]) => {
      const kind = state.edges[side], run = Math.hypot(b[0] - a[0], b[1] - a[1]), hatch = [];
      if (kind === FIXED) {
        for (let s = 3; s < run; s += 7) {
          const px = a[0] + ((b[0] - a[0]) * s) / run, py = a[1] + ((b[1] - a[1]) * s) / run;
          hatch.push(`M${px.toFixed(1)} ${py.toFixed(1)}l${(out[0] * 6 + out[1] * 4).toFixed(1)} ${(out[1] * 6 + out[0] * 4).toFixed(1)}`);
        }
      }
      return `
        <g class="pl-edge ${["free", "simple", "fixed"][kind]}" data-act="edge" data-edge="${side}" data-tip="${EDGES[side]} edge: ${SUPPORT[kind].toLowerCase()}. Click to change" tabindex="0" role="button" aria-label="${EDGES[side]} edge, ${SUPPORT[kind]}">
          <path class="hit" d="M${a[0]} ${a[1]}L${b[0]} ${b[1]}"/><path class="ink" d="M${a[0]} ${a[1]}L${b[0]} ${b[1]}"/>${hatch.length ? `<path class="hatch" d="${hatch.join("")}"/>` : ""}
        </g>`;
    }).join("");
    const columns = (state.solved?.columns ?? []).map(({ x, y }) => { const [px, py] = at(x, y); return `<rect class="column" x="${(px - 3.5).toFixed(1)}" y="${(py - 3.5).toFixed(1)}" width="7" height="7"/>`; }).join("");
    const load = state.point ? (([px, py]) => `<g class="load" transform="translate(${px.toFixed(1)} ${py.toFixed(1)})"><circle r="5"/><path d="M-3.5 -3.5l7 7M3.5 -3.5l-7 7"/></g>`)(at(state.point.x, state.point.y)) : "";
    const cut = section();
    let line = "";
    if (cut) {
      const [a, b] = cut.axis === "x" ? [at(0, cut.at), at(width, cut.at)] : [at(cut.at, 0), at(cut.at, length)];
      line = `<path class="cut" d="M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}"/>`;
    }
    const plan = $("#plan");
    plan.setAttribute("viewBox", `0 0 ${room.w} ${room.h}`);
    plan.innerHTML = `<rect class="slab" x="${x0}" y="${y0}" width="${w}" height="${h}"/>${line}${edges}${columns}${load}`;
  }

  function renderLegend() {
    const { scale, field, result } = state, host = $("#legend");
    if (!scale) { host.innerHTML = ""; return; }
    const [label, unit] = FIELDS[field], diverging = scale.kind === "diverging";
    const colours = bandColours(scale.kind), figure = (value) => number(value, value < 100 ? 1 : 0);
    host.innerHTML = `
      <div class="pl-legend-title"><b>${label}</b><span>${unit}</span></div>
      <div class="pl-legend-bar">${colours.map((colour) => `<i style="background: ${colour}"></i>`).join("")}</div>
      <div class="pl-legend-ticks">${diverging ? `<span>−${figure(scale.low)}</span><span>0</span><span>+${figure(scale.top)}</span>` : `<span>0</span><span>${figure(scale.top / 2)}</span><span>${figure(scale.top)}</span>`}</div>
      <p>${diverging ? `${field === "mxy" ? "Blue is negative, orange positive" : "Blue hogs, orange sags"}, each on its own scale.<br>` : ""}Shape drawn ×${number(result.ok ? state.gain : 1)}</p>`;
  }

  // The field in view along the cut. Drawn as a beam diagram is: sagging and
  // downward deflection below the line, with a triangle under every support.
  function renderDock() {
    const { result, solved, field } = state, host = $("#dock-plot"), cut = section();
    if (!cut) {
      host.innerHTML = '<p class="pl-dock-empty">The section appears once the slab is held.</p>';
      $("#dock-where").textContent = "";
      return;
    }
    const along = cut.axis === "x", steps = along ? solved.nx : solved.ny, span = along ? solved.width : solved.length;
    const [label, unit] = FIELDS[field];
    $("#dock-where").textContent = `${label} along ${along ? "y" : "x"} = ${number(cut.at, 2)} m`;
    const line = Math.round((cut.at / (along ? solved.length : solved.width)) * (along ? solved.ny : solved.nx));
    const node = (s) => (along ? line * (solved.nx + 1) + s : s * (solved.nx + 1) + line);
    const values = Array.from({ length: steps + 1 }, (_, s) => (field === "w" ? -result.w[node(s)] * 1000 : result[field][node(s)] / 1000));

    const W = host.clientWidth || 708, H = 104, left = 12, right = 12, top = 16, bottom = 22;
    const low = Math.min(0, ...values), high = Math.max(0, ...values), range = high - low || 1;
    const px = (s) => left + (s / steps) * (W - left - right), py = (value) => top + ((value - low) / range) * (H - top - bottom);
    const base = py(0), curve = values.map((value, s) => `${px(s).toFixed(1)} ${py(value).toFixed(1)}`).join("L");
    const area = `M${px(0)} ${base.toFixed(1)}L${curve}L${px(steps)} ${base.toFixed(1)}Z`;
    // one label at each extreme that is far enough from zero to be worth reading
    const digits = (value) => (Math.abs(value) < 100 ? 1 : 0);
    const extremes = [[high, 1], [low, -1]].filter(([value]) => Math.abs(value) > 0.04 * range).map(([value, side]) => {
      // the label of a low point near the right end keeps clear of the span's own figure
      const s = values.indexOf(value), x = clamp(px(s), 44, W - (side > 0 ? 112 : 44));
      return `<circle class="dot ${side > 0 ? "sag" : "hog"}" cx="${px(s).toFixed(1)}" cy="${py(value).toFixed(1)}" r="3.5"/>
        <text class="value" x="${x.toFixed(1)}" y="${(py(value) + (side > 0 ? 15 : -7)).toFixed(1)}" text-anchor="middle">${signed(value, digits(value))} ${unit}</text>`;
    }).join("");
    const held = new Set(result.reactions.columnNodes);
    const edgeHeld = (s) => (s === 0 && solved.edges[along ? "west" : "south"]) || (s === steps && solved.edges[along ? "east" : "north"]);
    const supports = values.map((_, s) => (held.has(node(s)) || edgeHeld(s) ? `<path class="support" d="M${px(s).toFixed(1)} ${base.toFixed(1)}l-5 8h10z"/>` : "")).join("");

    host.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" class="${field === "w" ? "deflection" : "moment"}" role="img" aria-label="${label} along section A–A">
        <defs><clipPath id="below"><rect x="0" y="${base.toFixed(1)}" width="${W}" height="${H}"/></clipPath><clipPath id="above"><rect x="0" y="0" width="${W}" height="${base.toFixed(1)}"/></clipPath></defs>
        <path class="fill sag" d="${area}" clip-path="url(#below)"/><path class="fill hog" d="${area}" clip-path="url(#above)"/>
        <path class="base" d="M${left} ${base.toFixed(1)}H${W - right}"/>${supports}
        <path class="curve" d="M${curve}"/>${extremes}
        <text class="end" x="${left}" y="${H - 5}">0</text><text class="end" x="${W - right}" y="${H - 5}" text-anchor="end">${number(span, 2)} m</text>
        <g class="probe" visibility="hidden"><path d="M0 ${top - 6}V${H - bottom + 4}"/><circle r="3.5"/></g>
      </svg>
      <output class="pl-dock-tip" hidden></output>`;

    const picture = host.querySelector("svg"), probe = host.querySelector(".probe"), readout = host.querySelector(".pl-dock-tip");
    picture.addEventListener("pointermove", (event) => {
      const frame = picture.getBoundingClientRect();
      const s = clamp(Math.round((((event.clientX - frame.left) / frame.width) * W - left) / (W - left - right) * steps), 0, steps);
      probe.setAttribute("visibility", "visible");
      probe.setAttribute("transform", `translate(${px(s).toFixed(1)} 0)`);
      probe.querySelector("circle").setAttribute("cy", py(values[s]).toFixed(1));
      readout.hidden = false;
      readout.textContent = `${number((s / steps) * span, 2)} m: ${signed(values[s], digits(values[s]))} ${unit}`;
      readout.style.left = `${clamp(px(s), 70, W - 70)}px`;
    });
    picture.addEventListener("pointerleave", () => { probe.setAttribute("visibility", "hidden"); readout.hidden = true; });
  }

  function renderResults() {
    const { result, solved } = state, body = (id) => $(`#${id} .pl-cell-body`);
    const limits = seg("limit", "Deflection limit", LIMITS.map((limit) => [limit, `L/${limit}`]));
    const place = `<button class="ui-btn" data-act="autoplace" id="autoplace"${state.placing ? " disabled" : ""}>${state.placing ? "Placing columns…" : "Add columns until it passes"}</button>`;

    if (!result.ok) {
      body("deflection").innerHTML = `<div class="pl-figure is-void"><strong>–</strong><span>mm</span></div><p class="pl-sub">No unique answer: the slab is a mechanism.</p>${limits}
        <button class="ui-btn" data-act="autoplace" id="autoplace"${state.placing ? " disabled" : ""}>Stand it on corner columns</button>`;
      for (const id of ["moments", "reactions"]) body(id).innerHTML = '<p class="pl-sub">Waiting for supports.</p>';
      body("solve").innerHTML = row("Unknowns", number(result.dof));
      mark("limit", state.limit);
      return;
    }

    const { peak, moment, reactions, time } = result, allowed = peak.span / state.limit, use = peak.w / allowed, ok = use <= 1;
    body("deflection").innerHTML = `
      <div class="pl-figure"><strong>${millimetres(peak.w)}</strong><span>mm</span></div>
      <p class="pl-sub" data-tip="The span is taken as twice the distance from the deepest point to the nearest support: the clear span between walls, the diagonal of a flat-slab bay, twice a cantilever.">Span ${number(peak.span, 1)} m, so L/${number(peak.span / peak.w)}</p>
      ${limits}
      <div class="pl-meter ${ok ? (use > 0.85 ? "near" : "ok") : "over"}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(use * 100)}" aria-label="Share of the allowed deflection"><i style="width: ${Math.min(100, use * 100).toFixed(1)}%"></i></div>
      <p class="pl-verdict ${ok ? "ok" : "over"}">${ok ? icons.checkCircle() : icons.warning()}<span>${ok ? "Within" : "Over"} the ${millimetres(allowed)} mm allowed</span><b>${number(use * 100)}%</b></p>
      ${ok ? "" : place}`;
    mark("limit", state.limit);

    body("moments").innerHTML = row("Sagging", `${kilo(moment.sag, 1)} <i>kNm/m</i>`, "sag") + row("Hogging", `${signed(moment.hog / 1000, 1)} <i>kNm/m</i>`, "hog");

    const residual = Math.abs(reactions.total - reactions.applied) / reactions.applied;
    const parts = [
      ...solved.columns.map((_, index) => [`C${index + 1}`, reactions.columns[index]]),
      ...Object.entries(EDGES).filter(([side]) => solved.edges[side]).map(([side, label]) => [`${label} ${solved.edges[side] === FIXED ? "wall, fixed" : "wall"}`, reactions.edges[side]]),
    ];
    body("reactions").innerHTML = `
      ${row("Load on the slab", `${kilo(reactions.applied)} <i>kN</i>`)}
      ${row("Carried by supports", `${kilo(reactions.total)} <i>kN</i>`)}
      <p class="pl-verdict ok" data-tip="Reactions come from K·u − f at the held unknowns. Their sum is checked against the load.">${icons.checkCircle()}<span>In equilibrium</span><b>${power(residual)}</b></p>
      <div class="pl-list">${parts.map(([label, value]) => `<div><span>${label}</span><b>${kilo(value)} <i>kN</i></b><u style="width: ${clamp((100 * value) / reactions.applied, 0, 100).toFixed(1)}%"></u></div>`).join("")}</div>`;

    const total = TIMES.reduce((sum, [key]) => sum + time[key], 0);
    body("solve").innerHTML = `
      ${row("Unknowns", number(result.dof))}
      ${row("Half bandwidth", number(result.band))}
      <div class="pl-times">${TIMES.map(([key, , colour]) => (time[key] > 0 ? `<i style="flex: ${Math.max(1, (100 * time[key]) / total).toFixed(1)}; background: ${colour}"></i>` : "")).join("")}</div>
      <div class="pl-time-key">${TIMES.map(([key, label, colour]) => `<span><i style="background: ${colour}"></i>${label}<b>${result.reused && (key === "assemble" || key === "factor") ? "kept" : `${number(time[key], time[key] < 100 ? 1 : 0)} ms`}</b></span>`).join("")}</div>`;
  }

  function renderStatus() {
    const { result } = state, host = $("#status");
    if (!result) { host.textContent = ""; return; }
    if (!result.ok) { host.innerHTML = `<span class="warn">${icons.warning("small")}Mechanism</span>`; return; }
    const total = TIMES.reduce((sum, [key]) => sum + result.time[key], 0);
    host.innerHTML = `<span>${number(result.dof)} unknowns</span><span>${KERNELS[result.backend]}</span><span>${result.reused ? "factor reused, " : ""}solved in <b>${number(total, 1)} ms</b></span>`;
  }

  function renderPage() {
    shell.querySelectorAll("#tabs button").forEach((button) => button.classList.toggle("is-on", button.dataset.page === state.page));
    main.querySelectorAll(".pl-page").forEach((page) => { page.hidden = page.dataset.page !== state.page; });
    if (state.page !== "model") checks.open(state.page);
    else viewer?.invalidate();
  }

  /* ---- actions ------------------------------------------------------- */

  // Keeps what stands on the slab inside it when the slab shrinks.
  function contain() {
    const { width, length } = state.slab, inside = ({ x, y, ...rest }) => ({ ...rest, x: clamp(x, 0, width), y: clamp(y, 0, length) });
    state.columns = state.columns.map(inside).filter((column, index, list) => list.findIndex((other) => other.x === column.x && other.y === column.y) === index);
    if (state.point) state.point = inside(state.point);
  }

  function toggleColumn({ x, y }) {
    const near = state.columns.findIndex((column) => Math.hypot(column.x - x, column.y - y) < 0.8);
    if (near >= 0) state.columns.splice(near, 1);
    else state.columns.push({ x: Math.round(x * 2) / 2, y: Math.round(y * 2) / 2 });
    renderInputs();
    refresh();
  }

  function moveLoad(at) {
    state.point = { x: at.x, y: at.y };
    renderInputs();
    refresh(0);
  }

  function moveCut(at) {
    state.cut = { axis: state.cutAxis, at: state.cutAxis === "x" ? at.y : at.x };
    paint();
    renderPlan();
  }

  // Greedy: a column goes under the deepest point until the limit is met.
  async function autoplace() {
    if (state.placing) return;
    const mine = epoch, alive = () => mine === epoch;
    state.placing = true;
    try {
      for (let step = 0; step < 12 && alive(); step++) {
        await settled();
        const { result } = state, { width, length } = state.slab;
        if (result.ok && passes(result)) break;
        if (result.ok) state.columns.push({ x: result.peak.x, y: result.peak.y });
        else state.columns.push({ x: 0, y: 0 }, { x: width, y: 0 }, { x: 0, y: length }, { x: width, y: length });
        renderInputs();
        refresh(380);
        await settled();
        await wait(620, alive);
      }
    } catch (error) {
      if (error !== CANCELLED) throw error;
    } finally {
      if (alive()) {
        state.placing = false;
        renderResults();
      }
    }
  }

  function act(target) {
    const { act: name, value } = target.dataset;
    if (name === "page") { state.page = target.dataset.page; return renderPage(); }
    if (name === "run-verify" || name === "run-bench") return checks.run(name);
    if (name === "tool") { state.tool = value; viewer?.note({ ghost: null }); return renderInputs(); }
    if (name === "field") { state.field = value; renderInputs(); return paint(260); }
    if (name === "limit") { state.limit = Number(value); return renderResults(); }
    if (name === "cut-axis") { state.cutAxis = value; state.cut = null; renderInputs(); paint(); return renderPlan(); }
    if (name === "mesh-lines") { state.meshLines = !state.meshLines; viewer?.setMesh(state.meshLines); return renderInputs(); }
    if (name === "view") { state.view = value; renderInputs(); return viewer?.look(value === "plan" ? viewer.plan() : viewer.home(), 800); }
    if (name === "autoplace") return autoplace();
    if (name === "mesh") state.mesh = Number(value);
    if (name === "kernel") state.kernel = value;
    if (name === "self-weight") state.load.selfWeight = !state.load.selfWeight;
    if (name === "clear-columns") state.columns = [];
    if (name === "remove-load") state.point = null;
    if (name === "edge") state.edges[target.dataset.edge] = (state.edges[target.dataset.edge] + 1) % 3;
    renderInputs();
    if (name === "edge") renderPlan();
    refresh();
  }

  shell.addEventListener("click", (event) => {
    const target = event.target.closest("[data-act]");
    if (target && !target.disabled) act(target);
  });

  shell.addEventListener("keydown", (event) => {
    const target = event.target.closest('[data-act="edge"]');
    if (target && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); act(target); }
  });

  shell.addEventListener("input", (event) => {
    const key = event.target.dataset.input;
    if (!key) return;
    SLIDERS[key][5](state, Number(event.target.value));
    contain();
    renderInputs();
    if (key !== "point" || state.point) refresh(key === "width" || key === "length" ? 0 : 140);
  });

  shell.addEventListener("pointerover", (event) => {
    const target = event.target.closest("[data-tip]");
    if (target) showTip(target);
    else hideTip();
  });
  shell.addEventListener("pointerleave", hideTip);

  // Reads the slab under the pointer, and shows where a click would land.
  function hover(event) {
    const readout = $("#readout"), { result } = state;
    const at = event.target === $("#canvas") && result?.ok ? viewer.pick(event.clientX, event.clientY) : null;
    if (!at) {
      readout.textContent = "";
      viewer?.note({ ghost: null });
      return;
    }
    readout.innerHTML = `<span>x ${number(at.x, 2)} m</span><span>y ${number(at.y, 2)} m</span><b>${signed(sample("w", at.x, at.y), 1)} mm</b><span>Mx ${signed(sample("mx", at.x, at.y), 1)}</span><span>My ${signed(sample("my", at.x, at.y), 1)} kNm/m</span>`;
    const snapped = state.tool === "column" ? { x: Math.round(at.x * 2) / 2, y: Math.round(at.y * 2) / 2 } : at;
    viewer.note({ ghost: state.tool === "orbit" ? null : { ...snapped, kind: state.tool } });
  }

  function bindCanvas() {
    const canvas = $("#canvas");
    if (!viewer) return;
    let drag = null;
    canvas.addEventListener("pointerdown", (event) => {
      if (event.button) return;
      const at = state.result?.ok || state.tool === "column" ? viewer.pick(event.clientX, event.clientY) : null;
      // the tour sends its own pointers; a drag only follows the kind that began it
      const scripted = !event.isTrusted;
      if (state.tool === "orbit" || !at) drag = { kind: "orbit", x: event.clientX, y: event.clientY, scripted };
      else if (state.tool === "column") toggleColumn(at);
      else {
        drag = { kind: state.tool, scripted };
        (state.tool === "load" ? moveLoad : moveCut)(at);
      }
      canvas.classList.toggle("is-dragging", !!drag);
    });
    window.addEventListener("pointermove", (event) => {
      if (!drag) return hover(event);
      if (drag.scripted === event.isTrusted) return;
      if (drag.kind === "orbit") {
        const ratio = shell.getBoundingClientRect().width / shell.offsetWidth || 1;
        viewer.orbit((event.clientX - drag.x) / ratio, (event.clientY - drag.y) / ratio);
        drag.x = event.clientX;
        drag.y = event.clientY;
        if (state.view !== "3d") { state.view = "3d"; mark("view", "3d"); }
        return;
      }
      const at = viewer.pick(event.clientX, event.clientY, 4);
      if (at) (drag.kind === "load" ? moveLoad : moveCut)(at);
    });
    window.addEventListener("pointerup", (event) => {
      if (drag && drag.scripted === event.isTrusted) return;
      drag = null;
      canvas.classList.remove("is-dragging");
    });
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      viewer.zoom(Math.exp(event.deltaY * 0.0012));
    }, { passive: false });
    canvas.addEventListener("pointerleave", () => { if (!drag) hover({ target: null }); });
  }

  // Puts the workspace in a known state: the defaults, with `preset` laid over them.
  function load(preset = {}) {
    epoch++;
    wanted = null;
    fresh = true;
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, initial());
    for (const [key, value] of Object.entries(preset)) state[key] = value && typeof value === "object" && !Array.isArray(value) ? { ...state[key], ...value } : value;
    viewer?.setMesh(state.meshLines);
    viewer?.note({ ghost: null });
    viewer?.look(state.view === "plan" ? viewer.plan() : viewer.home());
    renderInputs();
    renderPlan();
    renderPage();
    refresh(0);
  }

  build();
  bindCanvas();
  load();

  return {
    state, load, settled, box, spot, client, showTip, hideTip, checks,
    // called when the room for the view changes; the section is drawn to its width
    resize: (scale) => { viewer?.resize(scale); if (state.result) renderDock(); },
  };
}
