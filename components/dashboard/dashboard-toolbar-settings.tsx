"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import {
  EMPTY_BROKER_PROFILE,
  loadBrokerProfile,
  saveBrokerProfile,
  type BrokerProfile,
} from "@/lib/broker-profile";
import { annualGasUsageToMcf } from "@/lib/energy-usage";
import { annualUsageResolved, totalTermBrokerIncome } from "@/lib/contract-broker-income";
import { aggregateUsageByCalendarYear } from "@/lib/broker-usage-calendar";
import { BrokerageUsageByYearPanel } from "@/components/brokerage-usage-by-year-panel";
import { ArchivesRfpModal } from "@/components/archives-rfp-modal";
import { googleOAuthConnectUrl } from "@/lib/google-connect";

type ContractIncomeRow = {
  id: string;
  customerId?: string;
  startDate: string;
  expirationDate: string;
  energyType?: string | null;
  status?: string | null;
  contractIncome?: unknown;
  pricePerUnit?: unknown;
  priceUnit?: string | null;
  annualUsage?: unknown;
  avgMonthlyUsage?: unknown;
  termMonths?: number | null;
  brokerMargin?: unknown;
  customer?: { id?: string; name?: string | null } | null;
  supplier?: { name?: string | null } | null;
};

function parseApiDateOnlyKey(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function startOfToday(): Date {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

function customerKey(c: ContractIncomeRow): string {
  return String(c.customerId ?? c.customer?.id ?? c.customer?.name ?? c.id);
}

export function DashboardToolbarSettings() {
  const [archivesOpen, setArchivesOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [profile, setProfile] = useState<BrokerProfile>(EMPTY_BROKER_PROFILE);
  const [activeContracts, setActiveContracts] = useState<ContractIncomeRow[]>([]);
  const [incomeContracts, setIncomeContracts] = useState<ContractIncomeRow[]>([]);
  const [loadingContracts, setLoadingContracts] = useState(false);

  useEffect(() => {
    if (!profileOpen) return;
    setProfile(loadBrokerProfile());
  }, [profileOpen]);

  const loadContractsForSummary = useCallback(async () => {
    setLoadingContracts(true);
    try {
      const [activeRaw, endedRaw] = await Promise.all([
        fetch("/api/contracts?tab=active&sort=expirationDate&order=asc").then((r) => r.json()),
        fetch("/api/contracts?tab=ended&sort=expirationDate&order=asc").then((r) => r.json()),
      ]);
      const active = Array.isArray(activeRaw) ? activeRaw : [];
      const ended = Array.isArray(endedRaw) ? endedRaw : [];
      setActiveContracts(active);
      setIncomeContracts([...active, ...ended]);
    } catch {
      setActiveContracts([]);
      setIncomeContracts([]);
    } finally {
      setLoadingContracts(false);
    }
  }, []);

  useEffect(() => {
    if (!summaryOpen) return;
    void loadContractsForSummary();
  }, [summaryOpen, loadContractsForSummary]);

  const activeElectric = useMemo(
    () => activeContracts.filter((c) => c.energyType === "ELECTRIC").length,
    [activeContracts]
  );
  const activeGas = useMemo(
    () => activeContracts.filter((c) => c.energyType === "NATURAL_GAS").length,
    [activeContracts]
  );

  const electricRows = useMemo(
    () => activeContracts.filter((c) => c.energyType === "ELECTRIC"),
    [activeContracts]
  );
  const gasRows = useMemo(
    () => activeContracts.filter((c) => c.energyType === "NATURAL_GAS"),
    [activeContracts]
  );

  const totalElectricKwh = useMemo(
    () => electricRows.reduce((s, c) => s + annualUsageResolved(c), 0),
    [electricRows]
  );
  const totalGasMcf = useMemo(
    () =>
      gasRows.reduce(
        (s, c) => s + annualGasUsageToMcf(annualUsageResolved(c), c.priceUnit),
        0
      ),
    [gasRows]
  );

  const electricCustomerIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of electricRows) set.add(customerKey(c));
    return set;
  }, [electricRows]);
  const gasCustomerIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of gasRows) set.add(customerKey(c));
    return set;
  }, [gasRows]);

  const usageByYear = useMemo(() => {
    const slice = incomeContracts.map((c) => ({
      startDate: String(c.startDate),
      expirationDate: String(c.expirationDate),
      energyType: String(c.energyType ?? ""),
      priceUnit: c.priceUnit ?? null,
      annualUsage: c.annualUsage,
      avgMonthlyUsage: c.avgMonthlyUsage,
      status: c.status ?? undefined,
    }));
    return aggregateUsageByCalendarYear(slice);
  }, [incomeContracts]);

  const avgElectricPerCustomer = useMemo(() => {
    const n = electricCustomerIds.size;
    return n > 0 ? totalElectricKwh / n : 0;
  }, [electricCustomerIds.size, totalElectricKwh]);

  const avgGasMcfPerCustomer = useMemo(() => {
    const n = gasCustomerIds.size;
    return n > 0 ? totalGasMcf / n : 0;
  }, [gasCustomerIds.size, totalGasMcf]);

  const nextTwelveMonthBuckets = useMemo(() => {
    const from = startOfToday();
    const buckets: { key: string; label: string; count: number }[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(from.getFullYear(), from.getMonth() + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleString("en-US", { month: "short", year: "numeric" });
      buckets.push({ key, label, count: 0 });
    }
    for (const c of activeContracts) {
      const k = parseApiDateOnlyKey(String(c.expirationDate));
      if (!k) continue;
      const ym = k.slice(0, 7);
      const b = buckets.find((x) => x.key === ym);
      if (b) b.count++;
    }
    return buckets;
  }, [activeContracts]);

  const totalEstimatedValueActive = useMemo(() => {
    return activeContracts.reduce((acc, c) => acc + totalTermBrokerIncome(c), 0);
  }, [activeContracts]);

  const saveProfile = () => {
    saveBrokerProfile(profile);
    setProfileOpen(false);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" aria-label="Settings">
            <Settings className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setProfileOpen(true)}>Profile</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setSummaryOpen(true)}>Brokerage summary</DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/email-templates" className="no-underline">
              Email templates
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={googleOAuthConnectUrl(loadBrokerProfile().email)} className="no-underline">
              Reconnect Google…
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setArchivesOpen(true)}>Archives</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ArchivesRfpModal open={archivesOpen} onOpenChange={setArchivesOpen} />

      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Broker profile</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Used for renewal emails and sign-offs. Stored only in this browser for now.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Broker first name</Label>
              <Input value={profile.firstName} onChange={(e) => setProfile((p) => ({ ...p, firstName: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label>Broker last name</Label>
              <Input value={profile.lastName} onChange={(e) => setProfile((p) => ({ ...p, lastName: e.target.value }))} />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label>Broker company name</Label>
              <Input
                value={profile.companyName}
                onChange={(e) => setProfile((p) => ({ ...p, companyName: e.target.value }))}
              />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label>Broker email</Label>
              <Input
                type="email"
                autoComplete="email"
                value={profile.email}
                onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
                placeholder="name@company.com"
              />
            </div>
            <div className="grid gap-2">
              <Label>Broker phone</Label>
              <PhoneInput value={profile.phone} onChange={(v) => setProfile((p) => ({ ...p, phone: v }))} />
            </div>
            <div className="grid gap-2">
              <Label>Broker fax</Label>
              <PhoneInput value={profile.fax} onChange={(v) => setProfile((p) => ({ ...p, fax: v }))} />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label>Website or LinkedIn URL</Label>
              <Input
                value={profile.websiteOrLinkedIn}
                onChange={(e) => setProfile((p) => ({ ...p, websiteOrLinkedIn: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setProfileOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={saveProfile}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={summaryOpen} onOpenChange={setSummaryOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Brokerage summary</DialogTitle>
          </DialogHeader>
          {loadingContracts ? (
            <p className="text-sm text-muted-foreground">Loading contracts…</p>
          ) : (
            <div className="space-y-5 text-sm">
              <div>
                <p className="font-medium">Active contracts</p>
                <p className="text-muted-foreground">
                  Electric: {activeElectric} · Natural gas: {activeGas} · Total: {activeContracts.length}
                </p>
              </div>

              <div className="rounded-lg border bg-muted/25 px-3 py-3 space-y-2">
                <p className="font-medium">Customer usage (active book)</p>
                <div className="grid gap-2 sm:grid-cols-2 text-sm">
                  <div className="rounded-md border bg-background/80 p-2.5 space-y-1">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Electric</p>
                    <p className="tabular-nums font-semibold">
                      {totalElectricKwh.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh total
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {electricCustomerIds.size} customer{electricCustomerIds.size === 1 ? "" : "s"} · Avg{" "}
                      {avgElectricPerCustomer.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh / customer
                    </p>
                  </div>
                  <div className="rounded-md border bg-background/80 p-2.5 space-y-1">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Natural gas</p>
                    <p className="tabular-nums font-semibold">
                      {totalGasMcf.toLocaleString(undefined, { maximumFractionDigits: 0 })} MCF total
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Usage types (MCF/CCF/DTH) converted to MCF. {gasCustomerIds.size} customer
                      {gasCustomerIds.size === 1 ? "" : "s"} · Avg{" "}
                      {avgGasMcfPerCustomer.toLocaleString(undefined, { maximumFractionDigits: 0 })} MCF / customer
                    </p>
                  </div>
                </div>
              </div>

              <BrokerageUsageByYearPanel
                usageByYear={usageByYear}
                showActiveBookAnnualTotals={false}
              />

              <div className="rounded-lg border border-primary/20 bg-muted/20 px-3 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                  <p className="font-medium">Net 12 months — expirations by month</p>
                  <Link
                    href="/directory/contracts"
                    className="text-xs font-medium text-primary hover:underline shrink-0"
                    onClick={() => setSummaryOpen(false)}
                  >
                    Contract management →
                  </Link>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  Rolling 12 calendar months from today; counts are active contracts expiring in each month.
                </p>
                <div className="grid grid-cols-2 gap-x-8 gap-y-0">
                  <ul className="space-y-2">
                    {nextTwelveMonthBuckets.slice(0, 6).map((b) => (
                      <li
                        key={b.key}
                        className="flex justify-between gap-3 border-b border-border/50 pb-1.5 text-xs sm:text-sm"
                      >
                        <span className="text-muted-foreground truncate">{b.label}</span>
                        <span className="tabular-nums font-medium shrink-0">{b.count}</span>
                      </li>
                    ))}
                  </ul>
                  <ul className="space-y-2">
                    {nextTwelveMonthBuckets.slice(6, 12).map((b) => (
                      <li
                        key={b.key}
                        className="flex justify-between gap-3 border-b border-border/50 pb-1.5 text-xs sm:text-sm"
                      >
                        <span className="text-muted-foreground truncate">{b.label}</span>
                        <span className="tabular-nums font-medium shrink-0">{b.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div>
                <p className="font-medium">Total est. contract value (active)</p>
                <p className="text-lg font-semibold tabular-nums">
                  ${totalEstimatedValueActive.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Sum of full-term broker income estimates for active contracts (same basis as Contract Management).
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSummaryOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
