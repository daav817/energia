import { annualGasUsageToMcf } from "@/lib/energy-usage";
import { coerceFiniteNumber } from "@/lib/coerce-number";
import {
  annualUsageResolved,
  calendarYearProRatedAnnualUsage,
  type ContractLikeForIncome,
} from "@/lib/contract-broker-income";

export type ContractLikeForUsageCalendar = ContractLikeForIncome & {
  energyType: string;
  priceUnit?: string | null;
  status?: string | null;
};

export type UsageYearBreakdownRow = {
  year: number;
  electricKwh: number;
  naturalGasMcf: number;
  /** Sum of (prorated annual usage × broker margin) for electric contracts in this year. */
  electricBrokerIncomeUsd: number;
  /** Sum of (prorated annual usage × broker margin) for natural gas contracts — margin matches contract price unit. */
  naturalGasBrokerIncomeUsd: number;
};

function num(v: unknown): number {
  return coerceFiniteNumber(v);
}

function isElectricType(t: string | undefined | null): boolean {
  return String(t).toUpperCase() === "ELECTRIC";
}

function isNaturalGasType(t: string | undefined | null): boolean {
  return String(t).toUpperCase() === "NATURAL_GAS";
}

/** Usage slice for one contract in one calendar year (electric in kWh, gas normalized to MCF). */
export function contractUsageInCalendarYear(
  c: ContractLikeForUsageCalendar,
  year: number
): { electricKwh: number; naturalGasMcf: number } {
  if (String(c.status).toLowerCase() === "cancelled") {
    return { electricKwh: 0, naturalGasMcf: 0 };
  }
  const proratedNative = calendarYearProRatedAnnualUsage(c, year);
  if (proratedNative <= 0) return { electricKwh: 0, naturalGasMcf: 0 };
  if (isElectricType(c.energyType)) {
    return { electricKwh: proratedNative, naturalGasMcf: 0 };
  }
  if (isNaturalGasType(c.energyType)) {
    return {
      electricKwh: 0,
      naturalGasMcf: annualGasUsageToMcf(proratedNative, c.priceUnit),
    };
  }
  return { electricKwh: 0, naturalGasMcf: 0 };
}

/**
 * Broker income for one contract in one calendar year: prorated usage (same basis as usage panel)
 * × broker margin on that contract (per kWh for electric, per MCF/CCF/DTH for gas).
 */
export function contractBrokerIncomeInCalendarYear(
  c: ContractLikeForUsageCalendar,
  year: number
): { electricUsd: number; gasUsd: number } {
  if (String(c.status).toLowerCase() === "cancelled") {
    return { electricUsd: 0, gasUsd: 0 };
  }
  const margin = num(c.brokerMargin);
  if (margin <= 0) return { electricUsd: 0, gasUsd: 0 };
  const prorated = calendarYearProRatedAnnualUsage(c, year);
  if (prorated <= 0) return { electricUsd: 0, gasUsd: 0 };
  if (isElectricType(c.energyType)) {
    return { electricUsd: prorated * margin, gasUsd: 0 };
  }
  if (isNaturalGasType(c.energyType)) {
    return { electricUsd: 0, gasUsd: prorated * margin };
  }
  return { electricUsd: 0, gasUsd: 0 };
}

function parseStartYear(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  return m ? Number(m[1]) : null;
}

function parseEndYear(iso: string): number | null {
  return parseStartYear(iso);
}

/** Sum annual bill-based usage for non-archived, non-cancelled contracts (active book). */
export function activeBookAnnualUsageTotals(contracts: ContractLikeForUsageCalendar[]): {
  electricKwh: number;
  naturalGasMcf: number;
} {
  let electricKwh = 0;
  let naturalGasMcf = 0;
  for (const c of contracts) {
    const st = String(c.status ?? "").toLowerCase();
    if (st === "archived" || st === "cancelled") continue;
    const a = annualUsageResolved(c);
    if (a <= 0) continue;
    if (c.energyType === "ELECTRIC") electricKwh += a;
    else if (c.energyType === "NATURAL_GAS") {
      naturalGasMcf += annualGasUsageToMcf(a, c.priceUnit);
    }
  }
  return { electricKwh, naturalGasMcf };
}

/** Full-year margin × annual usage on the active book, by commodity (non-archived, non-cancelled). */
export function activeBookAnnualBrokerIncomeTotals(contracts: ContractLikeForUsageCalendar[]): {
  electricUsd: number;
  gasUsd: number;
} {
  let electricUsd = 0;
  let gasUsd = 0;
  for (const c of contracts) {
    const st = String(c.status ?? "").toLowerCase();
    if (st === "archived" || st === "cancelled") continue;
    const margin = num(c.brokerMargin);
    const a = annualUsageResolved(c);
    if (margin <= 0 || a <= 0) continue;
    if (isElectricType(c.energyType)) electricUsd += a * margin;
    else if (isNaturalGasType(c.energyType)) gasUsd += a * margin;
  }
  return { electricUsd, gasUsd };
}

/**
 * One row per calendar year from the earliest overlapping contract through the latest expiration or now.
 */
export function aggregateUsageByCalendarYear(
  contracts: ContractLikeForUsageCalendar[]
): UsageYearBreakdownRow[] {
  const nowY = new Date().getFullYear();
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of contracts) {
    const sy = parseStartYear(String(c.startDate));
    const ey = parseEndYear(String(c.expirationDate));
    if (sy != null) minY = Math.min(minY, sy);
    if (ey != null) maxY = Math.max(maxY, ey);
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return [];
  maxY = Math.max(maxY, nowY);
  const rows: UsageYearBreakdownRow[] = [];
  for (let y = minY; y <= maxY; y++) {
    let electricKwh = 0;
    let naturalGasMcf = 0;
    let electricBrokerIncomeUsd = 0;
    let naturalGasBrokerIncomeUsd = 0;
    for (const c of contracts) {
      const u = contractUsageInCalendarYear(c, y);
      electricKwh += u.electricKwh;
      naturalGasMcf += u.naturalGasMcf;
      const inc = contractBrokerIncomeInCalendarYear(c, y);
      electricBrokerIncomeUsd += inc.electricUsd;
      naturalGasBrokerIncomeUsd += inc.gasUsd;
    }
    rows.push({
      year: y,
      electricKwh,
      naturalGasMcf,
      electricBrokerIncomeUsd,
      naturalGasBrokerIncomeUsd,
    });
  }
  return rows;
}
