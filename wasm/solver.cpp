/**
 * Mindlin-Reissner plate solver: the part worth compiling.
 *
 * Element stiffness, assembly of the banded global stiffness, the pinned
 * unknowns, Cholesky factorisation and substitution. The JavaScript side
 * (src/solver.js) decides what is held and what is loaded, and recovers
 * moments and reactions from the solution; it has the same kernel written in
 * JavaScript, so the two can be run against each other.
 *
 * Freestanding: no libc, no allocator, no glue. One system is held at a time,
 * laid out from the heap base: the rows to pin, the right-hand side, the band.
 *
 * The stiffness is symmetric positive definite, so only its lower band is
 * kept, a row at a time: row i holds columns i - bw .. i. Factorising row by
 * row then multiplies two runs that are each contiguous in memory.
 */

#define EXPORT(name) __attribute__((export_name(#name)))

extern unsigned char __heap_base;

namespace {

const double SHEAR_FACTOR = 5.0 / 6.0;
const double PIVOT_FLOOR = 1e-9;   // of the diagonal: below it the slab is a mechanism
const unsigned PAGE = 65536;

int dof = 0, bw = 0, stride = 0;
int* pinned = nullptr;
double* rhs = nullptr;
double* band = nullptr;

inline double& at(int row, int column) { return band[row * stride + column - row + bw]; }

// Four partial sums: without them the compiler may not reorder the additions,
// and the loop stays scalar.
inline double dot(const double* p, const double* q, int count) {
  double s0 = 0, s1 = 0, s2 = 0, s3 = 0;
  int k = 0;
  for (; k + 3 < count; k += 4) {
    s0 += p[k] * q[k];
    s1 += p[k + 1] * q[k + 1];
    s2 += p[k + 2] * q[k + 2];
    s3 += p[k + 3] * q[k + 3];
  }
  for (; k < count; k++) s0 += p[k] * q[k];
  return (s0 + s1) + (s2 + s3);
}

// 12 x 12, three unknowns a node: w, then the rotations bx and by.
// `reduced` samples the shear once, at the centre. That cures locking but
// leaves an hourglass mode in w, so it is kept only to show the difference;
// the default ties the shear strain at the middle of each side (MITC4).
void element(double a, double b, double t, double E, double nu, bool reduced, double* Ke) {
  for (int i = 0; i < 144; i++) Ke[i] = 0;
  const double D = E * t * t * t / (12.0 * (1.0 - nu * nu));
  const double Dnu = D * nu, Dxy = D * (1.0 - nu) / 2.0;
  const double area = a * b / 4.0;
  const double g = 1.0 / __builtin_sqrt(3.0);
  const double points[2] = {-g, g};

  for (double xi : points) {
    for (double eta : points) {
      const double dx[4] = {-(1 - eta) / (2 * a), (1 - eta) / (2 * a), (1 + eta) / (2 * a), -(1 + eta) / (2 * a)};
      const double dy[4] = {-(1 - xi) / (2 * b), -(1 + xi) / (2 * b), (1 + xi) / (2 * b), (1 - xi) / (2 * b)};
      for (int i = 0; i < 4; i++) {
        for (int j = 0; j < 4; j++) {
          const int r = i * 3, c = j * 3;
          Ke[(r + 1) * 12 + c + 1] += area * (D * dx[i] * dx[j] + Dxy * dy[i] * dy[j]);
          Ke[(r + 1) * 12 + c + 2] += area * (Dnu * dx[i] * dy[j] + Dxy * dy[i] * dx[j]);
          Ke[(r + 2) * 12 + c + 1] += area * (Dnu * dy[i] * dx[j] + Dxy * dx[i] * dy[j]);
          Ke[(r + 2) * 12 + c + 2] += area * (D * dy[i] * dy[j] + Dxy * dx[i] * dx[j]);
        }
      }
    }
  }

  // shear strains are w,x + bx and w,y + by
  const double shear = SHEAR_FACTOR * (E / (2.0 * (1.0 + nu))) * t;
  if (reduced) {
    const double dx[4] = {-1 / (2 * a), 1 / (2 * a), 1 / (2 * a), -1 / (2 * a)};
    const double dy[4] = {-1 / (2 * b), -1 / (2 * b), 1 / (2 * b), 1 / (2 * b)};
    const double k = 4.0 * area * shear;
    for (int i = 0; i < 4; i++) {
      for (int j = 0; j < 4; j++) {
        const int r = i * 3, c = j * 3;
        Ke[r * 12 + c] += k * (dx[i] * dx[j] + dy[i] * dy[j]);
        Ke[r * 12 + c + 1] += k * dx[i] * 0.25;
        Ke[r * 12 + c + 2] += k * dy[i] * 0.25;
        Ke[(r + 1) * 12 + c] += k * 0.25 * dx[j];
        Ke[(r + 2) * 12 + c] += k * 0.25 * dy[j];
        Ke[(r + 1) * 12 + c + 1] += k * 0.0625;
        Ke[(r + 2) * 12 + c + 2] += k * 0.0625;
      }
    }
    return;
  }

  // Along a side from one corner to the next, the strain at its middle. Each
  // strain then varies linearly between its two sides: south and north for
  // the one along x, west and east for the one along y.
  const int sides[4][2] = {{0, 1}, {3, 2}, {0, 3}, {1, 2}};
  double B[4][12];
  for (int s = 0; s < 4; s++) {
    const double length = s < 2 ? a : b;
    const int rotation = s < 2 ? 1 : 2;
    for (int q = 0; q < 12; q++) B[s][q] = 0;
    B[s][sides[s][0] * 3] = -1.0 / length;
    B[s][sides[s][1] * 3] = 1.0 / length;
    B[s][sides[s][0] * 3 + rotation] = B[s][sides[s][1] * 3 + rotation] = 0.5;
  }
  for (int pair = 0; pair < 4; pair += 2) {
    const double* P = B[pair];
    const double* Q = B[pair + 1];
    for (int p = 0; p < 12; p++) {
      for (int q = 0; q < 12; q++) {
        Ke[p * 12 + q] += shear * a * b / 3.0 * (P[p] * P[q] + Q[p] * Q[q] + 0.5 * (P[p] * Q[q] + Q[p] * P[q]));
      }
    }
  }
}

}  // namespace

