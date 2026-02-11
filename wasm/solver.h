/**
 * Mindlin-Reissner plate FEA solver - C API for Emscripten
 */

#ifndef SOLVER_H
#define SOLVER_H

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Solve plate FEA.
 * Writes deflections (w at each node) to out_deflections[numNodes].
 * numNodes = (nx+1)*(ny+1).
 * pillars_bc: 0 = pinned (w only), 1 = fixed (w, βx, βy)
 * Returns solve time in milliseconds.
 */
double solver_solve(
  int nx, int ny,
  double width, double length, double thickness,
  double E, double nu, double load,
  const double* pillars_x, const double* pillars_z, const int* pillars_bc, int num_pillars,
  int edge_left, int edge_right, int edge_top, int edge_bottom,
  double* out_deflections,
  double* out_max_deflection, double* out_min_deflection
);

#ifdef __cplusplus
}
#endif

#endif /* SOLVER_H */
