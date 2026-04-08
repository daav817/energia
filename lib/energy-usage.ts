/**
 * Natural-gas quantity normalization to MCF (thousand cubic feet).
 * Annual usage in the DB is stored in the contract's usage type (priceUnit).
 */

/** Approximate MMBtu per MCF for pipeline natural gas (US). */
const DTH_PER_MCF = 1.037;

export function annualGasUsageToMcf(
  quantity: number,
  priceUnit: string | null | undefined
): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  const u = String(priceUnit ?? "MCF").toUpperCase();
  switch (u) {
    case "MCF":
      return quantity;
    case "CCF":
      return quantity / 10; // 100 cu ft per CCF; 1 MCF = 10 CCF
    case "DTH":
      return quantity / DTH_PER_MCF;
    default:
      return quantity;
  }
}