extern "C" {

/**
 * Lays out room for a system of `unknowns` with half bandwidth `bandwidth`,
 * growing the memory if it has to. Returns 0 when the memory cannot grow.
 */
EXPORT(solver_reserve) int solver_reserve(int unknowns, int bandwidth) {
  dof = unknowns;
  bw = bandwidth;
  stride = bandwidth + 1;
  unsigned long long base = ((unsigned long long)(__SIZE_TYPE__)&__heap_base + 7) & ~7ull;
  pinned = (int*)(__SIZE_TYPE__)base;
  base += ((unsigned long long)dof * sizeof(int) + 7) & ~7ull;
  rhs = (double*)(__SIZE_TYPE__)base;
  base += (unsigned long long)dof * sizeof(double);
  band = (double*)(__SIZE_TYPE__)base;
  base += (unsigned long long)dof * stride * sizeof(double);

  const unsigned long long have = (unsigned long long)__builtin_wasm_memory_size(0) * PAGE;
  if (base <= have) return 1;
  if (base > 0xffff0000ull) return 0;
  return __builtin_wasm_memory_grow(0, (base - have + PAGE - 1) / PAGE) != (__SIZE_TYPE__)-1;
}

/** Where to write the rows to pin (int32) and the right-hand side (float64). */
EXPORT(solver_pinned) int* solver_pinned() { return pinned; }
EXPORT(solver_rhs) double* solver_rhs() { return rhs; }

/**
 * Assembles the stiffness of an nx x ny mesh of a x b elements into the band
 * and gives each of the first `held` rows in the pinned list a unit row and
 * column of its own. Nodes are numbered along x when `along_x`, else along y:
 * the caller picks the shorter side, which is what sets the bandwidth.
 */
EXPORT(solver_assemble) void solver_assemble(int nx, int ny, int along_x, double a, double b,
                                             double t, double E, double nu, int reduced, int held) {
  double Ke[144];
  element(a, b, t, E, nu, reduced != 0, Ke);

  const int total = dof * stride;
  for (int i = 0; i < total; i++) band[i] = 0;

  const int nodesX = nx + 1, nodesY = ny + 1;
  int nodes[4];
  for (int j = 0; j < ny; j++) {
    for (int i = 0; i < nx; i++) {
      if (along_x) {
        nodes[0] = j * nodesX + i; nodes[1] = nodes[0] + 1;
        nodes[3] = nodes[0] + nodesX; nodes[2] = nodes[3] + 1;
      } else {
        nodes[0] = i * nodesY + j; nodes[3] = nodes[0] + 1;
        nodes[1] = nodes[0] + nodesY; nodes[2] = nodes[1] + 1;
      }
      for (int p = 0; p < 12; p++) {
        const int row = nodes[p / 3] * 3 + p % 3;
        for (int q = 0; q < 12; q++) {
          const int column = nodes[q / 3] * 3 + q % 3;
          if (column <= row) at(row, column) += Ke[p * 12 + q];
        }
      }
    }
  }

  for (int h = 0; h < held; h++) {
    const int row = pinned[h];
    for (int column = row > bw ? row - bw : 0; column < row; column++) at(row, column) = 0;
    const int last = row + bw < dof - 1 ? row + bw : dof - 1;
    for (int below = row + 1; below <= last; below++) at(below, row) = 0;
    at(row, row) = 1;
  }
}

/**
 * In place: the band of K becomes the band of L, with K = L L'. Returns 0 when
 * a pivot vanishes, which means the slab is a mechanism.
 */
EXPORT(solver_factorise) int solver_factorise() {
  for (int i = 0; i < dof; i++) {
    const int first = i > bw ? i - bw : 0;
    double* row = &at(i, first);
    for (int j = first; j < i; j++) {
      // columns first .. j - 1 of rows i and j; row j starts no later than row i
      row[j - first] = (row[j - first] - dot(row, &at(j, first), j - first)) / at(j, j);
    }
    const double diagonal = at(i, i);
    const double pivot = diagonal - dot(row, row, i - first);
    if (!(pivot > PIVOT_FLOOR * diagonal)) return 0;
    at(i, i) = __builtin_sqrt(pivot);
  }
  return 1;
}

/** Solves L L' x = rhs in place. */
EXPORT(solver_substitute) void solver_substitute() {
  for (int i = 0; i < dof; i++) {
    const int first = i > bw ? i - bw : 0;
    rhs[i] = (rhs[i] - dot(&at(i, first), rhs + first, i - first)) / at(i, i);
  }
  for (int i = dof - 1; i >= 0; i--) {
    const int first = i > bw ? i - bw : 0;
    const double x = rhs[i] / at(i, i);
    rhs[i] = x;
    const double* row = &at(i, first);
    for (int k = first; k < i; k++) rhs[k] -= row[k - first] * x;
  }
}

}  // extern "C"
