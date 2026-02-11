/**
 * Solver API: unified solveFEA with JS/Wasm backend selection.
 * Params: { plate, material, load, pillars, edgeSupported, nx, ny }.
 * Pillars in local coords [0,width]×[0,length].
 * Returns { deflections, maxDeflection, minDeflection, dof, solveTime, backend }.
 */

import { solvePlate as solveMindlin } from "./mindlin.js";
import {
  loadWasmSolver,
  isWasmReady,
  solveFEAWasm
} from "./wasm-loader.js";

/** @type {'auto'|'js'|'wasm'} */
let solverBackend = "auto";

/** Resolved backend after auto resolution. */
let resolvedBackend = null;

/** Pending Wasm load promise for "auto" mode. */
let wasmLoadPromise = null;

/**
 * Set solver backend. "auto" tries Wasm first, falls back to JS.
 * @param {'auto'|'js'|'wasm'} backend
 */
export function setSolverBackend(backend) {
  solverBackend = backend;
  resolvedBackend = null;
}

/**
 * Get current backend setting.
 * @returns {'auto'|'js'|'wasm'}
 */
export function getSolverBackend() {
  return solverBackend;
}

/**
 * Ensure Wasm is loaded when backend is auto or wasm.
 * Call early (e.g. app init) to avoid first-solve delay.
 * @returns {Promise<boolean>} true if Wasm is ready
 */
export function ensureWasmLoaded() {
  if (solverBackend === "js") return Promise.resolve(false);
  if (wasmLoadPromise) return wasmLoadPromise;
  wasmLoadPromise = loadWasmSolver();
  return wasmLoadPromise;
}

/**
 * Get the resolved backend ("js" or "wasm"). Only set after first solve in auto mode.
 * @returns {string|null}
 */
export function getResolvedBackend() {
  return resolvedBackend;
}

/**
 * Solve plate FEA. Uses current backend (auto/js/wasm).
 * @param {object} params
 * @param {object} _cache - unused, kept for API compatibility
 * @returns {{ deflections, maxDeflection, minDeflection, dof, solveTime, backend }}
 */
export async function solveFEA(params, _cache = null) {
  const backend = solverBackend === "wasm" ? "wasm" : solverBackend === "js" ? "js" : "auto";

  if (backend === "js") {
    const result = solveMindlin(params);
    resolvedBackend = "js";
    return {
      deflections: result.deflections,
      maxDeflection: result.maxDeflection,
      minDeflection: result.minDeflection,
      dof: result.dof,
      solveTime: result.solveTime,
      backend: "js"
    };
  }

  if (backend === "wasm" || backend === "auto") {
    const ready = await ensureWasmLoaded();
    if (ready && isWasmReady()) {
      try {
        const result = solveFEAWasm(params);
        resolvedBackend = "wasm";
        return {
          deflections: result.deflections,
          maxDeflection: result.maxDeflection,
          minDeflection: result.minDeflection,
          dof: result.dof,
          solveTime: result.solveTime,
          backend: "wasm"
        };
      } catch (err) {
        console.warn("[solver] WASM solve failed, falling back to JS:", err.message);
      }
    }
  }

  const result = solveMindlin(params);
  resolvedBackend = "js";
  return {
    deflections: result.deflections,
    maxDeflection: result.maxDeflection,
    minDeflection: result.minDeflection,
    dof: result.dof,
    solveTime: result.solveTime,
    backend: "js"
  };
}
