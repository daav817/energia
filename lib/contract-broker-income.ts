/**
 * Broker income estimates aligned with Contract Management (margin × usage),
 * plus calendar-year allocation using contract dates.
 */

function parseYmd(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function utcDay(y: number, mo: number, d: number): number {
  return Date.UTC(y, mo - 1, d);
}

function daysInclusiveUtc(start: { y: number; m: number; d: number }, end: { y: number; m: number; d: number }): number {
  const a = utcDay(start.y, start.m, start.d);
  const b = utcDay(end.y, end.m, end.d);
  if (b < a) return 0;
  return Math.floor((b - a) / 86400000) + 1;
}

function overlapDaysInCalendarYear(
  start: { y: number; m: number; d: number },
  end: { y: number; m: number; d: number },
  year: number
): number {
  const ys = { y: year, m: 1, d: 1 };
  const ye = { y: year, m: 12, d: 31 };
  const lo =
    utcDay(start.y, start.m, start.d) >= utcDay(ys.y, ys.m, ys.d) ? start : ys;
  const hi =
    utcDay(end.y, end.m, end.d) <= utcDay(ye.y, ye.m, ye.d) ? end : ye;
  if (utcDay(lo.y, lo.m, lo.d) > utcDay(hi.y, hi.m, hi.d)) return 0;
  return daysInclusiveUtc(lo, hi);
}

export type ContractLikeForIncome = {
  startDate: string;
  expirationDate: string;
  termMonths?: number | null;
  annualUsage?: unknown;
  avgMonthlyUsage?: unknown;
  brokerMargin?: unknown;
  contractIncome?: unknown;
};

function num(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function annualUsageResolved(c: ContractLikeForIncome): number {
  const annual = num(c.annualUsage);
  if (annual > 0) return annual;
  return num(c.avgMonthlyUsage) * 12;
}

/** Full-term broker income: stored contractIncome, else margin × (annual/12) × term months (matches directory contracts page). */
export function totalTermBrokerIncome(c: ContractLikeForIncome): number {
  const stored = num(c.contractIncome);
  if (stored > 0) return stored;
  const margin = num(c.brokerMargin);
  const usage = annualUsageResolved(c);
  const months = c.termMonths && c.termMonths > 0 ? c.termMonths : 12;
  return margin * (usage / 12) * months;
}

/** Broker income attributed to a calendar year via day proration over the contract term. */
export function calendarYearBrokerIncome(c: ContractLikeForIncome, year: number): number {
  const s = parseYmd(String(c.startDate));
  const e = parseYmd(String(c.expirationDate));
  if (!s || !e) return 0;
  const termDays = daysInclusiveUtc(s, e);
  if (termDays <= 0) return 0;
  const overlap = overlapDaysInCalendarYear(s, e, year);
  if (overlap <= 0) return 0;
  const total = totalTermBrokerIncome(c);
  return (total * overlap) / termDays;
}
