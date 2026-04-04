"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  Plus,
  Archive,
  ChevronUp,
  ChevronDown,
  Settings,
  FileText,
  Zap,
  Flame,
  ExternalLink,
  Upload,
  Download,
  Trash2,
  Mail,
  Pencil,
  StickyNote,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  stripEnergySuffix,
  normalizeCompanyKey,
  isCustomerCandidateContact,
} from "@/lib/customers-overview";
import { ContactLabelsField } from "@/components/contact-labels-field";
import { ComposeEmailModal } from "@/components/compose-email-modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Contact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  jobTitle?: string | null;
  label?: string | null;
  customerId?: string | null;
  isPriority?: boolean;
  emails?: { email: string }[];
  phones?: { phone: string; type?: string }[];
  addresses?: { street?: string; city?: string; state?: string; zip?: string }[];
};

type Document = {
  id: string;
  name: string;
  googleDriveUrl: string | null;
  type: string;
};

type Contract = {
  id: string;
  customerId: string;
  supplierId: string;
  mainContactId: string | null;
  energyType: "ELECTRIC" | "NATURAL_GAS";
  priceUnit: string;
  pricePerUnit: { toString: () => string };
  startDate: string;
  expirationDate: string;
  termMonths: number;
  annualUsage: { toString: () => string } | null;
  avgMonthlyUsage: { toString: () => string } | null;
  brokerMargin: { toString: () => string } | null;
  customerUtility: string | null;
  signedDate: string | null;
  totalMeters: number | null;
  status: string;
  customer: { id: string; name: string; company: string | null; notes?: string | null };
  supplier: { id: string; name: string; email?: string | null; phone?: string | null; website?: string | null; address?: string | null; city?: string | null; state?: string | null; zip?: string | null };
  mainContact: Contact | null;
  documents: Document[];
  notes?: string | null;
};

/** Default form when adding a new contract (shared state must be reset when opening Add Contract). */
const EMPTY_CONTRACT_FORM = {
  customerId: "",
  supplierId: "",
  mainContactId: "",
  energyType: "NATURAL_GAS" as "ELECTRIC" | "NATURAL_GAS",
  priceUnit: "MCF",
  pricePerUnit: "",
  startDate: "",
  expirationDate: "",
  termMonths: "",
  annualUsage: "",
  avgMonthlyUsage: "",
  brokerMargin: "",
  customerUtility: "",
  signedDate: "",
  totalMeters: "",
  notes: "",
};

/** Single note per customer (stored on Customer); legacy per-contract notes still shown until migrated. */
function sharedCustomerNotes(c: Contract): string {
  const fromCustomer = c.customer?.notes;
  if (fromCustomer != null && String(fromCustomer).trim() !== "") return String(fromCustomer);
  return (c.notes ?? "") || "";
}

function escapeCsvCell(val: unknown): string {
  const s = val == null ? "" : String(val);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function dateOnlyForCsv(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function contractRateForBackupCsv(c: Contract): string {
  const raw = c.pricePerUnit;
  if (raw == null) return "";
  const n = parseFloat(String(raw));
  const pu = (c.priceUnit || "").toUpperCase();
  const suffix = pu === "KWH" ? "kwh" : pu.toLowerCase();
  if (Number.isNaN(n)) return String(raw);
  return `${n}/${suffix}`;
}

function energyTypeExportLabel(et: string): string {
  if (et === "ELECTRIC") return "Electric";
  if (et === "NATURAL_GAS") return "Natural Gas";
  return et;
}

/** Column headers aligned with Import CSV field names where possible, plus Contract ID and Status for backup. */
const CONTRACT_BACKUP_HEADERS = [
  "Contract ID",
  "Company / Customer",
  "Supplier",
  "Main Contact",
  "Notes",
  "Type of Contract",
  "Usage Type",
  "Start Date",
  "End Date",
  "Term (months)",
  "Contract Rate",
  "Annual Usage",
  "Avg Monthly Usage",
  "Broker margin",
  "Utility",
  "Contract Signed Date",
  "Meters",
  "Status",
] as const;

function buildContractsBackupCsv(contracts: Contract[]): string {
  const rows = contracts.map((c) => {
    const company = c.customer?.company || c.customer?.name || "";
    return [
      c.id,
      company,
      c.supplier?.name || "",
      c.mainContact?.name || "",
      sharedCustomerNotes(c),
      energyTypeExportLabel(c.energyType),
      c.priceUnit || "",
      dateOnlyForCsv(c.startDate),
      dateOnlyForCsv(c.expirationDate),
      String(c.termMonths ?? ""),
      contractRateForBackupCsv(c),
      c.annualUsage != null ? String(c.annualUsage) : "",
      c.avgMonthlyUsage != null ? String(c.avgMonthlyUsage) : "",
      c.brokerMargin != null ? String(c.brokerMargin) : "",
      c.customerUtility || "",
      dateOnlyForCsv(c.signedDate),
      c.totalMeters != null ? String(c.totalMeters) : "",
      c.status || "",
    ].map(escapeCsvCell);
  });
  const headerLine = CONTRACT_BACKUP_HEADERS.map(escapeCsvCell).join(",");
  const body = rows.map((r) => r.join(",")).join("\r\n");
  return `${headerLine}\r\n${body}`;
}

const COLUMN_IDS = [
  "company",
  "notes",
  "startDate",
  "endDate",
  "mainContact",
  "supplier",
  "customerUtility",
  "contractRate",
  "brokerMargin",
  "annualUsage",
  "usageType",
  "contractLength",
  "energyType",
  "estIncomePerYear",
  "estTotalValue",
  "signedDate",
  "totalMeters",
  "document",
  "actions",
] as const;

const COLUMN_LABELS: Record<string, string> = {
  company: "Company",
  startDate: "Start Date",
  endDate: "End Date",
  mainContact: "Main Contact",
  supplier: "Supplier",
  customerUtility: "Customer Utility",
  contractRate: "Contract Rate",
  brokerMargin: "Broker Margin",
  annualUsage: "Annual Usage",
  usageType: "Usage Type",
  contractLength: "Contract Length",
  energyType: "Type of Contract",
  estIncomePerYear: "Est. Income/Year",
  estTotalValue: "Est. Total Contract Value",
  signedDate: "Date Signed",
  totalMeters: "Total Meters",
  document: "Contract Doc",
  notes: "Customer notes",
  actions: "Actions",
};

const COLUMNS_STORAGE_KEY = "energia-contracts-column-order";

function getStoredColumnOrder(): string[] {
  if (typeof window === "undefined") return [...COLUMN_IDS];
  try {
    const s = localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (s) {
      const parsed = JSON.parse(s) as string[];
      if (Array.isArray(parsed)) {
        const allIds = [...COLUMN_IDS] as string[];
        const merged = [...parsed.filter((id) => allIds.includes(id))];
        allIds.forEach((id) => {
          if (!merged.includes(id)) merged.push(id);
        });
        return merged;
      }
    }
  } catch {}
  return [...COLUMN_IDS];
}

function toNum(v: { toString: () => string } | null | undefined): number {
  if (v == null) return 0;
  const n = parseFloat(String(v));
  return isNaN(n) ? 0 : n;
}

function calcEstIncomePerYear(c: Contract): number {
  const margin = toNum(c.brokerMargin);
  const annual = toNum(c.annualUsage);
  const avgMonthly = toNum(c.avgMonthlyUsage);
  const usage = annual > 0 ? annual : avgMonthly * 12;
  return margin * usage;
}

function calcEstTotalValue(c: Contract): number {
  const margin = toNum(c.brokerMargin);
  const annual = toNum(c.annualUsage);
  const avgMonthly = toNum(c.avgMonthlyUsage);
  const usage = annual > 0 ? annual : avgMonthly * 12;
  const months = c.termMonths || 12;
  return margin * (usage / 12) * months;
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
}

function formatRateOrMargin(n: number): string {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(n);
}

function formatDate(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const normalized = text.replace(/^\uFEFF/, "");
  const lines = normalized.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if (c === "," && !inQuotes) {
        result.push(current.trim().replace(/^"|"$/g, ""));
        current = "";
      } else {
        current += c;
      }
    }
    result.push(current.trim().replace(/^"|"$/g, ""));
    return result;
  };
  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const values = parseLine(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = values[i] ?? "";
    });
    return obj;
  });
  return { headers, rows };
}

