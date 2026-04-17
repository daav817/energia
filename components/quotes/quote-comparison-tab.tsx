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
import { cn } from "@/lib/utils";
import { QuoteComparisonTableBlock } from "@/components/quotes/quote-comparison-table-block";
import { dthToMcf, mcfToDth } from "@/lib/gas-mcf-dth";
import { replaceCidWithAttachmentUrls } from "@/components/communications/EmailDetailPanel";
import { appendEmailBodyLayoutFix } from "@/lib/email-html-display";
import { gmailFromToken } from "@/lib/gmail-query";
import type { ComparisonRfpQuote, ManualQuoteRow, TermPick } from "@/components/quotes/quote-types";

export type { ComparisonRfpQuote, ManualQuoteRow, TermPick } from "@/components/quotes/quote-types";

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
  electricTables,
  energyDisplayTitle,
  defaultPriceUnit,
  onInsertQuoteRow,
  insertQuoteRowBusy,
  onClearQuoteRow,
  quotesLoading = false,
  manualRows = [],
  selectedEmailId,
  onSelectedEmailIdChange,
  emailDetail,
  emailDetailLoading,
}: {
  rfp: SummaryRfp;
  /** Full quote list (e.g. for reference); table(s) may use filtered subsets. */
  quotes: ComparisonRfpQuote[];
  pickByTerm: Partial<Record<number, TermPick>>;
  onPick: (termMonths: number, pick: TermPick | null) => void;
  /** When set, RFP is electric: two comparison tables with separate picks. */
  electricTables?: {
    quotesFixed: ComparisonRfpQuote[];
    quotesPass: ComparisonRfpQuote[];
    pickFixed: Partial<Record<number, TermPick>>;
    pickPass: Partial<Record<number, TermPick>>;
    onPickFixed: (termMonths: number, pick: TermPick | null) => void;
    onPickPass: (termMonths: number, pick: TermPick | null) => void;
  };
  /** e.g. "Electric" | "Natural gas" — shown above Enter quote */
  energyDisplayTitle: string;
  defaultPriceUnit: string;
  onInsertQuoteRow: (payload: {
    supplierId: string;
    termMonths: number;
    rate: number;
    comparisonBucket?: "ELECTRIC_FIXED_CAPACITY_ADJUST" | "ELECTRIC_CAPACITY_PASS_THROUGH" | null;
  }) => Promise<void>;
  insertQuoteRowBusy: boolean;
  /** Delete quote row(s) for one supplier × term (cell shows —). */
  onClearQuoteRow?: (payload: {
    supplierId: string;
    termMonths: number;
    comparisonBucket?: "ELECTRIC_FIXED_CAPACITY_ADJUST" | "ELECTRIC_CAPACITY_PASS_THROUGH";
  }) => void | Promise<void>;
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
  const [displayUnit, setDisplayUnit] = useState("KWH");
  const [gasConvertDirection, setGasConvertDirection] = useState<"mcfToDth" | "dthToMcf">("mcfToDth");
  const [comparisonElectricTab, setComparisonElectricTab] = useState<"fixed" | "pass">("fixed");
  const [electricInsertTarget, setElectricInsertTarget] = useState<"fixed" | "pass">("fixed");

  useEffect(() => {
    setDisplayUnit(rfp.energyType === "ELECTRIC" ? "KWH" : "MCF");
    setComparisonElectricTab("fixed");
    setElectricInsertTarget("fixed");
  }, [rfp.id, rfp.energyType]);

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
    const comparisonBucket =
      rfp.energyType === "ELECTRIC"
        ? electricInsertTarget === "fixed"
          ? ("ELECTRIC_FIXED_CAPACITY_ADJUST" as const)
          : ("ELECTRIC_CAPACITY_PASS_THROUGH" as const)
        : undefined;
    await onInsertQuoteRow({
      supplierId: selectedSupplierId,
      termMonths: resolvedInsertTermMonths,
      rate: resolvedInsertRate,
      ...(comparisonBucket ? { comparisonBucket } : {}),
    });
  };

  const applyGasUnitConversion = () => {
    const r = Number.parseFloat(rateInput);
    if (!Number.isFinite(r)) return;
    const out = gasConvertDirection === "mcfToDth" ? mcfToDth(r) : dthToMcf(r);
    const rounded = Math.round(out * 1e5) / 1e5;
    setRateInput(String(rounded));
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
      {electricTables ? (
        <div className="shrink-0 border-b border-border bg-muted/15 p-2">
          <div className="flex flex-wrap gap-1 rounded-lg border border-border/60 bg-background/80 p-0.5">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={cn(
                "h-8 shrink-0 px-3 text-xs",
                comparisonElectricTab === "fixed"
                  ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground"
                  : "text-muted-foreground"
              )}
              onClick={() => setComparisonElectricTab("fixed")}
            >
              Fixed Capacity Adjust
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={cn(
                "h-8 shrink-0 px-3 text-xs",
                comparisonElectricTab === "pass"
                  ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground"
                  : "text-muted-foreground"
              )}
              onClick={() => setComparisonElectricTab("pass")}
            >
              Capacity Pass-Through
            </Button>
          </div>
        </div>
      ) : null}
      {electricTables ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          {comparisonElectricTab === "fixed" ? (
            <QuoteComparisonTableBlock
              rfp={rfp}
              quotes={electricTables.quotesFixed}
              pickByTerm={electricTables.pickFixed}
              onPick={electricTables.onPickFixed}
              defaultPriceUnit={defaultPriceUnit}
              manualRows={manualRows}
              quotesLoading={quotesLoading}
              quoteTableMutationBusy={insertQuoteRowBusy}
              onClearQuoteCell={
                onClearQuoteRow
                  ? (supplierId, termMonths) =>
                      onClearQuoteRow({
                        supplierId,
                        termMonths,
                        comparisonBucket: "ELECTRIC_FIXED_CAPACITY_ADJUST",
                      })
                  : undefined
              }
            />
          ) : (
            <QuoteComparisonTableBlock
              rfp={rfp}
              quotes={electricTables.quotesPass}
              pickByTerm={electricTables.pickPass}
              onPick={electricTables.onPickPass}
              defaultPriceUnit={defaultPriceUnit}
              manualRows={manualRows}
              quotesLoading={quotesLoading}
              quoteTableMutationBusy={insertQuoteRowBusy}
              onClearQuoteCell={
                onClearQuoteRow
                  ? (supplierId, termMonths) =>
                      onClearQuoteRow({
                        supplierId,
                        termMonths,
                        comparisonBucket: "ELECTRIC_CAPACITY_PASS_THROUGH",
                      })
                  : undefined
              }
            />
          )}
        </div>
      ) : (
        <QuoteComparisonTableBlock
          rfp={rfp}
          quotes={quotes}
          pickByTerm={pickByTerm}
          onPick={onPick}
          defaultPriceUnit={defaultPriceUnit}
          manualRows={manualRows}
          quotesLoading={quotesLoading}
          quoteTableMutationBusy={insertQuoteRowBusy}
          onClearQuoteCell={
            onClearQuoteRow ? (supplierId, termMonths) => onClearQuoteRow({ supplierId, termMonths }) : undefined
          }
        />
      )}
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
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/30 px-2 py-2">
              <p className="text-sm font-semibold leading-tight text-foreground">{energyDisplayTitle}</p>
              <div className="flex items-center gap-2">
                <Label className="text-xs whitespace-nowrap">Unit</Label>
                <Select value={displayUnit} onValueChange={setDisplayUnit}>
                  <SelectTrigger className="h-8 w-[5.75rem] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {rfp.energyType === "ELECTRIC" ? (
                      <SelectItem value="KWH">kWh</SelectItem>
                    ) : (
                      <>
                        <SelectItem value="MCF">MCF</SelectItem>
                        <SelectItem value="DTH">DTH</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {rfp.energyType === "NATURAL_GAS" ? (
              <div className="space-y-2 rounded-md border border-dashed border-border/70 bg-background/80 p-2">
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Convert the value in the rate field (1 MCF = 1.032 DTH). Display only — does not change saved quotes.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={gasConvertDirection}
                    onValueChange={(v) => setGasConvertDirection(v as "mcfToDth" | "dthToMcf")}
                  >
                    <SelectTrigger className="h-8 w-[10.5rem] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mcfToDth">MCF → DTH</SelectItem>
                      <SelectItem value="dthToMcf">DTH → MCF</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button type="button" size="sm" variant="secondary" className="h-8 text-xs" onClick={applyGasUnitConversion}>
                    Convert rate
                  </Button>
                </div>
              </div>
            ) : null}
            {electricTables ? (
              <div className="space-y-1.5 rounded-md border border-border/60 p-2">
                <p className="text-[11px] font-medium text-muted-foreground">Enter quote into</p>
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="radio"
                    name="electric-insert"
                    checked={electricInsertTarget === "fixed"}
                    onChange={() => setElectricInsertTarget("fixed")}
                    className="h-3.5 w-3.5"
                  />
                  Fixed Capacity Adjust
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="radio"
                    name="electric-insert"
                    checked={electricInsertTarget === "pass"}
                    onChange={() => setElectricInsertTarget("pass")}
                    className="h-3.5 w-3.5"
                  />
                  Capacity Pass-Through
                </label>
              </div>
            ) : null}
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
