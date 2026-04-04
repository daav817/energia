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
  Send,
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
import { ContactLabelsField } from "@/components/contact-labels-field";
import { formatContactLabels, parseContactLabels } from "@/lib/contact-labels";
import {
  filterSupplierContactsForRfpEnergy,
  pickDefaultSupplierContactId,
} from "@/lib/supplier-rfp-contacts";

type EnergyType = "ELECTRIC" | "NATURAL_GAS";
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
  customer: { name: string; company: string | null };
  suppliers: Array<{ id: string; name: string }>;
  accountLines: Array<{ accountNumber: string; annualUsage: string; avgMonthlyUsage: string }>;
};

function defaultCustomerContactLabels(energy: EnergyType): string {
  const parts: string[] = ["customer"];
  if (energy === "NATURAL_GAS") parts.push("gas");
  if (energy === "ELECTRIC") parts.push("electric");
  return formatContactLabels(parts);
}

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

export default function RfpGeneratorPage() {
  const [customerCompanies, setCustomerCompanies] = useState<CustomerCompanyOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [recentRfqs, setRecentRfqs] = useState<RecentRfp[]>([]);
  const [loading, setLoading] = useState(true);

  const [customerCompanyId, setCustomerCompanyId] = useState("");
  const [customerCompanySearch, setCustomerCompanySearch] = useState("");
  const [customerCompanyDropdownOpen, setCustomerCompanyDropdownOpen] = useState(false);
  const [customerContactId, setCustomerContactId] = useState("");
  const [energyType, setEnergyType] = useState<EnergyType>("NATURAL_GAS");
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<string[]>([]);
  const [selectedSupplierContactIds, setSelectedSupplierContactIds] = useState<Record<string, string>>({});
  const [requestedTerms, setRequestedTerms] = useState<RequestedTerm[]>(["12", "24"]);
  const [customTermMonths, setCustomTermMonths] = useState("");
  const [contractStartValue, setContractStartValue] = useState("");
  const [quoteDueDate, setQuoteDueDate] = useState("");
  const [googleDriveFolderUrl, setGoogleDriveFolderUrl] = useState("");
  const [summarySpreadsheetUrl, setSummarySpreadsheetUrl] = useState("");
  const [ldcUtility, setLdcUtility] = useState("");
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

  useEffect(() => {
    void loadPageData();
  }, []);

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
    return suppliers
      .filter((supplier) => {
        const forEnergy = filterSupplierContactsForRfpEnergy(supplier.contactLinks ?? [], energyType);
        return forEnergy.length > 0;
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [suppliers, energyType]);

  useEffect(() => {
    setBrokerMarginUnit(defaultMarginUnitForEnergy(energyType));
  }, [energyType]);

  useEffect(() => {
    setSelectedSupplierIds(eligibleSuppliers.map((s) => s.id));
  }, [eligibleSuppliers]);

  useEffect(() => {
    setSelectedSupplierContactIds((current) => {
      const next: Record<string, string> = {};
      for (const supplier of eligibleSuppliers) {
        const forEnergy = filterSupplierContactsForRfpEnergy(supplier.contactLinks ?? [], energyType);
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
  const suppliersTableRows = useMemo(
    () =>
      eligibleSuppliers.map((supplier) => {
        const all = supplier.contactLinks ?? [];
        const contacts = filterSupplierContactsForRfpEnergy(all, energyType);
        const defaultId = pickDefaultSupplierContactId(contacts);
        const selectedContactId = selectedSupplierContactIds[supplier.id] || defaultId || "";
        const selectedContact = contacts.find((c) => c.id === selectedContactId) || null;
        return {
          supplier,
          contacts,
          selectedContact,
          selectedContactId,
        };
      }),
    [eligibleSuppliers, energyType, selectedSupplierContactIds]
  );
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
    if (customTermMonths.trim()) parts.push(`custom ${customTermMonths} mo`);
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
      setRecentRfqs(Array.isArray(rfpData) ? rfpData.slice(0, 6) : []);
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

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setResult(null);
    try {
      const validationError = validateRfpRequest();
      if (validationError) throw new Error(validationError);
      const response = await sendRfpRequest("send");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to send RFP");

      setResult({ success: true, sentTo: data.sentTo });
      await loadPageData();
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "Failed to send RFP" });
    } finally {
      setSending(false);
    }
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
    return {
      mode,
      customerId: resolvedCustomerIdForValidation || "",
      customerContactId,
      energyType,
      supplierIds: selectedSupplierIds,
      supplierContactIds: Object.values(selectedSupplierContactIds),
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
    };
  }

    return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">RFP workspace</h1>
          <p className="text-muted-foreground">
            Build a supplier request from customer bills, choose the right suppliers, and preview
            broker economics before the email goes out.
          </p>
        </div>
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
                      onClick={() => setEnergyType("NATURAL_GAS")}
                    >
                      Natural Gas
                    </Button>
                    <Button
                      type="button"
                      variant={energyType === "ELECTRIC" ? "default" : "outline"}
                      onClick={() => setEnergyType("ELECTRIC")}
                    >
                      Electric
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Choose one energy type for this RFP.
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
                  <Input
                    list="rfp-utilities"
                    value={ldcUtility}
                    onChange={(e) => setLdcUtility(e.target.value)}
                    placeholder="Start typing utility name"
                  />
                  <datalist id="rfp-utilities">
                    {UTILITY_OPTIONS.map((utility) => (
                      <option key={utility} value={utility} />
                    ))}
                  </datalist>
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
                <div className="grid gap-2 md:max-w-[220px]">
                  <Label htmlFor="custom-term">Custom term (months)</Label>
                  <Input
                    id="custom-term"
                    type="number"
                    min="1"
                    value={customTermMonths}
                    onChange={(e) => setCustomTermMonths(e.target.value)}
                    placeholder="Optional"
                  />
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
            <CardHeader>
              <CardTitle>Select suppliers</CardTitle>
              <CardDescription>
                Rows are directory suppliers that have at least one contact labeled{" "}
                <span className="font-medium">supplier</span> (or vendor) with{" "}
                <span className="font-medium">{energyType === "ELECTRIC" ? "electric" : "gas"}</span> on the same
                label. Changing the main contact moves the <span className="font-medium">primary</span> /{" "}
                <span className="font-medium">default</span> label to that person for future RFPs.
              </CardDescription>
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
                  <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1.35fr)_minmax(0,1.2fr)] gap-3 border-b bg-muted/40 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <div>Supplier</div>
                    <div>Main contact</div>
                    <div>Email</div>
                  </div>
                  {suppliersTableRows.map(({ supplier, contacts, selectedContact, selectedContactId }) => (
                    <div
                      key={supplier.id}
                      className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1.35fr)_minmax(0,1.2fr)] gap-3 border-b px-4 py-3 text-sm last:border-b-0"
                    >
                      <div className="min-w-0 flex items-center">
                        <p className="truncate font-medium">{supplier.name}</p>
                      </div>
                      <div className="min-w-0">
                        {contacts.length > 0 ? (
                          <Select
                            value={selectedContactId || undefined}
                            onValueChange={(value) => void onSupplierMainContactChange(supplier.id, value)}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="Select contact" />
                            </SelectTrigger>
                            <SelectContent>
                              {contacts.map((contact) => {
                                const hasEmail = Boolean((contact.email || "").trim());
                                const primaryHint = supplierContactShowsAsPrimary(contact);
                                return (
                                  <SelectItem key={contact.id} value={contact.id} disabled={!hasEmail}>
                                    {`${contact.name}${primaryHint ? " ★" : ""}`}
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                        ) : (
                          <p className="text-muted-foreground">—</p>
                        )}
                      </div>
                      <div className="min-w-0 flex items-center">
                        <p className="truncate">{selectedContact?.email || "—"}</p>
                      </div>
                    </div>
                  ))}
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
                <Button type="button" variant="outline" className="shrink-0" onClick={() => openDrivePicker("reference")}>
                  <FolderOpen className="mr-2 h-4 w-4" />
                  Browse Google Drive
                </Button>
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
                </div>
                <Button type="submit" disabled={sending}>
                  <Send className="mr-2 h-4 w-4" />
                  {sending ? "Sending RFP..." : "Send RFP"}
                </Button>
              </div>

              {result?.success && (
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
              <CardDescription>Latest requests saved in the system.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {recentRfqs.length === 0 && (
                <p className="text-sm text-muted-foreground">No RFP requests have been sent yet.</p>
              )}
              {recentRfqs.map((rfp) => (
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
                    <Link
                      href={`/quotes?rfpRequestId=${rfp.id}`}
                      className="inline-flex h-9 items-center justify-center rounded-md border px-3 text-sm font-medium"
                    >
                      Review quotes
                    </Link>
                  </div>
                </div>
              ))}
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

      <Dialog open={drivePickerOpen} onOpenChange={setDrivePickerOpen}>
        <DialogContent className="max-w-[53rem]">
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
            <div className="max-h-[420px] overflow-auto rounded-lg border">
              <div className="grid grid-cols-[minmax(0,2.4fr)_1fr_1fr_0.7fr_4.5rem] gap-3 border-b bg-muted/40 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <div>Name</div>
                <div>Owner</div>
                <div>Date Modified</div>
                <div className="text-right">File Size</div>
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
                  className="grid cursor-pointer grid-cols-[minmax(0,2.4fr)_1fr_1fr_0.7fr_4.5rem] gap-3 border-b px-4 py-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
                  onDoubleClick={() => handleDriveEntryActivate(file)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleDriveEntryActivate(file);
                  }}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {renderDriveFileIcon(file)}
                    <div className="min-w-0">
                      <p className="truncate font-medium">{file.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {file.isFolder ? "Folder · double-click to open" : formatDriveFileType(file)}
                      </p>
                    </div>
                    {file.isFolder ? <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" /> : null}
                  </div>
                  <div className="truncate text-sm text-muted-foreground">{file.ownerName || "—"}</div>
                  <div className="truncate text-sm text-muted-foreground">
                    {file.modifiedTime ? new Date(file.modifiedTime).toLocaleString() : "—"}
                  </div>
                  <div className="text-right text-sm text-muted-foreground">{file.isFolder ? "—" : formatFileSize(file.size)}</div>
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

function marginUnitOptions(energyType: EnergyType): PriceUnit[] {
  return energyType === "ELECTRIC" ? ["KWH"] : ["MCF", "CCF", "DTH"];
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
  const custom = Number.parseInt(customTermMonths, 10);
  const combined = Number.isFinite(custom) && custom > 0 ? [...standardTerms, custom] : standardTerms;
  return Array.from(new Set(combined)).sort((a, b) => a - b);
}

function parseLabelTokens(raw: string | null | undefined) {
  if (!raw) return [];
  return raw
    .split(/[,;]+/g)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function supplierContactShowsAsPrimary(contact: { isPriority: boolean; label?: string | null }) {
  if (contact.isPriority) return true;
  return supplierContactLabelHasPrimaryDefault(contact);
}

function supplierContactLabelHasPrimaryDefault(contact: { label?: string | null }) {
  return parseContactLabels(contact.label).some(
    (t) => t.toLowerCase() === "primary" || t.toLowerCase() === "default"
  );
}
