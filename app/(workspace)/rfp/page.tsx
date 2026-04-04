"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Calculator,
  ChevronDown,
  ChevronRight,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  Mail,
  RefreshCw,
  RotateCcw,
  Send,
  Table2,
  Upload,
  UserPlus,
  X,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ContactLabelsField } from "@/components/contact-labels-field";
import { formatContactLabels, parseContactLabels } from "@/lib/contact-labels";
import {
  filterSupplierContactsForRfpEnergy,
  pickDefaultSupplierContactId,
} from "@/lib/supplier-rfp-contacts";

type EnergyType = "ELECTRIC" | "NATURAL_GAS";
type EnergyChoice = "" | EnergyType;
type PriceUnit = "KWH" | "MCF" | "CCF" | "DTH";
type RequestedTerm = "12" | "24" | "36" | "NYMEX";

type CustomerCompanyOption = {
  id: string;
  displayName: string;
  customerId: string | null;
  primaryContactId: string | null;
  contacts?: Array<{
    id: string;
    customerId: string | null;
    name: string;
    email: string | null;
    phone: string | null;
    label: string | null;
  }>;
};

type SupplierOption = {
  id: string;
  name: string;
  email: string | null;
  isElectric: boolean;
  isNaturalGas: boolean;
  contactLinks?: Array<{
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    isPriority: boolean;
    label: string | null;
    company: string | null;
  }>;
};

type AccountLine = {
  id: string;
  accountNumber: string;
  serviceAddress: string;
  annualUsage: string;
  avgMonthlyUsage: string;
};

type DrivePickerKind = "bill" | "summary" | "reference";

type DriveFileOption = {
  id: string;
  name: string;
  mimeType: string | null;
  webViewLink: string | null;
  modifiedTime: string | null;
  parents?: string[];
  isFolder?: boolean;
  size?: number | null;
  ownerName?: string | null;
};

type DriveBreadcrumb = {
  id: string;
  name: string;
};

type SelectedDocumentKind = "bill" | "summary";

type EmailPreview = {
  subject: string;
  text: string;
  html: string;
  recipientPreview: Array<{
    supplierName: string;
    contactName: string;
    email: string;
  }>;
};

type RecentRfp = {
  id: string;
  status: string;
  energyType: EnergyType;
  requestedTerms: unknown;
  quoteDueDate: string | null;
  ldcUtility: string | null;
  sentAt?: string | null;
  parentRfpId?: string | null;
  refreshSequence?: number;
  quoteSummarySentAt?: string | null;
  customer: { name: string; company: string | null };
  suppliers: Array<{ id: string; name: string }>;
  accountLines: Array<{ accountNumber: string; annualUsage: string; avgMonthlyUsage: string }>;
};

function defaultCustomerContactLabels(energy: EnergyChoice): string {
  const parts: string[] = ["customer"];
  if (energy === "NATURAL_GAS") parts.push("gas");
  if (energy === "ELECTRIC") parts.push("electric");
  return formatContactLabels(parts);
}

const RFP_WIP_STORAGE_KEY = "energia-rfp-wip-v2";

const TERM_OPTIONS: RequestedTerm[] = ["12", "24", "36", "NYMEX"];
const UTILITY_OPTIONS = [
  "AEP Ohio",
  "AES Ohio",
  "CenterPoint Energy",
  "Columbia Gas",
  "Consumers Energy",
  "DTE Energy",
  "Duke Energy Ohio",
  "Dominion Energy Ohio",
  "FirstEnergy Ohio Edison",
  "FirstEnergy Toledo Edison",
  "National Fuel",
  "NIPSCO",
  "Nicor Gas",
  "Peoples Gas",
];

const emptyAccountLine = (): AccountLine => ({
  id: crypto.randomUUID(),
  accountNumber: "",
  serviceAddress: "",
  annualUsage: "",
  avgMonthlyUsage: "",
});

const emptyCustomerDraft = {
  customerName: "",
  company: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  notes: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  contactLabel: "",
};

function validateCustomTermsInput(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const parts = t.split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    if (!/^\d+$/.test(p)) {
      return `Invalid custom term "${p}" — use whole numbers separated by commas (e.g. 18, 30).`;
    }
    const n = Number.parseInt(p, 10);
    if (n <= 0) return "Custom term months must be positive integers.";
  }
  return null;
}

function mapDbTermsToRequestedTerms(rt: unknown): RequestedTerm[] {
  const out: RequestedTerm[] = [];
  if (!Array.isArray(rt)) return ["12", "24"];
  for (const entry of rt) {
    const e = entry as { kind?: string; months?: number };
    if (e?.kind === "nymex") out.push("NYMEX");
    if (e?.kind === "months" && typeof e.months === "number") {
      const m = e.months;
      if (m === 12 || m === 24 || m === 36) out.push(String(m) as RequestedTerm);
    }
  }
  return out.length ? [...new Set(out)] : ["12", "24"];
}

function mapDbTermsToCustomMonthsString(rt: unknown): string {
  if (!Array.isArray(rt)) return "";
  const nums: number[] = [];
  for (const entry of rt) {
    const e = entry as { kind?: string; months?: number };
    if (e?.kind === "months" && typeof e.months === "number") {
      const m = e.months;
      if (m !== 12 && m !== 24 && m !== 36) nums.push(m);
    }
  }
  return [...new Set(nums)].sort((a, b) => a - b).join(", ");
}

