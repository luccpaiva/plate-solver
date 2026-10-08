// The solver's kernel as compiled from C++ (wasm/solver.cpp): same steps and
// same band layout as the one in solver.js, behind the same four calls. The
// module is freestanding, so loading it is one instantiate with no imports.

// `bytes` is the module itself, for where there is no fetch of a file (Node).
export async function loadKernel(bytes) {
  const source = bytes ?? await (await fetch(new URL("./solver.wasm", import.meta.url))).arrayBuffer();
  const { instance } = await WebAssembly.instantiate(source, {});
  const wasm = instance.exports;
  // It keeps one system in its own memory, so a factor is good only until the
  // next one is assembled.
  let current = null;

  return {
    name: "wasm",

    assemble({ nx, ny, alongX, dof, bw, hx, hy, thickness, E, nu, reduced, pinned }) {
      if (!wasm.solver_reserve(dof, bw)) throw new Error(`No memory for ${dof} unknowns`);
      // the memory may have grown, so views are made after reserving
      new Int32Array(wasm.memory.buffer, wasm.solver_pinned(), pinned.length).set(pinned);
      wasm.solver_assemble(nx, ny, alongX ? 1 : 0, hx, hy, thickness, E, nu, reduced ? 1 : 0, pinned.length);
      current = { dof };
      return current;
    },

    factorise: () => wasm.solver_factorise() === 1,

    substitute({ dof }, x) {
      const rhs = new Float64Array(wasm.memory.buffer, wasm.solver_rhs(), dof);
      rhs.set(x);
      wasm.solver_substitute();
      x.set(rhs);
    },

    holds: (factor) => factor === current,
  };
}
