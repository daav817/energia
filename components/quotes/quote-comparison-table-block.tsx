"use client";

import { useMemo } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  combinedAnnualUsageFromAccounts,
  impliedMonthlyEnergyCostUsd,
  totalContractValueUsd,
  unitLabelForEnergy,
} from "@/lib/rfp-quote-math";
import type { ComparisonRfpQuote, ManualQuoteRow, TermPick } from "@/components/quotes/quote-types";

const QUOTE_RATE_INPUT_MAX_DECIMALS = 5;

/** Formats stored quote rates for the comparison table (up to five fractional digits). */
function formatComparisonTableRate(rate: number): string {
  if (!Number.isFinite(rate)) return "—";
  const rounded = Math.round(rate * 1e5) / 1e5;
  let s = rounded.toFixed(QUOTE_RATE_INPUT_MAX_DECIMALS);
  s = s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return `$${s}`;
}

type SummaryRfp = {
  requestedTerms: Array<{ kind: "months"; months: number } | { kind: "nymex" }> | null;
  accountLines: Array<{ annualUsage: number | string }>;
  suppliers: Array<{ id: string; name: string; email: string | null }>;
};

export function QuoteComparisonTableBlock({
  rfp,
  quotes,
  pickByTerm,
  onPick,
  defaultPriceUnit,
  manualRows = [],
  quotesLoading = false,
  onClearQuoteCell,
  quoteTableMutationBusy = false,
}: {
  rfp: SummaryRfp;
  quotes: ComparisonRfpQuote[];
  pickByTerm: Partial<Record<number, TermPick>>;
  onPick: (termMonths: number, pick: TermPick | null) => void;
  defaultPriceUnit: string;
  manualRows?: ManualQuoteRow[];
  quotesLoading?: boolean;
  /** Removes stored quote row(s) for this cell (empty cell shows "—", not zero). */
  onClearQuoteCell?: (supplierId: string, termMonths: number) => void | Promise<void>;
  /** Disables clear while insert/delete is in flight. */
  quoteTableMutationBusy?: boolean;
}) {
  const baseTerms = useMemo(() => {
    const fromReq =
      rfp.requestedTerms
        ?.filter((t): t is { kind: "months"; months: number } => t.kind === "months")
        .map((t) => t.months) ?? [];
    const fromQuotes = [...new Set(quotes.map((q) => q.termMonths))].sort((a, b) => a - b);
    return [...new Set([...fromReq, ...fromQuotes])].sort((a, b) => a - b);
  }, [rfp.requestedTerms, quotes]);

  const annualUsage = useMemo(() => combinedAnnualUsageFromAccounts(rfp.accountLines), [rfp.accountLines]);
  const supplierRows = rfp.suppliers;

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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
                  {baseTerms.map((term) => {
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
                      <TableCell key={term} className="p-0 text-center align-middle">
                        <div
                          className={cn(
                            "flex min-h-[2.25rem] w-full items-center gap-0.5 rounded px-0.5 py-0.5 text-xs transition-colors",
                            list.length === 0 && "opacity-40",
                            isOn
                              ? "bg-yellow-300 font-semibold text-foreground shadow-md ring-2 ring-yellow-500 ring-offset-1 ring-offset-background dark:bg-yellow-500/35 dark:ring-yellow-400"
                              : list.length > 0 && "hover:bg-muted/80",
                            isColLowest &&
                              "shadow-[0_0_7px_rgba(57,255,20,0.65)] outline outline-2 outline-[#39ff14] outline-offset-0 dark:shadow-[0_0_9px_rgba(57,255,20,0.5)]"
                          )}
                        >
                          <button
                            type="button"
                            disabled={list.length === 0 || quoteTableMutationBusy}
                            onClick={() => cyclePick(s.id, term)}
                            title={
                              list.length === 0
                                ? undefined
                                : isOn
                                  ? "Selected for customer quote email (click to change or clear)"
                                  : "Click to select this rate for the customer quote email"
                            }
                            className={cn(
                              "min-h-[2.25rem] min-w-0 flex-1 rounded px-0.5 py-1 text-center text-xs tabular-nums leading-tight transition-colors disabled:cursor-not-allowed",
                              list.length > 0 && "hover:bg-transparent"
                            )}
                          >
                            <span className="tabular-nums">{display}</span>
                            {list.length > 1 ? (
                              <span className="mt-0.5 block text-[10px] font-normal leading-none text-muted-foreground">
                                {list.length} offers · click
                              </span>
                            ) : null}
                          </button>
                          {list.length > 0 && onClearQuoteCell ? (
                            <button
                              type="button"
                              disabled={quoteTableMutationBusy}
                              className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
                              title="Clear this rate"
                              aria-label="Clear this rate"
                              onClick={(e) => {
                                e.stopPropagation();
                                void onClearQuoteCell(s.id, term);
                              }}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </div>
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
            const hasPick = Boolean(pickByTerm[term]);
            return (
              <div key={term} className="space-y-1 rounded border bg-background p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <p className="text-sm font-semibold leading-none">{term} months</p>
                  {hasPick ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                      onClick={() => onPick(term, null)}
                    >
                      Clear pick
                    </Button>
                  ) : null}
                </div>
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
      {quotesLoading ? (
        <p className="flex shrink-0 items-center gap-1.5 border-t px-3 py-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          Refreshing rates…
        </p>
      ) : null}
    </div>
  );
}
