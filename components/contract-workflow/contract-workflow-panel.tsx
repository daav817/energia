"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Mail,
  Plus,
  ExternalLink,
  Trash2,
  List,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContractRenewalEmailDialog } from "@/components/contracts/contract-renewal-email-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  RFP_FROM_CONTRACT_SESSION_KEY,
  buildRfpFromContractPrefillPayload,
  buildRfpWorkflowNewRowPrefill,
} from "@/lib/rfp-from-contract-prefill";
import { setWorkflowRfpPending } from "@/lib/workflow-rfp-pending";

type LinkedRfp = {
  id: string;
  sentAt: string | null;
  quoteSummarySentAt: string | null;
  archivedAt: string | null;
} | null;

type RfpPickerRow = {
  id: string;
  sentAt: string | null;
  createdAt: string;
  energyType: string;
  status: string;
  customer?: { name: string; company: string | null } | null;
  customerContact?: { name: string; company: string | null } | null;
  accountLines: { accountNumber: string; serviceAddress: string | null }[];
};

type WorkflowRowApi = {
  id: string;
  contractId: string | null;
  customerId: string | null;
  energyType: "ELECTRIC" | "NATURAL_GAS" | null;
  displayLabel: string | null;
  workflowArchived: boolean;
  receivedBillsAt: string | null;
  rfpQuoteClosedAt: string | null;
  newContractAmendedAt: string | null;
  linkedRfpRequestId: string | null;
  contractOutcome: string;
  lastWorkflowRefreshAt: string | null;
  renewalReminderNotApplicableAt: string | null;
  rfpSentOverrideAt: string | null;
  quoteSummaryOverrideAt: string | null;
  contract: {
    id: string;
    expirationDate: string;
    energyType: string;
    renewalReminderSentAt: string | null;
    needsContractDetail?: boolean;
    termMonths?: number | null;
    annualUsage?: unknown;
    avgMonthlyUsage?: unknown;
    brokerMargin?: unknown;
    customerUtility?: string | null;
    priceUnit?: string | null;
    notes?: string | null;
    customer: { id: string; name: string; company: string | null };
    supplier: { id: string; name: string };
    mainContact: { id: string; name: string; company?: string | null } | null;
  } | null;
  customer: { id: string; name: string; company: string | null } | null;
  linkedRfp: LinkedRfp;
};

type CompanyOpt = {
  id: string;
  displayName: string;
  customerId: string | null;
};

type AccountRow = {
  accountId: string;
  ldcUtility: string;
  serviceAddress: string;
};

function energyLabelLong(et: string | null | undefined): string {
  if (et === "ELECTRIC") return "Electric";
  if (et === "NATURAL_GAS") return "Natural gas";
  return "—";
}

function formatExpiration(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function afterRefresh(ts: string | null | undefined, refreshIso: string | null | undefined): boolean {
  if (!ts) return false;
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return false;
  const r = refreshIso ? new Date(refreshIso).getTime() : 0;
  if (!Number.isFinite(r) || r <= 0) return true;
  return t > r;
}

function formatRfpPickerLabel(rfp: RfpPickerRow): string {
  const c = rfp.customer;
  const cc = rfp.customerContact;
  /** Company / org line: CRM company, else contact’s company field, else CRM customer name (often the org). */
  const company =
    (c?.company ?? "").trim() ||
    (cc?.company ?? "").trim() ||
    (c?.name ?? "").trim() ||
    "";
  const contactName = (cc?.name ?? "").trim();
  const parts: string[] = [];
  if (company) parts.push(company);
  if (contactName && contactName !== company) parts.push(contactName);
  const who =
    parts.length > 0 ? parts.join(" — ") : contactName || `RFP …${rfp.id.slice(-6)}`;
  const dateSrc = rfp.sentAt || rfp.createdAt;
  const dateStr = dateSrc
    ? new Date(dateSrc).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";
  const etShort =
    rfp.energyType === "ELECTRIC" ? "Elec" : rfp.energyType === "NATURAL_GAS" ? "Gas" : rfp.energyType;
  const st = rfp.status ? String(rfp.status) : "";
  return `${who} · ${dateStr} · ${etShort}${st ? ` · ${st}` : ""}`;
}

function StepCheck({ done, compact }: { done: boolean; compact: boolean }) {
  if (!done) return <span className="text-muted-foreground">—</span>;
  return (
    <Check
      className={cn(
        "shrink-0 text-emerald-400 dark:text-emerald-300",
        "[filter:drop-shadow(0_0_5px_rgba(52,211,153,1))_drop-shadow(0_0_12px_rgba(16,185,129,0.85))]",
        compact ? "h-6 w-6" : "h-8 w-8"
      )}
      strokeWidth={3}
      aria-label="Done"
    />
  );
}

/** True if any renewal / RFP / quote / bills / contract step has been acted on. */
function workflowRowStarted(row: WorkflowRowApi): boolean {
  const c = row.contract;
  const refreshIso = row.lastWorkflowRefreshAt;
  const autoRfpSent = afterRefresh(row.linkedRfp?.sentAt ?? null, refreshIso);
  const rfpSent = autoRfpSent || Boolean(row.rfpSentOverrideAt);
  const autoQuoteSent = afterRefresh(row.linkedRfp?.quoteSummarySentAt ?? null, refreshIso);
  const quoteSent = autoQuoteSent || Boolean(row.quoteSummaryOverrideAt);
  const renewalDone =
    Boolean(c?.renewalReminderSentAt) || Boolean(row.renewalReminderNotApplicableAt);

  if (renewalDone) return true;
  if (row.receivedBillsAt) return true;
  if (rfpSent) return true;
  if (quoteSent) return true;
  if (row.rfpQuoteClosedAt) return true;
  if (row.newContractAmendedAt) return true;
  if (row.contractOutcome && row.contractOutcome.trim() !== "") return true;
  return false;
}

function rowSearchBlob(
  row: WorkflowRowApi,
  et: string | null | undefined,
  companyName: string,
  accounts: AccountRow[]
): string {
  const c = row.contract;
  const parts = [
    companyName,
    energyLabelLong(et),
    c ? formatExpiration(c.expirationDate) : "",
    row.displayLabel ?? "",
    row.customer?.name ?? "",
    row.customer?.company ?? "",
    ...accounts.map((a) => `${a.accountId} ${a.ldcUtility} ${a.serviceAddress}`),
  ];
  return parts.join(" ").toLowerCase();
}

export type ExpiryBucket = "expired" | "near" | "upcoming" | "longterm" | "newBusiness";

const EXPIRY_GROUP_ORDER: ExpiryBucket[] = [
  "expired",
  "near",
  "upcoming",
  "longterm",
  "newBusiness",
];

const GROUP_LABELS: Record<ExpiryBucket, string> = {
  expired: "Expired contracts",
  near: "Near expiring (30 days or less)",
  upcoming: "Upcoming expiring (31–90 days)",
  longterm: "Long-term (91+ days)",
  newBusiness: "New business (no contract end date)",
};

const EXPIRY_GROUPS_STORAGE_KEY = "energia-workflow-expiry-groups-open-v1";

/** Single shared list for all rows’ “Link RFP” comboboxes. */
const WORKFLOW_RFP_COMBO_CACHE_KEY = "__workflowRfpComboAll__";

const DEFAULT_EXPIRY_GROUPS_OPEN: Record<ExpiryBucket, boolean> = {
  expired: true,
  near: true,
  upcoming: true,
  longterm: true,
  newBusiness: true,
};

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
}

