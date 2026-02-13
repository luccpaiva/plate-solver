/**
 * Mindlin-Reissner Plate FEA Solver - C++ implementation
 * Banded Cholesky solver exploiting SPD stiffness matrix structure.
 * Penalty BC, 3 DOF/node (w, βx, βy).
 */

#include "solver.h"
#include <cmath>
#include <cstring>
#include <chrono>
#include <vector>
#include <set>

static const double GP = 1.0 / std::sqrt(3.0);
static const double PENALTY = 1e10;

static void computeElementStiffness(double a, double b, double t, double E, double nu, double* Ke) {
  std::memset(Ke, 0, 144 * sizeof(double));
  double D = (E * t * t * t) / (12.0 * (1.0 - nu * nu));
  double Db[9] = {
    D, D * nu, 0,
    D * nu, D, 0,
    0, 0, D * (1.0 - nu) / 2.0
  };
  double kappa = 5.0 / 6.0;
  double G = E / (2.0 * (1.0 + nu));
  double Ds0 = kappa * G * t;
  double detJ = (a * b) / 4.0;
  double gaussPts2[2] = {-GP, GP};
  double gaussWts2[2] = {1.0, 1.0};

  for (int gi = 0; gi < 2; gi++) {
    for (int gj = 0; gj < 2; gj++) {
      double xi = gaussPts2[gi], eta = gaussPts2[gj];
      double wt = gaussWts2[gi] * gaussWts2[gj];
      double dNdx[4] = {
        -(1.0 - eta) / (2.0 * a), (1.0 - eta) / (2.0 * a),
        (1.0 + eta) / (2.0 * a), -(1.0 + eta) / (2.0 * a)
      };
      double dNdy[4] = {
        -(1.0 - xi) / (2.0 * b), -(1.0 + xi) / (2.0 * b),
        (1.0 + xi) / (2.0 * b), (1.0 - xi) / (2.0 * b)
      };

      for (int ni = 0; ni < 4; ni++) {
        for (int nj = 0; nj < 4; nj++) {
          double dix = dNdx[ni], diy = dNdy[ni];
          double djx = dNdx[nj], djy = dNdy[nj];
          double c1_0 = Db[0] * djx + Db[2] * djy;
          double c1_1 = Db[3] * djx + Db[5] * djy;
          double c1_2 = Db[6] * djx + Db[8] * djy;
          double c2_0 = Db[1] * djy + Db[2] * djx;
          double c2_1 = Db[4] * djy + Db[5] * djx;
          double c2_2 = Db[7] * djy + Db[8] * djx;
          double factor = wt * detJ;
          int r = ni * 3, c = nj * 3;
          Ke[(r + 1) * 12 + (c + 1)] += factor * (dix * c1_0 + diy * c1_2);
          Ke[(r + 1) * 12 + (c + 2)] += factor * (dix * c2_0 + diy * c2_2);
          Ke[(r + 2) * 12 + (c + 1)] += factor * (diy * c1_1 + dix * c1_2);
          Ke[(r + 2) * 12 + (c + 2)] += factor * (diy * c2_1 + dix * c2_2);
        }
      }
    }
  }

  {
    double wt = 4.0;
    double N[4] = {0.25, 0.25, 0.25, 0.25};
    double dNdx[4] = {-1.0 / (2.0 * a), 1.0 / (2.0 * a), 1.0 / (2.0 * a), -1.0 / (2.0 * a)};
    double dNdy[4] = {-1.0 / (2.0 * b), -1.0 / (2.0 * b), 1.0 / (2.0 * b), 1.0 / (2.0 * b)};
    double factor = wt * detJ * Ds0;

    for (int ni = 0; ni < 4; ni++) {
      for (int nj = 0; nj < 4; nj++) {
        double dix = dNdx[ni], diy = dNdy[ni], Ni = N[ni];
        double djx = dNdx[nj], djy = dNdy[nj], Nj = N[nj];
        int r = ni * 3, c = nj * 3;
        Ke[r * 12 + c] += factor * (dix * djx + diy * djy);
        Ke[r * 12 + (c + 1)] += factor * (dix * Nj);
        Ke[r * 12 + (c + 2)] += factor * (diy * Nj);
        Ke[(r + 1) * 12 + c] += factor * (Ni * djx);
        Ke[(r + 1) * 12 + (c + 1)] += factor * (Ni * Nj);
        Ke[(r + 2) * 12 + c] += factor * (Ni * djy);
        Ke[(r + 2) * 12 + (c + 2)] += factor * (Ni * Nj);
      }
    }
  }
}

static void assembleGlobalBanded(double* Band, int stride, const double* Ke, int nx, int ny, int nodesX, int dofPerNode) {
  for (int ej = 0; ej < ny; ej++) {
    for (int ei = 0; ei < nx; ei++) {
      int n0 = ej * nodesX + ei;
      int elemNodes[4] = {n0, n0 + 1, n0 + nodesX + 1, n0 + nodesX};
      for (int li = 0; li < 4; li++) {
        for (int lj = 0; lj < 4; lj++) {
          for (int di = 0; di < dofPerNode; di++) {
            int gi = elemNodes[li] * dofPerNode + di;
            for (int dj = 0; dj < dofPerNode; dj++) {
              int gj = elemNodes[lj] * dofPerNode + dj;
              if (gj >= gi) {
                double keVal = Ke[(li * dofPerNode + di) * 12 + (lj * dofPerNode + dj)];
                Band[gi * stride + (gj - gi)] += keVal;
              }
            }
          }
        }
      }
    }
  }
}

