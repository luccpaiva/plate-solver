/**
 * Test: compare FEA solver against Abaqus S4R reference values.
 * Abaqus model: S4R shell, mesh seed 0.25m.
 * Material: E=20 GPa, nu=0.3, t=200mm, q=1 kPa.
 * All edges simply supported (U1=U2=U3=0), pillars pinned.
 *
 * Two reference sets:
 *   - NLGEOM=OFF (linear): direct comparison, should match within 5%
 *   - NLGEOM=ON  (nonlinear): shows membrane stiffening effect for reference
 */
import { solveFEA, setSolverBackend } from "../../src/solver/index.js";

setSolverBackend("js");

const material = { E: 20e9, nu: 0.3 };
const load = 1000;
const thickness = 0.2;
const edgeSupported = { left: true, right: true, top: true, bottom: true };
const TOL = 0.02; // 2%

const cases = [
  // No support — all edges SS only
  {
    label: "10x10 no support",
    width: 10, length: 10, pillars: [],
    abaqusLinear: 2.819, abaqusNlgeom: 2.819  // w/t=0.01, no difference
  },
  {
    label: "20x20 no support",
    width: 20, length: 20, pillars: [],
    abaqusLinear: 44.714, abaqusNlgeom: 42.055  // w/t=0.22, ~6% membrane effect
  },
  {
    label: "30x30 no support",
    width: 30, length: 30, pillars: [],
    abaqusLinear: 225.743, abaqusNlgeom: 135.069  // w/t=0.68, ~40% membrane effect
  },

  // Center pillar (pinned, w=0 only)
  {
    label: "10x10 center pillar",
    width: 10, length: 10,
    pillars: [{ x: 5, z: 5, bc: "pinned" }],
    abaqusLinear: 0.34, abaqusNlgeom: 0.34  // w/t=0.002, no difference
  },
  {
    label: "20x20 center pillar",
    width: 20, length: 20,
    pillars: [{ x: 10, z: 10, bc: "pinned" }],
    abaqusLinear: 5.332, abaqusNlgeom: 5.327  // w/t=0.03, negligible
  },
  {
    label: "30x30 center pillar",
    width: 30, length: 30,
    pillars: [{ x: 15, z: 15, bc: "pinned" }],
    abaqusLinear: 26.335, abaqusNlgeom: 26.335  // w/t=0.13, negligible
  }
];

async function runCase(c) {
  const nx = Math.max(20, Math.round(c.width * 2));
  const ny = Math.max(20, Math.round(c.length * 2));
  const result = await solveFEA({
    plate: { width: c.width, length: c.length, thickness },
    material,
    load,
    pillars: c.pillars,
    edgeSupported,
    nx,
    ny,
    reportTiming: false
  });
  return Math.abs(result.minDeflection) * 1000; // m -> mm
}

console.log("Abaqus S4R validation test\n");
console.log("Material: E=20 GPa, nu=0.3, t=200mm, q=1 kPa");
console.log("Abaqus: S4R shell, seed 0.25m");
console.log(`Tolerance: ${TOL * 100}% (vs linear Abaqus)`);
console.log("w/t = max deflection / plate thickness (nonlinearity indicator)\n");

const col = { case: 28, val: 12, err: 8, wt: 7, nlg: 20 };
const W = col.case + col.val * 3 + col.err + col.wt + col.nlg;

const header =
  "Case".padEnd(col.case) +
  "Ours".padStart(col.val) +
  "Abaqus".padStart(col.val) +
  "NLGEOM".padStart(col.val) +
  "Err".padStart(col.err) +
  "w/t".padStart(col.wt) +
  "NLGEOM impact".padStart(col.nlg);
console.log("─".repeat(W));
console.log(header);
console.log("─".repeat(W));

let allPass = true;

for (const c of cases) {
  const ours = await runCase(c);
  const ref = c.abaqusLinear;
  const nlg = c.abaqusNlgeom;
  const err = Math.abs(ours - ref) / ref;
  const pass = err <= TOL;
  if (!pass) allPass = false;

  const wOverT = (ref / (thickness * 1000)).toFixed(2);
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
