import { normalizeCompanyKey } from "@/lib/customers-overview";

function stripInvisible(s: string): string {
  return s.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
}

/** Standard Levenshtein distance (for light typo tolerance between tokens). */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row = new Array(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n]!;
}

/** True if b equals a with one adjacent pair swapped (e.g. Snyder ↔ Synder). */
function isAdjacentTransposition(a: string, b: string): boolean {
  if (a.length !== b.length || a.length < 2) return false;
  for (let i = 0; i < a.length - 1; i++) {
    if (a[i] !== b[i] && a[i] === b[i + 1] && a[i + 1] === b[i]) {
      if (a.slice(0, i) === b.slice(0, i) && a.slice(i + 2) === b.slice(i + 2)) return true;
    }
  }
  return false;
}

/**
 * Whether a contact's company field refers to the same organization as the supplier name.
 * Handles abbreviations (Bros/Brothers), light punctuation, and Inc/LLC-style noise.
 */
export function contactCompanyMatchesSupplierName(
  contactCompany: string | null | undefined,
  supplierName: string
): boolean {
  const rawC = stripInvisible(contactCompany || "");
  const rawS = stripInvisible(supplierName);
  if (!rawC || !rawS) return false;

  const fold = (s: string) => {
    let x = s.toLowerCase();
    x = x.replace(/\b(brothers?|bros)\b/gi, "bro");
    x = x.replace(/\b(inc\.?|llc|ltd\.?|corp\.?|corporation|co\.)\b/gi, " ");
    x = x.replace(/\s+/g, " ").trim();
    return normalizeCompanyKey(x);
  };

  const c = fold(rawC);
  const s = fold(rawS);
  if (!c || !s) return false;
  if (c === s) return true;
  if (c.includes(s) || s.includes(c)) return true;

  const words = (x: string) => x.split(/\s+/).filter((w) => w.length >= 2);
  const cWords = words(c);
  const sWords = words(s);
  if (cWords.length === 0 || sWords.length === 0) return false;

  const wordMatch = (a: string, b: string) => {
    if (a === b) return true;
    if (a.length >= 3 && b.length >= 3) {
      if (a.startsWith(b) || b.startsWith(a)) return true;
      if (a.slice(0, 4) === b.slice(0, 4)) return true;
    }
    const maxL = Math.max(a.length, b.length);
    if (maxL >= 4) {
      if (levenshtein(a, b) <= 1) return true;
      if (isAdjacentTransposition(a, b)) return true;
    }
    return false;
  };

  return sWords.every((sw) => cWords.some((cw) => wordMatch(cw, sw)));
}
