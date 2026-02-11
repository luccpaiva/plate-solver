# Plate Analysis – Folder Structure

## Project Structure

```
plate-analysis/
├── index.html
├── package.json
├── vite.config.js
├── public/
│   └── tools/
│       └── profiling/
│           ├── mesh-scaling-benchmark.html
│           └── output/            # benchmark results
├── src/
│   ├── main.js                   
│   ├── state/
│   │   └── index.js              # Application state
│   ├── viewer/
│   │   ├── index.js
│   │   ├── scene.js              # Three.js scene, camera, renderer, controls
│   │   ├── plate.js              # Plate mesh, deformation
│   │   └── pillars.js            # Pillar meshes
│   ├── analysis/
│   │   └── index.js              # FEA run, results display
│   ├── ui/
│   │   └── index.js              # Event handlers, sliders, interaction
│   ├── solver/
│   │   ├── index.js
│   │   └── mindlin.js            # FEA core
│   ├── styles/
│   │   └── main.css
│   ├── benchmarks/
│   │   └── mesh-scaling.mjs
│   └── tests/
│       ├── check-infinite.mjs
│       ├── symmetry.mjs
│       └── abaqus.mjs
```

## Usage

- `npm install` then `npm run dev` — opens `index.html`, loads `src/main.js`.
- `npm run lint` — run ESLint on `src/`.

## Tests

| Script | Description |
|--------|-------------|
| `npm run test` | Run all tests with summary |
| `npm run test:infinite` | Debug solver, check for NaN/Inf |
| `npm run test:symmetry` | Alternated edge support symmetry |
| `npm run test:abaqus` | Compare vs Abaqus (5% tolerance) |

## Benchmark

| Script | Description |
|--------|-------------|
| `npm run benchmark` | Mesh density vs solve time |

**Chart:** After `npm run benchmark`, run `npm run dev` and open  
http://localhost:5173/tools/profiling/mesh-scaling-benchmark.html
