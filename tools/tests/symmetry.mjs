/**
 * Test solver symmetry.
 * Runs with alternated edge support (left/bottom vs right/top) and checks
 * that deflection fields are mirror images.
 */
import { solveFEA, setSolverBackend } from "../../src/solver/index.js";

setSolverBackend("js");

const base = {
  plate: { width: 20, length: 20, thickness: 0.2 },
  material: { E: 20e9, nu: 0.3 },
  load: 1000,
  pillars: [],
  nx: 15,
  ny: 15,
  reportTiming: false
};

// Config A: left + bottom supported
const configA = {
  ...base,
  edgeSupported: { left: true, right: false, top: false, bottom: true }
};

// Config B: right + top supported (mirror of A)
const configB = {
  ...base,
  edgeSupported: { left: false, right: true, top: true, bottom: false }
};

const nx = base.nx;
const ny = base.ny;
const nodesX = nx + 1;
const nodesY = ny + 1;

function nodeIndex(i, j) {
  return j * nodesX + i;
}

console.log("Symmetry test: alternated edge support");
console.log("Config A: left + bottom supported");
console.log("Config B: right + top supported (mirror of A)\n");

const resultA = await solveFEA(configA);
const resultB = await solveFEA(configB);

const defA = resultA.deflections;
const defB = resultB.deflections;

// For mirror symmetry: w_A(i,j) should equal w_B(nx-i, ny-j)
let maxErr = 0;
let errCount = 0;
const tol = 1e-5;

for (let j = 0; j <= ny; j++) {
  for (let i = 0; i <= nx; i++) {
    const mirrorI = nx - i;
    const mirrorJ = ny - j;
    const wA = defA[nodeIndex(i, j)];
    const wB = defB[nodeIndex(mirrorI, mirrorJ)];
    const err = Math.abs(wA - wB);
    if (err > maxErr) maxErr = err;
    if (err > tol) errCount++;
  }
}

console.log("Results:");
console.log("  Max deflection A:", resultA.maxDeflection.toExponential(4));
console.log("  Max deflection B:", resultB.maxDeflection.toExponential(4));
console.log("\nSymmetry check (w_A(i,j) vs w_B(nx-i,ny-j)):");
console.log("  Max error:", maxErr.toExponential(4));
console.log("  Nodes with error > 1e-5:", errCount, "/", (nodesX * nodesY));
const pass = errCount === 0;
console.log("  Pass:", pass ? "yes" : "no");
process.exit(pass ? 0 : 1);
