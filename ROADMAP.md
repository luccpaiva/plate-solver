# Roadmap

What comes next, roughly in order. The solver handles one rectangular slab on walls and point columns today; most of this widens what it can model and what it checks.

## Solver

- **Any outline**: L, T and U shaped slabs, and openings for stairs and lift cores. This needs an unstructured mesh in place of the grid, with refinement around columns and re-entrant corners.
- **Columns with a size and a stiffness**: a column holds its footprint, not a point, and columns and walls can be springs instead of rigid supports.
- **Shear forces**: Qx and Qy recovered and drawn like the moments, with the stresses through the thickness.
- **Load cases and combinations**: several cases on one model, pattern loading bay by bay, and ULS and SLS combinations after EN 1990.
- **Large floors**: a sparse factorisation with a fill reducing ordering, so a floor over 1000 m² on a 0.25 m mesh still solves inside 50 ms; WebAssembly SIMD for the inner loops.

## Design checks

- **Reinforcement**: the steel each face needs from mx, my and mxy (Wood and Armer), after EN 1992-1-1.
- **Punching shear** at every column.
- **Long-term deflection**: cracked section and creep, against the same span limits.

## Workspace

- **Save and open**: a model as a JSON file, and as a link that carries it.
- **Plan editing**: draw walls, columns and openings on the plan; import an outline from DXF.
- **Report**: inputs, results and checks printed to PDF.

## Project

- **Open verification**: rebuild the reference shell models in free software (CalculiX or Code_Aster) and keep their input files here, so anyone can rerun them.
- **CI**: tests and lint on every push with GitHub Actions.
- **Hosting**: the workspace on GitHub Pages.
