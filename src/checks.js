// The two pages that back the model up. Verification sets the solver against a
// commercial code, against closed-form plate theory and against itself on
// finer meshes. Performance runs the kernel written in JavaScript beside the
// one compiled from C++ to WebAssembly. Nothing here is stored: every figure
// is computed in the visitor's browser when they press the button.
import { icons } from "./icons.js";
import { FIXED, FREE, HARD, SIMPLE, navier } from "./solver.js";
import { logChart } from "./charts.js";
import { number, power, signed } from "./format.js";

// the slab every reference was worked out for
const LAB = { thickness: 0.2, E: 20e9, nu: 0.3, q: 1000 };
const SIDE = 20;
const QA2 = LAB.q * SIDE ** 2;
const QA4_D = (LAB.q * SIDE ** 4) / ((LAB.E * LAB.thickness ** 3) / (12 * (1 - LAB.nu ** 2)));

const square = (side, n, kind, extra = {}) => ({ width: side, length: side, ...LAB, nx: n, ny: n, edges: { west: kind, east: kind, south: kind, north: kind }, ...extra });
const corners = (side) => [[0, 0], [side, 0], [0, side], [side, side]].map(([x, y]) => ({ x, y }));
const centre = (n) => (n / 2) * (n + 1) + n / 2;
const deepest = (result) => result.peak.w * 1000;

const SOLVES = {
  walls10: square(10, 40, SIMPLE),
  column10: square(10, 40, SIMPLE, { columns: [{ x: 5, y: 5 }] }),
  walls20: square(20, 80, SIMPLE),
  column20: square(20, 80, SIMPLE, { columns: [{ x: 10, y: 10 }] }),
  simple: square(SIDE, 40, HARD),
  fixed: square(SIDE, 40, FIXED),
  centred: square(10, 20, FREE, { columns: corners(10), reduced: true }),
  tied: square(10, 20, FREE, { columns: corners(10) }),
};

// [case, solve, what to read from it, reference, unit, digits, digits the reference was given to]
const GROUPS = [
  ["Abaqus S4R shell, 0.25 m mesh", "Peak deflection of a 200 mm slab under 1 kN/m², solved here on the same mesh.", [
    ["10 × 10 m on four walls", "walls10", deepest, 2.819, "mm", 3],
    ["10 × 10 m, column at the centre", "column10", deepest, 0.34, "mm", 3, 2],
    ["20 × 20 m on four walls", "walls20", deepest, 44.714, "mm", 2],
    ["20 × 20 m, column at the centre", "column20", deepest, 5.332, "mm", 3],
  ]],
  ["Closed form, Timoshenko and Woinowsky-Krieger", "A 20 m square under uniform load, from the tabulated coefficients of q a² and q a⁴ / D.", [
    ["Simply supported, moment at the centre", "simple", (result) => result.mx[centre(40)] / 1000, (0.0479 * QA2) / 1000, "kNm/m", 2],
    ["Fixed, deflection at the centre", "fixed", deepest, 0.00126 * QA4_D * 1000, "mm", 2],
    ["Fixed, moment at the centre", "fixed", (result) => result.mx[centre(40)] / 1000, (0.0231 * QA2) / 1000, "kNm/m", 2],
    ["Fixed, moment at the middle of an edge", "fixed", (result) => result.mx[20 * 41] / 1000, (-0.0513 * QA2) / 1000, "kNm/m", 2],
  ]],
  ["The element", "A slab on four corner columns and no wall, which is where one-point shear fails.", [
    ["Shear sampled at the centre, as it first was", "centred", deepest, null, "mm", 2],
    ["Shear tied at the sides, as it is now", "tied", deepest, null, "mm", 2],
  ]],
];

const STUDY = [4, 8, 16, 32, 64];
const SIZES = [12, 16, 24, 32, 40, 48, 56, 64];
const KERNELS = { js: "JavaScript", wasm: "WebAssembly" };
const TOLERANCE = 0.01;
const SERIES = { js: ["JavaScript", "#3987e5"], wasm: ["WebAssembly", "#d95926"] };

const percent = (value) => `${number(value * 100, value < 0.0005 ? 3 : value < 0.005 ? 2 : 1)}%`;
const time = (ms) => `${number(ms, ms < 10 ? 2 : ms < 100 ? 1 : 0)} ms`;

