/** Persisted when an RFP is archived so broker quote-comparison picks are recoverable in Archives. */

export type SnapshotTermPick =
  | { kind: "quote"; quoteId: string }
  | { kind: "manual"; rowId: string };

export type SnapshotManualRow = {
  id: string;
  supplierName: string;
  rates: Partial<Record<string, string>>;
  units: Partial<Record<string, string>>;
};

export type QuoteWorkspaceSnapshotV1 = {
  version: 1;
  /** JSON keys are term month strings, e.g. "12". */
  pickByTerm: Record<string, SnapshotTermPick>;
  /** Present for electric RFPs with dual comparison tables. */
  electricPicks?: {
    fixed: Record<string, SnapshotTermPick>;
    passThrough: Record<string, SnapshotTermPick>;
  };
  manualRows: SnapshotManualRow[];
  extraTermMonths: number[];
  capturedAt: string;
};

export function parseQuoteWorkspaceSnapshot(raw: unknown): QuoteWorkspaceSnapshotV1 | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Partial<QuoteWorkspaceSnapshotV1>;
  if (o.version !== 1) return null;
  const hasGasPicks = o.pickByTerm != null && typeof o.pickByTerm === "object";
  const hasElectric =
    o.electricPicks != null &&
    typeof o.electricPicks === "object" &&
    o.electricPicks.fixed != null &&
    o.electricPicks.passThrough != null;
  if (!hasGasPicks && !hasElectric) return null;
  if (!Array.isArray(o.manualRows)) return null;
  if (!Array.isArray(o.extraTermMonths)) return null;
  if (typeof o.capturedAt !== "string") return null;
  return {
    version: 1,
    pickByTerm: hasGasPicks ? (o.pickByTerm as Record<string, SnapshotTermPick>) : {},
    ...(hasElectric ? { electricPicks: o.electricPicks } : {}),
    manualRows: o.manualRows,
    extraTermMonths: o.extraTermMonths,
    capturedAt: o.capturedAt,
  };
}
