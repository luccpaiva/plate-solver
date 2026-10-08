/**
 * Test: the opening example solves to finite numbers in every field,
 * with either kernel.
 */
import { analyse, SIMPLE } from "../../src/solver.js";
import { kernels, square } from "../kernels.mjs";

const model = square(20, 25, SIMPLE);
const FIELDS = ["w", "bx", "by", "mx", "my", "mxy"];

console.log("Finite-values test: 20 x 20 m on four walls, 25 x 25 elements\n");

let pass = true;
for (const kernel of kernels) {
  const result = analyse(model, {}, kernel);
  const bad = FIELDS.filter((field) => !result[field].every(Number.isFinite));
  const ok = result.ok && bad.length === 0 && Number.isFinite(result.peak.w);
  if (!ok) pass = false;
  console.log(
    `  ${kernel.name.padEnd(5)} peak ${(result.peak.w * 1000).toFixed(3)} mm, ` +
    `${result.dof} unknowns: ${ok ? "all finite" : "non-finite in " + bad.join(", ")}`
  );
}

console.log("\nPass:", pass ? "yes" : "no");
process.exit(pass ? 0 : 1);
