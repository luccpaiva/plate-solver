/**
 * Test manager: run all tests and summarize pass/fail.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const tests = [
  { name: "infinite", script: "check-infinite.mjs" },
  { name: "symmetry", script: "symmetry.mjs" },
  { name: "abaqus", script: "abaqus.mjs" }
];

const results = [];

for (const { name, script } of tests) {
  const result = spawnSync("node", [join(__dirname, script)], {
    cwd: join(__dirname, "..", ".."),
    stdio: "inherit",
    encoding: "utf8"
  });
  results.push({ name, passed: result.status === 0 });
}

console.log("\n" + "─".repeat(40));
console.log("Summary");
console.log("─".repeat(40));
for (const { name, passed } of results) {
  console.log(`  ${name.padEnd(12)} ${passed ? "✓ pass" : "✗ fail"}`);
}
console.log("─".repeat(40));
const passed = results.filter((r) => r.passed).length;
const total = results.length;
console.log(`  ${passed}/${total} passed\n`);

process.exit(passed === total ? 0 : 1);
