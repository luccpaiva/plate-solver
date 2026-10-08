/**
 * Test: compare the solver against Abaqus S4R reference values.
 * Abaqus model: S4R shell, mesh seed 0.25 m. Solved here on the same mesh.
 * Material: E = 20 GPa, nu = 0.3, t = 200 mm, q = 1 kPa.
 * All edges simply supported (U3 = 0), the pillar pinned.
 *
 * Two reference sets:
 *   - NLGEOM=OFF (linear): the comparison, to within 2%
 *   - NLGEOM=ON  (nonlinear): shown for the membrane stiffening it brings
 *
 * The 30 x 30 pillar case carries the same value in both sets. Scaling the
 * 20 x 20 case by (30 / 20)^4, which linear thin-plate theory allows, gives
 * 27.0 mm, so that value is most likely the nonlinear one. It still passes.
 */
import { analyse, SIMPLE } from "../../src/solver.js";
import { wasm, LAB, square } from "../kernels.mjs";

const TOL = 0.02;
const SEED = 0.25;

const cases = [
  { label: "10x10 no support", side: 10, abaqusLinear: 2.819, abaqusNlgeom: 2.819 },
  { label: "20x20 no support", side: 20, abaqusLinear: 44.714, abaqusNlgeom: 42.055 },
  { label: "30x30 no support", side: 30, abaqusLinear: 225.743, abaqusNlgeom: 135.069 },
  { label: "10x10 center pillar", side: 10, pillar: true, abaqusLinear: 0.34, abaqusNlgeom: 0.34 },
  { label: "20x20 center pillar", side: 20, pillar: true, abaqusLinear: 5.332, abaqusNlgeom: 5.327 },
  { label: "30x30 center pillar", side: 30, pillar: true, abaqusLinear: 26.335, abaqusNlgeom: 26.335 }
];

// the largest mesh has 43,923 unknowns; the compiled kernel keeps this quick
function run(c) {
  const columns = c.pillar ? [{ x: c.side / 2, y: c.side / 2 }] : [];
  return analyse(square(c.side, c.side / SEED, SIMPLE, { columns }), {}, wasm).peak.w * 1000;
}

console.log("Abaqus S4R validation test\n");
console.log("Material: E=20 GPa, nu=0.3, t=200mm, q=1 kPa");
console.log(`Mesh: ${SEED} m, as in Abaqus`);
console.log(`Tolerance: ${TOL * 100}% (vs linear Abaqus)`);
console.log("w/t = max deflection / plate thickness (nonlinearity indicator)\n");

const col = { case: 28, val: 12, err: 8, wt: 7, nlg: 20 };
const W = col.case + col.val * 3 + col.err + col.wt + col.nlg;

console.log("─".repeat(W));
console.log(
  "Case".padEnd(col.case) +
  "Ours".padStart(col.val) +
  "Abaqus".padStart(col.val) +
  "NLGEOM".padStart(col.val) +
  "Err".padStart(col.err) +
  "w/t".padStart(col.wt) +
  "NLGEOM impact".padStart(col.nlg)
);
console.log("─".repeat(W));

let allPass = true;

for (const c of cases) {
  const ours = run(c);
  const ref = c.abaqusLinear;
  const nlg = c.abaqusNlgeom;
  const err = Math.abs(ours - ref) / ref;
  const pass = err <= TOL;
  if (!pass) allPass = false;

  const wOverT = (ref / (LAB.thickness * 1000)).toFixed(2);
  const nlgImpact = ref !== nlg
    ? `-${((1 - nlg / ref) * 100).toFixed(0)}% (${nlg.toFixed(1)} mm)`
    : "~0%";

  console.log(
    c.label.padEnd(col.case) +
    (ours.toFixed(2) + " mm").padStart(col.val) +
    (ref.toFixed(2) + " mm").padStart(col.val) +
    (nlg.toFixed(2) + " mm").padStart(col.val) +
    (err * 100).toFixed(1).padStart(col.err - 1) + "%" +
    wOverT.padStart(col.wt) +
    nlgImpact.padStart(col.nlg) +
    "  " + (pass ? "OK" : "FAIL")
  );
}

console.log("─".repeat(W));
console.log(`\nOverall (${cases.length} cases vs linear Abaqus): ${allPass ? "PASS" : "FAIL"}`);

process.exit(allPass ? 0 : 1);
