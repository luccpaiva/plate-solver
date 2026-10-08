/**
 * Test: the solver against closed-form plate theory.
 *
 *   - Simply supported square (hard support) against Navier's series with the
 *     shear term: the error must fall with the square of the element size.
 *   - Tabulated coefficients from Timoshenko and Woinowsky-Krieger, nu = 0.3:
 *     moment at the centre of a simply supported square, and deflection and
 *     moments of a square with all four edges fixed.
 */
import { analyse, navier, FIXED, HARD } from "../../src/solver.js";
import { LAB, square } from "../kernels.mjs";

const SIDE = 20;
const centre = (n) => (n / 2) * (n + 1) + n / 2;
let pass = true;

console.log("Closed-form test\n");
console.log("Mesh refinement, simply supported 20 x 20 m, against Navier + shear:");

const exact = navier(square(SIDE, 0, HARD));
let before = null, order = 0;
for (const n of [4, 8, 16, 32, 64]) {
  const value = -analyse(square(SIDE, n, HARD)).w[centre(n)];
  const error = Math.abs(value - exact) / exact;
  order = before ? Math.log2(before / error) : 0;
  console.log(
    `  ${String(n).padStart(2)} x ${String(n).padEnd(2)}  ${(value * 1000).toFixed(3)} mm  ` +
    `error ${(error * 100).toFixed(4)}%` + (before ? `  order ${order.toFixed(2)}` : "")
  );
  before = error;
}
const converges = order > 1.9 && order < 2.1 && before < 1e-4;
if (!converges) pass = false;
console.log(`  observed order ${order.toFixed(2)} (expected 2): ${converges ? "OK" : "FAIL"}\n`);

const qa2 = LAB.q * SIDE ** 2;
const qa4D = (LAB.q * SIDE ** 4) / ((LAB.E * LAB.thickness ** 3) / (12 * (1 - LAB.nu ** 2)));
const n = 40;
const simple = analyse(square(SIDE, n, HARD)), fixed = analyse(square(SIDE, n, FIXED));

const checks = [
  ["Simply supported, moment at the centre", simple.mx[centre(n)] / qa2, 0.0479],
  ["Fixed, deflection at the centre", fixed.peak.w / qa4D, 0.00126],
  ["Fixed, moment at the centre", fixed.mx[centre(n)] / qa2, 0.0231],
  ["Fixed, moment at the middle of an edge", fixed.mx[(n / 2) * (n + 1)] / qa2, -0.0513]
];

console.log("Tabulated coefficients (of q a^2 and q a^4 / D), tolerance 1%:");
for (const [label, ours, reference] of checks) {
  const error = Math.abs(ours - reference) / Math.abs(reference);
  const ok = error <= 0.01;
  if (!ok) pass = false;
  console.log(
    `  ${label.padEnd(40)} ${ours.toFixed(5).padStart(9)}  ${reference.toFixed(5).padStart(9)}  ` +
    `${(error * 100).toFixed(2)}%  ${ok ? "OK" : "FAIL"}`
  );
}

console.log("\nPass:", pass ? "yes" : "no");
process.exit(pass ? 0 : 1);
