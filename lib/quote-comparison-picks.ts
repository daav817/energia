export type StoredTermPick =
  | { kind: "quote"; quoteId: string }
  | { kind: "manual"; rowId: string };

/** Persist on `RfpRequest.quoteComparisonPicks` (JSON). Keys are term months as strings. */
export function serializeQuoteComparisonPicks(
  picks: Partial<Record<number, StoredTermPick>>
): Record<string, StoredTermPick> {
  const out: Record<string, StoredTermPick> = {};
  for (const [k, v] of Object.entries(picks)) {
    if (v == null) continue;
    const term = Number.parseInt(k, 10);
    if (!Number.isFinite(term)) continue;
    out[String(term)] = v;
  }
  return out;
}

export function hydrateQuoteComparisonPicks(raw: unknown): Partial<Record<number, StoredTermPick>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Partial<Record<number, StoredTermPick>> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    const term = Number.parseInt(key, 10);
    if (!Number.isFinite(term)) continue;
    if (!val || typeof val !== "object" || Array.isArray(val)) continue;
    const o = val as { kind?: unknown; quoteId?: unknown; rowId?: unknown };
    if (o.kind === "quote" && typeof o.quoteId === "string") {
      out[term] = { kind: "quote", quoteId: o.quoteId };
    } else if (o.kind === "manual" && typeof o.rowId === "string") {
      out[term] = { kind: "manual", rowId: o.rowId };
    }
  }
  return out;
}
