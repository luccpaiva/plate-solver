/**
 * The solver's two kernels, for scripts that run outside a browser:
 * the JavaScript one, and the WebAssembly build read from src/solver.wasm.
 */
import { readFile } from "node:fs/promises";
import { kernel as js } from "../src/solver.js";
import { loadKernel } from "../src/wasm.js";

export const wasm = await loadKernel(await readFile(new URL("../src/solver.wasm", import.meta.url)));
export const kernels = [js, wasm];
export { js };

/** Largest absolute difference between two fields. */
export const apart = (a, b) => a.reduce((most, value, index) => Math.max(most, Math.abs(value - b[index])), 0);

/** The slab the Abaqus references and the closed-form cases were worked out for. */
export const LAB = { thickness: 0.2, E: 20e9, nu: 0.3, q: 1000 };

/** A square slab with every edge supported the same way. */
export const square = (side, n, kind, extra = {}) => ({
  width: side, length: side, ...LAB, nx: n, ny: n,
  edges: { west: kind, east: kind, south: kind, north: kind },
  ...extra
});