function parseLocalDateOnly(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso).trim());
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const day = Number(m[3]);
    const x = new Date(y, mo, day, 12, 0, 0, 0);
    return Number.isNaN(x.getTime()) ? null : x;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return startOfLocalDay(d);
}

/** Whole calendar days from local today to expiration (negative = already expired). */
function calendarDaysUntilExpiration(expirationIso: string, now = new Date()): number | null {
  const expDay = parseLocalDateOnly(expirationIso);
  if (!expDay) return null;
  const today = startOfLocalDay(now);
  return Math.round((expDay.getTime() - today.getTime()) / 86_400_000);
}

export function classifyExpiryBucket(row: WorkflowRowApi): ExpiryBucket {
  if (!row.contract?.expirationDate) return "newBusiness";
  const days = calendarDaysUntilExpiration(row.contract.expirationDate);
  if (days === null) return "newBusiness";
  if (days < 0) return "expired";
  if (days <= 30) return "near";
  if (days <= 90) return "upcoming";
  return "longterm";
}

function sortRowsInBucket(rows: WorkflowRowApi[], bucket: ExpiryBucket): WorkflowRowApi[] {
  if (bucket === "newBusiness") return rows;
  return [...rows].sort((a, b) => {
    const ta = a.contract?.expirationDate
      ? parseLocalDateOnly(a.contract.expirationDate)?.getTime() ?? 0
      : 0;
    const tb = b.contract?.expirationDate
      ? parseLocalDateOnly(b.contract.expirationDate)?.getTime() ?? 0
      : 0;
    return ta - tb;
  });
}

function expiryGroupHeaderChrome(bucket: ExpiryBucket): {
  bar: string;
  chevron: string;
  label: string;
  count: string;
} {
  switch (bucket) {
    case "expired":
      return {
        bar: "bg-zinc-600 hover:bg-zinc-700 dark:bg-zinc-700 dark:hover:bg-zinc-800",
        chevron: "text-zinc-200",
        label: "text-zinc-50",
        count: "text-zinc-200/90",
      };
    case "near":
      return {
        bar: "bg-red-200/90 hover:bg-red-300/95 dark:bg-red-950/55 dark:hover:bg-red-950/70",
        chevron: "text-red-900/80 dark:text-red-200/90",
        label: "text-red-950 dark:text-red-50",
        count: "text-red-900/75 dark:text-red-200/85",
      };
    case "upcoming":
      return {
        bar: "bg-amber-200/85 hover:bg-amber-300/90 dark:bg-amber-950/50 dark:hover:bg-amber-950/65",
        chevron: "text-amber-900/75 dark:text-amber-200/90",
        label: "text-amber-950 dark:text-amber-50",
        count: "text-amber-900/70 dark:text-amber-200/85",
      };
    case "longterm":
      return {
        bar: "bg-emerald-200/85 hover:bg-emerald-300/90 dark:bg-emerald-950/45 dark:hover:bg-emerald-950/60",
        chevron: "text-emerald-900/75 dark:text-emerald-200/90",
        label: "text-emerald-950 dark:text-emerald-50",
        count: "text-emerald-900/70 dark:text-emerald-200/85",
      };
    case "newBusiness":
      return {
        bar: "bg-slate-200/90 hover:bg-slate-300/95 dark:bg-slate-800/85 dark:hover:bg-slate-800",
        chevron: "text-slate-700 dark:text-slate-300",
        label: "text-slate-900 dark:text-slate-100",
        count: "text-slate-700/90 dark:text-slate-300/90",
      };
  }
}

