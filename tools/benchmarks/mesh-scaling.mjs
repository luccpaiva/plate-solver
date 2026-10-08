/**
 * Benchmark: mesh density vs solve time, for both kernels.
 * Gradually increases nx = ny and records the time to assemble, factorise and
 * substitute. Output written to tools/benchmarks/output/mesh-scaling.json.
 * The app's Performance page runs the same comparison in the browser.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyse, SIMPLE } from "../../src/solver.js";
import { js, wasm, LAB, square } from "../kernels.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "output");
const outFile = join(outDir, "mesh-scaling.json");

const SIDE = 20;
const MESH_SIZES = [8, 12, 16, 20, 24, 28, 32, 40, 48, 56, 64, 80];
const RUNS = 5;

function best(kernel, model) {
  let ms = Infinity;
  for (let r = 0; r < RUNS; r++) {
    const start = performance.now();
    analyse({ ...model, bare: true }, {}, kernel);
    ms = Math.min(ms, performance.now() - start);
  }
  return ms;
}

console.log("Mesh scaling benchmark (unknowns vs solve time)\n");
console.log(`Plate: ${SIDE} x ${SIDE} m on four walls, best of ${RUNS} runs\n`);
console.log("  mesh".padEnd(12) + "unknowns".padStart(10) + "JS".padStart(12) + "WASM".padStart(12) + "ratio".padStart(8));

const results = [];
for (const n of MESH_SIZES) {
  const model = square(SIDE, n, SIMPLE);
  const dof = 3 * (n + 1) ** 2;
  const jsMs = best(js, model), wasmMs = best(wasm, model);
  results.push({ nx: n, ny: n, nodes: (n + 1) ** 2, dof, jsMs, wasmMs });
  console.log(
    `  ${n} x ${n}`.padEnd(12) + String(dof).padStart(10) +
    (jsMs.toFixed(1) + " ms").padStart(12) + (wasmMs.toFixed(1) + " ms").padStart(12) +
    ((jsMs / wasmMs).toFixed(1) + "x").padStart(8)
  );
}

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, JSON.stringify({ timestamp: new Date().toISOString(), params: { side: SIDE, ...LAB }, results }, null, 2), "utf8");

console.log(`\nResults written to ${outFile}`);
