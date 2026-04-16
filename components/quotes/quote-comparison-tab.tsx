"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { ChevronDown, Loader2, Plus, RefreshCw } from "lucide-react";
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
import { replaceCidWithAttachmentUrls } from "@/components/communications/EmailDetailPanel";
import { appendEmailBodyLayoutFix } from "@/lib/email-html-display";
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
  from: string;
  /** RFC 2822 / raw Date header from Gmail */
  date: string;
  bodyHtml: string;
  body: string;
  /** Content-ID (no angle brackets) → Gmail attachment part for `cid:` images in bodyHtml */
  inlineImages?: Record<string, { attachmentId: string; mimeType: string }>;
  attachments: Array<{
    attachmentId: string;
    filename: string;
    mimeType: string;
    size: number;
  }>;
};

function formatEmailHeaderSent(raw: string): string {
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return raw.trim() || "—";
  return new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const QUOTE_RATE_INPUT_MAX_DECIMALS = 5;
/** Match `INBOX_AUTO_REFRESH_MS` on the Emails (inbox) workspace page. */
const QUOTE_EMAILS_LIST_POLL_MS = 60_000;

function sanitizeDecimalRateInput(raw: string): string {
  let s = raw.replace(/[^\d.]/g, "");
  const firstDot = s.indexOf(".");
  if (firstDot !== -1) {
    const intAndDot = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, "");
    const fracStart = intAndDot.indexOf(".") + 1;
    const head = intAndDot.slice(0, fracStart);
    const frac = intAndDot.slice(fracStart, fracStart + QUOTE_RATE_INPUT_MAX_DECIMALS);
    s = head + frac;
  }
  return s;
}

