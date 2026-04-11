/**
 * Parse a form/API date-only value (YYYY-MM-DD or ISO string starting with that) into a
 * Date at local midnight for that calendar day. Use when persisting Prisma `@db.Date` fields
 * so the stored day matches what the user chose (avoids `new Date("YYYY-MM-DD")` UTC shift).
 */
export function localDateFromDayInput(isoOrDate: string | null | undefined): Date | null {
  if (isoOrDate == null) return null;
  const s = String(isoOrDate).trim();
  if (s === "") return null;
  const dayKey = s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    const y = Number(dayKey.slice(0, 4));
    const m = Number(dayKey.slice(5, 7));
    const d = Number(dayKey.slice(8, 10));
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
    return new Date(y, m - 1, d);
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

/**
 * Format a stored calendar day for locale display without UTC shifting.
 * ISO date-only strings (YYYY-MM-DD) are parsed as local midnight; using `new Date(iso)`
 * alone treats them as UTC and can show the previous calendar day in US timezones.
 */
export function formatLocaleDateFromStoredDay(isoOrDate: string | Date | null | undefined): string {
  if (isoOrDate == null || isoOrDate === "") return "";
  if (isoOrDate instanceof Date) {
    if (Number.isNaN(isoOrDate.getTime())) return "";
    return isoOrDate.toLocaleDateString();
  }
  const s = String(isoOrDate).trim();
  const dayKey = s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    const y = Number(dayKey.slice(0, 4));
    const m = Number(dayKey.slice(5, 7));
    const d = Number(dayKey.slice(8, 10));
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return "";
    return new Date(y, m - 1, d).toLocaleDateString();
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toLocaleDateString();
  return "";
}
