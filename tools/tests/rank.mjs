/**
 * Test: the stiffness has full rank exactly when the slab is held.
 *
 *   - On four corner columns and no wall, the element with tied shear (MITC4)
 *     solves. The element with one-point shear has an hourglass mode there and
 *     must be refused, not solved to garbage.
 *   - Support layouts that leave a rigid-body motion are refused; the smallest
 *     ones that do not are solved.
 */
import { analyse, FIXED, SIMPLE } from "../../src/solver.js";
import { kernels, LAB } from "../kernels.mjs";

const slab = { width: 10, length: 10, ...LAB, nx: 20, ny: 20 };
const corners = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }];

const layouts = [
  ["four corner columns, tied shear", { columns: corners }, true],
  ["four corner columns, one-point shear", { columns: corners, reduced: true }, false],
  ["no support", {}, false],
  ["one simply supported edge", { edges: { west: SIMPLE } }, false],
  ["one fixed edge", { edges: { west: FIXED } }, true],
  ["two columns", { columns: [{ x: 2, y: 2 }, { x: 8, y: 8 }] }, false],
  ["three columns in line", { columns: [{ x: 2, y: 2 }, { x: 5, y: 5 }, { x: 8, y: 8 }] }, false],
  ["three columns off one line", { columns: [{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 5, y: 8 }] }, true]
];

console.log("Rank test: 10 x 10 m slab, 20 x 20 elements\n");

let pass = true;
for (const [label, extra, held] of layouts) {
  const outcomes = kernels.map((kernel) => {
    const result = analyse({ ...slab, ...extra }, {}, kernel);
    const sane = !result.ok || (Number.isFinite(result.peak.w) && result.peak.w < 1);
    return { solved: result.ok, sane, text: result.ok ? `${(result.peak.w * 1000).toFixed(2)} mm` : "refused" };
  });
  const ok = outcomes.every((outcome) => outcome.solved === held && outcome.sane);
  if (!ok) pass = false;
  console.log(
    `  ${label.padEnd(38)} ${(held ? "solves" : "refused").padEnd(8)} ` +
    `${outcomes.map((outcome) => outcome.text.padStart(10)).join(" ")}  ${ok ? "OK" : "FAIL"}`
  );
}

console.log("\nPass:", pass ? "yes" : "no");
process.exit(pass ? 0 : 1);
