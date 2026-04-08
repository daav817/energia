"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { BrokerProfile } from "@/lib/broker-profile";

type Summary = {
  activeContractCount: number;
  activeElectric: number;
  activeGas: number;
  totalEstIncomePerYear: number;
  totalTermBrokerIncome: number;
  currentYearAttributableIncome: number;
  incomeYear: number;
};

function formatMoney(n: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function BrokerOverviewModal(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: BrokerProfile;
}) {
  const { open, onOpenChange, profile } = props;
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/broker/contracts-financial-summary");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Failed to load");
      setSummary(data as Summary);
    } catch (e) {
      setSummary(null);
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const displayName = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[min(90vh,720px)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{profile.companyName?.trim() || "Broker"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 text-sm">
          <div className="rounded-lg border bg-muted/30 px-3 py-3 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contact</p>
            {displayName ? (
              <p>
                <span className="text-muted-foreground">Name: </span>
                {displayName}
              </p>
            ) : (
              <p className="text-muted-foreground">Name not set — add it in Settings, Profile.</p>
            )}
            <p>
              <span className="text-muted-foreground">Email: </span>
              {profile.email?.trim() ? (
                <a href={`mailto:${profile.email.trim()}`} className="text-primary no-underline hover:underline">
                  {profile.email.trim()}
                </a>
              ) : (
                <span className="text-muted-foreground">{"\u2014"}</span>
              )}
            </p>
            <p>
              <span className="text-muted-foreground">Phone: </span>
              {profile.phone?.trim() || "\u2014"}
            </p>
            {profile.websiteOrLinkedIn?.trim() ? (
              <p>
                <span className="text-muted-foreground">Web: </span>
                <a
                  href={
                    profile.websiteOrLinkedIn.trim().startsWith("http")
                      ? profile.websiteOrLinkedIn.trim()
                      : `https://${profile.websiteOrLinkedIn.trim()}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary no-underline hover:underline break-all"
                >
                  {profile.websiteOrLinkedIn.trim()}
                </a>
              </p>
            ) : null}
          </div>

          <div className="rounded-lg border px-3 py-3 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Contract book (non-archived)
            </p>
            {loading ? (
              <p className="text-muted-foreground">Loading financial summary...</p>
            ) : error ? (
              <p className="text-destructive text-sm">{error}</p>
            ) : summary ? (
              <>
                <p className="text-muted-foreground">
                  Active contracts: {summary.activeContractCount} (Electric {summary.activeElectric}
                  {" \u00b7 "} Natural gas {summary.activeGas})
                </p>
                <dl className="grid gap-2 text-sm">
                  <div className="flex justify-between gap-4 border-b border-border/50 pb-2">
                    <dt className="text-muted-foreground">Est. broker income / year</dt>
                    <dd className="font-medium tabular-nums">{formatMoney(summary.totalEstIncomePerYear)}</dd>
                  </div>
                  <div className="flex justify-between gap-4 border-b border-border/50 pb-2">
                    <dt className="text-muted-foreground">Est. total term broker income</dt>
                    <dd className="font-medium tabular-nums">{formatMoney(summary.totalTermBrokerIncome)}</dd>
                  </div>
                  <div className="flex justify-between gap-4 pt-1">
                    <dt className="text-muted-foreground">Attributed to {summary.incomeYear} (prorated)</dt>
                    <dd className="font-medium tabular-nums">{formatMoney(summary.currentYearAttributableIncome)}</dd>
                  </div>
                </dl>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Estimates use the same margin and usage rules as the Contracts directory. Edit contract rows to change
                  totals.
                </p>
              </>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