export default function RfpGeneratorPage() {
  const [customerCompanies, setCustomerCompanies] = useState<CustomerCompanyOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [recentRfqs, setRecentRfqs] = useState<RecentRfp[]>([]);
  const [loading, setLoading] = useState(true);

  const [customerCompanyId, setCustomerCompanyId] = useState("");
  const [customerCompanySearch, setCustomerCompanySearch] = useState("");
  const [customerCompanyDropdownOpen, setCustomerCompanyDropdownOpen] = useState(false);
  const [customerContactId, setCustomerContactId] = useState("");
  const [energyType, setEnergyType] = useState<EnergyChoice>("");
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<string[]>([]);
  const [selectedSupplierContactIds, setSelectedSupplierContactIds] = useState<Record<string, string>>({});
  const [requestedTerms, setRequestedTerms] = useState<RequestedTerm[]>(["12", "24"]);
  const [customTermMonths, setCustomTermMonths] = useState("");
  const [contractStartValue, setContractStartValue] = useState("");
  const [quoteDueDate, setQuoteDueDate] = useState("");
  const [googleDriveFolderUrl, setGoogleDriveFolderUrl] = useState("");
  const [summarySpreadsheetUrl, setSummarySpreadsheetUrl] = useState("");
  const [ldcUtility, setLdcUtility] = useState("");
  const [ldcUtilitySearch, setLdcUtilitySearch] = useState("");
  const [ldcUtilityDropdownOpen, setLdcUtilityDropdownOpen] = useState(false);
  const [brokerMargin, setBrokerMargin] = useState("");
  const [brokerMarginUnit, setBrokerMarginUnit] = useState<PriceUnit>("MCF");
  const [notes, setNotes] = useState("");
  const [accountLines, setAccountLines] = useState<AccountLine[]>([emptyAccountLine()]);
  const [marginCalculatorOpen, setMarginCalculatorOpen] = useState(false);
  const [calculatorMargin, setCalculatorMargin] = useState("");
  const [drivePickerOpen, setDrivePickerOpen] = useState(false);
  const [drivePickerKind, setDrivePickerKind] = useState<DrivePickerKind>("bill");
  const [drivePickerQuery, setDrivePickerQuery] = useState("");
  const [drivePickerLoading, setDrivePickerLoading] = useState(false);
  const [drivePickerError, setDrivePickerError] = useState("");
  const [driveFiles, setDriveFiles] = useState<DriveFileOption[]>([]);
  const [driveBreadcrumbs, setDriveBreadcrumbs] = useState<DriveBreadcrumb[]>([]);
  const [driveCurrentFolderId, setDriveCurrentFolderId] = useState("");
  const [driveSort, setDriveSort] = useState<"name" | "modified" | "size">("name");
  const [localBillFile, setLocalBillFile] = useState<File | null>(null);
  const [localSummaryFile, setLocalSummaryFile] = useState<File | null>(null);
  const [selectedBillDriveFileId, setSelectedBillDriveFileId] = useState("");
  const [selectedSummaryDriveFileId, setSelectedSummaryDriveFileId] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState<EmailPreview | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [testingEmail, setTestingEmail] = useState(false);

  const [sending, setSending] = useState(false);
  const [sendConfirmOpen, setSendConfirmOpen] = useState(false);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [reissueParentRfpId, setReissueParentRfpId] = useState<string | null>(null);
  const [contactRecordCustomerId, setContactRecordCustomerId] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [utilityTableModalOpen, setUtilityTableModalOpen] = useState(false);
  const [customTermsError, setCustomTermsError] = useState("");
  const [testEmailFoundId, setTestEmailFoundId] = useState<string | null>(null);
  const [testEmailViewOpen, setTestEmailViewOpen] = useState(false);
  const [newSupplierContact, setNewSupplierContact] = useState<{
    supplierId: string;
    supplierName: string;
    name: string;
    email: string;
    saving: boolean;
  } | null>(null);
  const [result, setResult] = useState<{ success?: boolean; sentTo?: number; error?: string } | null>(null);

  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [customerDraft, setCustomerDraft] = useState(emptyCustomerDraft);
  const [focusRfpId, setFocusRfpId] = useState("");
  const [attachContactCustomerId, setAttachContactCustomerId] = useState<string | null>(null);
  const [contactLabelPresets, setContactLabelPresets] = useState<string[]>([]);
  const [rfpTestEmailOk, setRfpTestEmailOk] = useState(false);
  const localBillInputRef = useRef<HTMLInputElement>(null);
  const localSummaryInputRef = useRef<HTMLInputElement>(null);
  const customerCompanyInputRef = useRef<HTMLInputElement>(null);
  const ldcUtilityInputRef = useRef<HTMLInputElement>(null);
  const skipNextWipPersist = useRef(false);

  useEffect(() => {
    void loadPageData();
  }, []);

  useEffect(() => {
    setLdcUtilitySearch(ldcUtility);
  }, [ldcUtility]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(RFP_WIP_STORAGE_KEY);
      if (!raw || skipNextWipPersist.current) return;
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (data.version !== 2) return;
      if (typeof data.customerCompanyId === "string") setCustomerCompanyId(data.customerCompanyId);
      if (typeof data.customerContactId === "string") setCustomerContactId(data.customerContactId);
      if (data.energyType === "ELECTRIC" || data.energyType === "NATURAL_GAS") setEnergyType(data.energyType);
      if (Array.isArray(data.selectedSupplierIds)) setSelectedSupplierIds(data.selectedSupplierIds.map(String));
      if (data.selectedSupplierContactIds && typeof data.selectedSupplierContactIds === "object") {
        setSelectedSupplierContactIds(data.selectedSupplierContactIds as Record<string, string>);
      }
      if (Array.isArray(data.requestedTerms)) setRequestedTerms(data.requestedTerms as RequestedTerm[]);
      if (typeof data.customTermMonths === "string") setCustomTermMonths(data.customTermMonths);
      if (typeof data.contractStartValue === "string") setContractStartValue(data.contractStartValue);
      if (typeof data.quoteDueDate === "string") setQuoteDueDate(data.quoteDueDate);
      if (typeof data.googleDriveFolderUrl === "string") setGoogleDriveFolderUrl(data.googleDriveFolderUrl);
      if (typeof data.summarySpreadsheetUrl === "string") setSummarySpreadsheetUrl(data.summarySpreadsheetUrl);
      if (typeof data.ldcUtility === "string") setLdcUtility(data.ldcUtility);
      if (typeof data.brokerMargin === "string") setBrokerMargin(data.brokerMargin);
      if (data.brokerMarginUnit === "KWH" || data.brokerMarginUnit === "MCF" || data.brokerMarginUnit === "CCF" || data.brokerMarginUnit === "DTH") {
        setBrokerMarginUnit(data.brokerMarginUnit);
      }
      if (typeof data.notes === "string") setNotes(data.notes);
      if (Array.isArray(data.accountLines)) {
        setAccountLines(
          (data.accountLines as AccountLine[]).map((line) => ({
            ...line,
            id: line.id || crypto.randomUUID(),
          }))
        );
      }
      if (typeof data.selectedBillDriveFileId === "string") setSelectedBillDriveFileId(data.selectedBillDriveFileId);
      if (typeof data.selectedSummaryDriveFileId === "string") setSelectedSummaryDriveFileId(data.selectedSummaryDriveFileId);
      if (typeof data.activeDraftId === "string") setActiveDraftId(data.activeDraftId);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (loading) return;
    const t = window.setTimeout(() => {
      if (skipNextWipPersist.current) {
        skipNextWipPersist.current = false;
        return;
      }
      localStorage.setItem(
        RFP_WIP_STORAGE_KEY,
        JSON.stringify({
          version: 2,
          customerCompanyId,
          customerContactId,
          energyType,
          selectedSupplierIds,
          selectedSupplierContactIds,
          requestedTerms,
          customTermMonths,
          contractStartValue,
          quoteDueDate,
          googleDriveFolderUrl,
          summarySpreadsheetUrl,
          ldcUtility,
          brokerMargin,
          brokerMarginUnit,
          notes,
          accountLines,
          selectedBillDriveFileId,
          selectedSummaryDriveFileId,
          activeDraftId,
        })
      );
    }, 400);
    return () => window.clearTimeout(t);
  }, [
    loading,
    customerCompanyId,
    customerContactId,
    energyType,
    selectedSupplierIds,
    selectedSupplierContactIds,
    requestedTerms,
    customTermMonths,
    contractStartValue,
    quoteDueDate,
    googleDriveFolderUrl,
    summarySpreadsheetUrl,
    ldcUtility,
    brokerMargin,
    brokerMarginUnit,
    notes,
    accountLines,
    selectedBillDriveFileId,
    selectedSummaryDriveFileId,
    activeDraftId,
  ]);

  useEffect(() => {
    if (!rfpTestEmailOk || testEmailFoundId) return;
    const started = Date.now();
    const iv = window.setInterval(() => {
      if (Date.now() - started > 120_000) {
        window.clearInterval(iv);
        return;
      }
      void (async () => {
        try {
          const q = encodeURIComponent("subject:[TEST]");
          const r = await fetch(`/api/emails?maxResults=30&labelIds=INBOX&q=${q}`);
          const data = await r.json();
          const msgs = Array.isArray(data?.messages) ? data.messages : [];
          const hit = msgs.find(
            (m: { subject?: string }) => typeof m?.subject === "string" && m.subject.toLowerCase().includes("[test]")
          ) as { id: string } | undefined;
          if (hit?.id) {
            setTestEmailFoundId(hit.id);
            window.clearInterval(iv);
          }
        } catch {
          /* ignore */
        }
      })();
    }, 3000);
    return () => window.clearInterval(iv);
  }, [rfpTestEmailOk, testEmailFoundId]);

  useEffect(() => {
    void fetch("/api/contacts/label-options")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data?.labels)) setContactLabelPresets(data.labels as string[]);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setRfpTestEmailOk(false);
  }, [customerCompanyId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const fromUrl = new URL(window.location.href).searchParams.get("rfpRequestId") || "";
    setFocusRfpId(fromUrl);
  }, []);

  const eligibleSuppliers = useMemo(() => {
    if (!energyType) return [];
    return suppliers
      .filter((supplier) => {
        const forEnergy = filterSupplierContactsForRfpEnergy(supplier.contactLinks ?? [], energyType);
        return forEnergy.length > 0;
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [suppliers, energyType]);

  useEffect(() => {
    if (energyType) setBrokerMarginUnit(defaultMarginUnitForEnergy(energyType));
  }, [energyType]);

  useEffect(() => {
    setSelectedSupplierIds((prev) => {
      const eligibleIds = eligibleSuppliers.map((s) => s.id);
      const setEl = new Set(eligibleIds);
      const kept = prev.filter((id) => setEl.has(id));
      const added = eligibleIds.filter((id) => !prev.includes(id));
      return [...kept, ...added];
    });
  }, [eligibleSuppliers]);

  useEffect(() => {
    if (!energyType) {
      setSelectedSupplierContactIds({});
      return;
    }
    const et = energyType;
    setSelectedSupplierContactIds((current) => {
      const next: Record<string, string> = {};
      for (const supplier of eligibleSuppliers) {
        const forEnergy = filterSupplierContactsForRfpEnergy(supplier.contactLinks ?? [], et);
        if (forEnergy.length === 0) continue;
        const existing = current[supplier.id];
        if (existing && forEnergy.some((c) => c.id === existing)) {
          next[supplier.id] = existing;
        } else {
          next[supplier.id] = pickDefaultSupplierContactId(forEnergy);
        }
      }
      return next;
    });
  }, [eligibleSuppliers, energyType]);

  useEffect(() => {
    const selectedCustomer = customerCompanies.find((customer) => customer.id === customerCompanyId);
    const firstContactId = selectedCustomer?.primaryContactId || selectedCustomer?.contacts?.[0]?.id || "";
    setCustomerContactId((current) =>
      selectedCustomer?.contacts?.some((contact) => contact.id === current) ? current : firstContactId
    );
  }, [customerCompanyId, customerCompanies]);

  useEffect(() => {
    const selectedCompany = customerCompanies.find((customer) => customer.id === customerCompanyId);
    if (!selectedCompany) return;
    setCustomerCompanySearch(selectedCompany.displayName);
  }, [customerCompanyId, customerCompanies]);

  useEffect(() => {
    if (!customerContactId) {
      setContactRecordCustomerId(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/contacts/${encodeURIComponent(customerContactId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((row: { customerId?: string | null } | null) => {
        if (cancelled) return;
        const cid =
          row && typeof row.customerId === "string" && row.customerId.trim()
            ? row.customerId.trim()
            : null;
        setContactRecordCustomerId(cid);
      })
      .catch(() => {
        if (!cancelled) setContactRecordCustomerId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [customerContactId]);

  const suppliersMissingEnergyLabels = useMemo(
    () =>
      suppliers.filter((supplier) => {
        const supplierTagged = supplier.contactLinks?.some((contact) =>
          parseLabelTokens(contact.label).includes("supplier")
        );
        const hasEnergyLabel = supplier.contactLinks?.some((contact) => {
          const labels = parseLabelTokens(contact.label);
          return labels.includes("gas") || labels.includes("electric");
        });
        return Boolean(supplierTagged && !hasEnergyLabel);
      }),
    [suppliers]
  );

  const selectedCustomer = customerCompanies.find((customer) => customer.id === customerCompanyId) ?? null;
  const customerContacts = selectedCustomer?.contacts ?? [];
  const selectedCustomerHasContacts = customerContacts.length > 0;
  const selectedCustomerNeedsSetup = Boolean(selectedCustomer && !selectedCustomerHasContacts);
  const resolvedCustomerIdForValidation =
    selectedCustomer?.customerId ||
    customerContacts.find((contact) => contact.id === customerContactId)?.customerId ||
    contactRecordCustomerId ||
    "";
  const filteredCustomerCompanies = useMemo(() => {
    const query = customerCompanySearch.trim().toLowerCase();
    if (!query) return customerCompanies;
    return customerCompanies.filter((customer) => {
      const label = customer.displayName.toLowerCase();
      if (label.startsWith(query)) return true;
      return label.split(/\s+/).some((part) => part.startsWith(query));
    });
  }, [customerCompanies, customerCompanySearch]);
  const suppliersTableRows = useMemo(() => {
    if (!energyType) return [];
    const et = energyType;
    return eligibleSuppliers.map((supplier) => {
      const all = supplier.contactLinks ?? [];
      const contacts = filterSupplierContactsForRfpEnergy(all, et);
      const defaultId = pickDefaultSupplierContactId(contacts);
      const selectedContactId = selectedSupplierContactIds[supplier.id] || defaultId || "";
      const selectedContact = contacts.find((c) => c.id === selectedContactId) || null;
      return {
        supplier,
        contacts,
        selectedContact,
        selectedContactId,
      };
    });
  }, [eligibleSuppliers, energyType, selectedSupplierContactIds]);

  const draftRfqs = useMemo(() => recentRfqs.filter((r) => r.status === "draft"), [recentRfqs]);
  const submittedRfqs = useMemo(() => recentRfqs.filter((r) => r.status !== "draft"), [recentRfqs]);

  const contractStartMonth = contractStartValue ? Number.parseInt(contractStartValue.split("-")[1] || "", 10) : null;
  const contractStartYear = contractStartValue ? Number.parseInt(contractStartValue.split("-")[0] || "", 10) : null;
  const sortedDriveFiles = useMemo(() => {
    const files = [...driveFiles];
    files.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      if (driveSort === "modified") {
        const aTime = a.modifiedTime ? new Date(a.modifiedTime).getTime() : 0;
        const bTime = b.modifiedTime ? new Date(b.modifiedTime).getTime() : 0;
        return bTime - aTime || a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      }
      if (driveSort === "size") {
        const aSize = a.size ?? -1;
        const bSize = b.size ?? -1;
        return bSize - aSize || a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
    return files;
  }, [driveFiles, driveSort]);

  const totals = useMemo(() => {
    return accountLines.reduce(
      (acc, line) => {
        const annualUsage = toNumber(line.annualUsage);
        const avgMonthlyUsage = toNumber(line.avgMonthlyUsage);
        const margin = toNumber(brokerMargin);
        const monthsToUse = termsForCalculations(requestedTerms, customTermMonths);

        acc.totalAnnualUsage += annualUsage;
        acc.totalAvgMonthlyUsage += avgMonthlyUsage;

        for (const months of monthsToUse) {
          const brokerIncome = avgMonthlyUsage * months * margin;
          acc.byTerm[months] = acc.byTerm[months] || { brokerIncome: 0 };
          acc.byTerm[months].brokerIncome += brokerIncome;
        }

        return acc;
      },
      {
        totalAnnualUsage: 0,
        totalAvgMonthlyUsage: 0,
        byTerm: {} as Record<number, { brokerIncome: number }>,
      }
    );
  }, [accountLines, brokerMargin, requestedTerms, customTermMonths]);

  const termsChecklistSummary = useMemo(() => {
    const parts = requestedTerms.map((t) => (t === "NYMEX" ? "NYMEX" : `${t} mo`));
    if (customTermMonths.trim()) parts.push(`custom: ${customTermMonths}`);
    return parts.length ? parts.join(", ") : "";
  }, [requestedTerms, customTermMonths]);

  async function loadPageData() {
    setLoading(true);
    try {
      const [customersRes, suppliersRes, rfpRes] = await Promise.all([
        fetch("/api/contacts/customer-companies"),
        fetch("/api/suppliers?contacts=1&filter=all"),
        fetch("/api/rfp"),
      ]);
      const [customersData, suppliersData, rfpData] = await Promise.all([
        customersRes.json(),
        suppliersRes.json(),
        rfpRes.json(),
      ]);

      const companyOptions = Array.isArray(customersData?.companies) ? customersData.companies : [];
      setCustomerCompanies(companyOptions);
      setSuppliers(Array.isArray(suppliersData) ? suppliersData : []);
      setRecentRfqs(Array.isArray(rfpData) ? rfpData.slice(0, 40) : []);
      return companyOptions as CustomerCompanyOption[];
    } finally {
      setLoading(false);
    }
  }

  function openCustomerSetupDialog() {
    if (!selectedCustomer) return;
    setAttachContactCustomerId(selectedCustomer.customerId);
    setCustomerDraft((current) => ({
      ...current,
      customerName: selectedCustomer.displayName,
      company: selectedCustomer.displayName,
      contactName: current.contactName || selectedCustomer.contacts?.[0]?.name || "",
      contactEmail: current.contactEmail || selectedCustomer.contacts?.[0]?.email || "",
      contactPhone: current.contactPhone || selectedCustomer.contacts?.[0]?.phone || "",
      contactLabel: current.contactLabel || defaultCustomerContactLabels(energyType),
    }));
    setCustomerDialogOpen(true);
  }

  async function refreshSupplierRows() {
    const res = await fetch("/api/suppliers?contacts=1&filter=all");
    const data = await res.json();
    if (Array.isArray(data)) setSuppliers(data);
  }

  /** Move primary|default label tokens from previous main contact to the new one (saved for future RFPs). */
  async function movePrimaryDefaultLabelBetweenContacts(
    supplierId: string,
    previousContactId: string,
    newContactId: string
  ) {
    const supplierRow = suppliers.find((s) => s.id === supplierId);
    const roster = supplierRow?.contactLinks ?? [];
    const getTokens = (id: string) => parseContactLabels(roster.find((c) => c.id === id)?.label ?? "");

    const stripMarkers = (tokens: string[]) =>
      tokens.filter((t) => t.toLowerCase() !== "primary" && t.toLowerCase() !== "default");

    const prevTok = getTokens(previousContactId);
    const nextPrev = stripMarkers(prevTok);
    if (nextPrev.length !== prevTok.length) {
      const patchRes = await fetch(`/api/contacts/${previousContactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: formatContactLabels(nextPrev) || null }),
      });
      if (!patchRes.ok) {
        const err = await patchRes.json().catch(() => ({}));
        throw new Error(typeof err?.error === "string" ? err.error : "Failed to update previous contact label");
      }
    }

    const newTok = getTokens(newContactId);
    const hasMarker = newTok.some((t) => t.toLowerCase() === "primary" || t.toLowerCase() === "default");
    if (!hasMarker) {
      const patchRes = await fetch(`/api/contacts/${newContactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: formatContactLabels([...newTok, "primary"]) }),
      });
      if (!patchRes.ok) {
        const err = await patchRes.json().catch(() => ({}));
        throw new Error(typeof err?.error === "string" ? err.error : "Failed to set primary label on new contact");
      }
    }
  }

  async function onSupplierMainContactChange(supplierId: string, newContactId: string) {
    const prevId = selectedSupplierContactIds[supplierId] ?? "";
    setSelectedSupplierContactIds((current) => ({
      ...current,
      [supplierId]: newContactId,
    }));
    setResult(null);
    try {
      if (prevId && prevId !== newContactId) {
        await movePrimaryDefaultLabelBetweenContacts(supplierId, prevId, newContactId);
      }
      await refreshSupplierRows();
    } catch (error) {
      setResult({
        error: error instanceof Error ? error.message : "Failed to save main contact preference",
      });
    }
  }

  function validateRfpRequest() {
    if (!customerCompanyId) {
      return "Select a customer company before previewing or sending the RFP.";
    }
    if (!energyType) {
      return "Select an energy type (Natural Gas or Electric) before previewing or sending the RFP.";
    }
    const termErr = validateCustomTermsInput(customTermMonths);
    if (termErr) return termErr;
    if (!resolvedCustomerIdForValidation) {
      return "The selected customer contact must be linked to a customer record before preview or send. Use “Add customer + contact” to create the customer and link this contact.";
    }
    if (!customerContactId) {
      return "Select a customer contact before previewing or sending the RFP.";
    }
    if (selectedSupplierIds.length === 0) {
      return "No suppliers match the selected energy type with supplier + gas/electric labels. Add labels on the Contacts page.";
    }
    if (
      selectedSupplierIds.some((supplierId) => {
        const contactId = selectedSupplierContactIds[supplierId];
        if (!contactId) return true;
        const supplier = suppliers.find((s) => s.id === supplierId);
        const forEnergy = filterSupplierContactsForRfpEnergy(supplier?.contactLinks ?? [], energyType);
        const contact = forEnergy.find((c) => c.id === contactId);
        return !contact || !(contact.email || "").trim();
      })
    ) {
      return "Each supplier row needs a main contact with an email address.";
    }
    return null;
  }

  function toggleRequestedTerm(term: RequestedTerm) {
    setRequestedTerms((current) =>
      current.includes(term) ? current.filter((value) => value !== term) : [...current, term]
    );
  }

  function toggleSupplierIncluded(supplierId: string) {
    setSelectedSupplierIds((prev) =>
      prev.includes(supplierId) ? prev.filter((id) => id !== supplierId) : [...prev, supplierId]
    );
  }

  function clearLocalWipAndResetForm() {
    skipNextWipPersist.current = true;
    localStorage.removeItem(RFP_WIP_STORAGE_KEY);
    setCustomerCompanyId("");
    setCustomerCompanySearch("");
    setCustomerContactId("");
    setEnergyType("");
    setSelectedSupplierIds([]);
    setSelectedSupplierContactIds({});
    setRequestedTerms(["12", "24"]);
    setCustomTermMonths("");
    setCustomTermsError("");
    setContractStartValue("");
    setQuoteDueDate("");
    setGoogleDriveFolderUrl("");
    setSummarySpreadsheetUrl("");
    setLdcUtility("");
    setLdcUtilitySearch("");
    setLdcUtilityDropdownOpen(false);
    setBrokerMargin("");
    setNotes("");
    setAccountLines([emptyAccountLine()]);
    setLocalBillFile(null);
    setLocalSummaryFile(null);
    setSelectedBillDriveFileId("");
    setSelectedSummaryDriveFileId("");
    setActiveDraftId(null);
    setReissueParentRfpId(null);
    setResult(null);
    setRfpTestEmailOk(false);
    setTestEmailFoundId(null);
  }

  async function saveDraftToServer() {
    if (!resolvedCustomerIdForValidation || !energyType) {
      setResult({
        error: "Select a customer company with a linked record and an energy type before saving.",
      });
      return;
    }
    setSavingDraft(true);
    setResult(null);
    try {
      const contactSelections: Record<string, string> = {};
      for (const sid of selectedSupplierIds) {
        const cid = selectedSupplierContactIds[sid];
        if (cid) contactSelections[sid] = cid;
      }
      const res = await fetch("/api/rfp/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: activeDraftId || undefined,
          customerId: resolvedCustomerIdForValidation,
          customerContactId: customerContactId || undefined,
          energyType,
          supplierIds: selectedSupplierIds,
          supplierContactSelections: contactSelections,
          requestedTerms,
          customTermMonths: customTermMonths || undefined,
          quoteDueDate: quoteDueDate || undefined,
          contractStartMonth: contractStartMonth || undefined,
          contractStartYear: contractStartYear || undefined,
          googleDriveFolderUrl: googleDriveFolderUrl || undefined,
          summarySpreadsheetUrl: summarySpreadsheetUrl || undefined,
          ldcUtility: ldcUtility || undefined,
          brokerMargin: brokerMargin || undefined,
          brokerMarginUnit,
          accountLines: accountLines.map((line) => ({
            accountNumber: line.accountNumber,
            serviceAddress: line.serviceAddress || undefined,
            annualUsage: line.annualUsage,
            avgMonthlyUsage: line.avgMonthlyUsage,
          })),
          notes: notes || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save draft");
      setActiveDraftId(data.id);
      await loadPageData();
      setDraftNotice("RFP saved. Open it anytime under Recent RFPs → Unsubmitted.");
      window.setTimeout(() => setDraftNotice(null), 6000);
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "Failed to save draft" });
    } finally {
      setSavingDraft(false);
    }
  }

  async function loadSavedRfpIntoForm(id: string) {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`/api/rfp/${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load RFP");

      const companyRow = customerCompanies.find((c) => c.customerId === data.customerId) ?? null;
      if (companyRow) {
        setCustomerCompanyId(companyRow.id);
        setCustomerCompanySearch(companyRow.displayName);
      } else if (data.customer) {
        setCustomerCompanyId("");
        setCustomerCompanySearch(
          [data.customer.name, data.customer.company].filter(Boolean).join(" — ") || ""
        );
      }
      setCustomerContactId(data.customerContactId || "");
      if (data.energyType === "ELECTRIC" || data.energyType === "NATURAL_GAS") {
        setEnergyType(data.energyType);
      }
      const supIds = Array.isArray(data.suppliers) ? data.suppliers.map((s: { id: string }) => s.id) : [];
      setSelectedSupplierIds(supIds);
      setRequestedTerms(mapDbTermsToRequestedTerms(data.requestedTerms));
      setCustomTermMonths(mapDbTermsToCustomMonthsString(data.requestedTerms));
      setContractStartValue(
        data.contractStartYear && data.contractStartMonth
          ? `${String(data.contractStartYear).padStart(4, "0")}-${String(data.contractStartMonth).padStart(2, "0")}`
          : ""
      );
      setQuoteDueDate(
        data.quoteDueDate ? String(data.quoteDueDate).slice(0, 10) : ""
      );
      setGoogleDriveFolderUrl(data.googleDriveFolderUrl || "");
      setSummarySpreadsheetUrl(data.summarySpreadsheetUrl || "");
      setLdcUtility(data.ldcUtility || "");
      setBrokerMargin(data.brokerMargin != null ? String(data.brokerMargin) : "");
      if (data.brokerMarginUnit === "KWH" || data.brokerMarginUnit === "MCF" || data.brokerMarginUnit === "CCF" || data.brokerMarginUnit === "DTH") {
        setBrokerMarginUnit(data.brokerMarginUnit);
      }
      setNotes(data.notes || "");
      setAccountLines(
        Array.isArray(data.accountLines) && data.accountLines.length > 0
          ? data.accountLines.map(
              (line: {
                accountNumber: string;
                serviceAddress?: string | null;
                annualUsage: unknown;
                avgMonthlyUsage: unknown;
              }) => ({
                id: crypto.randomUUID(),
                accountNumber: line.accountNumber ?? "",
                serviceAddress: line.serviceAddress ?? "",
                annualUsage: String(line.annualUsage ?? ""),
                avgMonthlyUsage: String(line.avgMonthlyUsage ?? ""),
              })
            )
          : [emptyAccountLine()]
      );
      const selections = data.supplierContactSelections;
      if (selections && typeof selections === "object" && !Array.isArray(selections)) {
        setSelectedSupplierContactIds(selections as Record<string, string>);
      }
      if (data.status === "draft") {
        setActiveDraftId(data.id);
        setReissueParentRfpId(null);
      } else {
        setActiveDraftId(null);
        setReissueParentRfpId(String(data.id));
      }
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "Failed to load RFP" });
    } finally {
      setLoading(false);
    }
  }

  function updateAccountLine(id: string, field: keyof AccountLine, value: string) {
    setAccountLines((current) =>
      current.map((line) => (line.id === id ? { ...line, [field]: value } : line))
    );
  }

  function addAccountLine() {
    setAccountLines((current) => [...current, emptyAccountLine()]);
  }

  function removeAccountLine(id: string) {
    setAccountLines((current) => (current.length === 1 ? current : current.filter((line) => line.id !== id)));
  }

  async function handleCreateCustomer() {
    setCreatingCustomer(true);
    setResult(null);
    try {
      const targetCustomer =
        attachContactCustomerId != null
          ? customerCompanies.find((customer) => customer.customerId === attachContactCustomerId) ?? null
          : null;

      let customerData:
        | {
            id: string;
            name: string;
            company: string | null;
          }
        | null = targetCustomer
        ? {
            id: targetCustomer.customerId || "",
            name: targetCustomer.displayName,
            company: targetCustomer.displayName,
          }
        : null;

      if (!customerData) {
        const customerRes = await fetch("/api/customers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: customerDraft.customerName,
            company: customerDraft.company || undefined,
            email: customerDraft.email || undefined,
            phone: customerDraft.phone || undefined,
            address: customerDraft.address || undefined,
            city: customerDraft.city || undefined,
            state: customerDraft.state || undefined,
            zip: customerDraft.zip || undefined,
            notes: customerDraft.notes || undefined,
          }),
        });
        const createdCustomer = await customerRes.json();
        if (!customerRes.ok) throw new Error(createdCustomer.error || "Failed to create customer");
        customerData = createdCustomer;
      }
      if (!customerData) {
        throw new Error("Customer record unavailable for contact creation");
      }

      const contactRes = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:
            customerDraft.contactName ||
            customerDraft.customerName ||
            targetCustomer?.displayName ||
            "Customer Contact",
          email: customerDraft.contactEmail || customerDraft.email || undefined,
          phone: customerDraft.contactPhone || customerDraft.phone || undefined,
          company: customerDraft.company || targetCustomer?.displayName || undefined,
          label: customerDraft.contactLabel.trim() || "customer",
          customerId: customerData.id,
          emails: customerDraft.contactEmail || customerDraft.email
            ? [{ email: customerDraft.contactEmail || customerDraft.email, type: "work" }]
            : [],
          phones: customerDraft.contactPhone || customerDraft.phone
            ? [{ phone: customerDraft.contactPhone || customerDraft.phone, type: "work" }]
            : [],
          addresses: customerDraft.address || customerDraft.city || customerDraft.zip
            ? [{
                street: customerDraft.address,
                city: customerDraft.city,
                state: customerDraft.state,
                zip: customerDraft.zip,
                type: "work",
              }]
            : [],
        }),
      });
      const contactData = await contactRes.json();
      if (!contactRes.ok) throw new Error(contactData.error || "Failed to create customer contact");

      const refreshedCompanies = await loadPageData();
      const createdCompany =
        refreshedCompanies?.find((company) => company.customerId === customerData.id) ?? null;
      setCustomerCompanyId(createdCompany?.id || "");
      setCustomerContactId(contactData.id);
      setCustomerDialogOpen(false);
      setCustomerDraft(emptyCustomerDraft);
      setAttachContactCustomerId(null);
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "Failed to create customer" });
    } finally {
      setCreatingCustomer(false);
    }
  }

  async function performSendRfp() {
    setSending(true);
    setResult(null);
    try {
      const validationError = validateRfpRequest();
      if (validationError) throw new Error(validationError);
      const response = await sendRfpRequest("send");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to send RFP");

      setResult({ success: true, sentTo: data.sentTo });
      skipNextWipPersist.current = true;
      localStorage.removeItem(RFP_WIP_STORAGE_KEY);
      setActiveDraftId(null);
      setReissueParentRfpId(null);
      await loadPageData();
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "Failed to send RFP" });
    } finally {
      setSending(false);
      setSendConfirmOpen(false);
    }
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validateRfpRequest();
    if (validationError) {
      setResult({ error: validationError });
      return;
    }
    setSendConfirmOpen(true);
  }

  async function handlePreview() {
    setPreviewLoading(true);
    setResult(null);
    try {
      const validationError = validateRfpRequest();
      if (validationError) throw new Error(validationError);
      const response = await sendRfpRequest("preview");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to build preview");
      setPreviewData(data);
      setPreviewOpen(true);
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "Failed to build preview" });
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleTestSend() {
    setTestingEmail(true);
    setResult(null);
    setTestEmailFoundId(null);
    try {
      const validationError = validateRfpRequest();
      if (validationError) throw new Error(validationError);
      const response = await sendRfpRequest("test", { testEmail });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to send test email");
      setRfpTestEmailOk(true);
      setResult({ success: true, sentTo: data.sentTo });
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "Failed to send test email" });
    } finally {
      setTestingEmail(false);
    }
  }

  async function loadDriveFiles(kind: DrivePickerKind, options?: { query?: string; folderId?: string }) {
    setDrivePickerLoading(true);
    setDrivePickerError("");
    try {
      const params = new URLSearchParams({ kind });
      const query = options?.query ?? drivePickerQuery;
      const folderId = options?.folderId ?? driveCurrentFolderId;
      if (query.trim()) params.set("query", query.trim());
      if (folderId) params.set("folderId", folderId);
      const response = await fetch(`/api/google-drive/files?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to load Google Drive files");
      setDriveFiles(Array.isArray(data.files) ? data.files : []);
      setDriveBreadcrumbs(Array.isArray(data.breadcrumbs) ? data.breadcrumbs : []);
      setDriveCurrentFolderId(typeof data.currentFolderId === "string" ? data.currentFolderId : "");
    } catch (error) {
      setDriveFiles([]);
      setDriveBreadcrumbs([]);
      setDrivePickerError(error instanceof Error ? error.message : "Failed to load Google Drive files");
    } finally {
      setDrivePickerLoading(false);
    }
  }

  function openDrivePicker(kind: DrivePickerKind) {
    setDrivePickerKind(kind);
    setDrivePickerQuery("");
    setDriveFiles([]);
    setDriveBreadcrumbs([]);
    setDriveCurrentFolderId("");
    setDriveSort("name");
    setDrivePickerOpen(true);
    void loadDriveFiles(kind, { query: "", folderId: "" });
  }

  function handleDriveEntryActivate(file: DriveFileOption) {
    if (file.isFolder) {
      setDrivePickerQuery("");
      void loadDriveFiles(drivePickerKind, { query: "", folderId: file.id });
      return;
    }
    if (drivePickerKind === "reference") {
      if (file.webViewLink && typeof window !== "undefined") {
        window.open(file.webViewLink, "_blank", "noopener,noreferrer");
      }
      return;
    }
    if (drivePickerKind === "bill") {
      setGoogleDriveFolderUrl(file.webViewLink || "");
      setSelectedBillDriveFileId(file.id);
      setLocalBillFile(null);
    } else {
      setSummarySpreadsheetUrl(file.webViewLink || "");
      setSelectedSummaryDriveFileId(file.id);
      setLocalSummaryFile(null);
    }
    setDrivePickerOpen(false);
  }

  function handleLocalFileSelected(kind: DrivePickerKind, file: File | null) {
    if (kind === "bill") {
      setLocalBillFile(file);
      if (file) {
        setGoogleDriveFolderUrl("");
        setSelectedBillDriveFileId("");
      }
    } else {
      setLocalSummaryFile(file);
      if (file) {
        setSummarySpreadsheetUrl("");
        setSelectedSummaryDriveFileId("");
      }
    }
    setDrivePickerOpen(false);
  }

  function openSelectedDocument(kind: SelectedDocumentKind) {
    if (typeof window === "undefined") return;

    const localFile = kind === "bill" ? localBillFile : localSummaryFile;
    const url = kind === "bill" ? googleDriveFolderUrl : summarySpreadsheetUrl;

    if (localFile) {
      const objectUrl = URL.createObjectURL(localFile);
      window.open(objectUrl, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      return;
    }

    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  async function sendRfpRequest(
    mode: "preview" | "test" | "send",
    extraFields?: Record<string, string>
  ) {
    const payload = buildRfpPayload(mode);
    const hasAttachments = Boolean(localBillFile || localSummaryFile);

    if (!hasAttachments) {
      return fetch("/api/rfp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, ...extraFields }),
      });
    }

    const formData = new FormData();
    for (const [key, value] of Object.entries({ ...payload, ...extraFields })) {
      if (value === undefined) continue;
      formData.append(key, typeof value === "string" ? value : JSON.stringify(value));
    }
    if (localBillFile) formData.append("billAttachment", localBillFile);
    if (localSummaryFile) formData.append("summaryAttachment", localSummaryFile);

    return fetch("/api/rfp/send", {
      method: "POST",
      body: formData,
    });
  }

  function buildRfpPayload(mode: "send" | "preview" | "test") {
    const et = energyType as EnergyType;
    const contactIdsForSend = selectedSupplierIds
      .map((sid) => selectedSupplierContactIds[sid])
      .filter((id): id is string => Boolean(id));
    return {
      mode,
      customerId: resolvedCustomerIdForValidation || "",
      customerContactId,
      energyType: et,
      supplierIds: selectedSupplierIds,
      supplierContactIds: contactIdsForSend,
      requestedTerms,
      customTermMonths: customTermMonths || undefined,
      quoteDueDate: quoteDueDate || undefined,
      contractStartMonth: contractStartMonth || undefined,
      contractStartYear: contractStartYear || undefined,
      googleDriveFolderUrl: googleDriveFolderUrl || undefined,
      summarySpreadsheetUrl: summarySpreadsheetUrl || undefined,
      billDriveFileId: selectedBillDriveFileId || undefined,
      summaryDriveFileId: selectedSummaryDriveFileId || undefined,
      billAttachmentName: localBillFile?.name || undefined,
      summaryAttachmentName: localSummaryFile?.name || undefined,
      ldcUtility: ldcUtility || undefined,
      brokerMargin: brokerMargin || undefined,
      brokerMarginUnit,
      notes: notes || undefined,
      accountLines: accountLines.map((line) => ({
        accountNumber: line.accountNumber,
        serviceAddress: line.serviceAddress || undefined,
        annualUsage: line.annualUsage,
        avgMonthlyUsage: line.avgMonthlyUsage,
      })),
      ...(mode === "send" && reissueParentRfpId ? { reissueParentRfpId } : {}),
    };
  }

    return (
    <div className="space-y-6">
      {draftNotice && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100">
          {draftNotice}
        </div>
      )}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">RFP workspace</h1>
          <p className="text-muted-foreground">
            Build a supplier request from customer bills, choose the right suppliers, and preview
            broker economics before the email goes out.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          <Button type="button" variant="outline" onClick={() => setResetConfirmOpen(true)}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Reset page
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={savingDraft}
            onClick={() => void saveDraftToServer()}
          >
            {savingDraft ? "Saving…" : "Save RFP"}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setAttachContactCustomerId(null);
              setCustomerDraft({
                ...emptyCustomerDraft,
                contactLabel: defaultCustomerContactLabels(energyType),
              });
              setCustomerDialogOpen(true);
            }}
          >
            <UserPlus className="mr-2 h-4 w-4" />
            Add customer + contact
          </Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]">
        <form onSubmit={handleSend} className="space-y-6">
          <Card>
            <CardHeader className="pb-4">
              <CardDescription className="flex items-start gap-2 text-base text-foreground">
                <FileText className="mt-0.5 h-5 w-5 shrink-0" />
                <span>
                  Choose the customer company, energy type, requested terms, return date, and bill package.
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
                <div className="grid content-start gap-2">
                  <Label>Energy Type *</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant={energyType === "NATURAL_GAS" ? "default" : "outline"}
                      onClick={() => setEnergyType(energyType === "NATURAL_GAS" ? "" : "NATURAL_GAS")}
                    >
                      Natural Gas
                    </Button>
                    <Button
                      type="button"
                      variant={energyType === "ELECTRIC" ? "default" : "outline"}
                      onClick={() => setEnergyType(energyType === "ELECTRIC" ? "" : "ELECTRIC")}
                    >
                      Electric
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Choose one energy type for this RFP (required before suppliers appear).
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label>Customer Company *</Label>
                  <div className="relative">
                    <Input
                      ref={customerCompanyInputRef}
                      value={customerCompanySearch}
                      onFocus={() => setCustomerCompanyDropdownOpen(true)}
                      onBlur={() => window.setTimeout(() => setCustomerCompanyDropdownOpen(false), 120)}
                      onChange={(e) => {
                        setCustomerCompanySearch(e.target.value);
                        setCustomerCompanyDropdownOpen(true);
                        if (customerCompanyId) setCustomerCompanyId("");
                      }}
                      placeholder={loading ? "Loading customer companies..." : "Type customer company name"}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setCustomerCompanyDropdownOpen((current) => !current);
                        customerCompanyInputRef.current?.focus();
                      }}
                      aria-label="Toggle customer company list"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    {customerCompanyDropdownOpen && (
                      <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover shadow-md">
                        {filteredCustomerCompanies.length === 0 ? (
                          <p className="px-3 py-2 text-sm text-muted-foreground">No customer companies match that search.</p>
                        ) : (
                          filteredCustomerCompanies.map((customer) => {
                            const isSelected = customer.id === customerCompanyId;
                            return (
                              <button
                                key={customer.id}
                                type="button"
                                className={`w-full border-b px-3 py-2 text-left text-sm last:border-b-0 ${
                                  isSelected ? "bg-primary/10 font-medium" : "hover:bg-muted/50"
                                }`}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setCustomerCompanyId(customer.id);
                                  setCustomerCompanySearch(customer.displayName);
                                  setCustomerCompanyDropdownOpen(false);
                                }}
                              >
                                {`${customer.displayName}${
                                  Array.isArray(customer.contacts) && customer.contacts.length === 0
                                    ? " - no contact on file"
                                    : ""
                                }`}
                              </button>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Type to filter, or use the chevron to open the scrollable company list.
                  </p>
                </div>
              </div>

              <div className="grid gap-2">
                <Label>Customer contact *</Label>
                <Select
                  value={customerContactId}
                  onValueChange={setCustomerContactId}
                  disabled={!customerCompanyId || customerContacts.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select customer contact" />
                  </SelectTrigger>
                  <SelectContent>
                    {customerContacts.map((contact) => (
                      <SelectItem key={contact.id} value={contact.id}>
                        {contact.name}
                        {contact.email ? ` — ${contact.email}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedCustomerNeedsSetup && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-medium">Add a customer contact</p>
                  <p className="mt-1">
                    {selectedCustomer?.displayName || "This company"} does not have anyone listed under this company
                    yet. Add at least one contact so you can choose who receives quote summaries and supplier
                    communications.
                  </p>
                  <Button type="button" variant="outline" className="mt-3" onClick={openCustomerSetupDialog}>
                    Create customer + contact
                  </Button>
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-1">
                <div className="grid gap-2">
                  <Label>LDC / utility *</Label>
                  <div className="relative">
                    <Input
                      ref={ldcUtilityInputRef}
                      value={ldcUtilitySearch}
                      onFocus={() => setLdcUtilityDropdownOpen(true)}
                      onBlur={() =>
                        window.setTimeout(() => {
                          setLdcUtilityDropdownOpen(false);
                          setLdcUtility(ldcUtilitySearch.trim());
                        }, 120)
                      }
                      onChange={(e) => {
                        setLdcUtilitySearch(e.target.value);
                        setLdcUtilityDropdownOpen(true);
                      }}
                      placeholder={loading ? "Loading…" : "Type or pick a utility / LDC"}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setLdcUtilityDropdownOpen((o) => !o);
                        ldcUtilityInputRef.current?.focus();
                      }}
                      aria-label="Toggle utility list"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    {ldcUtilityDropdownOpen && (
                      <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover shadow-md">
                        {UTILITY_OPTIONS.filter((u) => {
                          const q = ldcUtilitySearch.trim().toLowerCase();
                          if (!q) return true;
                          return u.toLowerCase().includes(q);
                        }).length === 0 ? (
                            <p className="px-3 py-2 text-sm text-muted-foreground">
                              Type a custom utility name — it will be saved when you leave this field.
                            </p>
                          ) : (
                            UTILITY_OPTIONS.filter((u) => {
                              const q = ldcUtilitySearch.trim().toLowerCase();
                              if (!q) return true;
                              return u.toLowerCase().includes(q);
                            }).map((utility) => (
                              <button
                                key={utility}
                                type="button"
                                className="w-full border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/50"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setLdcUtility(utility);
                                  setLdcUtilitySearch(utility);
                                  setLdcUtilityDropdownOpen(false);
                                }}
                              >
                                {utility}
                              </button>
                            ))
                          )}
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Same style as customer company: type to filter, pick from the list, or enter a custom name.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <Label>Requested terms *</Label>
                <div className="flex flex-wrap gap-2">
                  {TERM_OPTIONS.map((term) => {
                    const active = requestedTerms.includes(term);
                    return (
                      <button
                        key={term}
                        type="button"
                        onClick={() => toggleRequestedTerm(term)}
                        className={`rounded-md border px-3 py-2 text-sm transition ${
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background hover:bg-muted"
                        }`}
                      >
                        {term === "NYMEX" ? "NYMEX" : `${term} months`}
                      </button>
                    );
                  })}
                </div>
                <div className="grid gap-2 md:max-w-md">
                  <Label htmlFor="custom-term">Custom terms (months)</Label>
                  <Input
                    id="custom-term"
                    value={customTermMonths}
                    onChange={(e) => {
                      const v = e.target.value;
                      setCustomTermMonths(v);
                      setCustomTermsError(validateCustomTermsInput(v) || "");
                    }}
                    placeholder="e.g. 18, 30, 48 — comma-separated whole numbers"
                  />
                  {customTermsError ? (
                    <p className="text-xs text-destructive">{customTermsError}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Separate multiple custom lengths with commas.</p>
                  )}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Contract start month / year *</Label>
                  <Input
                    type="month"
                    value={contractStartValue}
                    onChange={(e) => setContractStartValue(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use the month picker to choose the contract start month and year.
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label>Supplier quote due date *</Label>
                  <Input
                    type="date"
                    value={quoteDueDate}
                    onChange={(e) => setQuoteDueDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Bill PDF link or local file *</Label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        value={googleDriveFolderUrl}
                        onChange={(e) => {
                          setGoogleDriveFolderUrl(e.target.value);
                          setSelectedBillDriveFileId("");
                          if (e.target.value) setLocalBillFile(null);
                        }}
                        placeholder="https://drive.google.com/..."
                        className={googleDriveFolderUrl ? "pr-10" : undefined}
                      />
                      {googleDriveFolderUrl ? (
                        <button
                          type="button"
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          onClick={() => {
                            setGoogleDriveFolderUrl("");
                            setSelectedBillDriveFileId("");
                          }}
                          aria-label="Clear bill link"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                    <Button type="button" variant="outline" onClick={() => openDrivePicker("bill")}>
                      <FolderOpen className="mr-2 h-4 w-4" />
                      Browse
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!googleDriveFolderUrl && !localBillFile}
                      onClick={() => openSelectedDocument("bill")}
                    >
                      View
                    </Button>
                  </div>
                  {localBillFile && (
                    <p className="text-xs text-muted-foreground">
                      Local file selected: {localBillFile.name}
                    </p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label>Usage Summary Link or local file</Label>
                  <div className="flex gap-2">
                    <Input
                      value={summarySpreadsheetUrl}
                      onChange={(e) => {
                        setSummarySpreadsheetUrl(e.target.value);
                        setSelectedSummaryDriveFileId("");
                        if (e.target.value) setLocalSummaryFile(null);
                      }}
                      placeholder="Required when multiple utility accounts are included"
                    />
                    <Button type="button" variant="outline" onClick={() => openDrivePicker("summary")}>
                      <FolderOpen className="mr-2 h-4 w-4" />
                      Browse
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!summarySpreadsheetUrl && !localSummaryFile}
                      onClick={() => openSelectedDocument("summary")}
                    >
                      View
                    </Button>
                  </div>
                  {localSummaryFile && (
                    <p className="text-xs text-muted-foreground">
                      Local file selected: {localSummaryFile.name}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1.5">
                  <CardTitle>
                    {energyType === "ELECTRIC"
                      ? "Select suppliers — Electric"
                      : energyType === "NATURAL_GAS"
                        ? "Select suppliers — Natural Gas"
                        : "Select suppliers"}
                  </CardTitle>
                  <CardDescription>
                    Rows are directory suppliers that have at least one contact labeled{" "}
                    <span className="font-medium">supplier</span> (or vendor) with{" "}
                    <span className="font-medium">{energyType === "ELECTRIC" ? "electric" : "gas"}</span> on the
                    same label. Uncheck a row to exclude that supplier from this campaign. Changing the main
                    contact moves the <span className="font-medium">primary</span> /{" "}
                    <span className="font-medium">default</span> label to that person for future RFPs.
                  </CardDescription>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium">★</span> marks the primary main contact (or the only contact
                    for that supplier). Add a new contact with <span className="font-medium">New contact</span>{" "}
                    or use <span className="font-medium">Refresh suppliers</span> if you updated the directory in
                    another tab.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => void refreshSupplierRows()}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Refresh suppliers
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {suppliersMissingEnergyLabels.length > 0 && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-medium">Supplier label follow-up needed</p>
                  <p className="mt-1">
                    These suppliers have contacts labeled as supplier but are still missing a `gas`
                    or `electric` label, so RFP targeting may be incomplete:
                  </p>
                  <p className="mt-2">
                    {suppliersMissingEnergyLabels.map((supplier) => supplier.name).join(", ")}
                  </p>
                </div>
              )}
              {eligibleSuppliers.length === 0 && (
                <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  No suppliers are currently tagged for {energyType === "ELECTRIC" ? "electric" : "natural gas"}.
                </p>
              )}
              {eligibleSuppliers.length > 0 && (
                <div className="rounded-lg border">
                  <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1.35fr)_auto_minmax(0,1.1fr)] gap-2 border-b bg-muted/40 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:gap-3 sm:px-4 sm:text-xs">
                    <div className="text-center">Incl.</div>
                    <div>Supplier</div>
                    <div>Main contact</div>
                    <div className="text-center">Add</div>
                    <div>Email</div>
                  </div>
                  {suppliersTableRows.map(({ supplier, contacts, selectedContact, selectedContactId }) => {
                    const included = selectedSupplierIds.includes(supplier.id);
                    return (
                      <div
                        key={supplier.id}
                        className="grid grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1.35fr)_auto_minmax(0,1.1fr)] gap-2 border-b px-3 py-3 text-sm last:border-b-0 sm:gap-3 sm:px-4"
                      >
                        <div className="flex items-center justify-center pt-1">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-input"
                            checked={included}
                            onChange={() => toggleSupplierIncluded(supplier.id)}
                            aria-label={`Include ${supplier.name} in RFP`}
                          />
                        </div>
                        <div className="min-w-0 flex items-center">
                          <p className={`truncate font-medium ${!included ? "text-muted-foreground line-through" : ""}`}>
                            {supplier.name}
                          </p>
                        </div>
                        <div className="min-w-0">
                          {contacts.length > 0 ? (
                            <Select
                              value={selectedContactId || undefined}
                              onValueChange={(value) => void onSupplierMainContactChange(supplier.id, value)}
                              disabled={!included}
                            >
                              <SelectTrigger className="h-9">
                                <SelectValue placeholder="Select contact" />
                              </SelectTrigger>
                              <SelectContent>
                                {contacts.map((contact) => {
                                  const hasEmail = Boolean((contact.email || "").trim());
                                  const primaryHint = supplierContactShowsAsPrimary(contact, contacts.length);
                                  return (
                                    <SelectItem key={contact.id} value={contact.id} disabled={!hasEmail}>
                                      {`${contact.name}${primaryHint ? " ★ primary" : ""}`}
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                          ) : (
                            <p className="text-muted-foreground">—</p>
                          )}
                        </div>
                        <div className="flex items-start">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs"
                            disabled={!energyType || !included}
                            onClick={() =>
                              setNewSupplierContact({
                                supplierId: supplier.id,
                                supplierName: supplier.name,
                                name: "",
                                email: "",
                                saving: false,
                              })
                            }
                          >
                            New contact
                          </Button>
                        </div>
                        <div className="min-w-0 flex items-center">
                          <p className="truncate text-sm">{selectedContact?.email || "—"}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1.5">
                  <CardTitle className="flex items-center gap-2">
                    <FileSpreadsheet className="h-5 w-5" />
                    Utility accounts and usage
                  </CardTitle>
                  <CardDescription>
                    Enter one line per meter or utility account from the customer bills.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <Button type="button" variant="outline" onClick={() => setUtilityTableModalOpen(true)}>
                    <Table2 className="mr-2 h-4 w-4" />
                    Table for email
                  </Button>
                  <Button type="button" variant="outline" onClick={() => openDrivePicker("reference")}>
                    <FolderOpen className="mr-2 h-4 w-4" />
                    Browse Google Drive
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {accountLines.map((line, index) => (
                <div key={line.id} className="rounded-lg border p-4 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">Account {index + 1}</p>
                    <Button type="button" variant="ghost" onClick={() => removeAccountLine(line.id)}>
                      Remove
                    </Button>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div className="grid gap-2">
                      <Label>Account number *</Label>
                      <Input
                        value={line.accountNumber}
                        onChange={(e) => updateAccountLine(line.id, "accountNumber", e.target.value)}
                      />
                    </div>
                    <div className="grid gap-2 xl:col-span-2">
                      <Label>Service address</Label>
                      <Input
                        value={line.serviceAddress}
                        onChange={(e) => updateAccountLine(line.id, "serviceAddress", e.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>Annual usage *</Label>
                      <Input
                        type="number"
                        value={line.annualUsage}
                        onChange={(e) => updateAccountLine(line.id, "annualUsage", e.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>Average monthly usage *</Label>
                      <Input
                        type="number"
                        value={line.avgMonthlyUsage}
                        onChange={(e) => updateAccountLine(line.id, "avgMonthlyUsage", e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              ))}

              <Button type="button" variant="outline" onClick={addAccountLine}>
                Add another utility account
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calculator className="h-5 w-5" />
                Broker margin
              </CardTitle>
              <CardDescription>
                Set the broker margin first, then open the calculator if you want to test scenarios.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 md:grid-cols-4">
                <div className="grid gap-2">
                  <Label>Broker margin *</Label>
                  <Input
                    type="number"
                    step="0.000001"
                    value={brokerMargin}
                    onChange={(e) => setBrokerMargin(e.target.value)}
                    placeholder="e.g. 0.003500"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Margin unit *</Label>
                  <Select value={brokerMarginUnit} onValueChange={(value) => setBrokerMarginUnit(value as PriceUnit)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {marginUnitOptions(energyType).map((unit) => (
                        <SelectItem key={unit} value={unit}>
                          {unit}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Total avg monthly usage</Label>
                  <Input value={formatNumber(totals.totalAvgMonthlyUsage)} readOnly />
                </div>
                <div className="grid gap-2">
                  <Label>Verify margin</Label>
                  <Button
                    type="button"
                    variant="outline"
                    className="justify-start"
                    onClick={() => {
                      setCalculatorMargin(brokerMargin);
                      setMarginCalculatorOpen(true);
                    }}
                  >
                    <Calculator className="mr-2 h-4 w-4" />
                    Open margin calculator
                  </Button>
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="rfp-notes">Notes for suppliers</Label>
                <textarea
                  id="rfp-notes"
                  className="min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Special load notes, timing requests, or instructions."
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <Button type="button" variant="outline" onClick={handlePreview} disabled={previewLoading}>
                  <Mail className="mr-2 h-4 w-4" />
                  {previewLoading ? "Building preview..." : "Preview email"}
                </Button>
                <div className="flex flex-wrap gap-2">
                  <Input
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    placeholder="Test email address"
                    className="w-[260px]"
                  />
                  <Button type="button" variant="outline" onClick={handleTestSend} disabled={testingEmail}>
                    {testingEmail ? "Sending test..." : "Test RFP"}
                  </Button>
                  {testEmailFoundId ? (
                    <Button type="button" variant="secondary" onClick={() => setTestEmailViewOpen(true)}>
                      View test email
                    </Button>
                  ) : rfpTestEmailOk ? (
                    <span className="text-xs text-muted-foreground self-center">Waiting for inbox delivery…</span>
                  ) : null}
                </div>
                <Button type="submit" disabled={sending}>
                  <Send className="mr-2 h-4 w-4" />
                  {sending ? "Sending RFP..." : "Send RFP"}
                </Button>
              </div>

              {result?.success && typeof result.sentTo === "number" && (
                <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
                  RFP sent to {result.sentTo} supplier(s).
                </div>
              )}
              {result?.error && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                  {result.error}
                </div>
              )}

            </CardContent>
          </Card>
        </form>

        <div className="space-y-6 self-start xl:sticky xl:top-6">
          <Card>
            <CardHeader>
              <CardTitle>Quick checklist</CardTitle>
              <CardDescription>Before sending, make sure the package is complete.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <ChecklistItem checked={Boolean(customerCompanyId && customerContactId)}>
                Customer company and contact selected
              </ChecklistItem>
              <ChecklistItem checked={Boolean(energyType)}>
                Energy type selected ({energyType === "ELECTRIC" ? "Electric" : energyType === "NATURAL_GAS" ? "Natural gas" : "—"})
              </ChecklistItem>
              <ChecklistItem checked={selectedSupplierIds.length > 0}>
                {selectedSupplierIds.length > 0
                  ? `Suppliers selected (${selectedSupplierIds.length})`
                  : "At least one supplier selected"}
              </ChecklistItem>
              <ChecklistItem checked={selectedSupplierIds.length > 0 && selectedSupplierIds.every((supplierId) => Boolean(selectedSupplierContactIds[supplierId]))}>
                One supplier contact per supplier
              </ChecklistItem>
              <ChecklistItem checked={Boolean(ldcUtility.trim())}>
                LDC / utility filled in ({ldcUtility.trim() || "—"})
              </ChecklistItem>
              <ChecklistItem checked={Boolean(termsChecklistSummary)}>
                Requested terms ({termsChecklistSummary || "—"})
              </ChecklistItem>
              <ChecklistItem checked={Boolean(contractStartValue)}>
                Contract start month / year
              </ChecklistItem>
              <ChecklistItem checked={Boolean(quoteDueDate)}>
                Supplier quote due date
              </ChecklistItem>
              <ChecklistItem checked={Boolean(brokerMargin.trim()) && Boolean(brokerMarginUnit)}>
                {brokerMargin.trim()
                  ? `Broker margin (${brokerMargin} ${brokerMarginUnit})`
                  : "Broker margin and unit"}
              </ChecklistItem>
              <ChecklistItem checked={Boolean(googleDriveFolderUrl || localBillFile)}>
                Bill PDF linked
              </ChecklistItem>
              <ChecklistItem checked={accountLines.every((line) => line.accountNumber && line.annualUsage && line.avgMonthlyUsage)}>
                Utility account lines completed
              </ChecklistItem>
              <ChecklistItem checked={accountLines.length === 1 || Boolean(summarySpreadsheetUrl || localSummaryFile)}>
                Usage summary when multiple accounts exist
              </ChecklistItem>
              <ChecklistItem checked={rfpTestEmailOk}>Test RFP email sent successfully</ChecklistItem>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent RFPs</CardTitle>
              <CardDescription>
                Unsubmitted entries are saved from the form; submitted entries have had supplier emails sent.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
              <section className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold">Unsubmitted</h3>
                  <p className="text-xs text-muted-foreground">
                    Saved with <span className="font-medium">Save RFP</span> before sending.
                  </p>
                </div>
                {draftRfqs.length === 0 && (
                  <p className="text-sm text-muted-foreground">No saved RFPs yet.</p>
                )}
                {draftRfqs.map((rfp) => (
                  <div
                    key={rfp.id}
                    className={`rounded-lg border p-4 ${focusRfpId === rfp.id ? "border-primary bg-primary/5" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{rfp.customer.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {rfp.energyType === "ELECTRIC" ? "Electric" : "Natural gas"} · Draft
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {rfp.quoteDueDate ? new Date(rfp.quoteDueDate).toLocaleDateString() : "No due date"}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="secondary" onClick={() => void loadSavedRfpIntoForm(rfp.id)}>
                        Continue editing
                      </Button>
                    </div>
                  </div>
                ))}
              </section>

              <section className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold">Submitted</h3>
                  <p className="text-xs text-muted-foreground">
                    Supplier emails sent. Re-issue starts a new row and counts as a refresh.
                  </p>
                </div>
                {submittedRfqs.length === 0 && (
                  <p className="text-sm text-muted-foreground">No submitted RFPs yet.</p>
                )}
                {submittedRfqs.map((rfp) => (
                  <div
                    key={rfp.id}
                    className={`rounded-lg border p-4 ${focusRfpId === rfp.id ? "border-primary bg-primary/5" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{rfp.customer.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {rfp.energyType === "ELECTRIC" ? "Electric" : "Natural gas"} · {rfp.status}
                        </p>
                        {(rfp.refreshSequence ?? 0) > 0 ? (
                          <p className="text-xs font-medium text-amber-800 dark:text-amber-300 mt-1">
                            Supplier email refreshed {rfp.refreshSequence}×
                          </p>
                        ) : null}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {rfp.quoteDueDate ? new Date(rfp.quoteDueDate).toLocaleDateString() : "No due date"}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Suppliers: {rfp.suppliers.map((supplier) => supplier.name).join(", ") || "—"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Accounts: {rfp.accountLines.length} · Utility: {rfp.ldcUtility || "—"}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void loadSavedRfpIntoForm(rfp.id)}
                    >
                      Refresh / re-issue
                    </Button>
                    <Link
                      href={`/quotes?rfpRequestId=${rfp.id}`}
                      className="inline-flex h-9 items-center justify-center rounded-md border px-3 text-sm font-medium"
                    >
                      Review quotes
                    </Link>
                    {rfp.status !== "completed" && rfp.status !== "cancelled" && (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={async () => {
                            await fetch(`/api/rfp/${rfp.id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ status: "completed" }),
                            });
                            await loadPageData();
                          }}
                        >
                          Close out (no contract)
                        </Button>
                        <Button type="button" size="sm" asChild>
                          <Link href={`/directory/contracts?newFromRfp=${rfp.id}`}>Close out → new contract</Link>
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
              </section>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={marginCalculatorOpen} onOpenChange={setMarginCalculatorOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Broker margin calculator</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="grid gap-2">
                <Label>Margin rate</Label>
                <Input
                  type="number"
                  step="0.000001"
                  value={calculatorMargin}
                  onChange={(e) => setCalculatorMargin(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label>Margin unit</Label>
                <Select value={brokerMarginUnit} onValueChange={(value) => setBrokerMarginUnit(value as PriceUnit)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {marginUnitOptions(energyType).map((unit) => (
                      <SelectItem key={unit} value={unit}>
                        {unit}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Total avg monthly usage</Label>
                <Input value={formatNumber(totals.totalAvgMonthlyUsage)} readOnly />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {termsForCalculations(requestedTerms, customTermMonths).map((months) => (
                <div key={months} className="rounded-lg border bg-muted/40 p-4 space-y-2">
                  <p className="text-sm text-muted-foreground">{months}-month view</p>
                  <p className="text-sm">
                    Broker income:{" "}
                    <span className="font-semibold">
                      {formatCurrency(totals.totalAvgMonthlyUsage * months * toNumber(calculatorMargin))}
                    </span>
                  </p>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMarginCalculatorOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                setBrokerMargin(calculatorMargin);
                setMarginCalculatorOpen(false);
              }}
            >
              Use this margin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={sendConfirmOpen}
        onOpenChange={setSendConfirmOpen}
        title="Send RFP to suppliers?"
        message={`This sends one separate email to each included supplier (${selectedSupplierIds.length} recipient(s)). This cannot be undone.`}
        confirmLabel="Send RFP"
        variant="default"
        onConfirm={() => void performSendRfp()}
      />

      <ConfirmDialog
        open={resetConfirmOpen}
        onOpenChange={setResetConfirmOpen}
        title="Reset RFP page?"
        message="Clear all fields and local progress? Unsaved work in this form will be removed (saved drafts in the list stay in the database)."
        confirmLabel="Reset"
        onConfirm={() => {
          clearLocalWipAndResetForm();
          setResetConfirmOpen(false);
        }}
      />

      <Dialog open={utilityTableModalOpen} onOpenChange={setUtilityTableModalOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Utility accounts (email table)</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This table is included in the supplier RFP email body. Copy from here if needed.
          </p>
          <div className="overflow-x-auto rounded border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="p-2">Account #</th>
                  <th className="p-2">Service address</th>
                  <th className="p-2 text-right">Annual usage</th>
                  <th className="p-2 text-right">Avg monthly</th>
                </tr>
              </thead>
              <tbody>
                {accountLines.map((line) => (
                  <tr key={line.id} className="border-b">
                    <td className="p-2">{line.accountNumber || "—"}</td>
                    <td className="p-2">{line.serviceAddress || "—"}</td>
                    <td className="p-2 text-right">{line.annualUsage || "—"}</td>
                    <td className="p-2 text-right">{line.avgMonthlyUsage || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={testEmailViewOpen} onOpenChange={setTestEmailViewOpen}>
        <DialogContent className="max-w-4xl h-[min(90vh,800px)] flex flex-col">
          <DialogHeader>
            <DialogTitle>Test RFP email</DialogTitle>
          </DialogHeader>
          {testEmailFoundId ? (
            <iframe
              title="Test RFP email"
              className="flex-1 min-h-[480px] w-full rounded border bg-background"
              src={`/inbox/email/${encodeURIComponent(testEmailFoundId)}`}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={newSupplierContact != null}
        onOpenChange={(o) => {
          if (!o) setNewSupplierContact(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New contact for {newSupplierContact?.supplierName ?? "supplier"}</DialogTitle>
          </DialogHeader>
          {newSupplierContact && (
            <div className="grid gap-3">
              <div className="grid gap-2">
                <Label>Name *</Label>
                <Input
                  value={newSupplierContact.name}
                  onChange={(e) =>
                    setNewSupplierContact((c) => (c ? { ...c, name: e.target.value } : c))
                  }
                  placeholder="Contact name"
                />
              </div>
              <div className="grid gap-2">
                <Label>Email *</Label>
                <Input
                  type="email"
                  value={newSupplierContact.email}
                  onChange={(e) =>
                    setNewSupplierContact((c) => (c ? { ...c, email: e.target.value } : c))
                  }
                  placeholder="name@supplier.com"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Labels will include supplier and {energyType === "ELECTRIC" ? "electric" : "gas"} for RFP
                targeting.
              </p>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setNewSupplierContact(null)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={
                    newSupplierContact.saving ||
                    !newSupplierContact.name.trim() ||
                    !newSupplierContact.email.trim()
                  }
                  onClick={async () => {
                    if (!newSupplierContact) return;
                    setNewSupplierContact((c) => (c ? { ...c, saving: true } : c));
                    try {
                      const labelTokens =
                        energyType === "ELECTRIC"
                          ? ["supplier", "electric", "primary"]
                          : energyType === "NATURAL_GAS"
                            ? ["supplier", "gas", "primary"]
                            : ["supplier", "primary"];
                      const res = await fetch("/api/contacts", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          name: newSupplierContact.name.trim(),
                          company: newSupplierContact.supplierName,
                          supplierId: newSupplierContact.supplierId,
                          label: formatContactLabels(labelTokens),
                          emails: [{ email: newSupplierContact.email.trim(), type: "work" }],
                        }),
                      });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error || "Failed to create contact");
                      await refreshSupplierRows();
                      if (data?.id) {
                        setSelectedSupplierContactIds((prev) => ({
                          ...prev,
                          [newSupplierContact.supplierId]: String(data.id),
                        }));
                      }
                      setNewSupplierContact(null);
                    } catch (err) {
                      setResult({
                        error: err instanceof Error ? err.message : "Failed to add supplier contact",
                      });
                      setNewSupplierContact((c) => (c ? { ...c, saving: false } : c));
                    }
                  }}
                >
                  {newSupplierContact.saving ? "Saving…" : "Save contact"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={drivePickerOpen} onOpenChange={setDrivePickerOpen}>
        <DialogContent className="max-w-[min(92vw,72rem)] w-[min(92vw,72rem)]">
          <DialogHeader>
            <DialogTitle>
              {drivePickerKind === "bill"
                ? "Select Bill PDF from Google Drive"
                : drivePickerKind === "summary"
                  ? "Select Usage Summary from Google Drive"
                  : "Browse Google Drive"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {driveBreadcrumbs.length === 0 ? (
                <span className="text-sm text-muted-foreground">Loading folder path...</span>
              ) : (
                driveBreadcrumbs.map((crumb, index) => (
                  <button
                    key={crumb.id}
                    type="button"
                    className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setDrivePickerQuery("");
                      void loadDriveFiles(drivePickerKind, { query: "", folderId: crumb.id });
                    }}
                  >
                    {index > 0 && <ChevronRight className="mr-1 h-4 w-4" />}
                    {crumb.name}
                  </button>
                ))
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Input
                value={drivePickerQuery}
                onChange={(e) => setDrivePickerQuery(e.target.value)}
                placeholder="Search this folder"
              />
              <Button type="button" variant="outline" onClick={() => void loadDriveFiles(drivePickerKind)}>
                Search
              </Button>
              {drivePickerKind !== "reference" ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    (drivePickerKind === "bill" ? localBillInputRef : localSummaryInputRef).current?.click()
                  }
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Local file
                </Button>
              ) : null}
              <Select value={driveSort} onValueChange={(value) => setDriveSort(value as "name" | "modified" | "size")}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Sort: Name</SelectItem>
                  <SelectItem value="modified">Sort: Date modified</SelectItem>
                  <SelectItem value="size">Sort: File size</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {drivePickerError && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p>{drivePickerError}</p>
                {drivePickerError.toLowerCase().includes("insufficient permission") && (
                  <div className="mt-3">
                    <a
                      href="/api/gmail/connect"
                      className="inline-flex h-9 items-center justify-center rounded-md border border-amber-500 px-3 text-sm font-medium"
                    >
                      Reconnect Google with Drive access
                    </a>
                  </div>
                )}
              </div>
            )}
            <div className="max-h-[min(60vh,520px)] overflow-auto rounded-lg border">
              <div className="grid grid-cols-[minmax(12rem,2.6fr)_minmax(5rem,1fr)_minmax(6rem,1.1fr)_minmax(4rem,0.85fr)_4.5rem] gap-x-3 gap-y-1 border-b bg-muted/40 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:px-4 sm:text-xs">
                <div>Name</div>
                <div className="hidden sm:block">Owner</div>
                <div>Modified</div>
                <div className="text-right">Size</div>
                <div className="text-right">View</div>
              </div>
              {drivePickerLoading && <p className="text-sm text-muted-foreground">Loading Google Drive files...</p>}
              {!drivePickerLoading && sortedDriveFiles.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">No matching files or folders found in this location.</p>
              )}
              {sortedDriveFiles.map((file) => (
                <div
                  key={file.id}
                  role="button"
                  tabIndex={0}
                  title={file.name}
                  className="grid cursor-pointer grid-cols-[minmax(12rem,2.6fr)_minmax(5rem,1fr)_minmax(6rem,1.1fr)_minmax(4rem,0.85fr)_4.5rem] gap-x-3 gap-y-1 border-b px-3 py-2 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring sm:px-4 sm:py-3"
                  onDoubleClick={() => handleDriveEntryActivate(file)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleDriveEntryActivate(file);
                  }}
                >
                  <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                    {renderDriveFileIcon(file)}
                    <div className="min-w-0">
                      <p className="break-words font-medium leading-snug" title={file.name}>
                        {file.name}
                      </p>
                      <p className="break-words text-xs text-muted-foreground">
                        {file.isFolder ? "Folder · double-click to open" : formatDriveFileType(file)}
                      </p>
                    </div>
                    {file.isFolder ? <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" /> : null}
                  </div>
                  <div className="hidden truncate text-sm text-muted-foreground sm:block" title={file.ownerName || undefined}>
                    {file.ownerName || "—"}
                  </div>
                  <div
                    className="truncate text-xs text-muted-foreground sm:text-sm"
                    title={file.modifiedTime ? new Date(file.modifiedTime).toLocaleString() : undefined}
                  >
                    {file.modifiedTime ? new Date(file.modifiedTime).toLocaleString() : "—"}
                  </div>
                  <div
                    className="text-right text-xs text-muted-foreground sm:text-sm"
                    title={file.isFolder ? undefined : formatFileSize(file.size)}
                  >
                    {file.isFolder ? "—" : formatFileSize(file.size)}
                  </div>
                  <div className="flex justify-end">
                    {!file.isFolder ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!file.webViewLink}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!file.webViewLink || typeof window === "undefined") return;
                          window.open(file.webViewLink, "_blank", "noopener,noreferrer");
                        }}
                      >
                        View
                      </Button>
                    ) : (
                      <span className="text-muted-foreground"> </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <input
        ref={localBillInputRef}
        type="file"
        accept=".pdf,image/*"
        className="hidden"
        onChange={(e) => {
          handleLocalFileSelected("bill", e.target.files?.[0] || null);
          e.currentTarget.value = "";
        }}
      />
      <input
        ref={localSummaryInputRef}
        type="file"
        accept=".csv,.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => {
          handleLocalFileSelected("summary", e.target.files?.[0] || null);
          e.currentTarget.value = "";
        }}
      />

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>RFP email preview</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded border p-3 text-sm">
              <p><span className="font-medium">Subject:</span> {previewData?.subject || "—"}</p>
              <p className="mt-1">
                <span className="font-medium">Previewing first supplier:</span>{" "}
                {previewData?.recipientPreview[0]
                  ? `${previewData.recipientPreview[0].supplierName} - ${previewData.recipientPreview[0].contactName} (${previewData.recipientPreview[0].email})`
                  : "—"}
              </p>
              <p className="mt-1 text-muted-foreground">
                This preview shows the general email layout using the first selected supplier contact. Final send still delivers one private email per selected supplier contact.
              </p>
            </div>
            <div className="rounded border bg-white p-4">
              <div dangerouslySetInnerHTML={{ __html: previewData?.html || "" }} />
            </div>
            <div className="grid gap-2 md:grid-cols-[1fr_auto]">
              <div className="grid gap-2">
                <Label>Test email address</Label>
                <Input
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="name@example.com"
                />
              </div>
              <div className="flex items-end">
                <Button type="button" onClick={handleTestSend} disabled={testingEmail}>
                  {testingEmail ? "Sending test..." : "Send test email"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={customerDialogOpen}
        onOpenChange={(open) => {
          setCustomerDialogOpen(open);
          if (!open) {
            setAttachContactCustomerId(null);
            setCustomerDraft(emptyCustomerDraft);
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {attachContactCustomerId ? "Add contact for existing customer" : "Add customer and contact"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label>Customer name *</Label>
              <Input
                value={customerDraft.customerName}
                onChange={(e) => setCustomerDraft((current) => ({ ...current, customerName: e.target.value }))}
                disabled={attachContactCustomerId != null}
              />
            </div>
            <div className="grid gap-2">
              <Label>Company</Label>
              <Input
                value={customerDraft.company}
                onChange={(e) => setCustomerDraft((current) => ({ ...current, company: e.target.value }))}
                disabled={attachContactCustomerId != null}
              />
            </div>
            <div className="grid gap-2">
              <Label>Main email</Label>
              <Input
                value={customerDraft.email}
                onChange={(e) => setCustomerDraft((current) => ({ ...current, email: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label>Main phone</Label>
              <Input
                value={customerDraft.phone}
                onChange={(e) => setCustomerDraft((current) => ({ ...current, phone: e.target.value }))}
              />
            </div>
            <div className="grid gap-2 md:col-span-2">
              <Label>Address</Label>
              <Input
                value={customerDraft.address}
                onChange={(e) => setCustomerDraft((current) => ({ ...current, address: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label>City</Label>
              <Input
                value={customerDraft.city}
                onChange={(e) => setCustomerDraft((current) => ({ ...current, city: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label>State</Label>
              <Input
                value={customerDraft.state}
                onChange={(e) => setCustomerDraft((current) => ({ ...current, state: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label>ZIP</Label>
              <Input
                value={customerDraft.zip}
                onChange={(e) => setCustomerDraft((current) => ({ ...current, zip: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label>Customer contact name *</Label>
              <Input
                value={customerDraft.contactName}
                onChange={(e) => setCustomerDraft((current) => ({ ...current, contactName: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label>Customer contact email</Label>
              <Input
                value={customerDraft.contactEmail}
                onChange={(e) => setCustomerDraft((current) => ({ ...current, contactEmail: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label>Customer contact phone</Label>
              <Input
                value={customerDraft.contactPhone}
                onChange={(e) => setCustomerDraft((current) => ({ ...current, contactPhone: e.target.value }))}
              />
            </div>
            <div className="grid gap-2 md:col-span-2">
              <ContactLabelsField
                value={customerDraft.contactLabel}
                onChange={(contactLabel) => setCustomerDraft((current) => ({ ...current, contactLabel }))}
                presetLabels={contactLabelPresets}
                description="Include customer and the energy tag(s) (gas, electric, or both) so this person appears correctly in company picks and filters—same format as the Contacts page."
                idPrefix="rfp-add-customer-label"
              />
            </div>
            <div className="grid gap-2 md:col-span-2">
              <Label>Notes</Label>
              <textarea
                className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={customerDraft.notes}
                onChange={(e) => setCustomerDraft((current) => ({ ...current, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCustomerDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleCreateCustomer} disabled={creatingCustomer}>
                {creatingCustomer
                  ? attachContactCustomerId
                    ? "Creating contact..."
                    : "Creating..."
                  : attachContactCustomerId
                    ? "Create contact"
                    : "Create customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ChecklistItem({
  checked,
  children,
}: {
  checked: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          checked
            ? "bg-emerald-600 text-white shadow-sm dark:bg-emerald-500"
            : "bg-muted text-muted-foreground"
        }`}
      >
        {checked ? "✓" : "•"}
      </span>
      <span className={checked ? "text-foreground" : "text-muted-foreground"}>{children}</span>
    </div>
  );
}

function toNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value: number) {
  return value.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function formatNumber(value: number) {
  return value ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "";
}

function defaultMarginUnitForEnergy(energyType: EnergyType): PriceUnit {
  return energyType === "ELECTRIC" ? "KWH" : "MCF";
}

function marginUnitOptions(energyType: EnergyChoice): PriceUnit[] {
  if (energyType === "ELECTRIC") return ["KWH"];
  return ["MCF", "CCF", "DTH"];
}

function renderDriveFileIcon(file: DriveFileOption) {
  const className = "h-4 w-4 shrink-0";
  if (file.isFolder) return <Folder className={`${className} text-sky-500`} />;

  const name = file.name.toLowerCase();
  const mime = file.mimeType?.toLowerCase() || "";
  if (mime === "application/pdf" || name.endsWith(".pdf")) {
    return <FileText className={`${className} text-red-500`} />;
  }
  if (mime.startsWith("image/") || /\.(png|jpg|jpeg|gif|webp|svg)$/.test(name)) {
    return <FileImage className={`${className} text-emerald-500`} />;
  }
  if (mime.includes("sheet") || mime.includes("excel") || /\.(csv|xlsx|xls)$/.test(name)) {
    return <FileSpreadsheet className={`${className} text-green-600`} />;
  }
  if (mime.includes("text") || name.endsWith(".txt")) {
    return <FileText className={`${className} text-slate-500`} />;
  }
  return <FileText className={`${className} text-muted-foreground`} />;
}

function formatDriveFileType(file: DriveFileOption) {
  const name = file.name.toLowerCase();
  const mime = file.mimeType?.toLowerCase() || "";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "PDF";
  if (mime.startsWith("image/") || name.endsWith(".png")) return "PNG / Image";
  if (mime.includes("sheet") || mime.includes("excel") || /\.(csv|xlsx|xls)$/.test(name)) {
    return "Spreadsheet";
  }
  if (mime.includes("text") || name.endsWith(".txt")) return "Text";
  return file.mimeType || "File";
}

function formatFileSize(size?: number | null) {
  if (!size || size < 0) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function termsForCalculations(requestedTerms: RequestedTerm[], customTermMonths: string) {
  const standardTerms = requestedTerms
    .filter((term): term is "12" | "24" | "36" => term !== "NYMEX")
    .map((term) => Number(term));
  const customParts = customTermMonths
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => Number.parseInt(p, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  const combined = [...standardTerms, ...customParts];
  return Array.from(new Set(combined)).sort((a, b) => a - b);
}

function parseLabelTokens(raw: string | null | undefined) {
  if (!raw) return [];
  return raw
    .split(/[,;]+/g)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function supplierContactShowsAsPrimary(
  contact: { isPriority: boolean; label?: string | null },
  contactCount: number
) {
  if (contactCount === 1) return true;
  if (contact.isPriority) return true;
  return supplierContactLabelHasPrimaryDefault(contact);
}

function supplierContactLabelHasPrimaryDefault(contact: { label?: string | null }) {
  return parseContactLabels(contact.label).some(
    (t) => t.toLowerCase() === "primary" || t.toLowerCase() === "default"
  );
}
