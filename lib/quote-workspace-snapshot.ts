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
  manualRows: SnapshotManualRow[];
  extraTermMonths: number[];
  capturedAt: string;
};

export function parseQuoteWorkspaceSnapshot(raw: unknown): QuoteWorkspaceSnapshotV1 | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Partial<QuoteWorkspaceSnapshotV1>;
  if (o.version !== 1) return null;
  if (!o.pickByTerm || typeof o.pickByTerm !== "object") return null;
  if (!Array.isArray(o.manualRows)) return null;
  if (!Array.isArray(o.extraTermMonths)) return null;
  if (typeof o.capturedAt !== "string") return null;
  return o as QuoteWorkspaceSnapshotV1;
}