export function createChecks({ solve, kernel, verify, perform }) {
  const state = {
    verify: { status: "idle", results: {}, study: [] },
    perform: { status: "idle", rows: [] },
  };
  const built = new Set();

  const button = (act, { status }, idle) => `
    <button class="ui-btn solid" data-act="${act}" id="${act}"${status === "running" ? " disabled" : ""}>${status === "running" ? '<i class="pl-spinner"></i>Running' : status === "done" ? "Run again" : idle}</button>`;

  /* ---- verification -------------------------------------------------- */

  function caseRow([label, id, read, reference, unit, digits, given = digits]) {
    const result = state.verify.results[id], running = state.verify.status === "running";
    const wait = `<td class="num faint">${running ? '<i class="pl-spinner"></i>' : "–"}</td>`;
    if (!result) return `<tr><th>${label}</th>${wait}<td class="num">${reference === null ? "" : `${signed(reference, given)} ${unit}`}</td><td></td></tr>`;
    if (reference === null) {
      return result.ok
        ? `<tr><th>${label}</th><td class="num">${signed(read(result), digits)} ${unit}</td><td class="num"></td><td><span class="pl-flag ok">${icons.checkCircle("small")}Full rank</span></td></tr>`
        : `<tr><th>${label}</th><td class="num">no answer</td><td class="num"></td><td><span class="pl-flag over">${icons.warning("small")}Singular</span></td></tr>`;
    }
    const ours = read(result), apart = (ours - reference) / Math.abs(reference), close = Math.abs(apart) <= TOLERANCE;
    return `<tr><th>${label}</th><td class="num">${signed(ours, digits)} ${unit}</td><td class="num">${signed(reference, given)} ${unit}</td>
      <td><span class="pl-flag ${close ? "ok" : "over"}">${close ? icons.checkCircle("small") : icons.warning("small")}${apart > 0 ? "+" : "−"}${number(Math.abs(apart) * 100, 2)}%</span></td></tr>`;
  }

  function renderVerify() {
    const host = verify(), { study, status, solvedIn } = state.verify;
    host.querySelector("#verify-run").innerHTML = `${solvedIn ? `<span class="pl-doc-note">Solved in ${KERNELS[solvedIn]}</span>` : ""}${button("run-verify", state.verify, "Run the checks")}`;
    host.querySelector("#cases").innerHTML = `
      <table class="pl-table">
        <thead><tr><th>Case</th><th class="num">This solver</th><th class="num">Reference</th><th>Difference</th></tr></thead>
        ${GROUPS.map(([title, note, rows]) => `<tbody><tr class="group"><td colspan="4"><b>${title}</b><span>${note}</span></td></tr>${rows.map(caseRow).join("")}</tbody>`).join("")}
      </table>`;

    logChart(host.querySelector("#study-chart"), {
      width: 500, height: 232,
      x: { label: "Elements along each side", format: (value) => number(value), detail: (value) => `${value} × ${value} elements`, range: [3.4, 76], ticks: STUDY },
      y: { label: "Error in the centre deflection", format: (value) => `${Number((value * 100).toPrecision(1))}%`, detail: percent, range: [3e-5, 5e-2] },
      series: [{ name: "This solver", colour: SERIES.js[1], points: study.map(({ n, error }) => [n, error]) }],
      guide: study.length > 1 ? { from: [study[0].n, study[0].error * 1.9], to: 64, slope: -2, label: "error ∝ h²" } : null,
      empty: status === "running" ? "Refining the mesh…" : "Run the checks to refine the mesh from 4 to 64 elements a side.",
    });
    host.querySelector("#study-table").innerHTML = study.length ? `
      <table class="pl-table compact">
        <thead><tr><th>Mesh</th><th class="num">Centre deflection</th><th class="num">Error</th><th class="num">Order</th></tr></thead>
        <tbody>${study.map(({ n, value, error, order }) => `<tr><th>${n} × ${n}</th><td class="num">${number(value, 3)} mm</td><td class="num">${percent(error)}</td><td class="num">${order ? number(order, 2) : ""}</td></tr>`).join("")}</tbody>
      </table>` : "";
  }

  async function runVerify() {
    const run = state.verify;
    if (run.status === "running") return;
    Object.assign(run, { status: "running", results: {}, study: [], solvedIn: null });
    renderVerify();
    const using = kernel();
    for (const [id, model] of Object.entries(SOLVES)) {
      run.results[id] = await solve("case", { ...model, kernel: using });
      run.solvedIn = run.results[id].backend;
      renderVerify();
    }
    // against the series solution, which the hard support has and the soft one does not
    const exact = navier(square(SIDE, 0, HARD));
    for (const n of STUDY) {
      const result = await solve("case", { ...square(SIDE, n, HARD), kernel: using });
      const value = -result.w[centre(n)], error = Math.abs(value - exact) / exact, before = run.study.at(-1);
      run.study.push({ n, value: value * 1000, error, order: before && Math.log2(before.error / error) });
      renderVerify();
    }
    run.status = "done";
    renderVerify();
  }

  /* ---- performance --------------------------------------------------- */

  function renderPerform() {
    const host = perform(), { rows, status } = state.perform, last = rows.at(-1), wasm = last?.wasm != null;
    host.querySelector("#perform-run").innerHTML = button("run-bench", state.perform, "Run the benchmark");
    const apart = Math.max(0, ...rows.map((entry) => entry.apart ?? 0));
    host.querySelector("#tiles").innerHTML = last ? `
      <div><span>Largest system so far</span><strong>${number(last.dof)}</strong><em>unknowns, band of ${number(3 * (last.n + 2) + 2)}</em></div>
      <div><span>JavaScript</span><strong>${time(last.js)}</strong><em>to assemble, factorise and substitute</em></div>
      <div><span>WebAssembly</span><strong>${wasm ? time(last.wasm) : "unavailable"}</strong><em>${wasm ? `${number(last.js / last.wasm, 1)}× the speed of JavaScript` : "this browser did not load the module"}</em></div>
      <div><span>Largest difference</span><strong>${wasm ? `${power(apart)} m` : "–"}</strong><em>${wasm ? "between the two deflected shapes" : ""}</em></div>` : "";

    const first = rows[0];
    logChart(host.querySelector("#bench-chart"), {
      width: 690, height: 380,
      x: { label: "Unknowns", format: (value) => number(value), detail: (value) => `${number(value)} unknowns`, range: [400, 16500] },
      y: { label: "Time to solve", format: (value) => `${number(value, value < 1 ? 1 : 0)} ms`, detail: time },
      series: Object.entries(SERIES).map(([key, [name, colour]]) => ({ name, colour, points: rows.filter((entry) => entry[key] != null).map((entry) => [entry.dof, entry[key]]) })),
      // drawn back from under the last point, where the lower-order terms have faded
      guide: last?.wasm != null && rows.length > 1 ? { from: [first.dof, last.wasm * 0.6 * (first.dof / last.dof) ** 2], to: last.dof, slope: 2, label: "time ∝ N²" } : null,
      empty: status === "running" ? "Solving the first system…" : "Run the benchmark to time both solvers on this machine.",
    });
    host.querySelector("#bench-table").innerHTML = `
      <table class="pl-table compact">
        <thead><tr><th>Mesh</th><th class="num">Unknowns</th><th class="num">JavaScript</th><th class="num">WebAssembly</th><th class="num">Ratio</th></tr></thead>
        <tbody>${SIZES.map((n) => {
          const entry = rows.find((candidate) => candidate.n === n), pending = status === "running" && !entry && rows.length === SIZES.indexOf(n);
          return `<tr><th>${n} × ${n}</th><td class="num">${number(3 * (n + 1) ** 2)}</td>
            <td class="num">${entry ? time(entry.js) : pending ? '<i class="pl-spinner"></i>' : ""}</td><td class="num">${entry?.wasm != null ? time(entry.wasm) : ""}</td>
            <td class="num">${entry?.wasm ? `${number(entry.js / entry.wasm, 1)}×` : ""}</td></tr>`;
        }).join("")}</tbody>
      </table>`;
  }

  async function runBench() {
    const run = state.perform;
    if (run.status === "running") return;
    Object.assign(run, { status: "running", rows: [] });
    renderPerform();
    for (const n of SIZES) {
      run.rows.push(await solve("bench", { n }));
      renderPerform();
    }
    run.status = "done";
    renderPerform();
  }

  /* ---- pages --------------------------------------------------------- */

  function open(page) {
    if (!built.has(page)) {
      built.add(page);
      if (page === "verify") {
        verify().innerHTML = `
          <div class="pl-doc">
            <header class="pl-doc-head">
              <div><h1>Verification</h1><p>The solver set against a commercial finite-element code, against closed-form plate theory, and against itself as the mesh is refined. Each figure is computed in this browser when you run it.</p></div>
              <div id="verify-run"></div>
            </header>
            <div class="pl-doc-body">
              <section class="pl-sheet" id="cases"></section>
              <section class="pl-sheet">
                <h2>Mesh refinement</h2>
                <p>A 20 m simply supported square, measured against Navier’s series with the shear term. A four-node element should halve its error twice each time the mesh is halved.</p>
                <div class="pl-chart" id="study-chart"></div>
                <div id="study-table"></div>
              </section>
            </div>
          </div>`;
      } else {
        perform().innerHTML = `
          <div class="pl-doc">
            <header class="pl-doc-head">
              <div><h1>Performance</h1><p>The solver's kernel exists twice: written in JavaScript, and in C++ compiled to WebAssembly. Both assemble and factorise the same simply supported slab here, on this machine, and the best of three timings counts.</p></div>
              <div id="perform-run"></div>
            </header>
            <div class="pl-tiles" id="tiles"></div>
            <div class="pl-doc-body wide">
              <section class="pl-sheet"><h2>Time against size</h2><p>On logarithmic axes. A band of width b costs N b² to factorise, and b grows with √N, so both lines should climb two decades for each decade of unknowns.</p><div class="pl-chart" id="bench-chart"></div></section>
              <section class="pl-sheet"><h2>The runs</h2><div id="bench-table"></div></section>
            </div>
          </div>`;
      }
    }
    (page === "verify" ? renderVerify : renderPerform)();
  }

  const run = (act) => (act === "run-verify" ? runVerify() : runBench());

  function reset() {
    for (const page of Object.values(state)) if (page.status !== "running") Object.assign(page, { status: "idle", results: {}, study: [], rows: [] });
    for (const page of built) open(page);
  }

  return { state, open, run, reset };
}