function ExpiryNeonDot({ bucket, compact }: { bucket: ExpiryBucket; compact: boolean }) {
  const size = compact ? "h-2 w-2" : "h-2.5 w-2.5";
  if (bucket === "near") {
    return (
      <span
        className={cn(
          "inline-block shrink-0 rounded-full bg-red-500",
          "shadow-[0_0_14px_rgba(239,68,68,0.95),0_0_6px_rgba(248,113,113,0.9)]",
          "ring-2 ring-red-300/90 dark:bg-red-400",
          size
        )}
        title="Expires in 30 days or less"
        aria-hidden
      />
    );
  }
  if (bucket === "upcoming") {
    return (
      <span
        className={cn(
          "inline-block shrink-0 rounded-full bg-amber-400",
          "shadow-[0_0_14px_rgba(251,191,36,0.95),0_0_6px_rgba(252,211,77,0.85)]",
          "ring-2 ring-amber-200/90 dark:bg-amber-400",
          size
        )}
        title="Expires in 31–90 days"
        aria-hidden
      />
    );
  }
  if (bucket === "longterm") {
    return (
      <span
        className={cn(
          "inline-block shrink-0 rounded-full bg-emerald-400",
          "shadow-[0_0_14px_rgba(52,211,153,0.9),0_0_6px_rgba(16,185,129,0.85)]",
          "ring-2 ring-emerald-200/85 dark:bg-emerald-400",
          size
        )}
        title="Expires in 91+ days"
        aria-hidden
      />
    );
  }
  return <span className={cn("inline-block shrink-0", compact ? "h-2 w-2" : "h-2.5 w-2.5")} aria-hidden />;
}

