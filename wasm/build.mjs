#!/usr/bin/env node
/**
 * Cross-platform build script for Wasm solver.
 * Requires Emscripten. Activate first: emsdk_env.bat (Windows) or source emsdk_env.sh (Unix).
 * Or set EMSDK to your emsdk install path.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "public", "wasm");

function findEmcc() {
  const probe = spawnSync("emcc", ["--version"], { stdio: "pipe" });
  if (probe.status === 0) return "emcc";

  const emsdk = process.env.EMSDK || process.env.EMSDK_PATH;
  if (emsdk) {
    const emccPath = join(emsdk.replace(/[/\\]$/, ""), "upstream", "emscripten", "emcc");
    const emccPy = emccPath + (process.platform === "win32" ? ".bat" : "");
    if (existsSync(emccPy) || existsSync(emccPath)) return emccPy;
  }

  const homedir = process.env.USERPROFILE || process.env.HOME || "";
  for (const sub of ["Downloads/emsc/emsdk", "emsdk", ".emsdk"]) {
    const p = join(homedir, sub.replace(/\//g, sep), "upstream", "emscripten", "emcc");
    const py = p + (process.platform === "win32" ? ".bat" : "");
    if (existsSync(py) || existsSync(p)) return py;
  }
  return null;
}

const emccCmd = findEmcc();
if (!emccCmd) {
  console.error("\nBuild failed: emcc not found.");
  console.error("\n1. Activate Emscripten in THIS terminal first:");
  console.error("   Windows (cmd):  cd path\\to\\emsdk  && emsdk_env.bat");
  console.error("   Windows (PS):   cd path\\to\\emsdk ; .\\emsdk_env.ps1");
  console.error("   Unix:           source path/to/emsdk/emsdk_env.sh");
  console.error("\n2. Then run: npm run build:wasm");
  console.error("\nOr set EMSDK=/path/to/emsdk and run again.");
  process.exit(1);
}

const emccArgs = [
  "-O3", "-msimd128", "-std=c++17",
  "solver.cpp", "-o", join(outDir, "solver.js"),
  "-s", "EXPORTED_FUNCTIONS=[_solver_solve,_malloc,_free]",
  "-s", "EXPORTED_RUNTIME_METHODS=[ccall,cwrap,HEAPF64,HEAP32]",
  "-s", "MODULARIZE=1",
  "-s", "EXPORT_NAME=createSolverModule",
  "-s", "WASM=1",
  "-s", "INITIAL_MEMORY=256MB",
  "-s", "ENVIRONMENT=web,worker",
  "-s", "EXPORT_ES6=1"
];

mkdirSync(outDir, { recursive: true });

const spawnOpts = {
  cwd: __dirname,
  stdio: "inherit",
  shell: process.platform === "win32"  // Required to run .bat files on Windows
};

const r = spawnSync(emccCmd, emccArgs, spawnOpts);

if (r.status !== 0) {
  console.error("\nBuild failed (exit code " + r.status + ").");
  console.error("Ensure Emscripten is activated in this terminal:");
  console.error("  Windows: cd path\\to\\emsdk && emsdk_env.bat");
  console.error("  Then:   npm run build:wasm");
  process.exit(1);
}

console.log("\nBuilt:", join(outDir, "solver.js"));
console.log("      ", join(outDir, "solver.wasm"));
