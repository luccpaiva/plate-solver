import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  build: {
    outDir: "dist",
    rollupOptions: {
      input: "index.html",
    },
  },
  // the solver's worker is a module: it imports the kernel and fetches solver.wasm
  worker: { format: "es" },
});