export function ContractWorkflowPanel({
  compact = false,
  title,
  showHeading = true,
}: {
  compact?: boolean;
  title?: string;
  showHeading?: boolean;
}) {
  const [rows, setRows] = useState<WorkflowRowApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [archivedView, setArchivedView] = useState(false);
  const [renewalContractId, setRenewalContractId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [companies, setCompanies] = useState<CompanyOpt[]>([]);
  const [addCustomerId, setAddCustomerId] = useState("");
  const [addEnergy, setAddEnergy] = useState<"ELECTRIC" | "NATURAL_GAS">("NATURAL_GAS");
  const [addLabel, setAddLabel] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [accountsModal, setAccountsModal] = useState<{
    company: string;
    lines: AccountRow[];
  } | null>(null);
  const [accountsByContractId, setAccountsByContractId] = useState<Record<string, AccountRow[]>>({});
  const rfpPickerCacheRef = useRef<Record<string, RfpPickerRow[]>>({});
  const rfpPickerInflightRef = useRef<Record<string, Promise<void>>>({});
  const [rfpPickerTick, setRfpPickerTick] = useState(0);
  const [expiryGroupsOpen, setExpiryGroupsOpen] = useState<Record<ExpiryBucket, boolean>>(
    () => ({ ...DEFAULT_EXPIRY_GROUPS_OPEN })
  );
  const [expiryGroupsHydrated, setExpiryGroupsHydrated] = useState(false);

  const loadRfpPickerOptions = useCallback(async () => {
    const cacheKey = WORKFLOW_RFP_COMBO_CACHE_KEY;
    let inflight = rfpPickerInflightRef.current[cacheKey];
    if (!inflight) {
      inflight = (async () => {
        try {
          const res = await fetch("/api/contract-workflow/submitted-rfps");
          const raw = res.ok ? ((await res.json()) as unknown) : [];
          const list = Array.isArray(raw) ? (raw as RfpPickerRow[]) : [];
          rfpPickerCacheRef.current[cacheKey] = list;
        } catch {
          rfpPickerCacheRef.current[cacheKey] = [];
        } finally {
          setRfpPickerTick((t) => t + 1);
          delete rfpPickerInflightRef.current[cacheKey];
        }
      })();
      rfpPickerInflightRef.current[cacheKey] = inflight;
    }
    await inflight;
  }, []);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/contract-workflow?archived=${archivedView ? "1" : "0"}`);
      const data = (await res.json()) as { rows?: WorkflowRowApi[] };
      setRows(Array.isArray(data.rows) ? data.rows : []);
      delete rfpPickerCacheRef.current[WORKFLOW_RFP_COMBO_CACHE_KEY];
      setRfpPickerTick((t) => t + 1);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [archivedView]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [archivedView]);

  useEffect(() => {
    if (!addOpen) return;
    void fetch("/api/contacts/customer-companies")
      .then((r) => r.json())
      .then((raw: { companies?: CompanyOpt[] }) => {
        const list = Array.isArray(raw.companies) ? raw.companies : [];
        setCompanies(list.filter((c) => c.customerId));
      })
      .catch(() => setCompanies([]));
  }, [addOpen]);

  useEffect(() => {
    const ids = [...new Set(rows.map((r) => r.contract?.id).filter(Boolean))] as string[];
    if (ids.length === 0) {
      setAccountsByContractId({});
      return;
    }
    let cancelled = false;
    void Promise.all(
      ids.map(async (cid) => {
        try {
          const r = await fetch(`/api/contracts/${encodeURIComponent(cid)}/accounts`);
          const list = r.ok
            ? ((await r.json()) as Array<{
                accountId?: string;
                ldcUtility?: string | null;
                serviceAddress?: string | null;
              }>)
            : [];
          const normalized: AccountRow[] = Array.isArray(list)
            ? list.map((x) => ({
                accountId: String(x.accountId ?? "").trim(),
                ldcUtility: String(x.ldcUtility ?? "").trim(),
                serviceAddress: String(x.serviceAddress ?? "").trim(),
              }))
            : [];
          return [cid, normalized] as const;
        } catch {
          return [cid, [] as AccountRow[]] as const;
        }
      })
    ).then((pairs) => {
      if (cancelled) return;
      setAccountsByContractId(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [rows]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(EXPIRY_GROUPS_STORAGE_KEY);
      if (raw) {
        const j = JSON.parse(raw) as Record<string, boolean>;
        if (j && typeof j === "object") {
          setExpiryGroupsOpen((prev) => {
            const next = { ...prev };
            for (const k of EXPIRY_GROUP_ORDER) {
              if (typeof j[k] === "boolean") next[k] = j[k];
            }
            return next;
          });
        }
      }
    } catch {
      /* ignore */
    }
    setExpiryGroupsHydrated(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !expiryGroupsHydrated) return;
    try {
      localStorage.setItem(EXPIRY_GROUPS_STORAGE_KEY, JSON.stringify(expiryGroupsOpen));
    } catch {
      /* ignore */
    }
  }, [expiryGroupsOpen, expiryGroupsHydrated]);

  const patchRow = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      const res = await fetch(`/api/contract-workflow/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return;
      await loadRows();
    },
    [loadRows]
  );

  const filteredRows = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const c = row.contract;
      const et =
        c?.energyType === "ELECTRIC" || c?.energyType === "NATURAL_GAS" ? c.energyType : row.energyType;
      const companyName = c
        ? (c.customer.company?.trim() || c.customer.name || "Customer")
        : (row.displayLabel?.trim() ||
            row.customer?.company?.trim() ||
            row.customer?.name ||
            "New pursuit");
      const acc = c ? accountsByContractId[c.id] ?? [] : [];
      return rowSearchBlob(row, et, companyName, acc).includes(q);
    });
  }, [rows, filterQuery, accountsByContractId]);

  const groupedFilteredRows = useMemo(() => {
    const m: Record<ExpiryBucket, WorkflowRowApi[]> = {
      expired: [],
      near: [],
      upcoming: [],
      longterm: [],
      newBusiness: [],
    };
    for (const row of filteredRows) {
      m[classifyExpiryBucket(row)].push(row);
    }
    for (const k of EXPIRY_GROUP_ORDER) {
      m[k] = sortRowsInBucket(m[k], k);
    }
    return m;
  }, [filteredRows]);

  const visibleExpiryBuckets = useMemo(
    () => EXPIRY_GROUP_ORDER.filter((b) => groupedFilteredRows[b].length > 0),
    [groupedFilteredRows]
  );

  const allExpirySectionsExpanded = useMemo(
    () =>
      visibleExpiryBuckets.length > 0 &&
      visibleExpiryBuckets.every((b) => expiryGroupsOpen[b]),
    [visibleExpiryBuckets, expiryGroupsOpen]
  );

  const allFilteredSelected =
    filteredRows.length > 0 && filteredRows.every((r) => selectedIds.has(r.id));

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllFiltered() {
    if (allFilteredSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const r of filteredRows) next.delete(r.id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const r of filteredRows) next.add(r.id);
        return next;
      });
    }
  }

  function toggleExpiryGroup(key: ExpiryBucket) {
    setExpiryGroupsOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function toggleExpandAllExpiryGroups() {
    const nextOpen = !allExpirySectionsExpanded;
    setExpiryGroupsOpen((prev) => {
      const next = { ...prev };
      for (const b of EXPIRY_GROUP_ORDER) {
        if (groupedFilteredRows[b].length > 0) next[b] = nextOpen;
      }
      return next;
    });
  }

  async function bulkSetArchived(archive: boolean) {
    if (selectedIds.size === 0) return;
    await Promise.all(
      [...selectedIds].map((id) =>
        fetch(`/api/contract-workflow/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workflowArchive: archive }),
        })
      )
    );
    setSelectedIds(new Set());
    await loadRows();
  }

  async function bulkDelete() {
    if (selectedIds.size === 0) return;
    await Promise.all(
      [...selectedIds].map((id) =>
        fetch(`/api/contract-workflow/${encodeURIComponent(id)}`, { method: "DELETE" })
      )
    );
    setSelectedIds(new Set());
    await loadRows();
  }

  async function openRfpFromContractRow(row: WorkflowRowApi) {
    const c = row.contract;
    if (!c) return;
    type AccRow = {
      accountNumber: string;
      serviceAddress: string;
      annualUsage: string;
      avgMonthlyUsage: string;
    };
    let accountLines: AccRow[] = [];
    try {
      const res = await fetch(`/api/contracts/${encodeURIComponent(c.id)}/accounts`);
      if (res.ok) {
        const list = (await res.json()) as Array<{
          accountId?: string;
          serviceAddress?: string | null;
          annualUsage?: string | null;
          avgMonthlyUsage?: string | null;
        }>;
        if (Array.isArray(list) && list.length > 0) {
          accountLines = list.map((r) => ({
            accountNumber: String(r.accountId ?? "").trim(),
            serviceAddress: String(r.serviceAddress ?? "").trim(),
            annualUsage:
              r.annualUsage != null && String(r.annualUsage).trim() !== "" ? String(r.annualUsage) : "",
            avgMonthlyUsage:
              r.avgMonthlyUsage != null && String(r.avgMonthlyUsage).trim() !== ""
                ? String(r.avgMonthlyUsage)
                : "",
          }));
        }
      }
    } catch {
      /* fallback */
    }
    if (accountLines.length === 0) {
      accountLines = [
        { accountNumber: "", serviceAddress: "", annualUsage: "", avgMonthlyUsage: "" },
      ];
    }

    const et = c.energyType === "ELECTRIC" || c.energyType === "NATURAL_GAS" ? c.energyType : "NATURAL_GAS";
    const payload = buildRfpFromContractPrefillPayload(
      {
        id: c.id,
        supplierId: c.supplier?.id,
        customer: { id: c.customer.id, company: c.customer.company, name: c.customer.name },
        mainContactId: c.mainContact?.id ?? null,
        mainContact: c.mainContact
          ? { id: c.mainContact.id, company: c.mainContact.company ?? null }
          : null,
        resolvedCustomerContactId: c.mainContact?.id ?? null,
        energyType: et,
        expirationDate: c.expirationDate,
        termMonths: c.termMonths ?? null,
        annualUsage: c.annualUsage ?? null,
        avgMonthlyUsage: c.avgMonthlyUsage ?? null,
        brokerMargin: c.brokerMargin ?? null,
        customerUtility: c.customerUtility ?? null,
        priceUnit: c.priceUnit ?? null,
        notes: c.notes ?? null,
      },
      accountLines
    );

    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      localStorage.setItem(RFP_FROM_CONTRACT_SESSION_KEY, JSON.stringify(payload));
    } catch {
      /* continue */
    }
    setWorkflowRfpPending({ workflowRowId: row.id, contractId: c.id });
    const q = new URLSearchParams({
      fromContract: "1",
      prefillNonce: nonce,
      prefillContractId: c.id,
    });
    window.open(`/rfp?${q.toString()}`, "_blank", "noopener,noreferrer");
  }

  async function openRfpNewBusinessRow(row: WorkflowRowApi) {
    if (!row.customerId || !row.energyType) return;
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const payload = await buildRfpWorkflowNewRowPrefill({
      workflowRowId: row.id,
      customerId: row.customerId,
      energyType: row.energyType,
    });
    if (!payload) return;
    try {
      localStorage.setItem(RFP_FROM_CONTRACT_SESSION_KEY, JSON.stringify(payload));
    } catch {
      /* ignore */
    }
    setWorkflowRfpPending({ workflowRowId: row.id });
    const q = new URLSearchParams({
      fromContract: "1",
      prefillNonce: nonce,
      prefillCustomerId: row.customerId,
      prefillEnergy: row.energyType,
      workflowRowId: row.id,
    });
    window.open(`/rfp?${q.toString()}`, "_blank", "noopener,noreferrer");
  }

  const headerClass = compact ? "text-[10px] font-medium leading-tight px-1" : "text-xs font-medium";

  function renderWorkflowTable() {
    if (loading) {
      return (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      );
    }
    if (rows.length === 0) {
      return <p className="text-sm text-muted-foreground py-6">No workflow rows in this view.</p>;
    }
    if (filteredRows.length === 0) {
      return (
        <p className="text-sm text-muted-foreground py-6">No rows match your filter.</p>
      );
    }

    function renderTableHeader() {
      return (
        <TableHeader>
          <TableRow>
            <TableHead className={cn(headerClass, "w-[4.5rem] text-center")}>
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input accent-primary"
                checked={allFilteredSelected}
                onChange={toggleSelectAllFiltered}
                aria-label="Select all visible rows"
              />
            </TableHead>
            <TableHead className={cn(headerClass, "min-w-[200px]")}>Contracts</TableHead>
            <TableHead className={cn(headerClass, "text-center min-w-[100px]")}>
              Renewal Reminder
            </TableHead>
            <TableHead className={cn(headerClass, "text-center min-w-[88px]")}>Received Bills</TableHead>
            <TableHead className={cn(headerClass, "text-center min-w-[72px]")}>RFP Sent</TableHead>
            <TableHead className={cn(headerClass, "text-center min-w-[80px]")}>Quote Sent</TableHead>
            <TableHead className={cn(headerClass, "text-center min-w-[120px] leading-tight")}>
              Contract signed / received
            </TableHead>
            <TableHead className={cn(headerClass, "text-center min-w-[100px]")}>
              RFP/Quote Closed
            </TableHead>
          </TableRow>
        </TableHeader>
      );
    }

    function rfpPickerListForRow(row: WorkflowRowApi): RfpPickerRow[] {
      void rfpPickerTick;
      const etLabel =
        row.contract?.energyType === "ELECTRIC" || row.contract?.energyType === "NATURAL_GAS"
          ? row.contract.energyType
          : row.energyType ?? "NATURAL_GAS";
      const fromCache = rfpPickerCacheRef.current[WORKFLOW_RFP_COMBO_CACHE_KEY] ?? [];

      /** RFPs already linked on other rows — hide from this picker until cleared to "None". */
      const linkedOnOtherRows = new Set<string>();
      for (const r of rows) {
        if (r.id !== row.id && r.linkedRfpRequestId) {
          linkedOnOtherRows.add(r.linkedRfpRequestId);
        }
      }

      const baseList = fromCache.filter(
        (rfp) => !linkedOnOtherRows.has(rfp.id) || rfp.id === row.linkedRfpRequestId
      );

      const hasLinked = Boolean(row.linkedRfpRequestId);
      const inList = hasLinked && baseList.some((r) => r.id === row.linkedRfpRequestId);
      if (hasLinked && !inList && row.linkedRfp) {
        const lr = row.linkedRfp;
        const synthetic: RfpPickerRow = {
          id: lr.id,
          sentAt: lr.sentAt,
          createdAt: lr.sentAt ?? "",
          energyType: etLabel,
          status: "",
          accountLines: [],
        };
        return [synthetic, ...baseList];
      }
      if (hasLinked && !inList && row.linkedRfpRequestId) {
        const synthetic: RfpPickerRow = {
          id: row.linkedRfpRequestId,
          sentAt: row.linkedRfp?.sentAt ?? null,
          createdAt: row.linkedRfp?.sentAt ?? "",
          energyType: etLabel,
          status: "",
          accountLines: [],
        };
        return [synthetic, ...baseList];
      }
      return baseList;
    }

    function renderWorkflowRow(row: WorkflowRowApi, bucket: ExpiryBucket) {
      const c = row.contract;
      const refreshIso = row.lastWorkflowRefreshAt;
      const autoRfpSent = afterRefresh(row.linkedRfp?.sentAt ?? null, refreshIso);
      const rfpSent = autoRfpSent || Boolean(row.rfpSentOverrideAt);
      const autoQuoteSent = afterRefresh(row.linkedRfp?.quoteSummarySentAt ?? null, refreshIso);
      const quoteSent = autoQuoteSent || Boolean(row.quoteSummaryOverrideAt);
      const renewalDone =
        Boolean(c?.renewalReminderSentAt) || Boolean(row.renewalReminderNotApplicableAt);
      const isNewRow = !c;
      const strikethrough = row.contractOutcome === "end_pursuit";
      const rfpId = row.linkedRfpRequestId || row.linkedRfp?.id || "";
      const et =
        c?.energyType === "ELECTRIC" || c?.energyType === "NATURAL_GAS"
          ? c.energyType
          : row.energyType;
      const companyName = c
        ? (c.customer.company?.trim() || c.customer.name || "Customer")
        : (row.displayLabel?.trim() ||
            row.customer?.company?.trim() ||
            row.customer?.name ||
            "New pursuit");
      const titleLine = `${companyName} – ${energyLabelLong(et)}`;
      const acc = c ? accountsByContractId[c.id] ?? [] : [];
      const idsJoined = acc.length
        ? acc
            .map((a) => a.accountId)
            .filter(Boolean)
            .join(", ")
        : "";
      const subLine = c
        ? `(${formatExpiration(c.expirationDate)}${idsJoined ? ` · ${idsJoined}` : ""})`
        : `(New business pursuit)`;

      const canLinkSubmittedRfp = !archivedView;
      const rfpPickerRows = canLinkSubmittedRfp ? rfpPickerListForRow(row) : [];

      return (
        <TableRow
          key={row.id}
          className={cn(
            bucket === "expired" &&
              "bg-muted/65 hover:bg-muted/80 dark:bg-muted/40 dark:hover:bg-muted/55",
            strikethrough && "opacity-60",
            strikethrough && "[&_td]:line-through"
          )}
        >
          <TableCell className="text-center align-middle">
            <div className="flex items-center justify-center gap-1.5">
              <ExpiryNeonDot bucket={bucket} compact={compact} />
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 rounded border-input accent-primary"
                checked={selectedIds.has(row.id)}
                onChange={() => toggleSelect(row.id)}
                aria-label={`Select ${companyName}`}
              />
            </div>
          </TableCell>
          <TableCell className={cn(compact ? "text-[10px]" : "text-xs", "max-w-[260px]")}>
            <div className="flex items-start gap-1.5">
              {c ? (
                <button
                  type="button"
                  className="mt-0.5 shrink-0 rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="Show account IDs and service addresses"
                  onClick={() => {
                    void (async () => {
                      let lines = acc;
                      if (c && lines.length === 0) {
                        try {
                          const r = await fetch(`/api/contracts/${encodeURIComponent(c.id)}/accounts`);
                          const list = r.ok
                            ? ((await r.json()) as Array<{
                                accountId?: string;
                                ldcUtility?: string | null;
                                serviceAddress?: string | null;
                              }>)
                            : [];
                          lines = Array.isArray(list)
                            ? list.map((x) => ({
                                accountId: String(x.accountId ?? "").trim(),
                                ldcUtility: String(x.ldcUtility ?? "").trim(),
                                serviceAddress: String(x.serviceAddress ?? "").trim(),
                              }))
                            : [];
                        } catch {
                          lines = [];
                        }
                      }
                      setAccountsModal({ company: companyName, lines });
                    })();
                  }}
                >
                  <List className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
                </button>
              ) : (
                <span className="mt-0.5 w-4 shrink-0" />
              )}
              <div className="min-w-0">
                <div className="font-medium leading-tight line-clamp-2">{titleLine}</div>
                <div className="text-muted-foreground mt-0.5 line-clamp-2 text-[10px]">{subLine}</div>
              </div>
            </div>
          </TableCell>
          <TableCell className="text-center align-middle">
            {isNewRow ? (
              <span className="text-muted-foreground text-[10px]">—</span>
            ) : renewalDone ? (
              <div className="flex flex-col items-center gap-1">
                <StepCheck done compact={compact} />
                {!archivedView && !c!.renewalReminderSentAt && row.renewalReminderNotApplicableAt ? (
                  <button
                    type="button"
                    className="text-[10px] text-primary hover:underline"
                    onClick={() => void patchRow(row.id, { renewalReminderNotApplicable: false })}
                  >
                    Undo
                  </button>
                ) : null}
              </div>
            ) : archivedView ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <div className="flex flex-col items-center gap-1.5 max-w-[10rem] mx-auto">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-7 border-destructive/60 text-destructive hover:bg-destructive/10",
                    compact ? "text-[10px] px-1.5" : "text-xs"
                  )}
                  onClick={() => setRenewalContractId(c!.id)}
                >
                  <Mail className={cn("mr-1", compact ? "h-3 w-3" : "h-3.5 w-3.5")} />
                  {!compact ? "Send renewal email" : "Send"}
                </Button>
                <button
                  type="button"
                  className="text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                  onClick={() => void patchRow(row.id, { renewalReminderNotApplicable: true })}
                >
                  Not required
                </button>
              </div>
            )}
          </TableCell>
          <TableCell className="text-center align-middle">
            {archivedView ? (
              <StepCheck done={Boolean(row.receivedBillsAt)} compact={compact} />
            ) : (
              <div className="flex justify-center">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input accent-primary"
                  checked={Boolean(row.receivedBillsAt)}
                  onChange={(e) => void patchRow(row.id, { receivedBills: e.target.checked })}
                  aria-label="Received bills"
                />
              </div>
            )}
          </TableCell>
          <TableCell className="text-center align-middle">
            {archivedView ? (
              rfpSent ? (
                <div className="flex justify-center">
                  <StepCheck done compact={compact} />
                </div>
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            ) : (
              <div className="flex flex-col items-center gap-1 min-w-[7rem] max-w-[14rem] mx-auto">
                {rfpSent ? (
                  <div className="flex justify-center">
                    <StepCheck done compact={compact} />
                  </div>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className={cn("h-7", compact ? "text-[10px] px-1" : "text-xs")}
                  disabled={!c && (!row.customerId || !row.energyType)}
                  onClick={() => void (c ? openRfpFromContractRow(row) : openRfpNewBusinessRow(row))}
                >
                  <ExternalLink className={cn(compact ? "h-3 w-3" : "h-3.5 w-3.5")} />
                  {!compact && <span className="ml-1">Open RFP</span>}
                </Button>
                {canLinkSubmittedRfp ? (
                  <Select
                    key={`wf-submitted-rfp-${row.id}`}
                    value={row.linkedRfpRequestId ?? "__none__"}
                    onOpenChange={(open) => {
                      if (open) void loadRfpPickerOptions();
                    }}
                    onValueChange={(v) => {
                      if (v === "__none__") void patchRow(row.id, { linkedRfpRequestId: null });
                      else void patchRow(row.id, { linkedRfpRequestId: v });
                    }}
                  >
                    <SelectTrigger
                      onPointerDown={() => {
                        void loadRfpPickerOptions();
                      }}
                      className={cn(
                        compact ? "h-7 text-[10px]" : "h-8 text-xs",
                        "w-full min-w-0"
                      )}
                    >
                      <SelectValue placeholder="Link sent RFP" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {rfpPickerRows.map((rfp) => (
                        <SelectItem key={rfp.id} value={rfp.id}>
                          {formatRfpPickerLabel(rfp)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
                <label className="flex items-center gap-1 text-[9px] text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-input accent-primary scale-90 shrink-0"
                    checked={Boolean(row.rfpSentOverrideAt)}
                    onChange={(e) => void patchRow(row.id, { rfpSentOverride: e.target.checked })}
                    aria-label="Mark RFP sent manually"
                  />
                  <span>Mark sent (manual)</span>
                </label>
              </div>
            )}
          </TableCell>
          <TableCell className="text-center align-middle">
            <div className="flex flex-col items-center gap-1">
              <StepCheck done={quoteSent} compact={compact} />
              {rfpId && quoteSent && (
                <a
                  href={`/quotes?rfpRequestId=${encodeURIComponent(rfpId)}`}
                  className="text-[10px] text-primary hover:underline"
                >
                  Quotes
                </a>
              )}
              {!archivedView && (
                <label className="flex items-center gap-1 text-[9px] text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-input accent-primary scale-90 shrink-0"
                    checked={quoteSent}
                    disabled={autoQuoteSent && !row.quoteSummaryOverrideAt}
                    onChange={(e) => {
                      const on = e.target.checked;
                      if (on) {
                        if (!autoQuoteSent) void patchRow(row.id, { quoteSummaryOverride: true });
                      } else if (row.quoteSummaryOverrideAt) {
                        void patchRow(row.id, { quoteSummaryOverride: false });
                      }
                    }}
                    aria-label="Mark quote summary sent manually"
                  />
                  <span>Manual</span>
                </label>
              )}
            </div>
          </TableCell>
          <TableCell className="text-center align-middle">
            {archivedView ? (
              <StepCheck done={Boolean(row.newContractAmendedAt)} compact={compact} />
            ) : (
              <div className="flex flex-col items-center gap-1">
                <button
                  type="button"
                  className={cn(
                    "flex min-h-[4.5rem] w-full max-w-[9.5rem] flex-col items-center justify-center gap-1 rounded-md px-2 py-2 text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    row.newContractAmendedAt
                      ? "bg-emerald-500/10 ring-1 ring-emerald-500/45 dark:bg-emerald-500/15"
                      : "border border-dashed border-muted-foreground/35 hover:bg-muted/70"
                  )}
                  onClick={() =>
                    void patchRow(row.id, {
                      newContractAmended: !Boolean(row.newContractAmendedAt),
                    })
                  }
                  aria-pressed={Boolean(row.newContractAmendedAt)}
                  aria-label={
                    row.newContractAmendedAt
                      ? "Contract signed and received — click to clear"
                      : "Mark contract signed and received"
                  }
                >
                  <StepCheck done={Boolean(row.newContractAmendedAt)} compact={compact} />
                  <span
                    className={cn(
                      "text-[10px] leading-tight",
                      row.newContractAmendedAt
                        ? "font-medium text-emerald-700 dark:text-emerald-300"
                        : "text-muted-foreground"
                    )}
                  >
                    {row.newContractAmendedAt ? "Signed / received" : "Click to confirm"}
                  </span>
                </button>
                {c?.needsContractDetail ? (
                  <span className="text-[9px] text-amber-600 dark:text-amber-400">Stub</span>
                ) : null}
              </div>
            )}
          </TableCell>
          <TableCell className="text-center align-middle">
            {archivedView ? (
              <StepCheck done={Boolean(row.rfpQuoteClosedAt)} compact={compact} />
            ) : (
              <div className="flex flex-col items-center gap-1">
                <StepCheck done={Boolean(row.rfpQuoteClosedAt)} compact={compact} />
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-input accent-primary scale-90"
                  checked={Boolean(row.rfpQuoteClosedAt)}
                  onChange={(e) => void patchRow(row.id, { rfpQuoteClosed: e.target.checked })}
                  aria-label="RFP quote closed"
                />
              </div>
            )}
          </TableCell>
        </TableRow>
      );
    }

    return (
      <div className="w-full space-y-3">
        {visibleExpiryBuckets.length > 0 ? (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(compact ? "h-7 text-xs" : "h-8 text-xs")}
              onClick={toggleExpandAllExpiryGroups}
            >
              {allExpirySectionsExpanded ? "Collapse all groups" : "Expand all groups"}
            </Button>
          </div>
        ) : null}
        {EXPIRY_GROUP_ORDER.map((bucket) => {
          const groupRows = groupedFilteredRows[bucket];
          if (groupRows.length === 0) return null;
          const startedCount = groupRows.filter(workflowRowStarted).length;
          const open = expiryGroupsOpen[bucket];
          const chrome = expiryGroupHeaderChrome(bucket);
          return (
            <div
              key={bucket}
              className={cn(
                "rounded-lg border-2 border-foreground/40 p-[3px]",
                "dark:border-foreground/55",
                "bg-muted/25 dark:bg-muted/15"
              )}
            >
              <div
                className={cn(
                  "rounded-md border-2 border-foreground/25 overflow-hidden bg-card/30 shadow-sm",
                  "dark:border-foreground/40"
                )}
              >
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium transition-colors",
                    chrome.bar
                  )}
                  onClick={() => toggleExpiryGroup(bucket)}
                  aria-expanded={open}
                >
                  {open ? (
                    <ChevronDown className={cn("h-4 w-4 shrink-0", chrome.chevron)} />
                  ) : (
                    <ChevronRight className={cn("h-4 w-4 shrink-0", chrome.chevron)} />
                  )}
                  <span className={chrome.label}>{GROUP_LABELS[bucket]}</span>
                  <span className={cn("font-normal text-xs tabular-nums", chrome.count)}>
                    ({groupRows.length} · {startedCount} started)
                  </span>
                </button>
                {open ? (
                  <div className="overflow-x-auto border-t border-border/50">
                    <Table>
                      {renderTableHeader()}
                      <TableBody>{groupRows.map((row) => renderWorkflowRow(row, bucket))}</TableBody>
                    </Table>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const toolbar = (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 shrink-0",
        compact ? "w-full" : "justify-between"
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {!archivedView && (
          <Button
            type="button"
            size="sm"
            className={cn(compact ? "h-7 text-xs" : "h-8")}
            onClick={() => setAddOpen(true)}
          >
            <Plus className={cn("mr-1", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
            {compact ? "Add" : "Add New"}
          </Button>
        )}
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className={cn(compact ? "h-7 text-xs" : "h-8")}
          disabled={selectedIds.size === 0}
          onClick={() => setDeleteConfirmOpen(true)}
        >
          <Trash2 className={cn("mr-1", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
          Delete
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className={cn(compact ? "h-7 text-xs" : "h-8")}
          disabled={selectedIds.size === 0}
          onClick={() => void bulkSetArchived(!archivedView)}
        >
          <Archive className={cn("mr-1", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
          {archivedView ? "Restore" : "Archive"}
        </Button>
      </div>
      <Input
        className={cn(
          "max-w-md min-w-[12rem]",
          compact ? "h-7 text-xs flex-1" : "h-9 text-sm w-full sm:w-auto sm:flex-1 sm:max-w-xs"
        )}
        placeholder="Filter the list when typing"
        value={filterQuery}
        onChange={(e) => setFilterQuery(e.target.value)}
        aria-label="Filter workflow rows"
      />
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {showHeading ? (
        <div className="flex flex-col gap-3 shrink-0">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              {title ? (
                <h1 className={cn("font-semibold tracking-tight", compact ? "text-sm" : "text-xl")}>
                  {title}
                </h1>
              ) : null}
              {!compact && (
                <p className="text-sm text-muted-foreground mt-1">
                  Contracts are grouped by end date: expired (gray rows), ≤30 days (red glow), 31–90 days (gold
                  glow), 91+ days (green glow). Expand each section to work the table. Use the list icon for account
                  IDs and addresses.
                </p>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn("shrink-0", compact ? "h-7 text-xs" : "h-8")}
              onClick={() => setArchivedView((v) => !v)}
            >
              {archivedView ? "Back to active" : "View archived"}
            </Button>
          </div>
          {toolbar}
        </div>
      ) : (
        <div className="flex flex-col gap-2 shrink-0">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setArchivedView((v) => !v)}
            >
              {archivedView ? "Active" : "Archived"}
            </Button>
          </div>
          {toolbar}
        </div>
      )}

      <div className="min-h-0 flex-1">{renderWorkflowTable()}</div>

      <ContractRenewalEmailDialog
        open={renewalContractId != null}
        onOpenChange={(o) => {
          if (!o) setRenewalContractId(null);
        }}
        contractId={renewalContractId}
        onAfterSend={() => void loadRows()}
      />

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete workflow rows?"
        message={`Permanently remove ${selectedIds.size} row(s) from the workflow? This does not delete contracts or RFPs.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void bulkDelete()}
      />

      <Dialog
        open={accountsModal != null}
        onOpenChange={(o) => {
          if (!o) setAccountsModal(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Contract accounts — {accountsModal?.company}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[min(60vh,360px)] overflow-y-auto text-sm">
            {!accountsModal?.lines.length ? (
              <p className="text-muted-foreground py-4 text-sm">No accounts on file for this contract.</p>
            ) : (
              <ul className="space-y-2">
                {accountsModal.lines.map((line, i) => (
                  <li key={`${line.accountId}-${i}`} className="rounded-md border border-border/60 px-3 py-2">
                    <div className="font-mono text-xs font-medium">{line.accountId || "—"}</div>
                    {line.ldcUtility ? (
                      <div className="text-xs text-muted-foreground mt-1">Utility: {line.ldcUtility}</div>
                    ) : null}
                    {line.serviceAddress ? (
                      <div className="text-xs text-muted-foreground mt-1">{line.serviceAddress}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAccountsModal(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New contract workflow row</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid gap-2">
              <Label>Customer (CRM)</Label>
              <Select value={addCustomerId} onValueChange={setAddCustomerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select customer company…" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {companies.map((co) => (
                    <SelectItem key={co.customerId!} value={co.customerId!}>
                      {co.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Energy type</Label>
              <Select
                value={addEnergy}
                onValueChange={(v) => setAddEnergy(v as "ELECTRIC" | "NATURAL_GAS")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NATURAL_GAS">Natural gas</SelectItem>
                  <SelectItem value="ELECTRIC">Electric</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Label (optional)</Label>
              <Input
                value={addLabel}
                onChange={(e) => setAddLabel(e.target.value)}
                placeholder="Shown until a contract is linked"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!addCustomerId || addSaving}
              onClick={() => {
                setAddSaving(true);
                void fetch("/api/contract-workflow", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    customerId: addCustomerId,
                    energyType: addEnergy,
                    displayLabel: addLabel.trim() || undefined,
                  }),
                })
                  .then(async (r) => {
                    if (r.ok) {
                      setAddOpen(false);
                      setAddLabel("");
                      await loadRows();
                    }
                  })
                  .finally(() => setAddSaving(false));
              }}
            >
              {addSaving ? "Saving…" : "Create row"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
