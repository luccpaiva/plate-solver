import { solvePlate as solveMindlin } from "./mindlin.js";

/**
 * Solve plate FEA. Params: { plate, material, load, pillars, edgeSupported, nx, ny }.
 * Pillars in local coords [0,width]×[0,length]. Returns { deflections, maxDeflection, minDeflection, dof, solveTime }.
 */
export function solveFEA(params, _cache = null) {
  const result = solveMindlin(params);
  return {
    deflections: result.deflections,
    maxDeflection: result.maxDeflection,
    minDeflection: result.minDeflection,
    dof: result.dof,
    solveTime: result.solveTime
  };
}
