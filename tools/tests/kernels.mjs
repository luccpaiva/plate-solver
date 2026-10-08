/**
 * Test: the JavaScript and WebAssembly kernels give the same answer.
 * They are two implementations of the same steps, so they must agree to
 * rounding: on meshes numbered either way round, with fixed edges, columns
 * and a point load.
 */
import { analyse, FIXED, SIMPLE } from "../../src/solver.js";
import { js, wasm, apart, LAB, square } from "../kernels.mjs";

const TOL = 1e-10;

const models = [
  ["20 x 20 m on four walls", square(20, 40, SIMPLE)],
  ["24 x 12 m, wide mesh, two columns", {
    width: 24, length: 12, ...LAB, nx: 48, ny: 24,
    columns: [{ x: 6, y: 6 }, { x: 18, y: 6 }], edges: { west: SIMPLE, south: SIMPLE }
  }],
  ["12 x 24 m, tall mesh, fixed edge, point load", {
    width: 12, length: 24, ...LAB, nx: 24, ny: 48,
    columns: [{ x: 6, y: 18 }], edges: { south: FIXED, east: SIMPLE }, point: { x: 3.3, y: 11.1, P: 80e3 }
  }]
];

console.log("Kernel agreement test: JavaScript against WebAssembly\n");

let pass = true;
for (const [label, model] of models) {
  const a = analyse(model, {}, js), b = analyse(model, {}, wasm);
  const worst = Math.max(apart(a.w, b.w), apart(a.bx, b.bx), apart(a.by, b.by)) / a.peak.w;
  const ok = worst < TOL && a.backend === "js" && b.backend === "wasm";
  if (!ok) pass = false;
  console.log(`  ${label.padEnd(46)} relative difference ${worst.toExponential(1)}  ${ok ? "OK" : "FAIL"}`);
}

console.log("\nPass:", pass ? "yes" : "no");
process.exit(pass ? 0 : 1);
