"use client";

import { Fragment, useEffect, useMemo, useState, useCallback, useRef, type ReactNode } from "react";
import Link from "next/link";
import {
  Trash2,
  Search,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  X,
  StickyNote,
  AlertTriangle,
  ExternalLink,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type OverviewContract = {
  id: string;
  energyType: string;
  expirationDate: string;
  status: string;
  supplierName: string;
  mainContactName: string | null;
};

type OverviewRow = {
  companyKey: string;
  companyDisplay: string;
  customerIds: string[];
  canonicalCustomerId: string;
  notes: string | null;
  primaryNameFromContracts: string | null;
  directoryContact: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    label: string | null;
    company: string | null;
  } | null;
  contactMatchHint: "matched" | "no_primary_on_contracts" | "no_matching_contact";
  hasElectric: boolean;
  hasNaturalGas: boolean;
  isActive: boolean;
  contracts: OverviewContract[];
};

type EnergyFilter = "all" | "electric" | "gas" | "both";
type ActivityFilter = "all" | "active" | "inactive";

function formatExp(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function toNumContract(v: unknown): number {
  if (v == null) return 0;
  const n = parseFloat(String(v));
  return Number.isNaN(n) ? 0 : n;
}

function formatRateOrMargin(n: number): string {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(n);
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
}

function formatDetailDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function energyTypeLabel(et: string | undefined): string {
  if (et === "ELECTRIC") return "Electric";
  if (et === "NATURAL_GAS") return "Natural Gas";
  return et || "—";
}

function calcEstIncomePerYear(c: Record<string, unknown>): number {
  const margin = toNumContract(c.brokerMargin);
  const annual = toNumContract(c.annualUsage);
  const avgMonthly = toNumContract(c.avgMonthlyUsage);
  const usage = annual > 0 ? annual : avgMonthly * 12;
  return margin * usage;
}

function calcEstTotalValue(c: Record<string, unknown>): number {
  const margin = toNumContract(c.brokerMargin);
  const annual = toNumContract(c.annualUsage);
  const avgMonthly = toNumContract(c.avgMonthlyUsage);
  const usage = annual > 0 ? annual : avgMonthly * 12;
  const months = typeof c.termMonths === "number" ? c.termMonths : Number(c.termMonths) || 12;
  return margin * (usage / 12) * months;
}

function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-[minmax(160px,220px)_1fr] sm:gap-3 py-2 border-b border-border/50 text-sm last:border-b-0">
      <div className="text-muted-foreground font-medium shrink-0">{label}</div>
      <div className="min-w-0 break-words">{children ?? "—"}</div>
    </div>
  );
}

