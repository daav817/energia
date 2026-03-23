/** Split stored contact.label (comma/semicolon separated) into distinct tokens. */
export function parseContactLabels(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,;]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Serialize labels for API (comma-separated, case-insensitive dedupe, preserve first casing). */
export function formatContactLabels(labels: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of labels) {
    const t = l.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.join(", ");
}
