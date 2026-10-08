/**
 * Test: solver symmetry.
 * Supports on the west and south edges, then on the east and north ones, are
 * the same slab turned half a turn: the two deflection fields must mirror.
 */
import { analyse, FREE, SIMPLE } from "../../src/solver.js";
import { kernels, LAB } from "../kernels.mjs";

const nx = 15, ny = 15;
const base = { width: 20, length: 20, ...LAB, nx, ny };
const a = { ...base, edges: { west: SIMPLE, south: SIMPLE, east: FREE, north: FREE } };
const b = { ...base, edges: { west: FREE, south: FREE, east: SIMPLE, north: SIMPLE } };
const node = (i, j) => j * (nx + 1) + i;
const TOL = 1e-9;

console.log("Symmetry test: w_A(i, j) against w_B(nx - i, ny - j)\n");

let pass = true;
for (const kernel of kernels) {
  const wA = analyse(a, {}, kernel).w, wB = analyse(b, {}, kernel).w;
  let worst = 0;
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) worst = Math.max(worst, Math.abs(wA[node(i, j)] - wB[node(nx - i, ny - j)]));
  }
  if (worst > TOL) pass = false;
  console.log(`  ${kernel.name.padEnd(5)} largest difference ${worst.toExponential(2)} m`);
}

console.log("\nPass:", pass ? "yes" : "no");
process.exit(pass ? 0 : 1);