function ContractDetailModalBody({ c }: { c: Record<string, unknown> }) {
  const customer = (c.customer || {}) as Record<string, unknown>;
  const docs = (Array.isArray(c.documents) ? c.documents : []) as Array<Record<string, unknown>>;

  const priceUnit = String(c.priceUnit || "");
  const rate = toNumContract(c.pricePerUnit);
  const margin = toNumContract(c.brokerMargin);
  const annualU = toNumContract(c.annualUsage);
  const avgMo = toNumContract(c.avgMonthlyUsage);
  const contractIncome = c.contractIncome != null ? toNumContract(c.contractIncome) : null;
  const status = String(c.status || "active");
  const customerNotesStr = customer?.notes != null ? String(customer.notes).trim() : "";
  const contractNotesStr = c.notes != null ? String(c.notes).trim() : "";
  const showContractNotesOnly =
    contractNotesStr && (!customerNotesStr || contractNotesStr !== customerNotesStr);

  return (
    <div className="space-y-6 py-2 pr-1">
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contract terms</h4>
          <div className="flex flex-wrap gap-2">
            {c.energyType === "ELECTRIC" ? (
              <Badge variant="electric">Electric</Badge>
            ) : c.energyType === "NATURAL_GAS" ? (
              <Badge variant="gas">Natural Gas</Badge>
            ) : (
              <Badge variant="secondary">{energyTypeLabel(c.energyType as string)}</Badge>
            )}
            <Badge variant={status === "active" ? "default" : "secondary"} className="capitalize">
              {status}
            </Badge>
          </div>
        </div>
        <div className="rounded-lg border bg-muted/20 px-3">
          <DetailField label="Contract ID">
            <span className="font-mono text-xs">{String(c.id)}</span>
          </DetailField>
          <DetailField label="Usage type (unit)">{priceUnit || "—"}</DetailField>
          <DetailField label="Contract rate">
            {rate > 0 || c.pricePerUnit != null ? `$${formatRateOrMargin(rate)} / ${priceUnit || "unit"}` : "—"}
          </DetailField>
          <DetailField label="Term (months)">{c.termMonths != null ? String(c.termMonths) : "—"}</DetailField>
          <DetailField label="Start date">{formatDetailDate(c.startDate as string)}</DetailField>
          <DetailField label="Expiration date">{formatDetailDate(c.expirationDate as string)}</DetailField>
          <DetailField label="Signed date">{formatDetailDate(c.signedDate as string | null)}</DetailField>
        </div>
      </section>

      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Usage &amp; broker</h4>
        <div className="rounded-lg border bg-muted/20 px-3">
          <DetailField label="Annual usage">
            {annualU > 0 || c.annualUsage != null ? formatRateOrMargin(annualU) : "—"}
          </DetailField>
          <DetailField label="Avg monthly usage">
            {avgMo > 0 || c.avgMonthlyUsage != null ? formatRateOrMargin(avgMo) : "—"}
          </DetailField>
          <DetailField label="Broker margin (per unit)">
            {margin > 0 || c.brokerMargin != null ? `$${formatRateOrMargin(margin)}` : "—"}
          </DetailField>
          <DetailField label="Est. income / year">{formatCurrency(calcEstIncomePerYear(c))}</DetailField>
          <DetailField label="Est. total contract value">{formatCurrency(calcEstTotalValue(c))}</DetailField>
          {contractIncome != null && contractIncome > 0 ? (
            <DetailField label="Contract income (stored)">{formatCurrency(contractIncome)}</DetailField>
          ) : null}
        </div>
      </section>

      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Site &amp; other</h4>
        <div className="rounded-lg border bg-muted/20 px-3">
          <DetailField label="Customer utility">{c.customerUtility ? String(c.customerUtility) : "—"}</DetailField>
          <DetailField label="Total meters">{c.totalMeters != null ? String(c.totalMeters) : "—"}</DetailField>
          <DetailField label="Created">{formatDetailDate(c.createdAt as string)}</DetailField>
          <DetailField label="Last updated">{formatDetailDate(c.updatedAt as string)}</DetailField>
        </div>
      </section>

      {(customerNotesStr || showContractNotesOnly) && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Notes</h4>
          <div className="rounded-lg border bg-muted/20 px-3 py-2 text-sm space-y-2">
            {customerNotesStr ? (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Customer notes</div>
                <p className="whitespace-pre-wrap">{customerNotesStr}</p>
              </div>
            ) : null}
            {showContractNotesOnly ? (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">
                  {customerNotesStr ? "Additional contract notes" : "Contract notes"}
                </div>
                <p className="whitespace-pre-wrap">{contractNotesStr}</p>
              </div>
            ) : null}
          </div>
        </section>
      )}

      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Documents</h4>
        <div className="rounded-lg border bg-muted/20 px-3 py-2 text-sm">
          {docs.length === 0 ? (
            <p className="text-muted-foreground py-1">No documents linked.</p>
          ) : (
            <ul className="space-y-2">
              {docs.map((d) => {
                const url = d.googleDriveUrl ? String(d.googleDriveUrl) : "";
                const name = String(d.name || "Document");
                return (
                  <li key={String(d.id)}>
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-1.5"
                      >
                        <FileText className="h-4 w-4 shrink-0" />
                        {name}
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        {name}
                        <span className="text-xs text-muted-foreground">(no link)</span>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

export default function CustomersPage() {
  const [overviewRows, setOverviewRows] = useState<OverviewRow[]>([]);
  const [filter, setFilter] = useState<EnergyFilter>("all");
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [selectedCompanyKeys, setSelectedCompanyKeys] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const selectAllCheckboxRef = useRef<HTMLInputElement>(null);

  const [contractModalOpen, setContractModalOpen] = useState(false);
  const [contractModalLoading, setContractModalLoading] = useState(false);
  const [contractModalContract, setContractModalContract] = useState<any | null>(null);

  const [contactViewOpen, setContactViewOpen] = useState(false);
  const [contactViewLoading, setContactViewLoading] = useState(false);
  const [contactViewData, setContactViewData] = useState<any | null>(null);

  const [composeOpen, setComposeOpen] = useState(false);
  const [composeToEmail, setComposeToEmail] = useState<string | null>(null);
  const [composeToName, setComposeToName] = useState<string | undefined>(undefined);
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeSending, setComposeSending] = useState(false);

  const [notesOpen, setNotesOpen] = useState(false);
  const [notesCustomerIds, setNotesCustomerIds] = useState<string[]>([]);
  const [notesText, setNotesText] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesCompanyTitle, setNotesCompanyTitle] = useState("");

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/directory/customers-overview");
      const data = await res.json().catch(() => null);
      if (data?.error) throw new Error(data.error);
      setOverviewRows(Array.isArray(data) ? data : []);
    } catch {
      setOverviewRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  const filteredRows = useMemo(() => {
    let r = overviewRows;
    const q = search.trim().toLowerCase();
    if (q) {
      r = r.filter((row) => {
        const hay = [
          row.companyDisplay,
          row.primaryNameFromContracts || "",
          row.directoryContact?.name || "",
          row.directoryContact?.email || "",
          row.directoryContact?.phone || "",
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
    if (filter === "electric") r = r.filter((x) => x.hasElectric);
    else if (filter === "gas") r = r.filter((x) => x.hasNaturalGas);
    else if (filter === "both") r = r.filter((x) => x.hasElectric && x.hasNaturalGas);

    if (activityFilter === "active") r = r.filter((x) => x.isActive);
    else if (activityFilter === "inactive") r = r.filter((x) => !x.isActive);
    return r;
  }, [overviewRows, search, filter, activityFilter]);

  useEffect(() => {
    const valid = new Set(overviewRows.map((r) => r.companyKey));
    setSelectedCompanyKeys((prev) => {
      const next = new Set<string>();
      for (const k of prev) {
        if (valid.has(k)) next.add(k);
      }
      if (next.size === prev.size) {
        for (const k of prev) {
          if (!next.has(k)) return next;
        }
        return prev;
      }
      return next;
    });
  }, [overviewRows]);

  const allFilteredSelected =
    filteredRows.length > 0 && filteredRows.every((r) => selectedCompanyKeys.has(r.companyKey));
  const someFilteredSelected = filteredRows.some((r) => selectedCompanyKeys.has(r.companyKey));

  useEffect(() => {
    const el = selectAllCheckboxRef.current;
    if (!el) return;
    el.indeterminate = someFilteredSelected && !allFilteredSelected;
  }, [someFilteredSelected, allFilteredSelected]);

  const selectedCustomerRecordCount = useMemo(() => {
    const ids = new Set<string>();
    for (const key of selectedCompanyKeys) {
      const row = overviewRows.find((r) => r.companyKey === key);
      if (row) row.customerIds.forEach((id) => ids.add(id));
    }
    return ids.size;
  }, [selectedCompanyKeys, overviewRows]);

  const toggleCompanySelected = (companyKey: string) => {
    setSelectedCompanyKeys((prev) => {
      const next = new Set(prev);
      if (next.has(companyKey)) next.delete(companyKey);
      else next.add(companyKey);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    setSelectedCompanyKeys((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const r of filteredRows) next.delete(r.companyKey);
      } else {
        for (const r of filteredRows) next.add(r.companyKey);
      }
      return next;
    });
  };

  const toggleExpanded = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/directory/customers-overview/sync", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || "Failed to sync");
      await fetchOverview();
      alert(
        `Sync complete (contracts → main contact → Contacts cross-reference → Postgres): ` +
          `${data.companyGroups ?? 0} company group(s). ` +
          `Energy flags updated for ${data.energyRowsUpdated ?? 0} customer row(s). ` +
          `Contact email/phone applied to ${data.customerIdentityRowsUpdated ?? 0} customer row(s). ` +
          `Contact links updated: ${data.contactLinksUpdated ?? 0}.`
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to sync");
    } finally {
      setSyncing(false);
    }
  };

  const openNotesDialog = (row: OverviewRow) => {
    setNotesCustomerIds(row.customerIds);
    setNotesText(row.notes || "");
    setNotesCompanyTitle(row.companyDisplay);
    setNotesSaving(false);
    setNotesOpen(true);
  };

  const saveNotes = async () => {
    if (!notesCustomerIds.length) return;
    setNotesSaving(true);
    try {
      for (const id of notesCustomerIds) {
        const res = await fetch(`/api/customers/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: notesText || null }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) throw new Error(data.error || "Failed to save notes");
      }
      setNotesOpen(false);
      setNotesCustomerIds([]);
      setNotesCompanyTitle("");
      await fetchOverview();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save notes");
    } finally {
      setNotesSaving(false);
    }
  };

  const openContractModal = async (contractId: string) => {
    setContractModalOpen(true);
    setContractModalLoading(true);
    setContractModalContract(null);
    try {
      const res = await fetch(`/api/contracts/${contractId}`);
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Failed to load contract");
      setContractModalContract(data);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to load contract");
      setContractModalContract(null);
      setContractModalOpen(false);
    } finally {
      setContractModalLoading(false);
    }
  };

  const openContactViewModal = async (contactId: string) => {
    setContactViewOpen(true);
    setContactViewLoading(true);
    setContactViewData(null);
    try {
      const res = await fetch(`/api/contacts/${contactId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || "Failed to load contact");
      setContactViewData(data);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to load contact");
      setContactViewOpen(false);
      setContactViewData(null);
    } finally {
      setContactViewLoading(false);
    }
  };

  const openComposeEmailModal = (email: string, name?: string) => {
    setComposeToEmail(email);
    setComposeToName(name);
    setComposeSubject("");
    setComposeBody("");
    setComposeSending(false);
    setComposeOpen(true);
  };

  const sendComposeEmail = async () => {
    if (!composeToEmail) return;
    setComposeSending(true);
    try {
      const res = await fetch("/api/emails/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: composeToEmail,
          subject: composeSubject,
          body: composeBody,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || "Failed to send");
      setComposeOpen(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to send email");
    } finally {
      setComposeSending(false);
    }
  };

  const handleDeleteGroup = async (ids: string[]) => {
    if (
      !confirm(
        `Delete ${ids.length} customer record(s) in Postgres? This only works if no contracts reference them.`
      )
    )
      return;
    try {
      for (const id of ids) {
        const res = await fetch(`/api/customers/${id}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Failed to delete ${id}`);
        }
      }
      setSelectedCompanyKeys((prev) => {
        const next = new Set(prev);
        for (const row of overviewRows) {
          if (row.customerIds.some((id) => ids.includes(id))) next.delete(row.companyKey);
        }
        return next;
      });
      await fetchOverview();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const runBulkDeleteSelected = async () => {
    const ids = new Set<string>();
    for (const key of selectedCompanyKeys) {
      const row = overviewRows.find((r) => r.companyKey === key);
      if (row) row.customerIds.forEach((id) => ids.add(id));
    }
    if (ids.size === 0) return;
    setBulkDeleting(true);
    try {
      for (const id of ids) {
        const res = await fetch(`/api/customers/${id}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Failed to delete ${id}`);
        }
      }
      setSelectedCompanyKeys(new Set());
      await fetchOverview();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setBulkDeleting(false);
    }
  };

  const renderContractLines = (items: OverviewContract[], title: string) => {
    if (items.length === 0) return null;
    return (
      <div className="space-y-1">
        <div className="text-xs font-semibold text-muted-foreground">{title}</div>
        <div className="space-y-0.5 pl-1">
          {items.map((ct) => (
            <div key={ct.id} className="flex flex-wrap items-center gap-2 text-xs py-0.5">
              {ct.energyType === "ELECTRIC" ? (
                <Badge variant="electric" className="text-[10px] px-1.5 py-0">
                  Electric
                </Badge>
              ) : ct.energyType === "NATURAL_GAS" ? (
                <Badge variant="gas" className="text-[10px] px-1.5 py-0">
                  Gas
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  {ct.energyType}
                </Badge>
              )}
              <span className="text-muted-foreground truncate max-w-[140px]">{ct.supplierName || "—"}</span>
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={(e) => {
                  e.stopPropagation();
                  void openContractModal(ct.id);
                }}
              >
                Expires {formatExp(ct.expirationDate)}
              </button>
              {ct.mainContactName ? (
                <span className="text-muted-foreground truncate">• {ct.mainContactName}</span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="sticky top-14 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b pb-3">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pt-2">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Customers</h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
              One row per company, assembled from <strong>Contracts</strong> (grouped by customer). The main contact on
              each contract is cross-referenced with <strong>Contacts</strong> (customer label / matching rules) for email,
              phone, and links. After deleting customer rows, you can recreate them from contract + contact data using{" "}
              <strong>Sync to database</strong> (writes energy flags, identity fields, and <code>contact.customerId</code>{" "}
              in Postgres).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Tooltip content="Rebuilds from contracts (customer list + main contact), matches main contact to Contacts, then persists energy flags, customer email/phone, and contact.customerId links to Postgres.">
              <Button
                variant="outline"
                onClick={() => void handleSync()}
                disabled={syncing}
                title="Persist overview to Postgres"
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                Sync to database
              </Button>
            </Tooltip>
            {selectedCompanyKeys.size > 0 ? (
              <Button
                variant="destructive"
                onClick={() => setBulkDeleteConfirmOpen(true)}
                title="Delete selected customer Postgres rows"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete selected ({selectedCompanyKeys.size})
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => setExpandedKeys(new Set(filteredRows.map((r) => r.companyKey)))}>
              Expand all
            </Button>
            <Button variant="outline" onClick={() => setExpandedKeys(new Set())}>
              Collapse all
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-4 pt-4 sm:flex-row">
          <Select value={filter} onValueChange={(v) => setFilter(v as EnergyFilter)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by energy" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="electric">Electric only</SelectItem>
              <SelectItem value="gas">Natural Gas only</SelectItem>
              <SelectItem value="both">Both Electric & Gas</SelectItem>
            </SelectContent>
          </Select>
          <Select value={activityFilter} onValueChange={(v) => setActivityFilter(v as ActivityFilter)}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active (has non-ended contract)</SelectItem>
              <SelectItem value="inactive">Inactive (all ended)</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Filter by company, contact name, email..."
              className="pl-9 pr-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search.trim().length > 0 && (
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setSearch("")}
                aria-label="Clear"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <Card>
        <CardContent>
          {loading ? (
            <p className="py-8 text-center text-muted-foreground">Loading...</p>
          ) : filteredRows.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              {overviewRows.length === 0
                ? "No contracts yet — add contracts in Contract Management to see customers here."
                : "No rows match your filters."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 py-2 pr-0">
                    <span className="sr-only">Select row</span>
                    <input
                      ref={selectAllCheckboxRef}
                      type="checkbox"
                      className="h-4 w-4 rounded border border-input accent-primary cursor-pointer"
                      checked={allFilteredSelected}
                      onChange={() => toggleSelectAllFiltered()}
                      title={allFilteredSelected ? "Deselect all visible" : "Select all visible"}
                      aria-label="Select all visible rows"
                    />
                  </TableHead>
                  <TableHead className="w-[20%] py-2">Company</TableHead>
                  <TableHead className="w-[5%] py-2">Notes</TableHead>
                  <TableHead className="w-[15%] py-2">Primary contact</TableHead>
                  <TableHead className="w-[15%] py-2">Email</TableHead>
                  <TableHead className="w-[11%] py-2">Phone</TableHead>
                  <TableHead className="w-[11%] py-2">Energy</TableHead>
                  <TableHead className="w-[8%] py-2">Status</TableHead>
                  <TableHead className="w-[8%] py-2 text-right">Delete</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row) => {
                  const key = row.companyKey;
                  const isExpanded = expandedKeys.has(key);
                  const dc = row.directoryContact;

                  const activeContracts = row.contracts.filter((c) => c.status !== "archived");
                  const endedContracts = row.contracts.filter((c) => c.status === "archived");

                  const activeElec = activeContracts.filter((c) => c.energyType === "ELECTRIC");
                  const activeGas = activeContracts.filter((c) => c.energyType === "NATURAL_GAS");
                  const endedElec = endedContracts.filter((c) => c.energyType === "ELECTRIC");
                  const endedGas = endedContracts.filter((c) => c.energyType === "NATURAL_GAS");

                  return (
                    <Fragment key={key}>
                      <TableRow
                        className="cursor-pointer hover:bg-muted/40"
                        onClick={() => toggleExpanded(key)}
                      >
                        <TableCell className="w-10 py-2 pr-0 align-middle" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border border-input accent-primary cursor-pointer"
                            checked={selectedCompanyKeys.has(key)}
                            onChange={() => toggleCompanySelected(key)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`Select ${row.companyDisplay}`}
                          />
                        </TableCell>
                        <TableCell className="font-medium py-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4 shrink-0" />
                            ) : (
                              <ChevronRight className="h-4 w-4 shrink-0" />
                            )}
                            <span className="truncate">{row.companyDisplay}</span>
                          </div>
                        </TableCell>
                        <TableCell className="py-2" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="relative h-8 w-8"
                            onClick={() => openNotesDialog(row)}
                            title={row.notes ? "View/edit notes" : "Add note"}
                          >
                            <StickyNote className="h-4 w-4" />
                            {row.notes ? (
                              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-background animate-pulse" />
                            ) : null}
                          </Button>
                        </TableCell>
                        <TableCell className="py-2" onClick={(e) => e.stopPropagation()}>
                          {dc ? (
                            <button
                              type="button"
                              className="text-sm font-medium hover:underline text-left text-primary"
                              onClick={(e) => {
                                e.stopPropagation();
                                void openContactViewModal(dc.id);
                              }}
                            >
                              {dc.name}
                            </button>
                          ) : (
                            <div className="flex items-start gap-1 text-sm text-muted-foreground">
                              {row.contactMatchHint === "no_matching_contact" && row.primaryNameFromContracts ? (
                                <>
                                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
                                  <span>
                                    <span className="block text-foreground">{row.primaryNameFromContracts}</span>
                                    <span className="text-xs">No Contacts match (check name & customer label)</span>
                                  </span>
                                </>
                              ) : row.contactMatchHint === "no_primary_on_contracts" ? (
                                <span className="text-xs">Set Main Contact on contracts</span>
                              ) : (
                                "—"
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="py-2" onClick={(e) => e.stopPropagation()}>
                          {dc?.email ? (
                            <button
                              type="button"
                              className="text-primary hover:underline text-sm text-left"
                              onClick={() => openComposeEmailModal(dc.email!, dc.name)}
                            >
                              {dc.email}
                            </button>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-2">
                          {dc?.phone ? (
                            <span className="text-sm text-muted-foreground">{dc.phone}</span>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-2">
                          <div className="flex gap-1 flex-wrap">
                            {row.hasElectric && <Badge variant="electric">Electric</Badge>}
                            {row.hasNaturalGas && <Badge variant="gas">Gas</Badge>}
                            {!row.hasElectric && !row.hasNaturalGas && (
                              <span className="text-muted-foreground text-sm">—</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="py-2">
                          {row.isActive ? (
                            <Badge className="bg-green-600 text-white hover:bg-green-600/90">Active</Badge>
                          ) : (
                            <Badge variant="destructive">Inactive</Badge>
                          )}
                        </TableCell>
                        <TableCell className="py-2 text-right" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => void handleDeleteGroup(row.customerIds)}
                            title="Delete customer record(s)"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>

                      {isExpanded && (
                        <TableRow>
                          <TableCell colSpan={9} className="bg-muted/10">
                            <div className="space-y-3 p-2 text-sm">
                              <div className="text-xs font-semibold">Contracts (from Contract Management)</div>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-2 rounded-md border bg-background/50 p-2">
                                  <div className="text-xs font-bold text-primary">Active tab (current)</div>
                                  {renderContractLines(activeElec, "Electric")}
                                  {renderContractLines(activeGas, "Natural gas")}
                                  {activeContracts.length === 0 && (
                                    <div className="text-xs text-muted-foreground">No active (non-archived) contracts.</div>
                                  )}
                                </div>
                                <div className="space-y-2 rounded-md border bg-background/50 p-2">
                                  <div className="text-xs font-bold text-muted-foreground">Ended tab (archived)</div>
                                  {renderContractLines(endedElec, "Electric")}
                                  {renderContractLines(endedGas, "Natural gas")}
                                  {endedContracts.length === 0 && (
                                    <div className="text-xs text-muted-foreground">No ended (archived) contracts.</div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={contactViewOpen}
        onOpenChange={(open) => {
          setContactViewOpen(open);
          if (!open) setContactViewData(null);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Contact (from Contacts)</DialogTitle>
          </DialogHeader>
          {contactViewLoading ? (
            <div className="py-8 text-sm text-muted-foreground">Loading contact...</div>
          ) : contactViewData ? (
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold">{contactViewData.name || "—"}</div>
                  {contactViewData.company ? (
                    <div className="text-muted-foreground">{contactViewData.company}</div>
                  ) : null}
                  {contactViewData.jobTitle ? (
                    <div className="text-muted-foreground">{contactViewData.jobTitle}</div>
                  ) : null}
                  {contactViewData.label ? (
                    <Badge variant="secondary" className="mt-1">
                      {contactViewData.label}
                    </Badge>
                  ) : null}
                </div>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/contacts">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open Contacts page
                  </Link>
                </Button>
              </div>
              <div className="grid gap-1 sm:grid-cols-2">
                {contactViewData.website ? (
                  <div>
                    <span className="text-muted-foreground">Website:</span>{" "}
                    <a
                      href={contactViewData.website}
                      className="text-primary hover:underline break-all"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {contactViewData.website}
                    </a>
                  </div>
                ) : null}
                {contactViewData.isPriority ? (
                  <div>
                    <Badge>Priority</Badge>
                  </div>
                ) : null}
              </div>
              <div>
                <div className="text-xs font-semibold text-muted-foreground mb-1">Emails</div>
                {Array.isArray(contactViewData.emails) && contactViewData.emails.length > 0 ? (
                  <ul className="list-disc pl-5 space-y-0.5">
                    {contactViewData.emails.map((e: { id?: string; email: string; type?: string }) => (
                      <li key={e.id ?? e.email}>
                        {e.email}
                        {e.type ? <span className="text-muted-foreground"> ({e.type})</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : contactViewData.email ? (
                  <div>{contactViewData.email}</div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
              <div>
                <div className="text-xs font-semibold text-muted-foreground mb-1">Phones</div>
                {Array.isArray(contactViewData.phones) && contactViewData.phones.length > 0 ? (
                  <ul className="list-disc pl-5 space-y-0.5">
                    {contactViewData.phones.map((p: { id?: string; phone: string; type?: string }) => (
                      <li key={p.id ?? p.phone}>
                        {p.phone}
                        {p.type ? <span className="text-muted-foreground"> ({p.type})</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : contactViewData.phone ? (
                  <div>{contactViewData.phone}</div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
              <div>
                <div className="text-xs font-semibold text-muted-foreground mb-1">Addresses</div>
                {Array.isArray(contactViewData.addresses) && contactViewData.addresses.length > 0 ? (
                  <ul className="space-y-2">
                    {contactViewData.addresses.map(
                      (a: {
                        id?: string;
                        street?: string | null;
                        city?: string | null;
                        state?: string | null;
                        zip?: string | null;
                        type?: string | null;
                      }) => (
                        <li key={a.id ?? `${a.street}-${a.city}`}>
                          {[a.street, a.city, a.state, a.zip].filter(Boolean).join(", ") || "—"}
                          {a.type ? <span className="text-muted-foreground"> ({a.type})</span> : null}
                        </li>
                      )
                    )}
                  </ul>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
              {Array.isArray(contactViewData.significantDates) && contactViewData.significantDates.length > 0 ? (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground mb-1">Significant dates</div>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {contactViewData.significantDates.map(
                      (d: { id?: string; label: string; date: string }) => (
                        <li key={d.id ?? d.label}>
                          {d.label}: {new Date(d.date).toLocaleDateString()}
                        </li>
                      )
                    )}
                  </ul>
                </div>
              ) : null}
              {Array.isArray(contactViewData.relatedPersons) && contactViewData.relatedPersons.length > 0 ? (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground mb-1">Related persons</div>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {contactViewData.relatedPersons.map(
                      (rp: { id?: string; name: string; relation?: string | null }) => (
                        <li key={rp.id ?? rp.name}>
                          {rp.name}
                          {rp.relation ? <span className="text-muted-foreground"> — {rp.relation}</span> : null}
                        </li>
                      )
                    )}
                  </ul>
                </div>
              ) : null}
              {contactViewData.notes ? (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground mb-1">Notes</div>
                  <pre className="whitespace-pre-wrap rounded border bg-muted/30 p-3 text-xs font-sans">
                    {contactViewData.notes}
                  </pre>
                </div>
              ) : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setContactViewOpen(false)}>
                  Close
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No contact loaded.</div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={bulkDeleteConfirmOpen}
        onOpenChange={setBulkDeleteConfirmOpen}
        title="Delete selected customers?"
        message={`This will delete ${selectedCustomerRecordCount} customer record(s) in Postgres from ${selectedCompanyKeys.size} selected row(s). This only succeeds if no contracts still reference those customers.`}
        confirmLabel={bulkDeleting ? "Deleting…" : "Delete"}
        onConfirm={async () => {
          await runBulkDeleteSelected();
        }}
      />

      <Dialog
        open={notesOpen}
        onOpenChange={(open) => {
          setNotesOpen(open);
          if (!open) setNotesCompanyTitle("");
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {notesCompanyTitle ? `Customer notes — ${notesCompanyTitle}` : "Customer notes"}
            </DialogTitle>
          </DialogHeader>
          <textarea
            className="w-full min-h-[180px] rounded border px-3 py-2 text-sm"
            value={notesText}
            onChange={(e) => setNotesText(e.target.value)}
            placeholder="Stored on the customer record in Postgres (shared across merged company rows)."
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNotesOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void saveNotes()} disabled={notesSaving}>
              {notesSaving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={composeOpen}
        onOpenChange={(open) => {
          if (!open) {
            setComposeOpen(false);
            setComposeToEmail(null);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Compose Email</DialogTitle>
          </DialogHeader>
          {composeToEmail ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void sendComposeEmail();
              }}
              className="space-y-4 py-4"
            >
              <div className="grid gap-2">
                <Label>To</Label>
                <Input
                  value={composeToName ? `${composeToName} <${composeToEmail}>` : composeToEmail}
                  readOnly
                  className="bg-muted"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="compose-subject">Subject</Label>
                <Input
                  id="compose-subject"
                  value={composeSubject}
                  onChange={(e) => setComposeSubject(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="compose-body">Message</Label>
                <textarea
                  id="compose-body"
                  required
                  className="min-h-[140px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={composeBody}
                  onChange={(e) => setComposeBody(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setComposeOpen(false)} disabled={composeSending}>
                  Cancel
                </Button>
                <Button type="submit" disabled={composeSending}>
                  {composeSending ? "Sending..." : "Send"}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={contractModalOpen}
        onOpenChange={(open) => {
          if (!open) {
            setContractModalOpen(false);
            setContractModalContract(null);
          }
        }}
      >
        <DialogContent className="max-w-3xl max-h-[92vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle>Contract Details</DialogTitle>
          </DialogHeader>
          {contractModalLoading ? (
            <div className="py-6 text-sm text-muted-foreground">Loading contract...</div>
          ) : contractModalContract ? (
            <>
              <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
                <ContractDetailModalBody c={contractModalContract as Record<string, unknown>} />
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (!contractModalContract?.id) return;
                    window.location.href = `/directory/contracts?contractId=${encodeURIComponent(contractModalContract.id)}`;
                  }}
                >
                  Open in Contracts
                </Button>
                <Button type="button" onClick={() => setContractModalOpen(false)}>
                  Close
                </Button>
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">No contract.</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
