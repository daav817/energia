/**
 * Safe finite number for UI/math, including Prisma Decimal / decimal.js objects
 * (plain `Number(decimal)` is often NaN).
 */
export function coerceFiniteNumber(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return 0;
    const n = Number(t);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof v === "object") {
    const o = v as { toNumber?: () => number; toFixed?: (dp?: number) => string };
    if (typeof o.toNumber === "function") {
      try {
        const x = o.toNumber();
        if (Number.isFinite(x)) return x;
      } catch {
        /* ignore */
      }
    }
    if (typeof o.toFixed === "function") {
      try {
        const n = Number(o.toFixed(10));
        if (Number.isFinite(n)) return n;
      } catch {
        /* ignore */
      }
    }
  }
  const n = Number(v as string | number);
  return Number.isFinite(n) ? n : 0;
}