const IMPORT_FIELDS = [
  { key: "company", label: "Company / Customer", required: true },
  { key: "supplier", label: "Supplier", required: true },
  { key: "mainContact", label: "Main Contact", required: false },
  { key: "notes", label: "Notes", required: false },
  { key: "contractType", label: "Type of Contract", required: false },
  { key: "usageType", label: "Usage Type (KWH/MCF/CCF/DTH or from Contract Rate)", required: false },
  { key: "startDate", label: "Start Date", required: true },
  { key: "endDate", label: "End Date", required: true },
  { key: "termMonths", label: "Term (months)", required: false },
  { key: "contractRate", label: "Contract Rate", required: true },
  { key: "annualUsage", label: "Annual Usage", required: false },
  { key: "avgMonthlyUsage", label: "Avg Monthly Usage", required: false },
  { key: "brokerMargin", label: "Broker margin", required: false },
  { key: "customerUtility", label: "Utility", required: false },
  { key: "signedDate", label: "Contract Signed Date", required: false },
  { key: "totalMeters", label: "Meters", required: false },
] as const;

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [contractIdFromQuery, setContractIdFromQuery] = useState<string | null>(null);
  const [rfpRequestIdFromQuery, setRfpRequestIdFromQuery] = useState<string | null>(null);
  const rfpCloseoutPrefillDoneRef = useRef(false);
  const [tab, setTab] = useState<"active" | "ended">("active");
  const [energyFilter, setEnergyFilter] = useState<"all" | "electric" | "gas">("all");
  const [sortCol, setSortCol] = useState("expirationDate");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [addOpen, setAddOpen] = useState(false);
  const [contactModal, setContactModal] = useState<Contact | null>(null);
  const [columnOrder, setColumnOrder] = useState<string[]>(getStoredColumnOrder);
  const [manageColumnsOpen, setManageColumnsOpen] = useState(false);
  const [linkDocContract, setLinkDocContract] = useState<Contract | null>(null);
  const [linkDocUrl, setLinkDocUrl] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<{ headers: string[]; rows: Record<string, string>[] } | null>(null);
  const [importColumnMap, setImportColumnMap] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [customers, setCustomers] = useState<{ id: string; name: string; company: string | null }[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [contacts, setContactsList] = useState<Contact[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [moveToEndedConfirmOpen, setMoveToEndedConfirmOpen] = useState(false);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [editContract, setEditContract] = useState<Contract | null>(null);
  const [notesContract, setNotesContract] = useState<Contract | null>(null);
  const [notesText, setNotesText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [supplierModal, setSupplierModal] = useState<{
    supplier: {
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      website: string | null;
      address: string | null;
      city: string | null;
      state: string | null;
      zip: string | null;
    };
    contacts: Contact[];
  } | null>(null);
  const [composeTo, setComposeTo] = useState<{ email: string; name?: string } | null>(null);
  const [contractsForSuggestions, setContractsForSuggestions] = useState<Contract[]>([]);

  const [form, setForm] = useState({ ...EMPTY_CONTRACT_FORM });

  const openAddContract = useCallback(() => {
    setForm({ ...EMPTY_CONTRACT_FORM });
    setAddOpen(true);
  }, []);

  const fetchContracts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("tab", tab);
      params.set("energy", energyFilter);
      params.set("sort", sortCol);
      params.set("order", sortOrder);
      const res = await fetch("/api/contracts?" + params.toString());
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setContracts(Array.isArray(data) ? data.filter((c: Contract, i: number, a: Contract[]) => a.findIndex((x) => x.id === c.id) === i) : []);
    } catch (err) {
      setContracts([]);
    } finally {
      setLoading(false);
    }
  }, [tab, energyFilter, sortCol, sortOrder]);

  useEffect(() => {
    fetchContracts();
  }, [fetchContracts]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    setContractIdFromQuery(sp.get("contractId"));
    setRfpRequestIdFromQuery(sp.get("rfpRequestId"));
  }, []);

  // From RFP workspace: pre-fill Add Contract from a submitted RFP (closeout).
  useEffect(() => {
    const rfpId = rfpRequestIdFromQuery;
    if (!rfpId || contractIdFromQuery || rfpCloseoutPrefillDoneRef.current || editContract) return;

    rfpCloseoutPrefillDoneRef.current = true;

    (async () => {
      try {
        const res = await fetch(`/api/rfp/${encodeURIComponent(rfpId)}`);
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || "Failed to load RFP");

        if (data.status === "draft") return;

        const lines = Array.isArray(data.accountLines) ? data.accountLines : [];
        let annualTotal = 0;
        let avgMonthlyTotal = 0;
        for (const L of lines) {
          annualTotal += Number((L as { annualUsage?: unknown }).annualUsage) || 0;
          avgMonthlyTotal += Number((L as { avgMonthlyUsage?: unknown }).avgMonthlyUsage) || 0;
        }

        const energyRaw = data.energyType;
        const energyType =
          energyRaw === "ELECTRIC" || energyRaw === "NATURAL_GAS" ? energyRaw : "NATURAL_GAS";

        const marginUnitRaw = data.brokerMarginUnit;
        const priceUnit =
          marginUnitRaw === "KWH" ||
          marginUnitRaw === "MCF" ||
          marginUnitRaw === "CCF" ||
          marginUnitRaw === "DTH"
            ? marginUnitRaw
            : energyType === "ELECTRIC"
              ? "KWH"
              : "MCF";

        const quotes = Array.isArray(data.quotes) ? data.quotes : [];
        const best = quotes.find((q: { isBestOffer?: boolean }) => q.isBestOffer);
        const supplierId =
          typeof (best as { supplierId?: string } | undefined)?.supplierId === "string"
            ? (best as { supplierId: string }).supplierId
            : "";

        setForm({
          ...EMPTY_CONTRACT_FORM,
          customerId: typeof data.customerId === "string" ? data.customerId : "",
          supplierId,
          energyType,
          priceUnit,
          brokerMargin: data.brokerMargin != null ? String(data.brokerMargin) : "",
          customerUtility: typeof data.ldcUtility === "string" ? data.ldcUtility : "",
          annualUsage: annualTotal > 0 ? String(annualTotal) : "",
          avgMonthlyUsage: avgMonthlyTotal > 0 ? String(avgMonthlyTotal) : "",
          notes:
            typeof data.notes === "string" && data.notes.trim()
              ? `From RFP closeout. ${data.notes}`
              : "From RFP closeout.",
        });
        setAddOpen(true);
      } catch (err) {
        console.error("RFP closeout prefill failed:", err);
        rfpCloseoutPrefillDoneRef.current = false;
      }
    })();
  }, [rfpRequestIdFromQuery, contractIdFromQuery, editContract]);

  useEffect(() => {
    fetch("/api/customers")
      .then((r) => r.json())
      .then((d) => setCustomers(Array.isArray(d) ? d : []));
    fetch("/api/suppliers")
      .then((r) => r.json())
      .then((d) => setSuppliers(Array.isArray(d) ? d : []));
    fetch("/api/contacts")
      .then((r) => r.json())
      .then((d) => setContactsList((d.contacts ?? d) || []));
  }, []);

  // If another page links here with `?contractId=...`, open the Edit Contract dialog.
  useEffect(() => {
    const id = contractIdFromQuery;
    if (!id) return;
    if (editContract) return;

    (async () => {
      try {
        const res = await fetch(`/api/contracts/${encodeURIComponent(id)}`);
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || "Failed to load contract");
        openEdit(data as Contract);
      } catch (err) {
        // If the param is invalid, ignore and keep the page functional.
        console.error("Failed to open contract from query:", err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractIdFromQuery]);

  useEffect(() => {
    if (!contractIdFromQuery || loading) return;
    const el = document.getElementById(`contract-row-${contractIdFromQuery}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [contractIdFromQuery, contracts, loading]);

  const refetchCustomers = useCallback(() => {
    fetch("/api/customers").then((r) => r.json()).then((d) => setCustomers(Array.isArray(d) ? d : []));
  }, []);
  const refetchSuppliers = useCallback(() => {
    fetch("/api/suppliers").then((r) => r.json()).then((d) => setSuppliers(Array.isArray(d) ? d : []));
  }, []);
  const refetchContacts = useCallback(() => {
    fetch("/api/contacts").then((r) => r.json()).then((d) => setContactsList((d.contacts ?? d) || []));
  }, []);

  useEffect(() => {
    if (!addOpen && !editContract) return;
    const params = new URLSearchParams({ energy: energyFilter, sort: sortCol, order: sortOrder });
    Promise.all([
      fetch("/api/contracts?" + params.toString() + "&tab=active").then((r) => r.json()),
      fetch("/api/contracts?" + params.toString() + "&tab=ended").then((r) => r.json()),
    ]).then(([active, ended]) => {
      const a = Array.isArray(active) ? active : [];
      const e = Array.isArray(ended) ? ended : [];
      setContractsForSuggestions([...a, ...e]);
    });
  }, [addOpen, editContract, energyFilter, sortCol, sortOrder]);

  const utilitySuggestions = useMemo(() => {
    const set = new Set<string>();
    contractsForSuggestions.forEach((c) => {
      const u = c.customerUtility;
      if (u && typeof u === "string" && u.trim()) set.add(u.trim());
    });
    return Array.from(set).sort();
  }, [contractsForSuggestions]);

  const toggleSort = (col: string) => {
    if (sortCol === col) setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortOrder("asc");
    }
  };

  const SortHeader = ({ col, label }: { col: string; label: string }) => (
    <button type="button" className="flex items-center gap-1 font-medium hover:underline" onClick={() => toggleSort(col)}>
      {label}
      {sortCol === col ? (sortOrder === "asc" ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />) : null}
    </button>
  );

  const handleAddContract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customerId || !form.supplierId) {
      alert("Please select or add a Company and Supplier.");
      return;
    }
    try {
      const res = await fetch("/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: form.customerId,
          supplierId: form.supplierId,
          mainContactId: form.mainContactId || null,
          energyType: form.energyType,
          priceUnit: form.priceUnit,
          pricePerUnit: parseFloat(form.pricePerUnit),
          startDate: form.startDate,
          expirationDate: form.expirationDate,
          termMonths: parseInt(form.termMonths, 10),
          annualUsage: form.annualUsage ? parseFloat(form.annualUsage) : null,
          avgMonthlyUsage: form.avgMonthlyUsage ? parseFloat(form.avgMonthlyUsage) : null,
          brokerMargin: form.brokerMargin ? parseFloat(form.brokerMargin) : null,
          customerUtility: form.customerUtility || null,
          signedDate: form.signedDate || null,
          totalMeters: form.totalMeters ? parseInt(form.totalMeters, 10) : null,
          notes: form.notes || null,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAddOpen(false);
      setForm({ ...EMPTY_CONTRACT_FORM });
      fetchContracts();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create contract");
    }
  };

  const handleArchive = async (id: string) => {
    try {
      await fetch(`/api/contracts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      });
      fetchContracts();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to archive");
    }
  };

  const openContactModal = async (contactId: string) => {
    try {
      const res = await fetch("/api/contacts/" + contactId);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setContactModal(data);
    } catch {
      setContactModal(null);
    }
  };

  const openSupplierModal = async (supplier: Contract["supplier"]) => {
    if (!supplier) return;
    let supplierPayload = {
      id: supplier.id,
      name: supplier.name,
      email: supplier.email ?? null,
      phone: supplier.phone ?? null,
      website: supplier.website ?? null,
      address: supplier.address ?? null,
      city: supplier.city ?? null,
      state: supplier.state ?? null,
      zip: supplier.zip ?? null,
    };

    const [resContacts, resSupplier] = await Promise.all([
      fetch(`/api/suppliers/${encodeURIComponent(supplier.id)}/contacts`),
      fetch(`/api/suppliers/${encodeURIComponent(supplier.id)}`),
    ]);

    if (resSupplier.ok) {
      const row = await resSupplier.json().catch(() => null);
      if (row && !row.error && row.id) {
        supplierPayload = {
          id: row.id,
          name: row.name ?? supplierPayload.name,
          email: row.email ?? supplierPayload.email,
          phone: row.phone ?? supplierPayload.phone,
          website: row.website ?? supplierPayload.website,
          address: row.address ?? supplierPayload.address,
          city: row.city ?? supplierPayload.city,
          state: row.state ?? supplierPayload.state,
          zip: row.zip ?? supplierPayload.zip,
        };
      }
    }

    try {
      const data = await resContacts.json().catch(() => ({}));
      if (!resContacts.ok || data.error) throw new Error(data.error || "Failed to load contacts");
      const merged = Array.isArray(data.contacts) ? data.contacts : [];
      setSupplierModal({ supplier: supplierPayload, contacts: merged });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to load supplier contacts");
      setSupplierModal({ supplier: supplierPayload, contacts: [] });
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    try {
      const res = await fetch("/api/contracts/delete-multiple", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSelectedIds(new Set());
      setDeleteConfirmOpen(false);
      fetchContracts();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const handleMoveToEnded = async () => {
    if (selectedIds.size === 0) return;
    try {
      for (const id of selectedIds) {
        await fetch(`/api/contracts/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "archived" }),
        });
      }
      setSelectedIds(new Set());
      setMoveToEndedConfirmOpen(false);
      fetchContracts();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to move to ended");
    }
  };

  const handleRestoreToActive = async () => {
    if (selectedIds.size === 0) return;
    try {
      for (const id of selectedIds) {
        await fetch(`/api/contracts/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "active" }),
        });
      }
      setSelectedIds(new Set());
      setRestoreConfirmOpen(false);
      fetchContracts();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to move to active");
    }
  };

  const openNotesDialog = (c: Contract) => {
    setNotesContract(c);
    setNotesText(sharedCustomerNotes(c));
  };

  const saveNotes = async () => {
    if (!notesContract?.customer?.id) return;
    try {
      const res = await fetch(`/api/customers/${notesContract.customer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notesText || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && !data.error) {
        setNotesContract(null);
        fetchContracts();
      } else {
        throw new Error(data.error || "Failed to save notes");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save notes");
    }
  };

  const openEdit = (c: Contract) => {
    setEditContract(c);
    setForm({
      customerId: c.customerId,
      supplierId: c.supplierId,
      mainContactId: c.mainContactId || "",
      energyType: c.energyType,
      priceUnit: c.priceUnit,
      pricePerUnit: String(c.pricePerUnit ?? ""),
      startDate: c.startDate ? new Date(c.startDate).toISOString().slice(0, 10) : "",
      expirationDate: c.expirationDate ? new Date(c.expirationDate).toISOString().slice(0, 10) : "",
      termMonths: String(c.termMonths ?? ""),
      annualUsage: c.annualUsage != null ? String(c.annualUsage) : "",
      avgMonthlyUsage: c.avgMonthlyUsage != null ? String(c.avgMonthlyUsage) : "",
      brokerMargin: c.brokerMargin != null ? String(c.brokerMargin) : "",
      customerUtility: c.customerUtility || "",
      signedDate: c.signedDate ? new Date(c.signedDate).toISOString().slice(0, 10) : "",
      totalMeters: c.totalMeters != null ? String(c.totalMeters) : "",
      notes: sharedCustomerNotes(c),
    });
  };

  const handleEditContract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editContract) return;
    if (!form.customerId || !form.supplierId) {
      alert("Please select or add a Company and Supplier.");
      return;
    }
    try {
      const res = await fetch(`/api/contracts/${editContract.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: form.customerId,
          supplierId: form.supplierId,
          mainContactId: form.mainContactId || null,
          energyType: form.energyType,
          priceUnit: form.priceUnit,
          pricePerUnit: form.pricePerUnit ? parseFloat(form.pricePerUnit) : undefined,
          startDate: form.startDate || undefined,
          expirationDate: form.expirationDate || undefined,
          termMonths: form.termMonths ? parseInt(form.termMonths, 10) : undefined,
          annualUsage: form.annualUsage ? parseFloat(form.annualUsage) : null,
          avgMonthlyUsage: form.avgMonthlyUsage ? parseFloat(form.avgMonthlyUsage) : null,
          brokerMargin: form.brokerMargin ? parseFloat(form.brokerMargin) : null,
          customerUtility: form.customerUtility || null,
          signedDate: form.signedDate || null,
          totalMeters: form.totalMeters ? parseInt(form.totalMeters, 10) : null,
          notes: form.notes || null,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setEditContract(null);
      fetchContracts();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update contract");
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size >= filteredContracts.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredContracts.map((c) => c.id)));
  };

  const handleLinkDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkDocContract) return;
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Contract ${linkDocContract.customer?.company || linkDocContract.customer?.name} - ${linkDocContract.supplier?.name}`,
          type: "CONTRACT",
          googleDriveUrl: linkDocUrl.trim() || null,
          contractId: linkDocContract.id,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setLinkDocContract(null);
      setLinkDocUrl("");
      fetchContracts();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to link document");
    }
  };

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFile(file);
    setImportPreview(null);
    setImportResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      const { headers, rows } = parseCSV(text);
      setImportPreview({ headers, rows });
      const autoMap: Record<string, string> = {};
      const hints: Record<string, string[]> = {
        company: ["company", "customer", "account", "client"],
        supplier: ["supplier", "vendor", "provider"],
        mainContact: ["main contact", "contact", "primary contact", "customer contact"],
        contractType: ["type of contract", "contract type", "energy", "type", "electric", "gas"],
        startDate: ["start", "begin", "effective", "start date"],
        endDate: ["end", "expir", "expiration", "termination", "end date"],
        contractRate: ["rate", "price", "contract rate", "price per unit"],
        termMonths: ["term", "months", "length", "contract length"],
        annualUsage: ["annual", "usage", "consumption"],
        usageType: ["usage type", "unit", "kwh", "mcf", "ccf", "dth"],
      };
      headers.forEach((h) => {
        const lower = h.toLowerCase();
        for (const [key, terms] of Object.entries(hints)) {
          if (terms.some((t) => lower.includes(t)) && !autoMap[key]) {
            autoMap[key] = h;
            break;
          }
        }
      });
      setImportColumnMap(autoMap);
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!importPreview || importPreview.rows.length === 0) return;
    setImporting(true);
    setImportResult(null);
    try {
      const res = await fetch("/api/contracts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: importPreview.rows,
          columnMap: importColumnMap,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : res.statusText || "Import failed");
      }
      if (data.error) throw new Error(data.error);
      setImportResult(data.message || `Imported ${data.created?.contracts ?? 0} contract(s).`);
      fetchContracts();
      fetch("/api/customers").then((r) => r.json()).then((d) => setCustomers(Array.isArray(d) ? d : []));
      fetch("/api/suppliers").then((r) => r.json()).then((d) => setSuppliers(Array.isArray(d) ? d : []));
      fetch("/api/contacts").then((r) => r.json()).then((d) => setContactsList((d.contacts ?? d) || []));
    } catch (err) {
      setImportResult(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const saveColumnOrder = (order: string[]) => {
    setColumnOrder(order);
    try {
      localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(order));
    } catch {}
  };

  /** Full backup: active + ended contracts (all energy types), downloaded as CSV via the browser. */
  const handleBackupContractsCsv = async () => {
    setBackupBusy(true);
    try {
      const params = new URLSearchParams({
        energy: "all",
        sort: "expirationDate",
        order: "asc",
      });
      const [activeRes, endedRes] = await Promise.all([
        fetch(`/api/contracts?${params}&tab=active`),
        fetch(`/api/contracts?${params}&tab=ended`),
      ]);
      const activeData = await activeRes.json().catch(() => null);
      const endedData = await endedRes.json().catch(() => null);
      if (!activeRes.ok || (activeData && typeof activeData === "object" && "error" in activeData)) {
        throw new Error(
          typeof activeData === "object" && activeData && "error" in activeData
            ? String((activeData as { error: string }).error)
            : "Failed to load active contracts"
        );
      }
      if (!endedRes.ok || (endedData && typeof endedData === "object" && "error" in endedData)) {
        throw new Error(
          typeof endedData === "object" && endedData && "error" in endedData
            ? String((endedData as { error: string }).error)
            : "Failed to load ended contracts"
        );
      }
      const activeArr = Array.isArray(activeData) ? (activeData as Contract[]) : [];
      const endedArr = Array.isArray(endedData) ? (endedData as Contract[]) : [];
      const byId = new Map<string, Contract>();
      for (const c of [...activeArr, ...endedArr]) {
        if (c?.id) byId.set(c.id, c);
      }
      const merged = Array.from(byId.values()).sort((a, b) => {
        const na = (a.customer?.company || a.customer?.name || "").toLowerCase();
        const nb = (b.customer?.company || b.customer?.name || "").toLowerCase();
        const cmp = na.localeCompare(nb);
        if (cmp !== 0) return cmp;
        return new Date(a.expirationDate).getTime() - new Date(b.expirationDate).getTime();
      });
      const csv = `\uFEFF${buildContractsBackupCsv(merged)}`;
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `energia-contracts-backup-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Backup failed");
    } finally {
      setBackupBusy(false);
    }
  };

  const filteredContracts = contracts.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    const company = (c.customer?.company || c.customer?.name || "").toLowerCase();
    const supplierName = (c.supplier?.name || "").toLowerCase();
    const mainContactName = (c.mainContact?.name || "").toLowerCase();
    const utility = (c.customerUtility || "").toLowerCase();
    const notes = sharedCustomerNotes(c).toLowerCase();
    return company.includes(q) || supplierName.includes(q) || mainContactName.includes(q) || utility.includes(q) || notes.includes(q);
  });
  const now = new Date();
  const isExpired = (c: Contract) => new Date(c.expirationDate) < now;
  const contractsForTotals = tab === "active" ? filteredContracts.filter((c) => !isExpired(c)) : filteredContracts;
  const totalEstIncomePerYear = contractsForTotals.reduce((sum, c) => sum + calcEstIncomePerYear(c), 0);
  const totalEstTotalValue = contractsForTotals.reduce((sum, c) => sum + calcEstTotalValue(c), 0);

  const electricCount = contracts.filter((c) => c.energyType === "ELECTRIC").length;
  const gasCount = contracts.filter((c) => c.energyType === "NATURAL_GAS").length;

  return (
    <div
      className="flex flex-col min-h-0 max-w-full overflow-hidden"
      style={{ height: "calc(100vh - 3.5rem - 3rem - 0.5rem)" }}
    >
      {/* Sticky header: title, toolbar, tabs */}
      <div className="sticky top-0 z-20 bg-background pb-2 shrink-0 border-b">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Contract Management</h1>
          <p className="text-muted-foreground">
            Manage current and past customer contracts. Filter by energy type and archive ended contracts.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Electric/Natural Gas counts: Each contract has a Type of Contract (energyType) field—either ELECTRIC or NATURAL_GAS. Counts reflect contracts in the current filtered view.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4 mt-4">
          <div className="flex items-center gap-2" title="Counts are based on each contract's Type of Contract (energyType) field: Electric = ELECTRIC, Natural Gas = NATURAL_GAS. Each contract has exactly one type.">
            <Badge variant="outline" className="gap-1">
              <Zap className="h-3 w-3" />
              Electric: {electricCount}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Flame className="h-3 w-3" />
              Natural Gas: {gasCount}
            </Badge>
          </div>
          <Select value={energyFilter} onValueChange={(v) => setEnergyFilter(v as typeof energyFilter)}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Energy type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="electric">Electric only</SelectItem>
              <SelectItem value="gas">Natural Gas only</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search company, supplier, contact..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-8"
            />
            {searchQuery.trim().length > 0 && (
              <button
                type="button"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
                title="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" title="Settings">
                <Settings className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => openAddContract()}>
                <Plus className="h-4 w-4 mr-2" />
                Add Contract
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setImportOpen(true); setImportPreview(null); setImportFile(null); setImportResult(null); }}>
                <Upload className="h-4 w-4 mr-2" />
                Import CSV
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={backupBusy}
                onClick={() => void handleBackupContractsCsv()}
                title="Download all active and ended contracts as CSV (UTF-8, Excel-friendly)."
              >
                <Download className={`h-4 w-4 mr-2 ${backupBusy ? "opacity-50" : ""}`} />
                {backupBusy ? "Preparing backup…" : "Backup to CSV"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setManageColumnsOpen(true)}>
                Manage Columns
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex gap-2 border-b mt-4 -mb-px">
          <Button
            variant={tab === "active" ? "default" : "ghost"}
            onClick={() => setTab("active")}
          >
            Active Contracts
          </Button>
          <Button
            variant={tab === "ended" ? "default" : "ghost"}
            onClick={() => setTab("ended")}
          >
            Ended Contracts
          </Button>
        </div>
      </div>

      {/* Scrollable content: fixed viewport height so scrollbars stay visible (Google Sheets style) */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden mt-4" style={{ minHeight: 0 }}>
      {tab === "active" && (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex justify-between items-center mb-4">
            <div className="flex gap-2 items-center">
              {selectedIds.size > 0 && (
                <>
                  <Button variant="outline" onClick={() => setMoveToEndedConfirmOpen(true)}>
                    <Archive className="h-4 w-4 mr-2" />
                    Move to Ended ({selectedIds.size})
                  </Button>
                  <Button variant="outline" className="text-destructive" onClick={() => setDeleteConfirmOpen(true)}>
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete ({selectedIds.size})
                  </Button>
                </>
              )}
            </div>
            <div className="flex gap-6 text-sm">
              <span>
                <strong>Total Est. Income/Year:</strong> {formatCurrency(totalEstIncomePerYear)}
              </span>
              <span>
                <strong>Total Est. Contract Value:</strong> {formatCurrency(totalEstTotalValue)}
              </span>
            </div>
          </div>

          <ContractsTable
            contracts={filteredContracts}
            loading={loading}
            sortCol={sortCol}
            sortOrder={sortOrder}
            toggleSort={toggleSort}
            SortHeader={SortHeader}
            columnOrder={columnOrder}
            isExpired={isExpired}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
            onArchive={handleArchive}
            onOpenContact={openContactModal}
            onOpenSupplier={openSupplierModal}
            onLinkDocument={setLinkDocContract}
            onEdit={openEdit}
            onNotes={openNotesDialog}
            totalEstIncomePerYear={totalEstIncomePerYear}
            totalEstTotalValue={totalEstTotalValue}
            showArchive
            onRestore={undefined}
            tableClassName="flex-1 min-h-0 ended-grid"
          />
        </div>
      )}

      {tab === "ended" && (
        <div className="flex-1 min-h-0 flex flex-col mt-4">
          <div className="flex justify-between items-center mb-4">
            {selectedIds.size > 0 && (
              <>
                <Button variant="outline" onClick={() => setRestoreConfirmOpen(true)}>
                  <Archive className="h-4 w-4 mr-2" />
                  Move to Active ({selectedIds.size})
                </Button>
                <Button variant="outline" className="text-destructive" onClick={() => setDeleteConfirmOpen(true)}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete ({selectedIds.size})
                </Button>
              </>
            )}
            <div className="flex gap-6 text-sm ml-auto">
              <span>
                <strong>Total Est. Income/Year:</strong> {formatCurrency(totalEstIncomePerYear)}
              </span>
              <span>
                <strong>Total Est. Contract Value:</strong> {formatCurrency(totalEstTotalValue)}
              </span>
            </div>
          </div>

          <ContractsTable
            contracts={filteredContracts}
            loading={loading}
            sortCol={sortCol}
            sortOrder={sortOrder}
            toggleSort={toggleSort}
            SortHeader={SortHeader}
            columnOrder={columnOrder}
            isExpired={() => true}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
            onArchive={handleArchive}
            onOpenContact={openContactModal}
            onOpenSupplier={openSupplierModal}
            onLinkDocument={setLinkDocContract}
            onEdit={undefined}
            onNotes={openNotesDialog}
            totalEstIncomePerYear={totalEstIncomePerYear}
            totalEstTotalValue={totalEstTotalValue}
            showArchive={false}
            onRestore={handleRestoreToActive}
            tableClassName="flex-1 min-h-0"
          />
        </div>
      )}
      </div>

      <AddContractDialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) setForm({ ...EMPTY_CONTRACT_FORM });
        }}
        form={form}
        setForm={setForm}
        customers={customers}
        suppliers={suppliers}
        contacts={contacts}
        onSubmit={handleAddContract}
        title="Add Contract"
        refetchCustomers={refetchCustomers}
        refetchSuppliers={refetchSuppliers}
        refetchContacts={refetchContacts}
        utilitySuggestions={utilitySuggestions}
      />
      <AddContractDialog
        open={!!editContract}
        onOpenChange={(open) => !open && setEditContract(null)}
        form={form}
        setForm={setForm}
        customers={customers}
        suppliers={suppliers}
        contacts={contacts}
        onSubmit={handleEditContract}
        title="Edit Contract"
        refetchCustomers={refetchCustomers}
        refetchSuppliers={refetchSuppliers}
        refetchContacts={refetchContacts}
        utilitySuggestions={utilitySuggestions}
      />

      <ContactDetailModal
        contact={contactModal}
        onClose={() => setContactModal(null)}
        onCompose={(email) => setComposeTo({ email, name: contactModal?.name })}
        onContactUpdated={(c) => setContactModal(c)}
      />

      <SupplierInfoModal
        supplierModal={supplierModal}
        onClose={() => setSupplierModal(null)}
        onCompose={(email, name) => setComposeTo({ email, name })}
      />

      <ComposeEmailModal
        to={composeTo}
        onClose={() => setComposeTo(null)}
        onSent={() => setComposeTo(null)}
      />

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete contracts"
        message={`Permanently delete ${selectedIds.size} selected contract(s)? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleBulkDelete}
      />
      <ConfirmDialog
        open={moveToEndedConfirmOpen}
        onOpenChange={setMoveToEndedConfirmOpen}
        title="Move to Ended"
        message={`Move ${selectedIds.size} selected contract(s) to the Ended tab? You can delete them from there if needed.`}
        confirmLabel="Move to Ended"
        variant="default"
        onConfirm={handleMoveToEnded}
      />
      <ConfirmDialog
        open={restoreConfirmOpen}
        onOpenChange={setRestoreConfirmOpen}
        title="Move to Active"
        message={`Move ${selectedIds.size} selected contract(s) back to the Active tab? Contracts with past end dates will appear with a gray background.`}
        confirmLabel="Move to Active"
        variant="default"
        onConfirm={handleRestoreToActive}
      />
      <Dialog open={!!notesContract} onOpenChange={(open) => !open && setNotesContract(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {(() => {
                const company =
                  notesContract?.customer?.company?.trim() ||
                  notesContract?.customer?.name?.trim() ||
                  "";
                return company ? `Customer notes — ${company}` : "Customer notes";
              })()}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <textarea
              className="min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={notesText}
              onChange={(e) => setNotesText(e.target.value)}
              placeholder="One note per customer — same as the Customers page. Applies to all contracts for this company."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNotesContract(null)}>Cancel</Button>
            <Button onClick={saveNotes}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={(open) => { setImportOpen(open); if (!open) setImportPreview(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Import Contracts from CSV</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Upload your CSV file. The first row should be column headers. Map your columns to the fields below.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            <strong>Usage Type:</strong> If Contract Rate contains a suffix like /mcf, /ccf, /dth, or /kwh, that value is used as Usage Type and the Usage Type column mapping is ignored for that row.
          </p>
          <div className="space-y-4 py-4">
            <div className="grid gap-2">
              <Label>CSV File</Label>
              <Input
                type="file"
                accept=".csv"
                onChange={handleImportFileChange}
              />
            </div>
            {importPreview && (
              <>
                <p className="text-sm text-muted-foreground">
                  Found {importPreview.headers.length} columns, {importPreview.rows.length} rows. Map your CSV columns:
                </p>
                <div className="grid gap-3 max-h-64 overflow-auto">
                  {IMPORT_FIELDS.map(({ key, label, required }) => (
                    <div key={key} className="flex items-center gap-2">
                      <Label className="w-48 shrink-0 text-sm">
                        {label}
                        {required && <span className="text-destructive"> *</span>}
                      </Label>
                      <Select
                        value={importColumnMap[key] || "__none__"}
                        onValueChange={(v) => setImportColumnMap((m) => ({ ...m, [key]: v === "__none__" ? "" : v }))}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Select column" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— Skip —</SelectItem>
                          {importPreview.headers.map((h) => (
                            <SelectItem key={h} value={h}>
                              {h}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
                <div className="border rounded p-2 max-h-32 overflow-auto text-xs">
                  <p className="font-medium mb-1">Preview (first 3 rows):</p>
                  <pre className="whitespace-pre-wrap">
                    {importPreview.rows.slice(0, 3).map((r, i) => (
                      <div key={i}>{JSON.stringify(r)}</div>
                    ))}
                  </pre>
                </div>
                {importResult && (
                  <div className="space-y-1">
                    <p className={`text-sm ${importResult.includes("Failed") ? "text-destructive" : "text-green-600"}`}>
                      {importResult}
                    </p>
                    {!importResult.includes("Failed") && (
                      <p className="text-xs text-muted-foreground">
                        Tip: Contracts with an end date in the past appear under the <strong>Ended Contracts</strong> tab.
                      </p>
                    )}
                  </div>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setImportOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleImport} disabled={importing || !importColumnMap.company || !importColumnMap.supplier || !importColumnMap.startDate || !importColumnMap.endDate || !importColumnMap.contractRate}>
                    {importing ? "Importing..." : "Import"}
                  </Button>
                </DialogFooter>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!linkDocContract} onOpenChange={(open) => !open && setLinkDocContract(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link Contract Document</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleLinkDocument} className="space-y-4 py-4">
            <div className="grid gap-2">
              <Label>Google Drive URL</Label>
              <Input
                placeholder="https://drive.google.com/..."
                value={linkDocUrl}
                onChange={(e) => setLinkDocUrl(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setLinkDocContract(null)}>
                Cancel
              </Button>
              <Button type="submit">Link Document</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ManageColumnsDialog
        open={manageColumnsOpen}
        onOpenChange={setManageColumnsOpen}
        columnOrder={columnOrder}
        saveColumnOrder={saveColumnOrder}
      />
    </div>
  );
}

function ManageColumnsDialog({
  open,
  onOpenChange,
  columnOrder,
  saveColumnOrder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columnOrder: string[];
  saveColumnOrder: (order: string[]) => void;
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const handleDragStart = (id: string) => {
    setDraggedId(id);
  };
  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    setDragOverId(id);
  };
  const handleDragLeave = () => setDragOverId(null);
  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    setDragOverId(null);
    if (!draggedId || draggedId === targetId) return;
    const order = columnOrder.length > 0 ? displayOrder : [...COLUMN_IDS];
    const idx = order.indexOf(draggedId);
    const targetIdx = order.indexOf(targetId);
    if (idx === -1 || targetIdx === -1) return;
    const next = [...order];
    next.splice(idx, 1);
    next.splice(targetIdx, 0, draggedId);
    const visibleSet = new Set(columnOrder);
    saveColumnOrder(next.filter((id) => visibleSet.has(id)));
    setDraggedId(null);
  };
  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  const allIds = [...COLUMN_IDS] as string[];
  const displayOrder = columnOrder.length > 0
    ? [...columnOrder.filter((id) => allIds.includes(id)), ...allIds.filter((id) => !columnOrder.includes(id))]
    : allIds;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage Columns</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground py-2">
          Drag to reorder. Check/uncheck to show or hide columns.
        </p>
        <div className="space-y-2 py-4 max-h-80 overflow-auto">
          {displayOrder.map((id) => (
            <div
              key={id}
              draggable
              onDragStart={() => handleDragStart(id)}
              onDragOver={(e) => handleDragOver(e, id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, id)}
              onDragEnd={handleDragEnd}
              className={`flex items-center gap-2 p-2 rounded border cursor-grab active:cursor-grabbing ${draggedId === id ? "opacity-50" : ""} ${dragOverId === id ? "border-primary bg-muted/50" : ""}`}
            >
              <span className="text-muted-foreground cursor-grab">⋮⋮</span>
              <label className="flex-1 flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={columnOrder.includes(id)}
                  onChange={(e) => {
                    e.stopPropagation();
                    const next = e.target.checked
                      ? [...columnOrder, id]
                      : columnOrder.filter((x) => x !== id);
                    saveColumnOrder(next);
                  }}
                  className="rounded"
                  onClick={(e) => e.stopPropagation()}
                />
                {COLUMN_LABELS[id] || id}
              </label>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ContractsTable({
  contracts,
  loading,
  sortCol,
  sortOrder,
  toggleSort,
  SortHeader,
  columnOrder,
  isExpired,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onArchive,
  onOpenContact,
  onOpenSupplier,
  onLinkDocument,
  onEdit,
  onNotes,
  totalEstIncomePerYear,
  totalEstTotalValue,
  showArchive,
  onRestore,
  tableClassName,
}: {
  contracts: Contract[];
  loading: boolean;
  sortCol: string;
  sortOrder: "asc" | "desc";
  toggleSort: (col: string) => void;
  SortHeader: React.ComponentType<{ col: string; label: string }>;
  columnOrder: string[];
  isExpired: (c: Contract) => boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onArchive: (id: string) => void;
  onOpenContact: (id: string) => void;
  onOpenSupplier: (supplier: Contract["supplier"]) => void;
  onLinkDocument: (contract: Contract) => void;
  onEdit?: (c: Contract) => void;
  onNotes: (c: Contract) => void;
  totalEstIncomePerYear: number;
  totalEstTotalValue: number;
  showArchive: boolean;
  onRestore?: (id: string) => void;
  tableClassName?: string;
}) {
  const visibleCols = columnOrder.filter((id) => id !== "actions");
  const showLightGrid = !!tableClassName && tableClassName.includes("ended-grid");

  const verticalScrollRef = useRef<HTMLDivElement>(null);
  const horizontalBarRef = useRef<HTMLDivElement>(null);
  const tableInnerRef = useRef<HTMLDivElement>(null);
  const [tableContentWidth, setTableContentWidth] = useState(0);

  useEffect(() => {
    if (!tableClassName || !tableInnerRef.current) return;
    const el = tableInnerRef.current;
    const updateWidth = () => setTableContentWidth(el.scrollWidth);
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tableClassName, contracts.length, visibleCols.length]);

  const handleHorizontalBarScroll = useCallback(() => {
    if (verticalScrollRef.current && horizontalBarRef.current) {
      verticalScrollRef.current.scrollLeft = horizontalBarRef.current.scrollLeft;
    }
  }, []);

  const tableContent = (
    <Table className="w-full min-w-max" noWrapper={!!tableClassName}>
              <TableHeader className="sticky top-0 z-10 bg-background [&_th]:bg-background [&_th]:shadow-[0_1px_0_0_hsl(var(--border))]">
                <TableRow className={showLightGrid ? "[&_th]:border-slate-300/80 dark:[&_th]:border-slate-500/70" : ""}>
                  <TableHead className="sticky left-0 z-20 w-10 min-w-[2.5rem] bg-background border-r shadow-[1px_0_0_0_hsl(var(--border))]">
                    <input
                      type="checkbox"
                      checked={contracts.length > 0 && selectedIds.size >= contracts.length}
                      ref={(el) => {
                        if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < contracts.length;
                      }}
                      onChange={onToggleSelectAll}
                      className="rounded"
                    />
                  </TableHead>
                  <TableHead className="sticky left-[2.5rem] z-20 w-10 min-w-[2.5rem] bg-background border-r shadow-[1px_0_0_0_hsl(var(--border))]" />
                  {visibleCols.map((colId, colIndex) => (
                    <TableHead
                      key={colId}
                      className={`whitespace-nowrap text-center border-r ${showLightGrid ? "border-slate-300/80 dark:border-slate-500/70" : ""} ${
                        colIndex === 0
                          ? "sticky left-[5rem] z-20 min-w-[120px] bg-background shadow-[1px_0_0_0_hsl(var(--border))]"
                          : ""
                      }`}
                    >
                      {colId === "company" && <SortHeader col="customerId" label={COLUMN_LABELS[colId] || colId} />}
                      {colId === "startDate" && <SortHeader col="startDate" label={COLUMN_LABELS[colId] || colId} />}
                      {colId === "endDate" && <SortHeader col="expirationDate" label={COLUMN_LABELS[colId] || colId} />}
                      {colId === "contractRate" && <SortHeader col="pricePerUnit" label={COLUMN_LABELS[colId] || colId} />}
                      {colId === "estIncomePerYear" && <span>{COLUMN_LABELS[colId] || colId}</span>}
                      {colId === "estTotalValue" && <span>{COLUMN_LABELS[colId] || colId}</span>}
                      {colId === "energyType" && <span>{COLUMN_LABELS[colId] || colId}</span>}
                      {!["company", "startDate", "endDate", "contractRate", "estIncomePerYear", "estTotalValue", "energyType"].includes(colId) && (
                        <span>{COLUMN_LABELS[colId] || colId}</span>
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {contracts.map((c) => {
                  const expired = isExpired(c);
                  const company = c.customer?.company || c.customer?.name || "—";
                  const estIncome = calcEstIncomePerYear(c);
                  const estTotal = calcEstTotalValue(c);
                  const doc = c.documents?.find((d) => d.type === "CONTRACT") || c.documents?.[0];

                  return (
                    <TableRow
                      id={`contract-row-${c.id}`}
                      key={c.id}
                      className={`${expired ? "bg-slate-200 dark:bg-slate-700 text-muted-foreground" : ""} ${showLightGrid ? "border-b border-slate-300/80 dark:border-slate-500/70" : ""}`}
                    >
                      <TableCell className={`sticky left-0 z-10 w-10 min-w-[2.5rem] border-r ${expired ? "bg-slate-200 dark:bg-slate-700" : "bg-background"} shadow-[1px_0_0_0_hsl(var(--border))]`}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(c.id)}
                          onChange={() => onToggleSelect(c.id)}
                          className="rounded"
                        />
                      </TableCell>
                      <TableCell className={`sticky left-[2.5rem] z-10 w-10 min-w-[2.5rem] border-r ${expired ? "bg-slate-200 dark:bg-slate-700" : "bg-background"} shadow-[1px_0_0_0_hsl(var(--border))]`}>
                        {onEdit && (
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(c)} title="Edit contract">
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                      {visibleCols.map((colId, colIndex) => (
                        <TableCell
                          key={colId}
                          className={`whitespace-nowrap border-r ${showLightGrid ? "border-slate-300/80 dark:border-slate-500/70" : ""} ${
                            colIndex === 0
                              ? `text-left sticky left-[5rem] z-10 min-w-[120px] ${
                                  expired ? "bg-slate-200 dark:bg-slate-700" : "bg-background"
                                } shadow-[1px_0_0_0_hsl(var(--border))]`
                              : "text-center"
                          }`}
                        >
                          {colId === "company" && <span className="font-medium">{company}</span>}
                          {colId === "startDate" && formatDate(c.startDate)}
                          {colId === "endDate" && formatDate(c.expirationDate)}
                          {colId === "mainContact" && (
                            c.mainContact ? (
                              <button
                                type="button"
                                className="text-primary hover:underline"
                                onClick={() => onOpenContact(c.mainContact!.id)}
                              >
                                {c.mainContact.name}
                              </button>
                            ) : (
                              "—"
                            )
                          )}
                          {colId === "supplier" && (
                            <button
                              type="button"
                              className="text-primary hover:underline"
                              onClick={() => onOpenSupplier(c.supplier)}
                            >
                              {c.supplier?.name || "—"}
                            </button>
                          )}
                          {colId === "customerUtility" && (c.customerUtility || "—")}
                          {colId === "contractRate" && "$" + formatRateOrMargin(toNum(c.pricePerUnit))}
                          {colId === "brokerMargin" && (c.brokerMargin != null ? "$" + formatRateOrMargin(toNum(c.brokerMargin)) : "—")}
                          {colId === "annualUsage" && (
                            (c.annualUsage != null ? toNum(c.annualUsage).toLocaleString() : c.avgMonthlyUsage != null ? (toNum(c.avgMonthlyUsage) * 12).toLocaleString() : "—")
                          )}
                          {colId === "usageType" && c.priceUnit}
                          {colId === "contractLength" && `${c.termMonths} mo`}
                          {colId === "energyType" && (c.energyType === "ELECTRIC" ? "Electric" : "Natural Gas")}
                          {colId === "estIncomePerYear" && formatCurrency(estIncome)}
                          {colId === "estTotalValue" && formatCurrency(estTotal)}
                          {colId === "signedDate" && formatDate(c.signedDate)}
                          {colId === "totalMeters" && (c.totalMeters != null ? c.totalMeters : "—")}
                          {colId === "document" && (
                            doc?.googleDriveUrl ? (
                              <a
                                href={doc.googleDriveUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline inline-flex items-center gap-1"
                              >
                                <FileText className="h-4 w-4" />
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-muted-foreground"
                                onClick={() => onLinkDocument(c)}
                              >
                                Link
                              </Button>
                            )
                          )}
                          {colId === "notes" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="relative h-8 w-8"
                              onClick={() => onNotes(c)}
                              title={sharedCustomerNotes(c) ? "View/edit customer notes" : "Add customer note"}
                            >
                              <StickyNote className="h-4 w-4" />
                              {sharedCustomerNotes(c) && (
                                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-background animate-pulse" title="Has note" />
                              )}
                            </Button>
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
                <TableRow className={`bg-muted/30 font-medium ${showLightGrid ? "border-b border-slate-300/80 dark:border-slate-500/70" : ""}`}>
                  <TableCell className="sticky left-0 z-10 w-10 min-w-[2.5rem] bg-muted/30 border-r shadow-[1px_0_0_0_hsl(var(--border))]" />
                  <TableCell className="sticky left-[2.5rem] z-10 w-10 min-w-[2.5rem] bg-muted/30 border-r shadow-[1px_0_0_0_hsl(var(--border))]" />
                  {visibleCols.map((colId, colIndex) => (
                    <TableCell
                      key={colId}
                      className={
                        colIndex === 0
                          ? `sticky left-[5rem] z-10 min-w-[120px] bg-muted/30 border-r ${showLightGrid ? "border-slate-300/80 dark:border-slate-500/70" : ""} shadow-[1px_0_0_0_hsl(var(--border))] text-left`
                          : `text-center border-r ${showLightGrid ? "border-slate-300/80 dark:border-slate-500/70" : ""}`
                      }
                    >
                      {colId === "estIncomePerYear" && formatCurrency(totalEstIncomePerYear)}
                      {colId === "estTotalValue" && formatCurrency(totalEstTotalValue)}
                      {colId === "company" && "Total"}
                    </TableCell>
                  ))}
                </TableRow>
              </TableBody>
            </Table>
  );

  return (
    <Card className={`w-full ${tableClassName ? "flex flex-col min-h-0 " + tableClassName : ""}`}>
      <CardContent className="p-0 flex-1 min-h-0 flex flex-col min-h-0">
        {loading ? (
          <p className="py-8 text-center text-muted-foreground">Loading...</p>
        ) : contracts.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">
            No contracts in this view.
          </p>
        ) : tableClassName ? (
          <>
            <div
              ref={verticalScrollRef}
              className="overflow-y-auto overflow-x-auto hide-scrollbar-x flex-1 min-h-0 w-full"
              style={{ height: "calc(100vh - 19rem)", minHeight: "320px" }}
            >
              <div ref={tableInnerRef} className="w-max">
                {tableContent}
              </div>
            </div>
            <div
              ref={horizontalBarRef}
              className="overflow-x-auto overflow-y-hidden flex-shrink-0 bg-muted/30"
              style={{ height: "14px" }}
              onScroll={handleHorizontalBarScroll}
            >
              <div style={{ width: tableContentWidth, height: 1 }} />
            </div>
          </>
        ) : (
          <div className="overflow-auto w-full" style={{ maxHeight: "60vh" }}>
            {tableContent}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ContactDetailModal({ contact, onClose, onCompose, onContactUpdated }: { contact: Contact | null; onClose: () => void; onCompose: (email: string) => void; onContactUpdated?: (c: Contact) => void }) {
  const [editing, setEditing] = useState(false);
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [saving, setSaving] = useState(false);

  const emails = contact?.emails?.length ? contact.emails.map((e) => e.email) : contact?.email ? [contact.email] : [];
  const phones = contact?.phones?.length ? contact.phones : contact?.phone ? [{ phone: contact.phone, type: undefined }] : [];
  const hasNoContactInfo = emails.length === 0 && phones.length === 0;

  useEffect(() => {
    if (!contact) return;
    const e = contact.emails?.length ? contact.emails[0].email : contact.email;
    const p = contact.phones?.length ? contact.phones[0].phone : contact.phone;
    setEditEmail(e || "");
    setEditPhone(p || "");
    setEditing(!e && !p);
  }, [contact?.id, contact?.email, contact?.phone, contact?.emails, contact?.phones]);

  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contact) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/contacts/${contact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: editEmail.trim() || null,
          phone: editPhone.trim() || null,
          emails: editEmail.trim() ? [{ email: editEmail.trim(), type: "work" }] : [],
          phones: editPhone.trim() ? [{ phone: editPhone.trim(), type: "work" }] : [],
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      onContactUpdated?.({ ...contact, ...data });
      setEditing(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (!contact) return null;

  return (
    <Dialog open={!!contact} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{contact.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-4 text-sm">
          {contact.company && <p><strong>Company:</strong> {contact.company}</p>}
          {contact.jobTitle && <p><strong>Title:</strong> {contact.jobTitle}</p>}
          {emails.length > 0 && (
            <div>
              <strong>Email{emails.length > 1 ? "s" : ""}:</strong>
              <ul className="list-disc list-inside mt-1">
                {emails.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          {phones.length > 0 && (
            <div>
              <strong>Phone{phones.length > 1 ? "s" : ""}:</strong>
              <ul className="list-disc list-inside mt-1">
                {phones.map((p, i) => (
                  <li key={i}>{p.phone}{p.type ? ` (${p.type})` : ""}</li>
                ))}
              </ul>
            </div>
          )}
          {contact.addresses?.map((addr, i) => (addr.street || addr.city) && (
            <p key={i}><strong>Address:</strong> {[addr.street, addr.city, addr.state, addr.zip].filter(Boolean).join(", ")}</p>
          ))}
        </div>
        {(editing || hasNoContactInfo) && (
          <form onSubmit={handleSaveContact} className="space-y-3 py-4 border-t">
            <p className="text-sm font-medium">{hasNoContactInfo ? "Add contact details" : "Edit contact details"}</p>
            <div className="grid gap-2">
              <Label>Email</Label>
              <Input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="Email" />
            </div>
            <div className="grid gap-2">
              <Label>Phone</Label>
              <Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="Phone" />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
              {!hasNoContactInfo && <Button type="button" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>}
            </div>
          </form>
        )}
        {!editing && (emails.length > 0 || phones.length > 0) && (
          <Button variant="outline" size="sm" className="mt-2" onClick={() => setEditing(true)}>Edit contact details</Button>
        )}
        <DialogFooter>
          {emails[0] && (
            <Button onClick={() => onCompose(emails[0])}>
              <Mail className="h-4 w-4 mr-2" />
              Compose Email
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SupplierInfoModal({
  supplierModal,
  onClose,
  onCompose,
}: {
  supplierModal: {
    supplier: {
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      website: string | null;
      address: string | null;
      city: string | null;
      state: string | null;
      zip: string | null;
    };
    contacts: Contact[];
  } | null;
  onClose: () => void;
  onCompose: (email: string, name?: string) => void;
}) {
  if (!supplierModal) return null;
  const { supplier, contacts } = supplierModal;

  return (
    <Dialog open={!!supplierModal} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{supplier.name}</DialogTitle>
          <p className="text-sm font-normal text-muted-foreground pt-1">
            Supplier directory record. Contacts below come from{" "}
            <a href="/contacts" className="text-primary underline inline-flex items-center gap-1">
              Contacts
              <ExternalLink className="h-3 w-3" />
            </a>{" "}
            (linked to this supplier, or same company name; customer-only labels are excluded).
          </p>
        </DialogHeader>
        <div className="space-y-3 py-4 text-sm">
          {supplier.email && (
            <div>
              <strong>Email:</strong>
              <ul className="list-disc list-inside mt-1">
                <li>{supplier.email}</li>
              </ul>
            </div>
          )}
          {supplier.phone && (
            <div>
              <strong>Phone:</strong>
              <ul className="list-disc list-inside mt-1">
                <li>{supplier.phone}</li>
              </ul>
            </div>
          )}
          {supplier.website && (
            <p><strong>Website:</strong> <a href={supplier.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{supplier.website}</a></p>
          )}
          {(supplier.address || supplier.city) && (
            <p><strong>Address:</strong> {[supplier.address, supplier.city, supplier.state, supplier.zip].filter(Boolean).join(", ")}</p>
          )}
        </div>
        <div className="space-y-3 pt-2 border-t">
          <p className="font-medium">Supplier contacts (Contacts Management)</p>
          {contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No matching contacts yet. In Contacts, link people to this supplier or set their company to match this
              supplier name (labels that are customer-only are ignored).
            </p>
          ) : (
            contacts.map((c) => {
              const emails = c.emails?.length ? c.emails.map((e) => e.email) : c.email ? [c.email] : [];
              const phones = c.phones?.length ? c.phones : c.phone ? [{ phone: c.phone, type: undefined }] : [];
              return (
                <div key={c.id} className="space-y-2 text-sm p-3 rounded-lg border">
                  <p>
                    <strong>{c.name}</strong>
                    {c.label ? (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">({c.label})</span>
                    ) : null}
                  </p>
                  {c.company && <p><strong>Company:</strong> {c.company}</p>}
                  {c.jobTitle && <p><strong>Title:</strong> {c.jobTitle}</p>}
                  {emails.length > 0 && (
                    <div>
                      <strong>Email{emails.length > 1 ? "s" : ""}:</strong>
                      <ul className="list-disc list-inside mt-1">
                        {emails.map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {phones.length > 0 && (
                    <div>
                      <strong>Phone{phones.length > 1 ? "s" : ""}:</strong>
                      <ul className="list-disc list-inside mt-1">
                        {phones.map((p, i) => (
                          <li key={i}>{p.phone}{p.type ? ` (${p.type})` : ""}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {c.addresses?.map((addr, i) => (addr.street || addr.city) && (
                    <p key={i}><strong>Address:</strong> {[addr.street, addr.city, addr.state, addr.zip].filter(Boolean).join(", ")}</p>
                  ))}
                  {emails[0] && (
                    <Button size="sm" className="mt-2" onClick={() => onCompose(emails[0], c.name)}>
                      <Mail className="h-3 w-3 mr-1" />
                      Compose Email
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </div>
        <DialogFooter>
          {supplier.email && (
            <Button onClick={() => onCompose(supplier.email!, supplier.name)}>
              <Mail className="h-4 w-4 mr-2" />
              Compose Email
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ContactCompanyOption = {
  displayName: string;
  customerId: string | null;
  primaryContactId: string | null;
};

function pickPrimaryContactIdForCustomer(customerId: string, contacts: Contact[]): string | null {
  const pool = contacts.filter(
    (c) => isCustomerCandidateContact(c.label) && c.customerId === customerId
  );
  if (pool.length === 0) return null;
  pool.sort((a, b) => {
    const pa = a.isPriority ? 1 : 0;
    const pb = b.isPriority ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return pool[0].id;
}

type ContractFormState = {
  customerId: string;
  supplierId: string;
  mainContactId: string;
  energyType: "ELECTRIC" | "NATURAL_GAS";
  priceUnit: string;
  pricePerUnit: string;
  startDate: string;
  expirationDate: string;
  termMonths: string;
  annualUsage: string;
  avgMonthlyUsage: string;
  brokerMargin: string;
  customerUtility: string;
  signedDate: string;
  totalMeters: string;
  notes: string;
};

function AddCustomerModal({
  initialCompanyName,
  initialContactName,
  labelOptions,
  onClose,
  onSubmit,
}: {
  initialCompanyName: string;
  initialContactName: string;
  labelOptions: string[];
  onClose: () => void;
  onSubmit: (
    e: React.FormEvent,
    data: {
      contactName: string;
      company: string;
      email?: string;
      phone?: string;
      label: string;
      contactNotes: string;
      customerNotes: string;
    }
  ) => void;
}) {
  const [company, setCompany] = useState(initialCompanyName);
  const [contactName, setContactName] = useState(initialContactName);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [labelsSerialized, setLabelsSerialized] = useState("customer");
  const [contactNotes, setContactNotes] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  useEffect(() => {
    setCompany(initialCompanyName);
    setContactName(initialContactName);
  }, [initialCompanyName, initialContactName]);

  return (
    <div className="absolute inset-0 z-50 bg-background flex flex-col p-4 rounded-md border overflow-y-auto">
      <h3 className="text-lg font-semibold mb-1">Add customer company &amp; main contact</h3>
      <p className="text-xs text-muted-foreground mb-3">
        Saves to <strong>Contacts</strong>, creates the <strong>Customer</strong> record for this contract, and links
        them. Same notes behavior as elsewhere in Energia (contact notes vs customer/company notes).
      </p>
      <form
        onSubmit={(e) =>
          onSubmit(e, {
            contactName,
            company,
            email,
            phone,
            label: labelsSerialized.trim() || "customer",
            contactNotes,
            customerNotes,
          })
        }
        className="space-y-3 flex-1"
      >
        <div>
          <Label>Company name *</Label>
          <Input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            required
            placeholder="As it should appear on contracts (no energy type suffix)"
          />
        </div>
        <div>
          <Label>Main contact name *</Label>
          <Input
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            required
            placeholder="Primary person at this company"
          />
        </div>
        <div>
          <Label>Email</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
        </div>
        <div>
          <Label>Phone</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" />
        </div>
        <ContactLabelsField
          value={labelsSerialized}
          onChange={setLabelsSerialized}
          presetLabels={labelOptions}
          description="Same multi-label behavior as Contacts → Add Contact."
          idPrefix="add-contract-customer-label"
        />
        <div className="grid gap-2">
          <Label>Contact notes</Label>
          <textarea
            className="min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={contactNotes}
            onChange={(e) => setContactNotes(e.target.value)}
            placeholder="Notes on this person in Contacts…"
          />
        </div>
        <div className="grid gap-2">
          <Label>Customer / company notes</Label>
          <p className="text-xs text-muted-foreground -mt-1">Stored on the Customer record (Customers page, shared across contracts).</p>
          <textarea
            className="min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={customerNotes}
            onChange={(e) => setCustomerNotes(e.target.value)}
            placeholder="Notes for this company…"
          />
        </div>
        <DialogFooter className="pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Save &amp; use for contract</Button>
        </DialogFooter>
      </form>
    </div>
  );
}

function AddContactModal({
  initialName,
  labelOptions,
  onClose,
  onSubmit,
}: {
  initialName: string;
  labelOptions: string[];
  onClose: () => void;
  onSubmit: (
    e: React.FormEvent,
    data: {
      name: string;
      company?: string;
      email?: string;
      phone?: string;
      label: string;
      notes: string;
    }
  ) => void;
}) {
  const [name, setName] = useState(initialName);
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [labelsSerialized, setLabelsSerialized] = useState("customer");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    setName(initialName);
  }, [initialName]);

  return (
    <div className="absolute inset-0 z-50 bg-background flex flex-col p-4 rounded-md border overflow-y-auto">
      <h3 className="text-lg font-semibold mb-2">Add main contact</h3>
      <p className="text-xs text-muted-foreground mb-2">
        If you set <strong>Company</strong>, the contract form will fill the Company field from it when you save.
      </p>
      <form
        onSubmit={(e) =>
          onSubmit(e, { name, company, email, phone, label: labelsSerialized.trim() || "customer", notes })
        }
        className="space-y-3 flex-1"
      >
        <div>
          <Label>Name *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Contact name" />
        </div>
        <div>
          <Label>Company</Label>
          <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company" />
        </div>
        <div>
          <Label>Email</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
        </div>
        <div>
          <Label>Phone</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" />
        </div>
        <ContactLabelsField
          value={labelsSerialized}
          onChange={setLabelsSerialized}
          presetLabels={labelOptions}
          idPrefix="add-contract-contact-label"
        />
        <div className="grid gap-2">
          <Label>Notes</Label>
          <textarea
            className="min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Contact notes…"
          />
        </div>
        <DialogFooter className="pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Add</Button>
        </DialogFooter>
      </form>
    </div>
  );
}

function AddSupplierModal({
  initialName,
  onClose,
  onSubmit,
}: {
  initialName: string;
  onClose: () => void;
  onSubmit: (e: React.FormEvent, data: { name: string; email?: string; phone?: string }) => void;
}) {
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  useEffect(() => {
    setName(initialName);
  }, [initialName]);
  return (
    <div className="absolute inset-0 z-50 bg-background flex flex-col p-4 rounded-md border">
      <h3 className="text-lg font-semibold mb-2">Add Supplier contact info</h3>
      <form
        onSubmit={(e) => onSubmit(e, { name, email, phone })}
        className="space-y-3 flex-1"
      >
        <div>
          <Label>Name *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Supplier name" />
        </div>
        <div>
          <Label>Email</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
        </div>
        <div>
          <Label>Phone</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" />
        </div>
        <DialogFooter className="pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Add</Button>
        </DialogFooter>
      </form>
    </div>
  );
}

function AddContractDialog({
  open,
  onOpenChange,
  form,
  setForm,
  customers,
  suppliers,
  contacts,
  onSubmit,
  title = "Add Contract",
  refetchCustomers,
  refetchSuppliers,
  refetchContacts,
  utilitySuggestions = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: ContractFormState;
  setForm: React.Dispatch<React.SetStateAction<ContractFormState>>;
  customers: { id: string; name: string; company: string | null }[];
  suppliers: { id: string; name: string }[];
  contacts: Contact[];
  onSubmit: (e: React.FormEvent) => void;
  title?: string;
  refetchCustomers?: () => void;
  refetchSuppliers?: () => void;
  refetchContacts?: () => void;
  utilitySuggestions?: string[];
}) {
  const [contactCompanyOptions, setContactCompanyOptions] = useState<ContactCompanyOption[]>([]);

  const loadCustomerCompanies = useCallback(() => {
    fetch("/api/contacts/customer-companies")
      .then((r) => r.json())
      .then((d) => {
        const raw = Array.isArray(d.companies) ? d.companies : [];
        setContactCompanyOptions(
          raw.map((x: { displayName: string; customerId?: string | null; primaryContactId?: string | null }) => ({
            displayName: x.displayName,
            customerId: x.customerId ?? null,
            primaryContactId: x.primaryContactId ?? null,
          }))
        );
      })
      .catch(() => setContactCompanyOptions([]));
  }, []);

  useEffect(() => {
    if (!open) return;
    loadCustomerCompanies();
  }, [open, loadCustomerCompanies]);

  const [contactLabelOptions, setContactLabelOptions] = useState<string[]>([]);
  useEffect(() => {
    if (!open) return;
    fetch("/api/contacts/label-options")
      .then((r) => r.json())
      .then((d) => setContactLabelOptions(Array.isArray(d.labels) ? d.labels : []))
      .catch(() => setContactLabelOptions([]));
  }, [open]);

  const safeContacts = Array.isArray(contacts) ? contacts : [];

  const companiesMerged = useMemo(() => {
    const list: ContactCompanyOption[] = contactCompanyOptions.map((o) => ({ ...o }));
    const keys = new Set(list.map((o) => normalizeCompanyKey(o.displayName)));
    const cur = customers.find((x) => x.id === form.customerId);
    if (cur) {
      const raw = (cur.company || cur.name || "").trim();
      const dn = stripEnergySuffix(raw) || cur.name;
      const k = normalizeCompanyKey(dn);
      if (k && !keys.has(k)) {
        list.push({
          displayName: dn,
          customerId: cur.id,
          primaryContactId: pickPrimaryContactIdForCustomer(cur.id, safeContacts),
        });
      }
    }
    return list.sort((a, b) =>
      a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" })
    );
  }, [contactCompanyOptions, customers, form.customerId, safeContacts]);

  const [companyQuery, setCompanyQuery] = useState("");
  const [supplierQuery, setSupplierQuery] = useState("");
  const [mainContactQuery, setMainContactQuery] = useState("");
  const [companyOpen, setCompanyOpen] = useState(false);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [mainContactOpen, setMainContactOpen] = useState(false);
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);
  const [addContactOpen, setAddContactOpen] = useState(false);
  const [addSupplierOpen, setAddSupplierOpen] = useState(false);
  const [addCustomerInitialCompany, setAddCustomerInitialCompany] = useState("");
  const [addCustomerInitialContact, setAddCustomerInitialContact] = useState("");
  const [addContactInitialName, setAddContactInitialName] = useState("");
  const [addSupplierInitialName, setAddSupplierInitialName] = useState("");
  const [utilityOpen, setUtilityOpen] = useState(false);
  const [signedPreviewFile, setSignedPreviewFile] = useState<File | null>(null);
  const [signedPreviewUrl, setSignedPreviewUrl] = useState("");
  const [signedObjectUrl, setSignedObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!signedPreviewFile) {
      setSignedObjectUrl(null);
      return;
    }
    const u = URL.createObjectURL(signedPreviewFile);
    setSignedObjectUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [signedPreviewFile]);

  useEffect(() => {
    if (!open) {
      setSignedPreviewFile(null);
      setSignedPreviewUrl("");
    }
  }, [open]);

  useEffect(() => {
    const fromMerged = companiesMerged.find((x) => x.customerId === form.customerId);
    if (fromMerged) {
      setCompanyQuery(fromMerged.displayName);
      return;
    }
    const c = customers.find((x) => x.id === form.customerId);
    if (c) {
      setCompanyQuery(stripEnergySuffix((c.company || c.name || "").trim()) || c.name);
      return;
    }
    if (!form.customerId) {
      setCompanyQuery("");
    }
  }, [form.customerId, companiesMerged, customers]);
  useEffect(() => {
    const s = suppliers.find((x) => x.id === form.supplierId);
    setSupplierQuery(s ? s.name : "");
  }, [form.supplierId, suppliers]);
  useEffect(() => {
    const m = safeContacts.find((x) => x.id === form.mainContactId);
    if (m) {
      setMainContactQuery(m.name);
      return;
    }
    if (!form.mainContactId) {
      setMainContactQuery("");
    }
  }, [form.mainContactId, safeContacts]);

  const customerSideContacts = useMemo(
    () => safeContacts.filter((c) => isCustomerCandidateContact(c.label)),
    [safeContacts]
  );

  const companyFiltered = companyQuery.trim()
    ? companiesMerged.filter((c) =>
        c.displayName.toLowerCase().includes(companyQuery.toLowerCase())
      )
    : companiesMerged;
  const companyExactMatch = companyFiltered.some(
    (c) => c.displayName.toLowerCase() === companyQuery.trim().toLowerCase()
  );

  const ensureCustomerId = async (opt: ContactCompanyOption): Promise<string> => {
    if (opt.customerId) return opt.customerId;
    const res = await fetch("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: opt.displayName,
        company: opt.displayName,
        email: null,
        phone: null,
      }),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json.id as string;
  };
  const supplierFiltered = supplierQuery.trim()
    ? suppliers.filter((s) => s.name.toLowerCase().includes(supplierQuery.toLowerCase()))
    : suppliers;
  const supplierExactMatch = supplierFiltered.some((s) => s.name.toLowerCase() === supplierQuery.trim().toLowerCase());
  const mainContactFiltered = mainContactQuery.trim()
    ? customerSideContacts.filter(
        (c) =>
          c.name.toLowerCase().includes(mainContactQuery.toLowerCase()) ||
          (c.company || "").toLowerCase().includes(mainContactQuery.toLowerCase())
      )
    : customerSideContacts;
  const mainContactExactMatch = mainContactFiltered.some(
    (c) => c.name.toLowerCase() === mainContactQuery.trim().toLowerCase()
  );

  const handleAddCustomer = async (
    e: React.FormEvent,
    data: {
      contactName: string;
      company: string;
      email?: string;
      phone?: string;
      label: string;
      contactNotes: string;
      customerNotes: string;
    }
  ) => {
    e.preventDefault();
    const company = data.company?.trim();
    const contactName = data.contactName?.trim();
    if (!company || !contactName) {
      alert("Company name and main contact name are required.");
      return;
    }
    const labelVal = data.label?.trim() || "customer";
    try {
      const resContact = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: contactName,
          company,
          email: data.email?.trim() || null,
          phone: data.phone?.trim() || null,
          label: labelVal,
          notes: data.contactNotes?.trim() || null,
          emails: data.email?.trim() ? [{ email: data.email.trim(), type: "work" }] : [],
          phones: data.phone?.trim() ? [{ phone: data.phone.trim(), type: "work" }] : [],
        }),
      });
      const contactJson = await resContact.json();
      if (contactJson.error) throw new Error(contactJson.error);

      const resCust = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: company,
          company,
          email: data.email?.trim() || null,
          phone: data.phone?.trim() || null,
          notes: data.customerNotes?.trim() || null,
        }),
      });
      const custJson = await resCust.json();
      if (custJson.error) throw new Error(custJson.error);

      const linkRes = await fetch(`/api/contacts/${contactJson.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: custJson.id }),
      });
      const linkJson = await linkRes.json().catch(() => ({}));
      if (!linkRes.ok || linkJson.error) throw new Error(linkJson.error || "Failed to link contact to customer");

      setForm((f) => ({
        ...f,
        customerId: custJson.id,
        mainContactId: contactJson.id,
      }));
      setCompanyQuery(stripEnergySuffix(company));
      setMainContactQuery(contactName);
      setCompanyOpen(false);
      setAddCustomerOpen(false);
      refetchCustomers?.();
      refetchContacts?.();
      loadCustomerCompanies();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to add company & contact");
    }
  };

  const handleAddSupplier = async (e: React.FormEvent, data: { name: string; email?: string; phone?: string }) => {
    e.preventDefault();
    if (!data.name.trim()) return;
    try {
      const res = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name.trim(),
          email: data.email?.trim() || null,
          phone: data.phone?.trim() || null,
        }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setForm((f) => ({ ...f, supplierId: json.id }));
      setSupplierQuery(json.name);
      setSupplierOpen(false);
      setAddSupplierOpen(false);
      refetchSuppliers?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to add supplier");
    }
  };

  const handleAddContact = async (
    e: React.FormEvent,
    data: {
      name: string;
      company?: string;
      email?: string;
      phone?: string;
      label: string;
      notes: string;
    }
  ) => {
    e.preventDefault();
    if (!data.name.trim()) return;
    const labelVal = data.label?.trim() || "customer";
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name.trim(),
          company: data.company?.trim() || null,
          email: data.email?.trim() || null,
          phone: data.phone?.trim() || null,
          label: labelVal,
          notes: data.notes?.trim() || null,
          emails: data.email ? [{ email: data.email, type: "work" }] : [],
          phones: data.phone ? [{ phone: data.phone, type: "work" }] : [],
        }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);

      const companyRaw = (json.company as string | null)?.trim();
      if (companyRaw) {
        const display = stripEnergySuffix(companyRaw);
        const custRes = await fetch("/api/customers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: display,
            company: display,
            email: data.email?.trim() || null,
            phone: data.phone?.trim() || null,
          }),
        });
        const custJson = await custRes.json();
        if (custJson.error) throw new Error(custJson.error);
        const linkRes = await fetch(`/api/contacts/${json.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customerId: custJson.id }),
        });
        const linkJson = await linkRes.json().catch(() => ({}));
        if (!linkRes.ok || linkJson.error) throw new Error(linkJson.error || "Failed to link contact to customer");
        setForm((f) => ({
          ...f,
          mainContactId: json.id,
          customerId: custJson.id,
        }));
        setCompanyQuery(display);
        refetchCustomers?.();
        loadCustomerCompanies();
      } else {
        setForm((f) => ({ ...f, mainContactId: json.id }));
      }

      setMainContactQuery(json.name);
      setMainContactOpen(false);
      setAddContactOpen(false);
      refetchContacts?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to add contact");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(96vw,72rem)] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="grid lg:grid-cols-[1fr_minmax(280px,400px)] gap-4 lg:gap-6 items-start">
          <form onSubmit={onSubmit} className="space-y-4 py-2 min-w-0">
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2 relative">
              <Label>Company *</Label>
              <p className="text-xs text-muted-foreground -mt-1">
                List comes from <strong>company names on Contacts</strong> with a customer label (clean names—no electric/gas
                suffix). Choosing a company fills <strong>Main contact</strong> with the best-matched contact (linked to that
                customer, priority, or most recent). Or pick Main contact first to fill Company. Scroll the list for more
                rows.
              </p>
              <Input
                value={companyQuery}
                onChange={(e) => {
                  setCompanyQuery(e.target.value);
                  setCompanyOpen(true);
                }}
                onFocus={() => setCompanyOpen(true)}
                onBlur={() => setTimeout(() => setCompanyOpen(false), 200)}
                placeholder="Type or select company"
              />
              {companyOpen && (
                <div
                  className="absolute z-50 top-full left-0 right-0 mt-1 border rounded-md bg-popover shadow-md max-h-[min(70vh,22rem)] overflow-y-auto overscroll-contain"
                  onMouseDown={(e) => e.preventDefault()}
                >
                  {companyFiltered.map((c) => (
                    <button
                      key={`${c.displayName}-${c.customerId ?? "new"}`}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent shrink-0"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        void (async () => {
                          try {
                            const id = await ensureCustomerId(c);
                            const mainId = c.primaryContactId || "";
                            setForm((f) => ({
                              ...f,
                              customerId: id,
                              mainContactId: mainId,
                            }));
                            setCompanyQuery(c.displayName);
                            setCompanyOpen(false);
                            refetchCustomers?.();
                            loadCustomerCompanies();
                          } catch (err) {
                            alert(err instanceof Error ? err.message : "Could not select company");
                          }
                        })();
                      }}
                    >
                      {c.displayName}
                    </button>
                  ))}
                  {companyQuery.trim() && !companyExactMatch && (
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent border-t font-medium text-primary"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setAddCustomerInitialCompany(companyQuery.trim());
                        setAddCustomerInitialContact("");
                        setAddCustomerOpen(true);
                        setCompanyOpen(false);
                      }}
                    >
                      Company not listed — add main contact &amp; company (Contacts + Customer)
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="grid gap-2 relative">
              <Label>Supplier *</Label>
              <Input
                value={supplierQuery}
                onChange={(e) => {
                  setSupplierQuery(e.target.value);
                  setSupplierOpen(true);
                }}
                onFocus={() => setSupplierOpen(true)}
                onBlur={() => setTimeout(() => setSupplierOpen(false), 200)}
                placeholder="Type or select supplier"
              />
              {supplierOpen && (
                <div
                  className="absolute z-50 top-full left-0 right-0 mt-1 border rounded-md bg-popover shadow-md max-h-[min(70vh,22rem)] overflow-y-auto overscroll-contain"
                  onMouseDown={(e) => e.preventDefault()}
                >
                  {supplierFiltered.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setForm((f) => ({ ...f, supplierId: s.id }));
                        setSupplierQuery(s.name);
                        setSupplierOpen(false);
                      }}
                    >
                      {s.name}
                    </button>
                  ))}
                  {supplierQuery.trim() && !supplierExactMatch && (
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent border-t font-medium text-primary"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setAddSupplierInitialName(supplierQuery.trim());
                        setAddSupplierOpen(true);
                        setSupplierOpen(false);
                      }}
                    >
                      Add Supplier contact info
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2 relative">
              <Label>Main Contact</Label>
              <p className="text-xs text-muted-foreground -mt-1">
                Customer-side contacts only. Selecting one fills <strong>Company</strong> when a company is set on the
                contact.
              </p>
              <Input
                value={mainContactQuery}
                onChange={(e) => {
                  setMainContactQuery(e.target.value);
                  setMainContactOpen(true);
                }}
                onFocus={() => setMainContactOpen(true)}
                onBlur={() => setTimeout(() => setMainContactOpen(false), 200)}
                placeholder="Type or select contact (optional)"
              />
              {mainContactOpen && (
                <div
                  className="absolute z-50 top-full left-0 right-0 mt-1 border rounded-md bg-popover shadow-md max-h-[min(70vh,22rem)] overflow-y-auto overscroll-contain"
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setForm((f) => ({ ...f, mainContactId: "" }));
                      setMainContactQuery("");
                      setMainContactOpen(false);
                    }}
                  >
                    None
                  </button>
                  {mainContactFiltered.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent shrink-0"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        void (async () => {
                          const companyRaw = c.company?.trim();
                          if (!companyRaw) {
                            setForm((f) => ({ ...f, mainContactId: c.id }));
                            setMainContactQuery(c.name);
                            setMainContactOpen(false);
                            return;
                          }
                          const display = stripEnergySuffix(companyRaw);
                          try {
                            let custId = c.customerId || null;
                            if (!custId) {
                              custId = await ensureCustomerId({
                                displayName: display,
                                customerId: null,
                                primaryContactId: null,
                              });
                              const linkRes = await fetch(`/api/contacts/${c.id}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ customerId: custId }),
                              });
                              const linkJson = await linkRes.json().catch(() => ({}));
                              if (!linkRes.ok || linkJson.error) {
                                throw new Error(linkJson.error || "Failed to link contact to customer");
                              }
                              refetchContacts?.();
                            }
                            setForm((f) => ({
                              ...f,
                              mainContactId: c.id,
                              customerId: custId!,
                            }));
                            setCompanyQuery(display);
                            setMainContactQuery(c.name);
                            setMainContactOpen(false);
                            refetchCustomers?.();
                            loadCustomerCompanies();
                          } catch (err) {
                            alert(err instanceof Error ? err.message : "Could not set company from contact");
                          }
                        })();
                      }}
                    >
                      {c.name}
                      {c.company ? ` (${c.company})` : ""}
                    </button>
                  ))}
                  {mainContactQuery.trim() && !mainContactExactMatch && (
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent border-t font-medium text-primary"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setAddContactInitialName(mainContactQuery.trim());
                        setAddContactOpen(true);
                        setMainContactOpen(false);
                      }}
                    >
                      Add Company/Customer contact
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="grid gap-2">
              <Label>Energy Type *</Label>
              <Select
                value={form.energyType}
                onValueChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    energyType: v as "ELECTRIC" | "NATURAL_GAS",
                    priceUnit: v === "ELECTRIC" ? "KWH" : "MCF",
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ELECTRIC">Electric</SelectItem>
                  <SelectItem value="NATURAL_GAS">Natural Gas</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Usage Type *</Label>
              <Select value={form.priceUnit} onValueChange={(v) => setForm((f) => ({ ...f, priceUnit: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="KWH">KWH (Electric)</SelectItem>
                  <SelectItem value="MCF">MCF (Gas)</SelectItem>
                  <SelectItem value="CCF">CCF (Gas)</SelectItem>
                  <SelectItem value="DTH">DTH (Gas)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Contract Rate ($/unit) *</Label>
              <Input
                type="number"
                step="any"
                value={form.pricePerUnit}
                onChange={(e) => setForm((f) => ({ ...f, pricePerUnit: e.target.value }))}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Start Date *</Label>
              <Input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label>End Date *</Label>
              <Input
                type="date"
                value={form.expirationDate}
                onChange={(e) => setForm((f) => ({ ...f, expirationDate: e.target.value }))}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Term (months) *</Label>
              <Input
                type="number"
                value={form.termMonths}
                onChange={(e) => setForm((f) => ({ ...f, termMonths: e.target.value }))}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label>Annual Usage</Label>
              <Input
                type="number"
                value={form.annualUsage}
                onChange={(e) => setForm((f) => ({ ...f, annualUsage: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Avg Monthly Usage</Label>
              <Input
                type="number"
                value={form.avgMonthlyUsage}
                onChange={(e) => setForm((f) => ({ ...f, avgMonthlyUsage: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label>Broker Margin ($/unit)</Label>
              <Input
                type="number"
                step="any"
                value={form.brokerMargin}
                onChange={(e) => setForm((f) => ({ ...f, brokerMargin: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2 relative">
              <Label>Customer Utility</Label>
              <Input
                value={form.customerUtility}
                onChange={(e) => {
                  setForm((f) => ({ ...f, customerUtility: e.target.value }));
                  setUtilityOpen(true);
                }}
                onFocus={() => setUtilityOpen(true)}
                onBlur={() => setTimeout(() => setUtilityOpen(false), 200)}
                placeholder="Type or select utility"
              />
              {utilityOpen && utilitySuggestions.length > 0 && (
                <div
                  className="absolute z-50 top-full left-0 right-0 mt-1 border rounded-md bg-popover shadow-md max-h-[min(70vh,22rem)] overflow-y-auto overscroll-contain"
                  onMouseDown={(e) => e.preventDefault()}
                >
                  {utilitySuggestions
                    .filter((u) => !form.customerUtility || u.toLowerCase().includes(form.customerUtility.toLowerCase()))
                    .map((u) => (
                      <button
                        key={u}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-accent"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setForm((f) => ({ ...f, customerUtility: u }));
                          setUtilityOpen(false);
                        }}
                      >
                        {u}
                      </button>
                    ))}
                </div>
              )}
            </div>
            <div className="grid gap-2">
              <Label>Date Signed</Label>
              <Input
                type="date"
                value={form.signedDate}
                onChange={(e) => setForm((f) => ({ ...f, signedDate: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Total Meters</Label>
              <Input
                type="number"
                value={form.totalMeters}
                onChange={(e) => setForm((f) => ({ ...f, totalMeters: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Customer notes</Label>
            <p className="text-xs text-muted-foreground -mt-1">Shared with the Customers page — one note for this company across all contracts.</p>
            <textarea
              className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{title === "Edit Contract" ? "Save" : "Add Contract"}</Button>
          </DialogFooter>
        </form>

        <aside className="space-y-3 border-t lg:border-t-0 lg:border-l border-border/60 pt-4 lg:pt-0 lg:pl-4">
          <div>
            <Label>Signed contract preview</Label>
            <p className="text-xs text-muted-foreground mt-1">
              PDF or PNG from disk, or a document / Drive URL. For on-screen review only unless you attach via contract
              documents elsewhere.
            </p>
          </div>
          <Input
            type="file"
            accept=".pdf,image/png,image/jpeg,application/pdf"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setSignedPreviewFile(f);
              if (f) setSignedPreviewUrl("");
            }}
          />
          <Input
            placeholder="https://… document link"
            value={signedPreviewUrl}
            onChange={(e) => {
              setSignedPreviewUrl(e.target.value);
              if (e.target.value.trim()) setSignedPreviewFile(null);
            }}
          />
          {(() => {
            const url = (signedObjectUrl || signedPreviewUrl.trim()) as string;
            if (!url) return null;
            const nameOrUrl = (signedPreviewFile?.name || signedPreviewUrl || url).toLowerCase();
            const isPdf =
              nameOrUrl.endsWith(".pdf") ||
              (signedPreviewFile?.type || "").includes("pdf") ||
              url.toLowerCase().includes(".pdf");
            if (isPdf) {
              return (
                <iframe
                  title="Contract PDF preview"
                  className="w-full h-[min(52vh,520px)] rounded-md border bg-muted/20"
                  src={url}
                />
              );
            }
            return (
              <img
                src={url}
                alt="Contract preview"
                className="w-full max-h-[min(52vh,520px)] object-contain rounded-md border bg-muted/20"
              />
            );
          })()}
        </aside>
        </div>

        {/* Add Customer overlay */}
        {addCustomerOpen && (
          <AddCustomerModal
            initialCompanyName={addCustomerInitialCompany}
            initialContactName={addCustomerInitialContact}
            labelOptions={contactLabelOptions}
            onClose={() => setAddCustomerOpen(false)}
            onSubmit={handleAddCustomer}
          />
        )}
        {addContactOpen && (
          <AddContactModal
            initialName={addContactInitialName}
            labelOptions={contactLabelOptions}
            onClose={() => setAddContactOpen(false)}
            onSubmit={handleAddContact}
          />
        )}
        {addSupplierOpen && (
          <AddSupplierModal
            initialName={addSupplierInitialName}
            onClose={() => setAddSupplierOpen(false)}
            onSubmit={handleAddSupplier}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
