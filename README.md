# Plate Analysis

Rectangular plate FEA using Mindlin-Reissner theory, for concrete slabs on walls and columns. The solver's kernel exists in JavaScript and in C++ compiled to WebAssembly; the workspace around it is plain DOM and raw WebGL.

![A guided tour of the workspace: a slab is thinned and one of its edges freed, columns are stood under it, bending moments are shown and cut along section A–A, a point load is dragged across it, columns are placed automatically, and the Verification and Performance pages are run](assets/demo_plate.webp)

_A recording of the guided tour, about a minute and three quarters, looping. Every number in it was solved as it played._

## Usage

```bash
npm install
npm run dev
```

Open the app and change anything: every change is solved again, in a worker, and the slab eases into its new shape.

- **Model** — slab size and thickness, concrete, self-weight and imposed load. Each edge is free, simply supported or fixed (click it on the plan). Tools on the view: stand or remove columns, drag a point load, cut section A–A.
- **Results** — deflection against a span/250, /360 or /500 limit, bending and twisting moments, the reaction of every column and wall, and the time each solve took. A slab that nothing holds still is reported as a mechanism.
- **Add columns until it passes** — a greedy search: a column under the deepest point, solve, repeat.
- **Verification** and **Performance** — the checks and the benchmark below, run in the browser.

## Solver

`src/solver.js`. Four-node elements with three unknowns a node (deflection and two rotations). Bending is integrated 2 × 2; the shear strain is tied at the middle of each element side (MITC4), which neither locks on a thin slab nor leaves a spurious mode.

- **Supports** are imposed exactly: a held unknown gets a unit row and column.
- **Reactions** come from `K u − f` at the held unknowns, and their sum is checked against the load.
- **Moments** come from the curvature at the nodes, second order on the edges too.
- **Factor reuse** — while only the load changes, the Cholesky factor is kept and a solve is one substitution.
- **Bandwidth** — nodes are numbered along the shorter side of the mesh.

The first version of this solver sampled the shear once, at the element centre. That leaves an hourglass mode in the deflection which only a supported edge holds down, so a slab standing on columns alone was singular. That element is still there behind `reduced: true`, for the test and the Verification page that show the difference.

## Kernels

Assembly, factorisation and substitution are a kernel with two builds behind the same four calls:

- **JavaScript** — in `src/solver.js`. Always available.
- **WebAssembly** — `wasm/solver.cpp`, loaded by `src/wasm.js`. Two to three times faster.

Both keep the lower band of the stiffness a row at a time, so factorising multiplies runs that are contiguous in memory. The C++ is freestanding (no libc, no allocator, no JS glue): the module is 8 kB and loads with one `WebAssembly.instantiate`.

The kernel is chosen in the Solve panel (Auto / WASM / JS). Auto uses WebAssembly where it loads and JavaScript otherwise.

`src/solver.wasm` is committed. To rebuild it you need [Zig](https://ziglang.org/download/), whose `zig c++` is clang with a wasm linker:

```bash
npm run build:wasm
```

## Tests

`npm test` runs them all in Node, on both kernels.

| Test | What it checks |
|------|----------------|
| `infinite` | The opening example solves to finite numbers |
| `symmetry` | Mirrored supports give mirrored deflections |
| `rank` | Held slabs solve; mechanisms and the hourglass element are refused |
| `equilibrium` | Reactions sum to the load, with and without a reused factor |
| `kernels` | JavaScript and WebAssembly agree to rounding |
| `closed-form` | Second-order convergence to Navier's series; Timoshenko's coefficients for simply supported and fixed squares within 1% |
| `abaqus` | Six Abaqus S4R models on the same 0.25 m mesh, within 2% |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run build:wasm` | Compile `wasm/solver.cpp` to `src/solver.wasm` (needs Zig) |
| `npm run test` | Run all tests |
| `npm run benchmark` | CLI benchmark: both kernels over a range of meshes |
| `npm run lint` | ESLint |

## Project Structure

```
plate-analysis/
├── index.html
├── src/
│   ├── main.js             # Entry: worker and workspace
│   ├── app.js              # Inputs, section diagram and results over one state object
│   ├── viewer.js           # WebGL slab: contour bands, supports, drawn annotations
│   ├── checks.js           # Verification and Performance pages
│   ├── charts.js           # Log-log line chart in SVG
│   ├── solver.js           # The analysis and the JavaScript kernel
│   ├── wasm.js             # Loads the WebAssembly kernel
│   ├── solver.worker.js    # Runs the solver off the main thread
│   ├── solver.wasm         # Built from wasm/solver.cpp
│   ├── workspace.css       # The workspace
│   └── styles.css          # The page around it
├── wasm/                   # C++ kernel (solver.cpp, build.mjs)
└── tools/                  # Tests, benchmark, export-demo.mjs
```

## Embedding

The workspace knows nothing about the page it sits in. `node tools/export-demo.mjs <directory>` copies it into another project, which supplies its own page around it: that is how the guided demo on my portfolio is kept in step with this repository.
