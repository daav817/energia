"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Loader2, RefreshCw, Search, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { gmailFromToken } from "@/lib/gmail-query";
import {
  combinedAnnualUsageFromAccounts,
  impliedMonthlyEnergyCostUsd,
  totalContractValueUsd,
  unitLabelForEnergy,
} from "@/lib/rfp-quote-math";

export type ComparisonRfpQuote = {
  id: string;
  rate: number;
  priceUnit: string;
  termMonths: number;
  supplier: { id: string; name: string };
};

export type TermPick = { kind: "quote"; quoteId: string } | { kind: "manual"; rowId: string };

export type ManualQuoteRow = {
  id: string;
  supplierName: string;
  rates: Partial<Record<number, string>>;
  units: Partial<Record<number, string>>;
};

type SummaryRfp = {
  id: string;
  quoteDueDate: string | null;
  requestedTerms: Array<{ kind: "months"; months: number } | { kind: "nymex" }> | null;
  energyType: "ELECTRIC" | "NATURAL_GAS";
  suppliers: Array<{ id: string; name: string; email: string | null }>;
  accountLines: Array<{ annualUsage: number | string }>;
};

type InboxMessage = {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
};

export type SupplierInboxEmailDetail = {
  subject: string;
  bodyHtml: string;
  body: string;
  attachments: Array<{
    attachmentId: string;
    filename: string;
    mimeType: string;
    size: number;
  }>;
};

function sanitizeDecimalRateInput(raw: string): string {
  let s = raw.replace(/[^\d.]/g, "");
  const firstDot = s.indexOf(".");
  if (firstDot !== -1) {
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, "");
  }
  return s;
}

function sanitizeWholeMonthsInput(raw: string): string {
  return raw.replace(/\D/g, "");
}

const STANDARD_TERM_PRESETS = ["12", "24", "36"] as const;