function sanitizeWholeMonthsInput(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** Formats stored quote rates for the comparison table (up to five fractional digits). */
function formatComparisonTableRate(rate: number): string {
  if (!Number.isFinite(rate)) return "—";
  const rounded = Math.round(rate * 1e5) / 1e5;
  let s = rounded.toFixed(QUOTE_RATE_INPUT_MAX_DECIMALS);
  s = s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return `$${s}`;
}

function parseMessageListDateMs(dateHeader: string): number | null {
  const t = Date.parse(dateHeader);
  return Number.isFinite(t) ? t : null;
}

function startOfLocalDayMs(ymd: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  return new Date(`${ymd}T00:00:00`).getTime();
}

function endOfLocalDayMs(ymd: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  return new Date(`${ymd}T23:59:59.999`).getTime();
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
  manualRows?: ManualQuoteRow[];
  selectedEmailId: string | null;
  onSelectedEmailIdChange: (id: string | null) => void;
  emailDetail: SupplierInboxEmailDetail | null;
  emailDetailLoading: boolean;
}) {
  const selectedEmailIdRef = useRef(selectedEmailId);
  selectedEmailIdRef.current = selectedEmailId;

  const [wideSplit, setWideSplit] = useState(true);
  const [compareRightTab, setCompareRightTab] = useState<"emails" | "table">("emails");
  const [emailUserFilter, setEmailUserFilter] = useState("");
  const [emailDateFrom, setEmailDateFrom] = useState("");
  const [emailDateTo, setEmailDateTo] = useState("");
  const [quoteEmailListFiltersOpen, setQuoteEmailListFiltersOpen] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");
  const [termPreset, setTermPreset] = useState<string>("12");
  const [customTermMonths, setCustomTermMonths] = useState("");
  const [rateInput, setRateInput] = useState("");
  const [resolvedInboxEmails, setResolvedInboxEmails] = useState<string[]>([]);
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
    return parts.filter(Boolean).join(" ");
  }, [rfp.quoteDueDate, rfp.suppliers, selectedSupplierId, resolvedInboxEmails]);

  const loadInbox = useCallback(
    async (opts?: { keepSelection?: boolean }) => {
      setInboxLoading(true);
      setInboxError(null);
      try {
        const built = gmailQueryBase.trim();
        if (!built) {
          setInboxMessages([]);
          onSelectedEmailIdChange(null);
          return;
        }
        const q = encodeURIComponent(built);
        const res = await fetch(`/api/emails?maxResults=75&q=${q}`);
        const data = await res.json();
        if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not load messages");
        const msgs = Array.isArray(data?.messages) ? (data.messages as InboxMessage[]) : [];
        setInboxMessages(msgs);
        const curId = selectedEmailIdRef.current;
        if (!opts?.keepSelection) {
          onSelectedEmailIdChange(null);
        } else if (curId && !msgs.some((m) => m.id === curId)) {
          onSelectedEmailIdChange(null);
        }
      } catch (e) {
        setInboxError(e instanceof Error ? e.message : "Could not load messages");
        setInboxMessages([]);
        onSelectedEmailIdChange(null);
      } finally {
        setInboxLoading(false);
      }
    },
    [gmailQueryBase, onSelectedEmailIdChange]
  );

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  useEffect(() => {
    if (compareRightTab !== "emails") return;
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void (async () => {
        try {
          await fetch("/api/emails/poll?sync=1");
        } catch {
          return;
        }
        void loadInbox({ keepSelection: true });
      })();
    }, QUOTE_EMAILS_LIST_POLL_MS);
    return () => window.clearInterval(intervalId);
  }, [compareRightTab, loadInbox]);

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

  const filteredInboxMessages = useMemo(() => {
    let rows = inboxMessages;
    const u = emailUserFilter.trim().toLowerCase();
    if (u) {
      rows = rows.filter((m) => `${m.from} ${m.subject} ${m.snippet}`.toLowerCase().includes(u));
    }
    const fromMs = emailDateFrom ? startOfLocalDayMs(emailDateFrom) : null;
    const toMs = emailDateTo ? endOfLocalDayMs(emailDateTo) : null;
    if (fromMs != null || toMs != null) {
      rows = rows.filter((m) => {
        const t = parseMessageListDateMs(m.date);
        if (t == null) return true;
        if (fromMs != null && t < fromMs) return false;
        if (toMs != null && t > toMs) return false;
        return true;
      });
    }
    return rows;
  }, [inboxMessages, emailUserFilter, emailDateFrom, emailDateTo]);

  const quoteEmailBodyHtmlForDisplay = useMemo(() => {
    if (!emailDetail?.bodyHtml?.trim() || !selectedEmailId) return "";
    return replaceCidWithAttachmentUrls(
      emailDetail.bodyHtml,
      selectedEmailId,
      emailDetail.inlineImages ?? {}
    );
  }, [emailDetail?.bodyHtml, emailDetail?.inlineImages, selectedEmailId]);

  const quoteEmailHtmlToInject = useMemo(() => {
    const raw = quoteEmailBodyHtmlForDisplay || emailDetail?.bodyHtml || "";
    if (!raw.trim()) return "";
    return appendEmailBodyLayoutFix(raw);
  }, [quoteEmailBodyHtmlForDisplay, emailDetail?.bodyHtml]);

  const quoteTableSection = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 space-y-2 border-b border-border bg-muted/15 p-3">
        <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium">Quote comparison table</p>
            <p className="text-[11px] leading-snug text-muted-foreground">
              Enter quote adds or updates the rate for that supplier and term on this RFP. Green outline = lowest rate in
              that term column. Click a cell to choose the yellow highlight for the customer quote — your selection is
              saved to this RFP automatically when you click. Use{" "}
              <span className="font-medium text-foreground">Refresh list</span> in the bar above if you need the RFP
              dropdown to reload from the server.
            </p>
            {quotesLoading ? (
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                Refreshing rates…
              </p>
            ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="min-w-0 overflow-x-auto">
          <Table className="w-full min-w-[28rem] border-collapse text-sm [&_tbody>tr]:border-0 [&_thead>tr]:border-0 [&_th]:border [&_th]:border-border/80 [&_td]:border [&_td]:border-border/80 [&_thead_th]:bg-muted/40">
            <TableHeader className="[&_tr]:border-b-0">
              <TableRow className="border-0 hover:bg-transparent [&_th]:h-9 [&_th]:py-1">
                <TableHead className="w-[min(11rem,26vw)] min-w-[8rem] max-w-[16rem] pl-3 pr-6 text-left text-sm font-semibold">
                  Supplier
                </TableHead>
                {baseTerms.map((t, i) => (
                  <TableHead
                    key={t}
                    className={`w-[4.25rem] min-w-[4rem] max-w-[5rem] px-1 text-center text-sm font-semibold ${i === 0 ? "pl-3" : ""}`}
                  >
                    {t} mo
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {supplierRows.map((s) => (
                <TableRow key={s.id} className="border-0 hover:bg-muted/30 [&_td]:py-1">
                  <TableCell className="max-w-[16rem] truncate px-3 py-1 pr-6 text-sm font-medium leading-snug">
                    {s.name}
                  </TableCell>
                  {baseTerms.map((term, i) => {
                    const list = quotesBySupplierTerm.get(`${s.id}:${term}`) ?? [];
                    const pick = pickByTerm[term];
                    const chosen = pick?.kind === "quote" ? quotes.find((q) => q.id === pick.quoteId) : null;
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
                    const display = displayQuote ? formatComparisonTableRate(Number(displayQuote.rate)) : "—";
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
                        className="p-0 text-center align-middle"
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
                              "shadow-[0_0_7px_rgba(57,255,20,0.65)] outline outline-2 outline-[#39ff14] outline-offset-0 dark:shadow-[0_0_9px_rgba(57,255,20,0.5)]"
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
        </div>
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
                    Supplier: <span className="font-medium text-foreground">{foot.supplierName}</span>
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
    </div>
  );

  const quoteEmailsSection = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="shrink-0 border-b border-border bg-muted/20">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-foreground hover:bg-muted/50"
          aria-expanded={quoteEmailListFiltersOpen}
          onClick={() => setQuoteEmailListFiltersOpen((o) => !o)}
        >
          <span>List filters, dates and refresh</span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
              quoteEmailListFiltersOpen && "rotate-180"
            )}
            aria-hidden
          />
        </button>
        {quoteEmailListFiltersOpen ? (
          <div className="space-y-3 border-t border-border/60 px-3 py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex min-w-0 items-center gap-2">
                <Label htmlFor="quote-email-date-from" className="shrink-0 text-xs whitespace-nowrap">
                  Date from
                </Label>
                <Input
                  id="quote-email-date-from"
                  type="date"
                  className="h-9 w-[10.25rem] shrink-0 sm:w-[10.5rem]"
                  value={emailDateFrom}
                  onChange={(e) => setEmailDateFrom(e.target.value)}
                />
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <Label htmlFor="quote-email-date-to" className="shrink-0 text-xs whitespace-nowrap">
                  Date to
                </Label>
                <Input
                  id="quote-email-date-to"
                  type="date"
                  className="h-9 w-[10.25rem] shrink-0 sm:w-[10.5rem]"
                  value={emailDateTo}
                  onChange={(e) => setEmailDateTo(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={emailUserFilter}
                onChange={(e) => setEmailUserFilter(e.target.value)}
                placeholder="Filter listed messages by sender, subject, or snippet…"
                className="h-9 min-w-0 flex-1"
                aria-label="Filter listed messages by sender, subject, or snippet"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-9 shrink-0 px-2"
                title="Reload from Gmail"
                onClick={() => void loadInbox({ keepSelection: true })}
              >
                <RefreshCw className={cn("h-4 w-4", inboxLoading && "animate-spin")} />
              </Button>
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground">
              Gmail search uses this RFP&apos;s supplier quote due date (when set) and supplier addresses, across{" "}
              <span className="font-medium text-foreground">all folders</span> (not only Inbox). The filter box narrows
              the loaded list instantly. While this tab is open, the list also refreshes about every 60 seconds (same as
              the Emails page) after a quick sync. Use refresh to reload immediately.
            </p>
          </div>
        ) : null}
      </div>
      <PanelGroup
        direction={wideSplit ? "horizontal" : "vertical"}
        autoSaveId="energia-quote-compare-inbox-emailbody"
        className="flex min-h-0 min-w-0 flex-1"
      >
        <Panel defaultSize={38} minSize={18} className="min-h-0 min-w-0 flex flex-col overflow-hidden border-border">
          <div className="shrink-0 border-b bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Select quote ({filteredInboxMessages.length})
          </div>
          <div className="min-h-0 flex-1 divide-y overflow-y-auto">
            {inboxError ? (
              <p className="p-3 text-sm text-destructive">{inboxError}</p>
            ) : inboxLoading ? (
              <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </p>
            ) : !gmailQueryBase.trim() ? (
              <p className="p-3 text-sm text-muted-foreground">
                Add a quote due date and supplier email addresses on the RFP so we can search Gmail across your
                mailbox.
              </p>
            ) : filteredInboxMessages.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">No messages matched these filters.</p>
            ) : (
              filteredInboxMessages.map((m) => (
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
        </Panel>
        <PanelResizeHandle className={panelResizeHandleClass} />
        <Panel defaultSize={62} minSize={22} className="min-h-0 min-w-0 flex flex-col overflow-hidden">
          <div className="shrink-0 border-b bg-muted/30 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Email content
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-sm">
            {emailDetailLoading ? (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading message…
              </p>
            ) : !emailDetail ? (
              <p className="text-muted-foreground">Select a quote email to view its body.</p>
            ) : (
              <>
                <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/25 px-3 py-2.5 text-xs leading-snug">
                  <p>
                    <span className="text-muted-foreground">Subject:</span>{" "}
                    <span className="font-medium text-foreground">{emailDetail.subject?.trim() || "(no subject)"}</span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">From:</span>{" "}
                    <span className="break-words text-foreground">{emailDetail.from?.trim() || "—"}</span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">Sent:</span>{" "}
                    <span className="tabular-nums text-foreground">{formatEmailHeaderSent(emailDetail.date)}</span>
                  </p>
                </div>
                {emailDetail.attachments.length > 0 && selectedEmailId ? (
                  <div className="rounded-md border bg-muted/20 px-3 py-2">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">Attachments</p>
                    <ul className="space-y-1 text-xs">
                      {emailDetail.attachments.map((a) => {
                        const base = `/api/emails/${encodeURIComponent(selectedEmailId)}/attachments/${encodeURIComponent(a.attachmentId)}?filename=${encodeURIComponent(a.filename)}&mimeType=${encodeURIComponent(a.mimeType)}`;
                        return (
                          <li key={a.attachmentId} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
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
                  <div className="max-w-full overflow-x-auto">
                    <div
                      className="email-html-body text-sm leading-relaxed text-foreground [&_a]:text-primary [&_img]:max-w-full [&_img]:h-auto"
                      dangerouslySetInnerHTML={{ __html: quoteEmailHtmlToInject }}
                    />
                  </div>
                ) : emailDetail.body ? (
                  <pre className="font-sans whitespace-pre-wrap text-sm">{emailDetail.body}</pre>
                ) : (
                  <p className="text-muted-foreground">No body in this message.</p>
                )}
              </>
            )}
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
      <PanelGroup
        direction="horizontal"
        autoSaveId="energia-quote-compare-entry-vs-tabs"
        className="flex min-h-0 min-w-0 flex-1"
      >
        <Panel defaultSize={22} minSize={14} maxSize={32} className="min-h-0 min-w-0 border-r border-border bg-muted/10">
          <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Quote data entry</p>
            <div className="grid gap-1.5">
              <Label className="text-xs">Supplier</Label>
              <Select
                value={selectedSupplierId || undefined}
                onValueChange={setSelectedSupplierId}
                disabled={rfp.suppliers.length === 0}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={rfp.suppliers.length === 0 ? "No suppliers" : "Supplier"} />
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
            <div className="grid gap-1.5">
              <Label className="text-xs">Term</Label>
              <div className="flex flex-col gap-2">
                <Select value={termPreset} onValueChange={setTermPreset}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STANDARD_TERM_PRESETS.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t} mo
                      </SelectItem>
                    ))}
                    <SelectItem value="__custom__">Custom</SelectItem>
                  </SelectContent>
                </Select>
                {termPreset === "__custom__" ? (
                  <Input
                    inputMode="numeric"
                    className="h-9 tabular-nums"
                    value={customTermMonths}
                    onChange={(e) => setCustomTermMonths(sanitizeWholeMonthsInput(e.target.value))}
                    placeholder="Months"
                    maxLength={4}
                    aria-label="Custom term in whole months"
                  />
                ) : null}
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Rate (up to 5 decimals)</Label>
              <Input
                inputMode="decimal"
                className="h-9 tabular-nums"
                value={rateInput}
                onChange={(e) => setRateInput(sanitizeDecimalRateInput(e.target.value))}
                placeholder="0.00000"
                aria-label="Quoted rate, up to five decimal places"
              />
            </div>
            <Button
              type="button"
              size="sm"
              className="w-full shrink-0"
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
                  Enter quote
                </>
              )}
            </Button>
            <div className="min-h-8 flex-1" aria-hidden />
          </div>
        </Panel>
        <PanelResizeHandle className={panelResizeHandleClass} />
        <Panel defaultSize={78} minSize={50} className="min-h-0 min-w-0 flex flex-col overflow-hidden">
          <div className="flex shrink-0 border-b border-border bg-muted/30 px-2 py-1">
            <div className="inline-flex w-fit gap-0.5 rounded-md border border-border/60 bg-background/80 p-0.5">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={cn(
                  "h-8 shrink-0 px-2.5 text-xs font-medium whitespace-nowrap",
                  compareRightTab === "emails"
                    ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted/80"
                )}
                onClick={() => setCompareRightTab("emails")}
              >
                Quote emails
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={cn(
                  "h-8 shrink-0 px-2.5 text-xs font-medium whitespace-nowrap",
                  compareRightTab === "table"
                    ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted/80"
                )}
                onClick={() => setCompareRightTab("table")}
              >
                Quote comparison table
              </Button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", compareRightTab !== "emails" && "hidden")}>
              {quoteEmailsSection}
            </div>
            <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", compareRightTab !== "table" && "hidden")}>
              {quoteTableSection}
            </div>
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}
