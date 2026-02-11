/**
 * Test: compare FEA solver against Abaqus reference values.
 * Plate: 10x10, 20x20, 30x30 m with shared properties.
 * All edges simply supported. 5% tolerance.
 */
import { solveFEA, setSolverBackend } from "../../src/solver/index.js";

setSolverBackend("js");

const props = {
  material: { E: 20e9, nu: 0.3 },
  load: 1000,
  pillars: [],
  edgeSupported: { left: true, right: true, top: true, bottom: true },
  reportTiming: false
};

const cases = [
  { width: 10, length: 10, thickness: 0.2, abaqus: 2.755 },
  { width: 20, length: 20, thickness: 0.2, abaqus: 43.67 },
  { width: 30, length: 30, thickness: 0.2, abaqus: 193.227 }
];

const TOL = 0.05; // 5%

// Mesh: ~1 element per meter
async function runCase(c) {
  const nx = Math.max(10, Math.round(c.width));
  const ny = Math.max(10, Math.round(c.length));
  const result = await solveFEA({
    ...props,
    plate: { width: c.width, length: c.length, thickness: c.thickness },
    nx,
    ny
  });
  return result.maxDeflection * 1000; // m -> mm
}

console.log("Abaqus validation test (5% tolerance)\n");
console.log("Properties:", { ...props.material, load: props.load, thickness: "200 mm" });
console.log("Edge support: all four edges\n");

let allPass = true;
for (const c of cases) {
  const ours = await runCase(c);
  const ref = c.abaqus;
  const err = Math.abs(ours - ref) / ref;
  const pass = err <= TOL;
  if (!pass) allPass = false;

  console.log(`${c.width}x${c.length} m:`);
  console.log(`  Abaqus:  ${ref.toFixed(2)} mm`);
  console.log(`  Ours:    ${ours.toFixed(2)} mm`);
  console.log(`  Error:   ${(err * 100).toFixed(2)}%  ${pass ? "OK" : "FAIL"}`);
  console.log();
}

console.log("Overall:", allPass ? "PASS" : "FAIL");
process.exit(allPass ? 0 : 1);
