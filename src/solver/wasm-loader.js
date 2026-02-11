/**
 * WebAssembly solver loader.
 * Loads the Emscripten-built solver and exposes solveFEA(params) compatible with mindlin.js.
 */

let solverModule = null;

/**
 * Load the Wasm solver module. Resolves when ready, rejects on failure.
 * @returns {Promise<boolean>} true if loaded successfully
 */
export function loadWasmSolver() {
  if (solverModule) return Promise.resolve(true);

  return (async () => {
    try {
      // Use runtime URL so Vite doesn't try to resolve it at transform time
      const url = new URL("/wasm/solver.js", window.location.origin).href;
      const createModule = (await import(/* @vite-ignore */ url)).default;
      solverModule = await createModule({ locateFile: (p) => `/wasm/${p}` });
      return true;
    } catch (err) {
      console.warn("[solver] Wasm load failed, using JS fallback:", err.message);
      return false;
    }
  })();
}

/**
 * Check if Wasm solver is loaded and ready.
 * @returns {boolean}
 */
export function isWasmReady() {
  return solverModule != null;
}

/**
 * Solve FEA using Wasm. Same API as solveFEA from mindlin.
 * @param {object} params - { plate, material, load, pillars, edgeSupported, nx, ny }
 * @returns {{ deflections, maxDeflection, minDeflection, dof, solveTime }}
 */
export function solveFEAWasm(params) {
  if (!solverModule) throw new Error("Wasm solver not loaded. Call loadWasmSolver() first.");

  const { plate, material, load, pillars = [], edgeSupported = {}, nx, ny } = params;
  const { width, length, thickness } = plate;
  const { E, nu } = material;

  const nodesX = nx + 1;
  const nodesY = ny + 1;
  const numNodes = nodesX * nodesY;
  const totalDof = numNodes * 3;

  const es = edgeSupported ?? {};
  const edgeLeft = es.left ? 1 : 0;
  const edgeRight = es.right ? 1 : 0;
  const edgeTop = es.top ? 1 : 0;
  const edgeBottom = es.bottom ? 1 : 0;

  const numPillars = pillars.length;
  let pxPtr = 0, pzPtr = 0, pbPtr = 0;
  if (numPillars > 0) {
    pxPtr = solverModule._malloc(numPillars * 8);
    pzPtr = solverModule._malloc(numPillars * 8);
    pbPtr = solverModule._malloc(numPillars * 4);
    for (let i = 0; i < numPillars; i++) {
      solverModule.HEAPF64[(pxPtr >> 3) + i] = pillars[i].x;
      solverModule.HEAPF64[(pzPtr >> 3) + i] = pillars[i].z;
      solverModule.HEAP32[(pbPtr >> 2) + i] = pillars[i].bc === "fixed" ? 1 : 0;
    }
  }

  const deflPtr = solverModule._malloc(numNodes * 8);
  const maxPtr = solverModule._malloc(8);
  const minPtr = solverModule._malloc(8);

  try {
    const solveTime = solverModule.ccall(
      "solver_solve",
      "number",
      [
        "number", "number",           // nx, ny
        "number", "number", "number", // width, length, thickness
        "number", "number", "number", // E, nu, load
        "number", "number", "number", "number", // pillars ptrs, count
        "number", "number", "number", "number", // edge flags
        "number", "number", "number"             // out ptrs
      ],
      [
        nx, ny,
        width, length, thickness,
        E, nu, load,
        pxPtr, pzPtr, pbPtr, numPillars,
        edgeLeft, edgeRight, edgeTop, edgeBottom,
        deflPtr, maxPtr, minPtr
      ]
    );

    const deflections = new Float64Array(numNodes);
    deflections.set(
      new Float64Array(solverModule.HEAPF64.buffer, deflPtr, numNodes)
    );
    const maxDeflection = new Float64Array(solverModule.HEAPF64.buffer, maxPtr, 1)[0];
    const minDeflection = new Float64Array(solverModule.HEAPF64.buffer, minPtr, 1)[0];

    return {
      deflections,
      maxDeflection,
      minDeflection,
      dof: totalDof,
      solveTime
    };
  } finally {
    solverModule._free(deflPtr);
    solverModule._free(maxPtr);
    solverModule._free(minPtr);
    if (numPillars > 0) {
      solverModule._free(pxPtr);
      solverModule._free(pzPtr);
      solverModule._free(pbPtr);
    }
  }
}
