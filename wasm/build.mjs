#!/usr/bin/env node
/**
 * Builds wasm/solver.cpp into src/solver.wasm.
 *
 * The solver is freestanding C++ (no libc, no allocator), so it needs a
 * compiler and a linker for wasm32 and nothing else: no sysroot, no JS glue.
 * Zig carries both (`zig c++` is clang with wasm-ld), in one download:
 * https://ziglang.org/download/
 */
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "src", "solver.wasm");

const zig = process.env.ZIG || "zig";
if (spawnSync(zig, ["version"], { stdio: "pipe" }).status !== 0) {
  console.error("\nBuild failed: zig not found.");
  console.error("Install it from https://ziglang.org/download/ (or `choco install zig`, `brew install zig`),");
  console.error("or point ZIG at the executable, then run: npm run build:wasm");
  process.exit(1);
}

const args = [
  "c++", "-target", "wasm32-freestanding",
  "-O3", "-msimd128", "-std=c++17", "-Wall", "-Wextra",
  "-nostdlib", "-fno-exceptions", "-fno-rtti",
  // exports are named in the source; the stack only ever holds one element matrix
  "-Wl,--no-entry", "-Wl,--strip-all", "-Wl,-z,stack-size=65536",
  join(here, "solver.cpp"), "-o", out
];

const built = spawnSync(zig, args, { cwd: here, stdio: "inherit" });
if (built.status !== 0) {
  console.error("\nBuild failed (exit code " + built.status + ").");
  process.exit(1);
}

console.log("Built", out, "(" + statSync(out).size + " bytes)");
