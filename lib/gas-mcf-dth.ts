/** Industry shorthand: 1 MCF ≈ 1.032 DTH (dekatherms). */
export const MCF_PER_DTH = 1.032;

export function mcfToDth(mcf: number): number {
  if (!Number.isFinite(mcf)) return NaN;
  return mcf * MCF_PER_DTH;
}

export function dthToMcf(dth: number): number {
  if (!Number.isFinite(dth)) return NaN;
  return dth / MCF_PER_DTH;
}
