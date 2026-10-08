// The solver lives in a worker, so a solve never holds a frame on the page:
// the model, the reference cases and the benchmark all run here.
import { analyse, kernel as js, SIMPLE } from "./solver.js";
import { loadKernel } from "./wasm.js";

const cache = {};
// The compiled kernel is a few kilobytes, fetched once. Where it does not
// load, the JavaScript one does the work.
const compiled = loadKernel().catch(() => null);

// 'js' asks for JavaScript; anything else takes the compiled kernel if there is one.
const pick = async (name) => (name === "js" ? js : (await compiled) ?? js);

// The clock here ticks in tenths of a millisecond, so a small system is timed
// over as many repeats as fill a few milliseconds. Best of three such batches.
function timed(solve) {
  let start = performance.now();
  solve();
  const repeats = Math.max(1, Math.min(60, Math.ceil(12 / Math.max(performance.now() - start, 0.05))));
  let best = Infinity;
  for (let batch = 0; batch < 3; batch++) {
    start = performance.now();
    for (let repeat = 0; repeat < repeats; repeat++) solve();
    best = Math.min(best, (performance.now() - start) / repeats);
  }
  return best;
}

// One mesh size, both kernels on the same system: how long each takes to
// assemble and solve it, and how far apart their answers are.
async function bench({ n }) {
  const model = { width: 20, length: 20, thickness: 0.2, E: 20e9, nu: 0.3, q: 1000, nx: n, ny: n,
    edges: { west: SIMPLE, east: SIMPLE, south: SIMPLE, north: SIMPLE } };
  const row = { n, dof: 3 * (n + 1) ** 2, js: timed(() => analyse({ ...model, bare: true }, {}, js)), wasm: null, apart: null };
  const wasm = await compiled;
  if (!wasm) return row;
  row.wasm = timed(() => analyse({ ...model, bare: true }, {}, wasm));
  const ours = analyse(model, {}, js).w, theirs = analyse(model, {}, wasm).w;
  row.apart = ours.reduce((most, value, index) => Math.max(most, Math.abs(value - theirs[index])), 0);
  return row;
}

const fields = (result) => (result.ok ? [result.w, result.bx, result.by, result.mx, result.my, result.mxy].map((field) => field.buffer) : []);

self.onmessage = async ({ data: { id, type, payload } }) => {
  try {
    if (type === "bench") return self.postMessage({ id, result: await bench(payload) });
    // the model keeps its factor between solves, until the workspace is reset;
    // a reference case always starts clean
    if (payload.fresh) cache.key = null;
    const result = analyse(payload, type === "model" ? cache : {}, await pick(payload.kernel));
    self.postMessage({ id, result }, fields(result));
  } catch (error) {
    self.postMessage({ id, error: String(error?.message ?? error) });
  }
};
