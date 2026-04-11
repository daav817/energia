"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { UsageYearBreakdownRow } from "@/lib/broker-usage-calendar";

function formatKwh(n: number): string {
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh`;
}

function formatMcf(n: number): string {
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })} MCF`;
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 100 ? 0 : 2,
  }).format(n);
}

function rowIncomeElectric(r: UsageYearBreakdownRow): number {
  return r.electricBrokerIncomeUsd ?? 0;
}

function rowIncomeGas(r: UsageYearBreakdownRow): number {
  return r.naturalGasBrokerIncomeUsd ?? 0;
}

export function BrokerageUsageByYearPanel(props: {
  usageByYear: UsageYearBreakdownRow[];
  /** Shown in the footer; omit when `showActiveBookAnnualTotals` is false. */
  activeBookElectricKwh?: number;
  activeBookGasMcf?: number;
  activeBookElectricBrokerIncomeUsd?: number;
  activeBookGasBrokerIncomeUsd?: number;
  /** When false, hides the “Active book” totals footer (e.g. Settings already shows that block above). Default true. */
  showActiveBookAnnualTotals?: boolean;
}) {
  const {
    usageByYear,
    activeBookElectricKwh = 0,
    activeBookGasMcf = 0,
    activeBookElectricBrokerIncomeUsd = 0,
    activeBookGasBrokerIncomeUsd = 0,
    showActiveBookAnnualTotals = true,
  } = props;
  const defaultYear = new Date().getFullYear();

  const [selectedYear, setSelectedYear] = useState(defaultYear);

  const years = useMemo(() => usageByYear.map((r) => r.year), [usageByYear]);

  useEffect(() => {
    if (years.length === 0) return;
    if (!years.includes(selectedYear)) {
      setSelectedYear(years.includes(defaultYear) ? defaultYear : years[years.length - 1]);
    }
  }, [years, selectedYear, defaultYear]);

  const rowForYear = useMemo(
    () => usageByYear.find((r) => r.year === selectedYear) ?? null,
    [usageByYear, selectedYear]
  );

  const yearTotalIncome = rowForYear ? rowIncomeElectric(rowForYear) + rowIncomeGas(rowForYear) : 0;

  if (usageByYear.length === 0) {
    return (
      <div className="rounded-lg border bg-muted/25 px-3 py-3 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Usage &amp; broker income by calendar year
        </p>
        <p className="text-sm text-muted-foreground">
          No contract usage data yet. Add annual usage (or average monthly × 12) and broker margin on contracts to see
          estimates.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-muted/25 px-3 py-3 space-y-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Usage &amp; broker income by calendar year
        </p>
        <p className="text-xs text-muted-foreground leading-snug mt-1">
          Usage is prorated from bill-based annual estimates: contract days overlapping the year ÷ days in that year.
          Income per contract is that prorated usage × the contract&apos;s broker margin (per kWh for electric; per
          MCF/CCF/DTH for gas). Natural gas usage is shown normalized to MCF; income stays in the contract&apos;s
          pricing unit. Cancelled contracts are excluded; archived contracts count for years their term covered.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {usageByYear.map(({ year }) => (
          <Button
            key={year}
            type="button"
            size="sm"
            variant={year === selectedYear ? "default" : "outline"}
            className="h-8 min-w-[3.25rem] tabular-nums"
            onClick={() => setSelectedYear(year)}
          >
            {year}
          </Button>
        ))}
      </div>

      {rowForYear ? (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-md border bg-background/80 p-2.5 space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Electric ({selectedYear})
              </p>
              <p className="tabular-nums font-semibold">{formatKwh(rowForYear.electricKwh)}</p>
              <p className="text-xs text-muted-foreground">
                Est. income <span className="font-medium text-foreground">{formatMoney(rowIncomeElectric(rowForYear))}</span>
              </p>
            </div>
            <div className="rounded-md border bg-background/80 p-2.5 space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Natural gas ({selectedYear})
              </p>
              <p className="tabular-nums font-semibold">{formatMcf(rowForYear.naturalGasMcf)}</p>
              <p className="text-xs text-muted-foreground">
                Est. income <span className="font-medium text-foreground">{formatMoney(rowIncomeGas(rowForYear))}</span>
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground border-t border-border/60 pt-2">
            <span className="font-medium text-foreground">{selectedYear}</span> combined est. broker income{" "}
            <span className="tabular-nums font-semibold text-foreground">{formatMoney(yearTotalIncome)}</span>
          </p>
        </div>
      ) : null}

      {showActiveBookAnnualTotals ? (
        <div className="rounded-md border border-dashed border-border/80 bg-background/60 p-2.5 space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Active book — full-year estimates (non-archived)
          </p>
          <p className="text-xs text-muted-foreground leading-snug">
            Annual usage sums and margin × annual usage per contract; not prorated to today&apos;s date.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 text-sm pt-1">
            <div className="space-y-0.5">
              <p className="tabular-nums">
                <span className="text-muted-foreground">Electric usage: </span>
                <span className="font-semibold">{formatKwh(activeBookElectricKwh)}</span>
              </p>
              <p className="tabular-nums text-xs">
                <span className="text-muted-foreground">Est. income / yr: </span>
                <span className="font-medium">{formatMoney(activeBookElectricBrokerIncomeUsd)}</span>
              </p>
            </div>
            <div className="space-y-0.5">
              <p className="tabular-nums">
                <span className="text-muted-foreground">Natural gas: </span>
                <span className="font-semibold">{formatMcf(activeBookGasMcf)}</span>
              </p>
              <p className="tabular-nums text-xs">
                <span className="text-muted-foreground">Est. income / yr: </span>
                <span className="font-medium">{formatMoney(activeBookGasBrokerIncomeUsd)}</span>
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
