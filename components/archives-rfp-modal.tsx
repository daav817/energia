"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { parseQuoteWorkspaceSnapshot } from "@/lib/quote-workspace-snapshot";

type ArchivedRfp = {
  id: string;
  status: string;
  energyType: string;
  quoteDueDate: string | null;
  archivedAt: string | null;
  ldcUtility: string | null;
  requestedTerms: unknown;
  archivedQuoteWorkspace: unknown;
  customer: { name: string; company: string | null } | null;
  suppliers: Array<{ id: string; name: string }>;
  accountLines: Array<{ accountNumber: string; annualUsage: unknown; serviceAddress?: string | null }>;
  quotes: Array<{
    id: string;
    rate: unknown;
    priceUnit: string;
    termMonths: number;
    supplier: { name: string };
  }>;
};

function formatTerms(rt: unknown): string {
  if (!Array.isArray(rt)) return "—";
  return rt
    .map((t) => {
      const o = t as { kind?: string; months?: number };
      return o?.kind === "nymex" ? "NYMEX" : `${o?.months ?? "?"} months`;
    })
    .join(", ");
}

export function ArchivesRfpModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [list, setList] = useState<ArchivedRfp[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/rfp?archivedOnly=1");
        const data = await res.json();
        setList(Array.isArray(data) ? data : []);
        setSelectedId(null);
      } catch {
        setList([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [open]);

  const selected = list.find((r) => r.id === selectedId) ?? null;
  const workspaceSnap = selected ? parseQuoteWorkspaceSnapshot(selected.archivedQuoteWorkspace) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle>Archives</DialogTitle>
        </DialogHeader>
        <div className="flex flex-1 min-h-0 border-t">
          <div className="w-[min(40%,280px)] border-r overflow-y-auto">
            {loading ? (
              <p className="p-4 text-sm text-muted-foreground">Loading…</p>
            ) : list.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No archived RFPs.</p>
            ) : (
              <ul className="p-2 space-y-1">
                {list.map((r) => {
                  const label =
                    `${r.customer?.name ?? "Customer"} · ${r.energyType === "ELECTRIC" ? "Electric" : "Gas"}`;
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(r.id)}
                        className={`w-full text-left rounded-md px-3 py-2 text-xs leading-snug transition-colors ${
                          selectedId === r.id ? "bg-primary/15" : "hover:bg-muted"
                        }`}
                      >
                        <div className="font-medium line-clamp-2">{label}</div>
                        <div className="text-muted-foreground">
                          Archived{" "}
                          {r.archivedAt
                            ? new Date(r.archivedAt).toLocaleDateString()
                            : "—"}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="flex-1 min-w-0 overflow-y-auto p-4 text-sm">
            {!selected ? (
              <p className="text-muted-foreground">Select an archived RFP to view details.</p>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge variant={selected.energyType === "ELECTRIC" ? "electric" : "gas"}>
                    {selected.energyType === "ELECTRIC" ? "Electric" : "Gas"}
                  </Badge>
                  <Badge variant="outline">{selected.status}</Badge>
                </div>
                <p className="font-medium">
                  {selected.customer?.name ?? "—"}
                  {selected.customer?.company ? ` (${selected.customer.company})` : ""}
                </p>
                <p className="text-muted-foreground">
                  Utility: {selected.ldcUtility || "—"} · Quote due:{" "}
                  {selected.quoteDueDate
                    ? new Date(selected.quoteDueDate).toLocaleDateString()
                    : "—"}
                </p>
                <p className="text-muted-foreground">Requested terms: {formatTerms(selected.requestedTerms)}</p>
                <p className="text-muted-foreground">
                  Suppliers: {selected.suppliers.map((s) => s.name).join(", ") || "—"}
                </p>
                <div>
                  <p className="font-medium mb-2">Accounts</p>
                  <ul className="text-xs space-y-1 text-muted-foreground">
                    {selected.accountLines.length === 0 ? (
                      <li>—</li>
                    ) : (
                      selected.accountLines.map((a) => (
                        <li key={a.accountNumber}>
                          {a.accountNumber}
                          {a.serviceAddress ? ` — ${a.serviceAddress}` : ""} · Annual:{" "}
                          {String(a.annualUsage ?? "—")}
                        </li>
                      ))
                    )}
                  </ul>
                </div>
                <div>
                  <p className="font-medium mb-2">Quote comparison (saved rows)</p>
                  {selected.quotes.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No quote rows stored.</p>
                  ) : (
                    <div className="rounded-md border overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b bg-muted/40">
                            <th className="text-left p-2">Supplier</th>
                            <th className="text-right p-2">Rate</th>
                            <th className="text-left p-2">Unit</th>
                            <th className="text-right p-2">Term</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selected.quotes.map((q) => (
                            <tr key={q.id} className="border-b border-border/50">
                              <td className="p-2">{q.supplier.name}</td>
                              <td className="p-2 text-right tabular-nums">${Number(q.rate).toFixed(4)}</td>
                              <td className="p-2">{q.priceUnit}</td>
                              <td className="p-2 text-right">{q.termMonths} mo</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div>
                  <p className="font-medium mb-2">Archived customer quote selections</p>
                  {!workspaceSnap ? (
                    <p className="text-xs text-muted-foreground">
                      No workspace snapshot (archived before this was recorded, or comparison was not saved).
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Captured{" "}
                        {workspaceSnap.capturedAt
                          ? new Date(workspaceSnap.capturedAt).toLocaleString(undefined, {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })
                          : "—"}
                        {workspaceSnap.extraTermMonths?.length
                          ? ` · Extra term columns: ${workspaceSnap.extraTermMonths.join(", ")} mo`
                          : ""}
                      </p>
                      <div className="rounded-md border overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b bg-muted/40">
                              <th className="text-left p-2">Term (mo)</th>
                              <th className="text-left p-2">Source</th>
                              <th className="text-left p-2">Supplier</th>
                              <th className="text-right p-2">Rate</th>
                              <th className="text-left p-2">Unit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(workspaceSnap.pickByTerm)
                              .map(([termStr, pick]) => ({
                                term: Number.parseInt(termStr, 10),
                                pick,
                              }))
                              .filter((row) => Number.isFinite(row.term))
                              .sort((a, b) => a.term - b.term)
                              .map(({ term, pick }) => {
                                if (pick.kind === "quote") {
                                  const q = selected.quotes.find((x) => x.id === pick.quoteId);
                                  return (
                                    <tr key={`${term}-q`} className="border-b border-border/50">
                                      <td className="p-2 tabular-nums">{term}</td>
                                      <td className="p-2">Saved quote</td>
                                      <td className="p-2">{q?.supplier.name ?? "—"}</td>
                                      <td className="p-2 text-right tabular-nums">
                                        {q ? `$${Number(q.rate).toFixed(4)}` : "—"}
                                      </td>
                                      <td className="p-2">{q?.priceUnit ?? "—"}</td>
                                    </tr>
                                  );
                                }
                                const row = workspaceSnap.manualRows.find((m) => m.id === pick.rowId);
                                const rateRaw = row?.rates[String(term)];
                                const unit = row?.units[String(term)] ?? "—";
                                return (
                                  <tr key={`${term}-m`} className="border-b border-border/50">
                                    <td className="p-2 tabular-nums">{term}</td>
                                    <td className="p-2">Manual row</td>
                                    <td className="p-2">{(row?.supplierName || "").trim() || "—"}</td>
                                    <td className="p-2 text-right tabular-nums">
                                      {rateRaw != null && String(rateRaw).trim() !== ""
                                        ? `$${Number.parseFloat(String(rateRaw)).toFixed(4)}`
                                        : "—"}
                                    </td>
                                    <td className="p-2">{unit}</td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        <DialogFooter className="px-6 py-4 border-t shrink-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
