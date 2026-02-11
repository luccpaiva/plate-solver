/**
 * Benchmark: mesh density vs solve time.
 * Gradually increases nx=ny and records nodes vs compute time.
 * Output written to tools/profiling/output/mesh-scaling.json for plotting.
 */
import { solveFEA, setSolverBackend } from "../../src/solver/index.js";

setSolverBackend("js");
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "output");
const outFile = join(outDir, "mesh-scaling.json");

const params = {
  plate: { width: 20, length: 20, thickness: 0.2 },
  material: { E: 20e9, nu: 0.3 },
  load: 1000,
  pillars: [],
  edgeSupported: { left: true, right: true, top: true, bottom: true },
  reportTiming: false
};

// Mesh sizes to test (nx = ny), gradual steps
const MESH_SIZES = [5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40];

const results = [];

console.log("Mesh scaling benchmark (nodes vs solve time)\n");
console.log("Plate:", params.plate.width, "x", params.plate.length, "m\n");

const RUNS = 3;

for (const n of MESH_SIZES) {
  const nx = n, ny = n;
  const nodes = (nx + 1) * (ny + 1);
  const dof = nodes * 3;

  process.stdout.write(`  nx=ny=${n} (${nodes} nodes, ${dof} DOF)... `);

  let sum = 0;
  for (let r = 0; r < RUNS; r++) {
    const result = await solveFEA({ ...params, nx, ny });
    sum += result.solveTime;
  }
  const avgMs = sum / RUNS;

  results.push({
    nx,
    ny,
    nodes,
    dof,
    solveTimeMs: avgMs
  });

  console.log(`${avgMs.toFixed(0)} ms (avg of ${RUNS})`);
}

const output = {
  timestamp: new Date().toISOString(),
  params: { plate: params.plate, material: params.material, load: params.load },
  results
};

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, JSON.stringify(output, null, 2), "utf8");

console.log(`\nResults written to ${outFile}`);
console.log("\nTo view: npm run dev → /tools/benchmarks/mesh-scaling-benchmark.html");
