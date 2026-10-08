/**
 * Copies the workspace into a project that embeds it as a demo.
 *
 *   node tools/export-demo.mjs <target directory>
 *
 * The target keeps the page it puts around the workspace: its own index.html,
 * entry script and stylesheet (which imports workspace.css), and whatever
 * drives the workspace there. Every file listed below is overwritten, so they
 * are edited here and exported again, never edited in the target.
 */
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FILES = [
  "app.js", "viewer.js", "checks.js", "charts.js", "format.js", "clock.js", "icons.js",
  "solver.js", "wasm.js", "solver.worker.js", "solver.wasm",
  "workspace.css"
];

const source = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const target = process.argv[2] && resolve(process.argv[2]);

if (!target || !existsSync(target)) {
  console.error("Usage: node tools/export-demo.mjs <target directory>");
  if (target) console.error(`No such directory: ${target}`);
  process.exit(1);
}

for (const file of FILES) copyFileSync(join(source, file), join(target, file));

console.log(`Copied ${FILES.length} files to ${target}:`);
console.log("  " + FILES.join(", "));
