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
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion === 2 && o.electric && typeof o.electric === "object" && o.electric !== null) {
    return {};
  }
  const out: Partial<Record<number, StoredTermPick>> = {};
  for (const [key, val] of Object.entries(o)) {
    if (key === "schemaVersion" || key === "electric") continue;
    const term = Number.parseInt(key, 10);
    if (!Number.isFinite(term)) continue;
    if (!val || typeof val !== "object" || Array.isArray(val)) continue;
    const row = val as { kind?: unknown; quoteId?: unknown; rowId?: unknown };
    if (row.kind === "quote" && typeof row.quoteId === "string") {
      out[term] = { kind: "quote", quoteId: row.quoteId };
    } else if (row.kind === "manual" && typeof row.rowId === "string") {
      out[term] = { kind: "manual", rowId: row.rowId };
    }
  }
  return out;
}

export type ElectricDualPicks = {
  fixed: Partial<Record<number, StoredTermPick>>;
  passThrough: Partial<Record<number, StoredTermPick>>;
};

const EMPTY_DUAL: ElectricDualPicks = { fixed: {}, passThrough: {} };

export function hydrateElectricDualPicks(raw: unknown): ElectricDualPicks {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...EMPTY_DUAL, fixed: {}, passThrough: {} };
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion === 2 && o.electric && typeof o.electric === "object" && o.electric !== null) {
    const e = o.electric as Record<string, unknown>;
    return {
      fixed: hydrateQuoteComparisonPicks(e.fixed ?? {}),
      passThrough: hydrateQuoteComparisonPicks(e.passThrough ?? {}),
    };
  }
  return {
    fixed: hydrateQuoteComparisonPicks(raw),
    passThrough: {},
  };
}

export function serializeElectricDualPicks(dual: ElectricDualPicks): Record<string, unknown> {
  return {
    schemaVersion: 2,
    electric: {
      fixed: serializeQuoteComparisonPicks(dual.fixed),
      passThrough: serializeQuoteComparisonPicks(dual.passThrough),
    },
  };
}

export function persistPayloadForEnergyType(
  energyType: "ELECTRIC" | "NATURAL_GAS",
  single: Partial<Record<number, StoredTermPick>>,
  electricDual: ElectricDualPicks
): Record<string, unknown> | Record<string, StoredTermPick> {
  if (energyType === "ELECTRIC") {
    return serializeElectricDualPicks(electricDual);
  }
  return serializeQuoteComparisonPicks(single);
}

export function hydrateFullQuotePicks(
  raw: unknown,
  energyType: "ELECTRIC" | "NATURAL_GAS"
): { single: Partial<Record<number, StoredTermPick>>; electric: ElectricDualPicks } {
  if (energyType === "ELECTRIC") {
    const electric = hydrateElectricDualPicks(raw);
    return { single: {}, electric };
  }
  return { single: hydrateQuoteComparisonPicks(raw), electric: { fixed: {}, passThrough: {} } };
}
