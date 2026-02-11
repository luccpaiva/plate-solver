# Plate Analysis

Rectangular plate FEA using Mindlin-Reissner theory. JS and WebAssembly solvers, 3D visualization.

## Usage

```bash
npm install
npm run dev
```

Open the app, adjust plate properties, add pillars, run analysis.

## Solvers

- **JavaScript** — `mindlin.js`, banded Cholesky. Always available.
- **WebAssembly** — C++ via Emscripten. Faster. Bundled in the project.

Use the Backend dropdown (Auto / WebAssembly / JavaScript) in the app. Wasm is bundled; Auto prefers it when available.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run test` | Run all tests |
| `npm run benchmark` | CLI mesh-scaling benchmark |
| `npm run benchmark:compare` | Instructions for Wasm vs JS benchmark |

## Benchmarks

- **Wasm vs JS:** `npm run dev` → open `/tools/benchmarks/wasm-vs-js-benchmark.html` → Run benchmark.
- **Mesh scaling:** `npm run benchmark` → open `/tools/benchmarks/mesh-scaling-benchmark.html`.

## Project Structure

```
plate-analysis/
├── src/                # App source
│   ├── solver/         # mindlin.js (JS), wasm-loader.js, index.js (unified API)
│   ├── viewer/         # Three.js scene, plate, pillars
│   ├── analysis/       # Run FEA, update results
│   └── ui/             # Controls
├── wasm/               # C++ solver (solver.cpp, build.mjs)
├── tools/              # Benchmarks, tests
└── public/wasm/        # Bundled solver.js, solver.wasm
```