static void assembleLoads(double* rhs, double q, double a, double b, int nx, int ny, int nodesX) {
  double elemLoad = (q * a * b) / 4.0;
  for (int ej = 0; ej < ny; ej++) {
    for (int ei = 0; ei < nx; ei++) {
      int n0 = ej * nodesX + ei;
      rhs[n0 * 3] -= elemLoad;
      rhs[(n0 + 1) * 3] -= elemLoad;
      rhs[(n0 + nodesX + 1) * 3] -= elemLoad;
      rhs[(n0 + nodesX) * 3] -= elemLoad;
    }
  }
}

static void bandedCholesky(double* Band, int n, int bw, int stride) {
  for (int j = 0; j < n; j++) {
    double sum = Band[j * stride];
    int kStart = j - bw;
    if (kStart < 0) kStart = 0;
    for (int k = kStart; k < j; k++) {
      double t = Band[k * stride + (j - k)];
      sum -= t * t;
    }
    Band[j * stride] = (sum > 0.0) ? std::sqrt(sum) : 1e-15;

    int iEnd = j + bw;
    if (iEnd > n - 1) iEnd = n - 1;
    for (int i = j + 1; i <= iEnd; i++) {
      sum = Band[j * stride + (i - j)];
      kStart = i - bw;
      if (kStart < 0) kStart = 0;
      for (int k = kStart; k < j; k++) {
        sum -= Band[k * stride + (j - k)] * Band[k * stride + (i - k)];
      }
      Band[j * stride + (i - j)] = sum / Band[j * stride];
    }
  }
}

static void bandedCholeskySolve(const double* Band, int n, int bw, int stride, double* x) {
  // Forward: R^T * y = b  (R^T is lower triangular)
  for (int i = 0; i < n; i++) {
    double sum = x[i];
    int kStart = i - bw;
    if (kStart < 0) kStart = 0;
    for (int k = kStart; k < i; k++) {
      sum -= Band[k * stride + (i - k)] * x[k];
    }
    x[i] = sum / Band[i * stride];
  }
  // Back: R * x = y  (R is upper triangular)
  for (int i = n - 1; i >= 0; i--) {
    double sum = x[i];
    int kEnd = i + bw;
    if (kEnd > n - 1) kEnd = n - 1;
    for (int k = i + 1; k <= kEnd; k++) {
      sum -= Band[i * stride + (k - i)] * x[k];
    }
    x[i] = sum / Band[i * stride];
  }
}

extern "C" {

double solver_solve(
  int nx, int ny,
  double width, double length, double thickness,
  double E, double nu, double load,
  const double* pillars_x, const double* pillars_z, const int* pillars_bc, int num_pillars,
  int edge_left, int edge_right, int edge_top, int edge_bottom,
  double* out_deflections,
  double* out_max_deflection, double* out_min_deflection
) {
  auto t0 = std::chrono::high_resolution_clock::now();

  int nodesX = nx + 1;
  int nodesY = ny + 1;
  int numNodes = nodesX * nodesY;
  int dofPerNode = 3;
  int totalDof = numNodes * dofPerNode;
  double elemWidth = width / nx;
  double elemLength = length / ny;

  int bw = 3 * (nodesX + 1) + 2;
  int stride = bw + 1;
  if ((bw & (bw - 1)) == 0) stride++;  // avoid power-of-2 step in Cholesky inner loop

  double Ke[144];
  computeElementStiffness(elemWidth, elemLength, thickness, E, nu, Ke);

  std::vector<double> Band(totalDof * stride, 0.0);
  assembleGlobalBanded(Band.data(), stride, Ke, nx, ny, nodesX, dofPerNode);

  std::vector<double> rhs(totalDof, 0.0);
  assembleLoads(rhs.data(), load, elemWidth, elemLength, nx, ny, nodesX);

  std::set<int> constrainedDofs;

  for (int pp = 0; pp < num_pillars; pp++) {
    double px = pillars_x[pp], pz = pillars_z[pp];
    int ni = (int)std::round(px / elemWidth);
    int nj = (int)std::round(pz / elemLength);
    int ci = (ni < 0) ? 0 : (ni > nx ? nx : ni);
    int cj = (nj < 0) ? 0 : (nj > ny ? ny : nj);
    int nodeIdx = cj * nodesX + ci;
    int bc = pillars_bc[pp];

    constrainedDofs.insert(nodeIdx * 3);
    if (bc == 1) {
      constrainedDofs.insert(nodeIdx * 3 + 1);
      constrainedDofs.insert(nodeIdx * 3 + 2);
    }
  }

  if (edge_left) for (int j = 0; j <= ny; j++) constrainedDofs.insert(j * nodesX * 3);
  if (edge_right) for (int j = 0; j <= ny; j++) constrainedDofs.insert((j * nodesX + nx) * 3);
  if (edge_bottom) for (int i = 0; i <= nx; i++) constrainedDofs.insert(i * 3);
  if (edge_top) for (int i = 0; i <= nx; i++) constrainedDofs.insert((ny * nodesX + i) * 3);

  for (int d : constrainedDofs) {
    Band[d * stride] *= PENALTY;
    rhs[d] = 0;
  }

  bandedCholesky(Band.data(), totalDof, bw, stride);
  bandedCholeskySolve(Band.data(), totalDof, bw, stride, rhs.data());

  double maxDefl = -1e308, minDefl = 1e308;
  for (int n = 0; n < numNodes; n++) {
    double w = rhs[n * 3];
    out_deflections[n] = w;
    if (w > maxDefl) maxDefl = w;
    if (w < minDefl) minDefl = w;
  }

  *out_max_deflection = std::max(std::abs(maxDefl), std::abs(minDefl));
  *out_min_deflection = minDefl;

  auto t1 = std::chrono::high_resolution_clock::now();
  return std::chrono::duration<double, std::milli>(t1 - t0).count();
}

} /* extern "C" */
