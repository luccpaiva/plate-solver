/**
 * Test: reactions balance the load.
 * A slab on a simply supported edge, a fixed edge and three columns, under
 * uniform load and a point load. The reactions recovered from K u - f must
 * sum to the load, and their split between columns and walls to that sum.
 * A second load on the same slab must reuse the factor and still balance.
 */
import { analyse, FIXED, SIMPLE } from "../../src/solver.js";
import { kernels, apart } from "../kernels.mjs";

const model = {
  width: 18, length: 12, thickness: 0.25, E: 30e9, nu: 0.2, q: 9250, nx: 36, ny: 24,
  columns: [{ x: 6, y: 6 }, { x: 12, y: 6 }, { x: 18, y: 12 }],
  edges: { west: SIMPLE, south: FIXED },
  point: { x: 9.3, y: 3.1, P: 100e3 }
};
const moved = { ...model, point: { x: 4.2, y: 8.8, P: 250e3 } };
const TOL = 1e-9;

const total = (r) => r.reactions.columns.reduce((sum, v) => sum + v, 0) + Object.values(r.reactions.edges).reduce((sum, v) => sum + v, 0);
const residual = (r) => Math.abs(r.reactions.total - r.reactions.applied) / r.reactions.applied;

console.log("Equilibrium test: 18 x 12 m, mixed supports, uniform and point load\n");

let pass = true;
for (const kernel of kernels) {
  const cache = {};
  const first = analyse(model, cache, kernel);
  const second = analyse(moved, cache, kernel);
  const fresh = analyse(moved, {}, kernel);

  const checks = [
    ["sum of reactions = load", residual(first) < TOL],
    ["columns + walls = sum", Math.abs(total(first) - first.reactions.total) / first.reactions.total < TOL],
    ["second load reuses the factor", second.reused === true && first.reused === false],
    ["and still balances", residual(second) < TOL],
    ["and matches a fresh solve", apart(second.w, fresh.w) < TOL * fresh.peak.w]
  ];
  console.log(
    `  ${kernel.name.padEnd(5)} load ${(first.reactions.applied / 1000).toFixed(1)} kN, ` +
    `reactions ${(first.reactions.total / 1000).toFixed(1)} kN, residual ${residual(first).toExponential(1)}`
  );
  for (const [label, ok] of checks) {
    if (!ok) pass = false;
    console.log(`        ${label.padEnd(32)} ${ok ? "OK" : "FAIL"}`);
  }
}

console.log("\nPass:", pass ? "yes" : "no");
process.exit(pass ? 0 : 1);