export function QuoteComparisonTab({
  rfp,
  quotes,
  pickByTerm,
  onPick,
  defaultPriceUnit,
  onInsertQuoteRow,
  insertQuoteRowBusy,
  quotesLoading = false,
  onSaveComparisonPicks,
  comparisonPicksSaveBusy = false,
  manualRows = [],
  selectedEmailId,
  onSelectedEmailIdChange,
  emailDetail,
  emailDetailLoading,
}: {
  rfp: SummaryRfp;
  quotes: ComparisonRfpQuote[];
  pickByTerm: Partial<Record<number, TermPick>>;
  onPick: (termMonths: number, pick: TermPick | null) => void;
  defaultPriceUnit: string;
  onInsertQuoteRow: (payload: { supplierId: string; termMonths: number; rate: number }) => Promise<void>;
  insertQuoteRowBusy: boolean;
  /** True while refetching quote rows — keeps this panel mounted so insert controls are not reset. */
  quotesLoading?: boolean;
  onSaveComparisonPicks?: () => void | Promise<void>;
  comparisonPicksSaveBusy?: boolean;
  manualRows?: ManualQuoteRow[];
  selectedEmailId: string | null;
  onSelectedEmailIdChange: (id: string | null) => void;
  emailDetail: SupplierInboxEmailDetail | null;
  emailDetailLoading: boolean;
}) {
  const [wideSplit, setWideSplit] = useState(true);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");
  const [termPreset, setTermPreset] = useState<string>("12");
  const [customTermMonths, setCustomTermMonths] = useState("");
  const [rateInput, setRateInput] = useState("");
  const [resolvedInboxEmails, setResolvedInboxEmails] = useState<string[]>([]);
  const [showGrid, setShowGrid] = useState(true);
  const [inboxQuery, setInboxQuery] = useState("");
  const [inboxSubmittedQuery, setInboxSubmittedQuery] = useState("");
  const [inboxLoading, setInboxLoading] = useState(false);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [inboxMessages, setInboxMessages] = useState<InboxMessage[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const upd = () => setWideSplit(mq.matches);
    upd();
    mq.addEventListener("change", upd);
    return () => mq.removeEventListener("change", upd);
  }, []);

  const panelResizeHandleClass =
    "relative w-1.5 mx-0.5 rounded-sm bg-border/80 outline-none hover:bg-primary/40 data-[panel-group-direction=vertical]:h-1.5 data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:mx-0 data-[panel-group-direction=vertical]:my-0.5";

  const baseTerms = useMemo(() => {
    const fromReq =
      rfp.requestedTerms
        ?.filter((t): t is { kind: "months"; months: number } => t.kind === "months")
        .map((t) => t.months) ?? [];
    const fromQuotes = [...new Set(quotes.map((q) => q.termMonths))].sort((a, b) => a - b);
    return [...new Set([...fromReq, ...fromQuotes])].sort((a, b) => a - b);
  }, [rfp.requestedTerms, quotes]);

  const annualUsage = useMemo(() => combinedAnnualUsageFromAccounts(rfp.accountLines), [rfp.accountLines]);

  const supplierRows = useMemo(() => rfp.suppliers, [rfp.suppliers]);

  useEffect(() => {
    if (rfp.suppliers.length === 0) {
      setSelectedSupplierId("");
      return;
    }
    setSelectedSupplierId((cur) =>
      rfp.suppliers.some((s) => s.id === cur) ? cur : rfp.suppliers[0]!.id
    );
  }, [rfp.id, rfp.suppliers]);

  const resolvedInsertTermMonths = useMemo(() => {
    if (termPreset === "__custom__") {
      const n = Number.parseInt(customTermMonths, 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    const n = Number.parseInt(termPreset, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [termPreset, customTermMonths]);

  const resolvedInsertRate = useMemo(() => {
    const r = Number.parseFloat(rateInput);
    return Number.isFinite(r) ? r : null;
  }, [rateInput]);

  const canInsertQuoteRow =
    Boolean(selectedSupplierId) &&
    resolvedInsertTermMonths != null &&
    resolvedInsertRate != null;

  const handleInsertQuoteRowClick = async () => {
    if (!canInsertQuoteRow || resolvedInsertTermMonths == null || resolvedInsertRate == null) return;
    await onInsertQuoteRow({
      supplierId: selectedSupplierId,
      termMonths: resolvedInsertTermMonths,
      rate: resolvedInsertRate,
    });
  };

  useEffect(() => {
    let cancelled = false;
    const q = selectedSupplierId ? `?supplierId=${encodeURIComponent(selectedSupplierId)}` : "";
    void (async () => {
      try {
        const res = await fetch(`/api/rfp/${encodeURIComponent(rfp.id)}/supplier-inbox-emails${q}`);
        const data = await res.json();
        if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "resolve failed");
        const list = Array.isArray(data.emails)
          ? (data.emails as unknown[]).filter((x): x is string => typeof x === "string" && x.trim() !== "")
          : [];
        if (!cancelled) setResolvedInboxEmails(list);
      } catch {
        if (!cancelled) setResolvedInboxEmails([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rfp.id, selectedSupplierId]);

  const gmailQueryBase = useMemo(() => {
    const parts: string[] = [];
    if (rfp.quoteDueDate) {
      const dayKey = String(rfp.quoteDueDate).slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
        const [y, m, d] = dayKey.split("-");
        parts.push(`after:${y}/${m}/${d}`);
      }
    }
    const directoryFallback = (): string[] => {
      if (selectedSupplierId) {
        const s = rfp.suppliers.find((x) => x.id === selectedSupplierId);
        const em = s?.email?.trim();
        return em ? [em] : [];
      }
      return rfp.suppliers.map((s) => s.email?.trim()).filter((e): e is string => Boolean(e));
    };
    const fromList = resolvedInboxEmails.length > 0 ? resolvedInboxEmails : directoryFallback();
    if (fromList.length > 0) {
      parts.push(`(${fromList.map((e) => gmailFromToken(e)).join(" OR ")})`);
    }
    if (inboxSubmittedQuery.trim()) {
      parts.push(inboxSubmittedQuery.trim());
    }
    return parts.filter(Boolean).join(" ");
  }, [rfp.quoteDueDate, rfp.suppliers, selectedSupplierId, inboxSubmittedQuery, resolvedInboxEmails]);

  const loadInbox = useCallback(async () => {
    setInboxLoading(true);
    setInboxError(null);
    try {
      const q = encodeURIComponent(gmailQueryBase || "in:inbox");
      const res = await fetch(`/api/emails?maxResults=35&labelIds=INBOX&q=${q}`);
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Inbox failed");
      const msgs = Array.isArray(data?.messages) ? (data.messages as InboxMessage[]) : [];
      setInboxMessages(msgs);
      onSelectedEmailIdChange(null);
    } catch (e) {
      setInboxError(e instanceof Error ? e.message : "Inbox failed");
      setInboxMessages([]);
      onSelectedEmailIdChange(null);
    } finally {
      setInboxLoading(false);
    }
  }, [gmailQueryBase, onSelectedEmailIdChange]);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  const quotesBySupplierTerm = useMemo(() => {
    const map = new Map<string, ComparisonRfpQuote[]>();
    for (const q of quotes) {
      const k = `${q.supplier.id}:${q.termMonths}`;
      const arr = map.get(k) ?? [];
      arr.push(q);
      map.set(k, arr);
    }
    for (const [k, arr] of map) {
      arr.sort((a, b) => Number(a.rate) - Number(b.rate));
      map.set(k, arr);
    }
    return map;
  }, [quotes]);

  /** Lowest best rate per term column (across suppliers) for highlighting. */
  const lowestRateByTermColumn = useMemo(() => {
    const map = new Map<number, number>();
    for (const term of baseTerms) {
      let min = Number.POSITIVE_INFINITY;
      for (const s of supplierRows) {
        const list = quotesBySupplierTerm.get(`${s.id}:${term}`) ?? [];
        if (list.length === 0) continue;
        const r = Number(list[0]!.rate);
        if (Number.isFinite(r) && r < min) min = r;
      }
      if (min < Number.POSITIVE_INFINITY) map.set(term, min);
    }
    return map;
  }, [supplierRows, baseTerms, quotesBySupplierTerm]);

  const cyclePick = (supplierId: string, termMonths: number) => {
    const list = quotesBySupplierTerm.get(`${supplierId}:${termMonths}`) ?? [];
    if (list.length === 0) return;
    const cur = pickByTerm[termMonths];
    if (!cur || cur.kind !== "quote") {
      onPick(termMonths, { kind: "quote", quoteId: list[0]!.id });
      return;
    }
    const idx = list.findIndex((q) => q.id === cur.quoteId);
    if (idx < 0) {
      onPick(termMonths, { kind: "quote", quoteId: list[0]!.id });
      return;
    }
    const next = list[(idx + 1) % list.length]!;
    if (next.id === cur.quoteId) {
      onPick(termMonths, null);
    } else {
      onPick(termMonths, { kind: "quote", quoteId: next.id });
    }
  };

  const footerForTerm = (termMonths: number) => {
    const pick = pickByTerm[termMonths];
    if (!pick) {
      return {
        total: null as number | null,
        monthly: null as number | null,
        supplierName: null as string | null,
      };
    }
    if (pick.kind === "quote") {
      const q = quotes.find((x) => x.id === pick.quoteId);
      if (!q) return { total: null, monthly: null, supplierName: null };
      const r = Number(q.rate);
      return {
        total: totalContractValueUsd({ baseRatePerUnit: r, termMonths, annualUsage }),
        monthly: impliedMonthlyEnergyCostUsd({ baseRatePerUnit: r, annualUsage }),
        supplierName: q.supplier.name,
      };
    }
    const row = manualRows.find((m) => m.id === pick.rowId);
    if (!row) return { total: null, monthly: null, supplierName: null };
    const raw = row.rates[termMonths];
    const r = raw != null ? Number.parseFloat(String(raw)) : NaN;
    const name = row.supplierName.trim() || null;
    if (!Number.isFinite(r)) return { total: null, monthly: null, supplierName: name };
    return {
      total: totalContractValueUsd({ baseRatePerUnit: r, termMonths, annualUsage }),
      monthly: impliedMonthlyEnergyCostUsd({ baseRatePerUnit: r, annualUsage }),
      supplierName: name,
    };
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-4">
      <PanelGroup
        direction="vertical"
        autoSaveId="energia-quote-compare-main-stack"
        className="flex min-h-[min(78dvh,820px)] min-w-0 flex-1 flex-col"
      >
        <Panel defaultSize={58} minSize={18} className="min-h-0 flex min-w-0 flex-col">
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
            <PanelGroup
              direction={wideSplit ? "horizontal" : "vertical"}
              autoSaveId="energia-quote-compare-table-email"
              className="flex min-h-0 min-w-0 flex-1"
            >
              <Panel
                defaultSize={wideSplit ? 48 : 42}
                minSize={wideSplit ? 22 : 16}
                className="min-h-0 min-w-0"
              >
                <div className="h-full min-h-0 overflow-y-auto border-border bg-muted/15 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm font-medium">Quote comparison table</p>
                      <p className="text-[11px] leading-snug text-muted-foreground">
                        Insert updates the rate for that supplier and term on this RFP. Green outline = lowest rate in that
                        term column. Click a cell to choose the yellow highlight for the customer quote — your selection is
                        saved to this RFP automatically. Use{" "}
                        <span className="font-medium text-foreground">Save picks</span> to refresh the RFP list from the
                        server.
                      </p>
                      {quotesLoading ? (
                        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                          Refreshing rates…
                        </p>
                      ) : null}
                    </div>
                    {onSaveComparisonPicks ? (
                      <Button
                        type="button"
                        size="sm"
                        className="shrink-0"
                        disabled={comparisonPicksSaveBusy}
                        onClick={() => void onSaveComparisonPicks()}
                      >
                        {comparisonPicksSaveBusy ? (
                          <>
                            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                            Saving…
                          </>
                        ) : (
                          "Save picks"
                        )}
                      </Button>
                    ) : null}
                  </div>
                  <div className="mt-3 flex min-w-0 flex-nowrap items-end gap-3 overflow-x-auto pb-0.5">
                    <div className="grid w-[min(12rem,42vw)] shrink-0 gap-1.5">
                      <Label className="text-xs">Supplier</Label>
                      <Select
                        value={selectedSupplierId || undefined}
                        onValueChange={setSelectedSupplierId}
                        disabled={rfp.suppliers.length === 0}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder={rfp.suppliers.length === 0 ? "No suppliers on RFP" : "Select supplier"} />
                        </SelectTrigger>
                        <SelectContent>
                          {rfp.suppliers.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex shrink-0 items-end gap-2">
                      <div className="grid w-[min(11rem,38vw)] gap-1.5">
                        <Label className="text-xs">Contract term column</Label>
                        <Select value={termPreset} onValueChange={setTermPreset}>
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STANDARD_TERM_PRESETS.map((t) => (
                              <SelectItem key={t} value={t}>
                                {t}
                              </SelectItem>
                            ))}
                            <SelectItem value="__custom__">Custom</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {termPreset === "__custom__" ? (
                        <div className="grid w-[4.25rem] gap-1.5">
                          <Label className="text-xs">Months</Label>
                          <Input
                            inputMode="numeric"
                            className="h-9 tabular-nums"
                            value={customTermMonths}
                            onChange={(e) => setCustomTermMonths(sanitizeWholeMonthsInput(e.target.value))}
                            placeholder="e.g. 18"
                            maxLength={4}
                            aria-label="Custom term in whole months"
                          />
                        </div>
                      ) : null}
                    </div>
                    <div className="grid min-w-[6.5rem] max-w-[10rem] flex-1 basis-[6.5rem] gap-1.5">
                      <Label className="text-xs">Rate</Label>
                      <Input
                        inputMode="decimal"
                        className="h-9 tabular-nums"
                        value={rateInput}
                        onChange={(e) => setRateInput(sanitizeDecimalRateInput(e.target.value))}
                        placeholder="0.0000"
                        aria-label="Quoted rate (decimal)"
                      />
                    </div>
                  </div>
                  <div className="mt-3 shrink-0">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleInsertQuoteRowClick()}
                      disabled={!canInsertQuoteRow || insertQuoteRowBusy}
                    >
                      {insertQuoteRowBusy ? (
                        <>
                          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                          Adding…
                        </>
                      ) : (
                        <>
                          <Plus className="mr-1 h-4 w-4" />
                          Insert quote row
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </Panel>

              <PanelResizeHandle className={panelResizeHandleClass} />

              <Panel
                defaultSize={wideSplit ? 52 : 58}
                minSize={wideSplit ? 24 : 20}
                className="min-h-0 min-w-0 flex flex-col bg-background"
              >
                <PanelGroup
                  direction="vertical"
                  autoSaveId="energia-quote-compare-inbox-emailbody"
                  className="flex min-h-0 min-w-0 flex-1 flex-col"
                >
                  <Panel defaultSize={40} minSize={14} className="min-h-0 flex flex-col overflow-hidden">
                    <div className="shrink-0 space-y-3 border-b border-border p-4">
                      <p className="text-sm font-medium">Supplier quote email</p>
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="grid min-w-[200px] flex-1 gap-2">
                          <Label className="text-xs">Search inbox (Gmail query)</Label>
                          <Input
                            value={inboxQuery}
                            onChange={(e) => setInboxQuery(e.target.value)}
                            placeholder="Keywords, subject:, etc."
                          />
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => setInboxSubmittedQuery(inboxQuery.trim())}
                        >
                          <Search className="h-4 w-4 mr-1" />
                          Submit
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => void loadInbox()}>
                          <RefreshCw className={cn("h-4 w-4", inboxLoading && "animate-spin")} />
                        </Button>
                      </div>
                      <p className="text-[11px] leading-snug text-muted-foreground">
                        Messages filter from the supplier quote due date forward (when set), scoped to supplier inbox
                        addresses when known. Select a message below to read returned quotes while you work on the table.
                      </p>
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-b border-border">
                      <div className="shrink-0 border-b bg-muted/30 px-3 py-2 text-sm font-medium">Inbox</div>
                      <div className="min-h-0 flex-1 divide-y overflow-y-auto">
                        {inboxError ? (
                          <p className="p-3 text-sm text-destructive">{inboxError}</p>
                        ) : inboxLoading ? (
                          <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                          </p>
                        ) : inboxMessages.length === 0 ? (
                          <p className="p-3 text-sm text-muted-foreground">No messages matched.</p>
                        ) : (
                          inboxMessages.map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => onSelectedEmailIdChange(m.id)}
                              className={cn(
                                "w-full px-3 py-2 text-left text-xs transition-colors hover:bg-muted/60",
                                selectedEmailId === m.id && "bg-primary/10"
                              )}
                            >
                              <div className="line-clamp-1 font-medium">{m.subject}</div>
                              <div className="line-clamp-1 text-muted-foreground">{m.from}</div>
                              <div className="line-clamp-2 text-muted-foreground">{m.snippet}</div>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  </Panel>

                  <PanelResizeHandle className={panelResizeHandleClass} />

                  <Panel defaultSize={60} minSize={18} className="min-h-0 flex flex-col overflow-hidden">
                    <div className="shrink-0 border-b bg-muted/30 px-4 py-2 text-sm font-medium">Email content</div>
                    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-sm">
                      {emailDetailLoading ? (
                        <p className="flex items-center gap-2 text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" /> Loading message…
                        </p>
                      ) : !emailDetail ? (
                        <p className="text-muted-foreground">Select an inbox message to view its body.</p>
                      ) : (
                        <>
                          {emailDetail.attachments.length > 0 && selectedEmailId ? (
                            <div className="rounded-md border bg-muted/20 px-3 py-2">
                              <p className="mb-2 text-xs font-medium text-muted-foreground">Attachments</p>
                              <ul className="space-y-1 text-xs">
                                {emailDetail.attachments.map((a) => {
                                  const base = `/api/emails/${encodeURIComponent(selectedEmailId)}/attachments/${encodeURIComponent(a.attachmentId)}?filename=${encodeURIComponent(a.filename)}&mimeType=${encodeURIComponent(a.mimeType)}`;
                                  return (
                                    <li
                                      key={a.attachmentId}
                                      className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
                                    >
                                      <a
                                        href={base}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary hover:underline"
                                      >
                                        {a.filename}
                                      </a>
                                      <a
                                        href={`${base}&download=1`}
                                        className="text-muted-foreground underline hover:text-foreground"
                                      >
                                        Download
                                      </a>
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          ) : null}
                          {emailDetail.bodyHtml ? (
                            <div
                              className="prose prose-sm max-w-none dark:prose-invert [&_a]:text-primary"
                              dangerouslySetInnerHTML={{ __html: emailDetail.bodyHtml }}
                            />
                          ) : emailDetail.body ? (
                            <pre className="whitespace-pre-wrap font-sans text-sm">{emailDetail.body}</pre>
                          ) : (
                            <p className="text-muted-foreground">No body in this message.</p>
                          )}
                        </>
                      )}
                    </div>
                  </Panel>
                </PanelGroup>
              </Panel>
            </PanelGroup>
          </div>
        </Panel>

        <PanelResizeHandle className={panelResizeHandleClass} />

        <Panel defaultSize={42} minSize={16} className="min-h-0 min-w-0 flex flex-col">
          <div className="flex min-h-0 min-w-0 flex-col gap-1.5">
        <Button type="button" variant="outline" size="sm" className="h-8 w-fit text-xs" onClick={() => setShowGrid((s) => !s)}>
          {showGrid ? "Hide" : "Show"} quote comparison
        </Button>
        {showGrid ? (
          <div className="rounded-md border overflow-x-auto w-full min-w-0">
            <Table className="w-full min-w-[28rem] border-separate border-spacing-0 text-sm">
              <TableHeader>
                <TableRow className="hover:bg-transparent [&_th]:h-9 [&_th]:py-1">
                  <TableHead className="w-[min(11rem,26vw)] min-w-[8rem] max-w-[16rem] pr-6 pl-3 text-left text-sm font-semibold">
                    Supplier
                  </TableHead>
                  {baseTerms.map((t, i) => (
                    <TableHead
                      key={t}
                      className={`w-[4.25rem] min-w-[4rem] max-w-[5rem] px-1 text-center text-sm font-semibold ${i === 0 ? "pl-3 border-l border-border/60" : ""}`}
                    >
                      {t} mo
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {supplierRows.map((s) => (
                  <TableRow key={s.id} className="hover:bg-muted/30 [&_td]:py-1">
                    <TableCell className="max-w-[16rem] truncate px-3 py-1 pr-6 text-sm font-medium leading-snug">
                      {s.name}
                    </TableCell>
                    {baseTerms.map((term, i) => {
                      const list = quotesBySupplierTerm.get(`${s.id}:${term}`) ?? [];
                      const pick = pickByTerm[term];
                      const chosen =
                        pick?.kind === "quote" ? quotes.find((q) => q.id === pick.quoteId) : null;
                      const isOn =
                        chosen != null &&
                        chosen.supplier.id === s.id &&
                        chosen.termMonths === term &&
                        list.length > 0;
                      const displayQuote =
                        chosen &&
                        chosen.supplier.id === s.id &&
                        chosen.termMonths === term &&
                        list.some((q) => q.id === chosen.id)
                          ? chosen
                          : list[0];
                      const display = displayQuote ? `$${Number(displayQuote.rate).toFixed(4)}` : "—";
                      const colMin = lowestRateByTermColumn.get(term);
                      const colBest = list[0];
                      const colBestRate = colBest != null ? Number(colBest.rate) : null;
                      const isColLowest =
                        colBestRate != null &&
                        colMin != null &&
                        Number.isFinite(colBestRate) &&
                        Number.isFinite(colMin) &&
                        Math.abs(colBestRate - colMin) <= 1e-9;
                      return (
                        <TableCell
                          key={term}
                          className={`p-0 text-center align-middle ${i === 0 ? "border-l border-border/60" : ""}`}
                        >
                          <button
                            type="button"
                            disabled={list.length === 0}
                            onClick={() => cyclePick(s.id, term)}
                            title={
                              list.length === 0
                                ? undefined
                                : isOn
                                  ? "Selected for customer quote email (click to change or clear)"
                                  : "Click to select this rate for the customer quote email"
                            }
                            className={cn(
                              "w-full min-h-[2.25rem] rounded px-1 py-1 text-xs tabular-nums leading-tight transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                              isOn
                                ? "bg-yellow-300 font-semibold text-foreground shadow-md ring-2 ring-yellow-500 ring-offset-1 ring-offset-background dark:bg-yellow-500/35 dark:ring-yellow-400"
                                : "hover:bg-muted/80",
                              isColLowest &&
                                "outline outline-2 outline-[#39ff14] outline-offset-0 shadow-[0_0_7px_rgba(57,255,20,0.65)] dark:shadow-[0_0_9px_rgba(57,255,20,0.5)]"
                            )}
                          >
                            {display}
                            {list.length > 1 ? (
                              <span className="mt-0.5 block text-[10px] font-normal leading-none text-muted-foreground">
                                {list.length} offers · click
                              </span>
                            ) : null}
                          </button>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="grid gap-2 border-t bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-4">
              {baseTerms.map((term) => {
                const foot = footerForTerm(term);
                return (
                  <div key={term} className="space-y-1 rounded border bg-background p-3 text-xs">
                    <p className="text-sm font-semibold leading-none">{term} months</p>
                    <p className="text-muted-foreground">
                      Total (est.):{" "}
                      <span className="font-medium tabular-nums text-foreground">
                        {foot.total != null ? `$${foot.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—"}
                      </span>
                    </p>
                    <p className="text-muted-foreground">
                      Monthly (est.):{" "}
                      <span className="font-medium tabular-nums text-foreground">
                        {foot.monthly != null
                          ? `$${foot.monthly.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                          : "—"}
                      </span>
                    </p>
                    {foot.supplierName ? (
                      <p className="text-muted-foreground">
                        Supplier:{" "}
                        <span className="font-medium text-foreground">{foot.supplierName}</span>
                      </p>
                    ) : null}
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      {annualUsage.toLocaleString()} {unitLabelForEnergy(defaultPriceUnit)}/yr
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}
