/**
 * Debug script: run FEA solver with initial example params and trace for infinity/NaN.
 */
import { solveFEA } from "../solver/index.js";

const params = {
  plate: { width: 20, length: 20, thickness: 0.2 },
  material: { E: 20e9, nu: 0.3 },
  load: 1000,
  pillars: [],
  edgeSupported: { left: true, right: true, top: true, bottom: true },
  nx: 25,
  ny: 25,
  reportTiming: true
};

console.log("Params:", JSON.stringify(params, null, 2));

const results = solveFEA(params);

const { deflections, maxDeflection, minDeflection } = results;

// Check for non-finite values
let infCount = 0, nanCount = 0, finiteCount = 0;
for (let i = 0; i < deflections.length; i++) {
  const v = deflections[i];
  if (!Number.isFinite(v)) {
    if (Number.isNaN(v)) nanCount++;
    else infCount++;
    if (infCount + nanCount <= 5) console.log(`  Non-finite at i=${i}: ${v}`);
  } else finiteCount++;
}

console.log("\nDeflections stats: finite=%d, inf=%d, nan=%d", finiteCount, infCount, nanCount);
console.log("maxDeflection:", maxDeflection, "isFinite:", Number.isFinite(maxDeflection));
console.log("minDeflection:", minDeflection, "isFinite:", Number.isFinite(minDeflection));

const pass = infCount === 0 && nanCount === 0;
console.log("Pass:", pass ? "yes" : "no");
process.exit(pass ? 0 : 1);
