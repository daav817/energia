"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Calculator,
  FileSpreadsheet,
  FileText,
  RefreshCw,
  RotateCcw,
  Send,
  Star,
  Table,
  UserPlus,
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

type EnergyType = "ELECTRIC" | "NATURAL_GAS";
type PriceUnit = "KWH" | "MCF" | "CCF" | "DTH";
type RequestedTerm = "12" | "24" | "36" | "NYMEX";

type CustomerOption = {
  id: string;
  name: string;
  company: string | null;
  contacts?: Array<{ id: string; name: string; email: string | null; phone: string | null; label: string | null }>;
};

type SupplierOption = {
  id: string;
  name: string;
  email: string | null;
  isElectric: boolean;
  isNaturalGas: boolean;
  contactLinks?: Array<{ id: string; name: string; email: string | null; phone: string | null; isPriority: boolean; label?: string | null }>;
};

type AccountLine = {
  id: string;
  accountNumber: string;
  serviceAddress: string;
  annualUsage: string;
  avgMonthlyUsage: string;
  proposedRate: string;
};

type RecentRfp = {
  id: string;
  status: string;
  energyType: EnergyType | string;
  requestedTerms: unknown;
  quoteDueDate: string | null;
  ldcUtility: string | null;
  customer: { name: string; company: string | null };
  suppliers: Array<{ id: string; name: string }>;
  accountLines: Array<{ accountNumber: string; annualUsage: string; avgMonthlyUsage: string }>;
};

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
  proposedRate: "",
});

const RFP_SESSION_KEY = "energia-rfp-wip-v1";

function validateCustomTermsInputForString(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  for (const part of t.split(/[,;]+/)) {
    const p = part.trim();
    if (!p) continue;
    if (!/^\d+$/.test(p)) {
      return `Invalid term "${p}". Use whole numbers separated by commas.`;
    }
  }
  return null;
}

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
};

export default function RfpGeneratorPage() {
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [recentRfqs, setRecentRfqs] = useState<RecentRfp[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [sendConfirmOpen, setSendConfirmOpen] = useState(false);
  const [utilitiesTableOpen, setUtilitiesTableOpen] = useState(false);
  const [customTermError, setCustomTermError] = useState<string | null>(null);

  const [customerId, setCustomerId] = useState("");
  const [customerContactId, setCustomerContactId] = useState("");
  const [energyType, setEnergyType] = useState<EnergyType | "">("");
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<string[]>([]);
  const [requestedTerms, setRequestedTerms] = useState<RequestedTerm[]>(["12", "24"]);
  const [customTermMonths, setCustomTermMonths] = useState("");
  const [contractStartMonth, setContractStartMonth] = useState("");
  const [contractStartYear, setContractStartYear] = useState("");
  const [quoteDueDate, setQuoteDueDate] = useState("");
  const [googleDriveFolderUrl, setGoogleDriveFolderUrl] = useState("");
  const [summarySpreadsheetUrl, setSummarySpreadsheetUrl] = useState("");
  const [ldcUtility, setLdcUtility] = useState("");
  const [brokerMargin, setBrokerMargin] = useState("");
  const [brokerMarginUnit, setBrokerMarginUnit] = useState<PriceUnit>("MCF");
  const [notes, setNotes] = useState("");
  const [accountLines, setAccountLines] = useState<AccountLine[]>([emptyAccountLine()]);

  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{
    success?: boolean;
    sentTo?: number;
    draftSaved?: boolean;
    error?: string;
  } | null>(null);

  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [customerDraft, setCustomerDraft] = useState(emptyCustomerDraft);
  const [focusRfpId, setFocusRfpId] = useState("");
  const [attachContactCustomerId, setAttachContactCustomerId] = useState<string | null>(null);

  useEffect(() => {
    void loadPageData();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const fromUrl = new URL(window.location.href).searchParams.get("rfpRequestId") || "";
    setFocusRfpId(fromUrl);
  }, []);

  useEffect(() => {
    if (energyType) setBrokerMarginUnit(defaultMarginUnitForEnergy(energyType));
  }, [energyType]);

  useEffect(() => {
    if (!energyType) {
      setSelectedSupplierIds([]);
      return;
    }
    setSelectedSupplierIds((current) => {
      const eligible = eligibleSuppliersForEnergy(suppliers, energyType);
      const set = new Set(eligible.map((s) => s.id));
      const kept = current.filter((id) => set.has(id));
      if (kept.length > 0) return kept;
      return eligible.map((s) => s.id);
    });
  }, [suppliers, energyType]);

  useEffect(() => {
    const selectedCustomer = customers.find((customer) => customer.id === customerId);
    const firstContactId = selectedCustomer?.contacts?.[0]?.id ?? "";
    setCustomerContactId((current) =>
      selectedCustomer?.contacts?.some((contact) => contact.id === current) ? current : firstContactId
    );
  }, [customerId, customers]);

  const eligibleSuppliers = useMemo(
    () => (energyType ? eligibleSuppliersForEnergy(suppliers, energyType) : []),
    [suppliers, energyType]
  );

  const draftRfqs = useMemo(() => recentRfqs.filter((r) => r.status === "draft"), [recentRfqs]);
  const submittedRfqs = useMemo(() => recentRfqs.filter((r) => r.status !== "draft"), [recentRfqs]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(RFP_SESSION_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as Record<string, unknown>;
      if (typeof s.customerId === "string") setCustomerId(s.customerId);
      if (typeof s.customerContactId === "string") setCustomerContactId(s.customerContactId);
      if (s.energyType === "ELECTRIC" || s.energyType === "NATURAL_GAS") setEnergyType(s.energyType);
      if (Array.isArray(s.selectedSupplierIds)) setSelectedSupplierIds(s.selectedSupplierIds as string[]);
      if (Array.isArray(s.requestedTerms)) setRequestedTerms(s.requestedTerms as RequestedTerm[]);
      if (typeof s.customTermMonths === "string") setCustomTermMonths(s.customTermMonths);
      if (typeof s.contractStartMonth === "string") setContractStartMonth(s.contractStartMonth);
      if (typeof s.contractStartYear === "string") setContractStartYear(s.contractStartYear);
      if (typeof s.quoteDueDate === "string") setQuoteDueDate(s.quoteDueDate);
      if (typeof s.googleDriveFolderUrl === "string") setGoogleDriveFolderUrl(s.googleDriveFolderUrl);
      if (typeof s.summarySpreadsheetUrl === "string") setSummarySpreadsheetUrl(s.summarySpreadsheetUrl);
      if (typeof s.ldcUtility === "string") setLdcUtility(s.ldcUtility);
      if (typeof s.brokerMargin === "string") setBrokerMargin(s.brokerMargin);
      if (s.brokerMarginUnit === "KWH" || s.brokerMarginUnit === "MCF" || s.brokerMarginUnit === "CCF" || s.brokerMarginUnit === "DTH") setBrokerMarginUnit(s.brokerMarginUnit);
      if (typeof s.notes === "string") setNotes(s.notes);
      if (Array.isArray(s.accountLines)) setAccountLines(s.accountLines as AccountLine[]);
      if (typeof s.draftId === "string" || s.draftId === null) setDraftId(s.draftId);
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        sessionStorage.setItem(
          RFP_SESSION_KEY,
          JSON.stringify({
            customerId,
            customerContactId,
            energyType,
            selectedSupplierIds,
            requestedTerms,
            customTermMonths,
            contractStartMonth,
            contractStartYear,
            quoteDueDate,
            googleDriveFolderUrl,
            summarySpreadsheetUrl,
            ldcUtility,
            brokerMargin,
            brokerMarginUnit,
            notes,
            accountLines,
            draftId,
          })
        );
      } catch {
        /* ignore */
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [
    customerId,
    customerContactId,
    energyType,
    selectedSupplierIds,
    requestedTerms,
    customTermMonths,
    contractStartMonth,
    contractStartYear,
    quoteDueDate,
    googleDriveFolderUrl,
    summarySpreadsheetUrl,
    ldcUtility,
    brokerMargin,
    brokerMarginUnit,
    notes,
    accountLines,
    draftId,
  ]);
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

  const selectedCustomer = customers.find((customer) => customer.id === customerId) ?? null;
  const customerContacts = selectedCustomer?.contacts ?? [];
  const selectedCustomerHasContacts = customerContacts.length > 0;

  const totals = useMemo(() => {
    return accountLines.reduce(
      (acc, line) => {
        const annualUsage = toNumber(line.annualUsage);
        const avgMonthlyUsage = toNumber(line.avgMonthlyUsage);
        const proposedRate = toNumber(line.proposedRate);
        const margin = toNumber(brokerMargin);
        const monthsToUse = termsForCalculations(requestedTerms, customTermMonths);

        acc.totalAnnualUsage += annualUsage;
        acc.totalAvgMonthlyUsage += avgMonthlyUsage;

        for (const months of monthsToUse) {
          const brokerIncome = avgMonthlyUsage * months * margin;
          const contractValue = avgMonthlyUsage * months * (proposedRate + margin);
          acc.byTerm[months] = acc.byTerm[months] || { brokerIncome: 0, contractValue: 0 };
          acc.byTerm[months].brokerIncome += brokerIncome;
          acc.byTerm[months].contractValue += contractValue;
        }

        return acc;
      },
      {
        totalAnnualUsage: 0,
        totalAvgMonthlyUsage: 0,
        byTerm: {} as Record<number, { brokerIncome: number; contractValue: number }>,
      }
    );
  }, [accountLines, brokerMargin, requestedTerms, customTermMonths]);

  async function loadPageData() {
    setLoading(true);
    try {
      const [customersRes, suppliersRes, rfpRes] = await Promise.all([
        fetch("/api/customers?contacts=1"),
        fetch("/api/suppliers?contacts=1&filter=all"),
        fetch("/api/rfp"),
      ]);
      const [customersData, suppliersData, rfpData] = await Promise.all([
        customersRes.json(),
        suppliersRes.json(),
        rfpRes.json(),
      ]);

      setCustomers(Array.isArray(customersData) ? customersData : []);
      setSuppliers(Array.isArray(suppliersData) ? suppliersData : []);
      setRecentRfqs(Array.isArray(rfpData) ? rfpData.slice(0, 40) : []);
    } finally {
      setLoading(false);
    }
  }

  function toggleSupplier(supplierId: string) {
    setSelectedSupplierIds((current) =>
      current.includes(supplierId)
        ? current.filter((id) => id !== supplierId)
        : [...current, supplierId]
    );
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
          ? customers.find((customer) => customer.id === attachContactCustomerId) ?? null
          : null;

      let customerData:
        | {
            id: string;
            name: string;
            company: string | null;
          }
        | null = targetCustomer
        ? { id: targetCustomer.id, name: targetCustomer.name, company: targetCustomer.company }
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
            targetCustomer?.name ||
            "Customer Contact",
          email: customerDraft.contactEmail || customerDraft.email || undefined,
          phone: customerDraft.contactPhone || customerDraft.phone || undefined,
          company: customerDraft.company || targetCustomer?.company || undefined,
          label: "customer",
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

      await loadPageData();
      setCustomerId(customerData.id);
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

  function validateCustomTermsInput(): string | null {
    return validateCustomTermsInputForString(customTermMonths);
  }

  function requestSendConfirm(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    const termErr = validateCustomTermsInput();
    setCustomTermError(termErr);
    if (termErr) return;
    if (!customerId) {
      setResult({ error: "Select a customer company." });
      return;
    }
    if (!customerContactId) {
      setResult({ error: "Select a customer contact." });
      return;
    }
    if (!energyType) {
      setResult({ error: "Select an energy type." });
      return;
    }
    if (selectedSupplierIds.length === 0) {
      setResult({ error: "Select at least one supplier to include." });
      return;
    }
    setSendConfirmOpen(true);
  }

  async function executeSend() {
    setSendConfirmOpen(false);
    if (!energyType) return;
    setSending(true);
    setResult(null);
    try {
      const response = await fetch("/api/rfp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          customerContactId,
          energyType,
          supplierIds: selectedSupplierIds,
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
          notes: notes || undefined,
          accountLines: accountLines.map((line) => ({
            accountNumber: line.accountNumber,
            serviceAddress: line.serviceAddress || undefined,
            annualUsage: line.annualUsage,
            avgMonthlyUsage: line.avgMonthlyUsage,
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to send RFP");

      setResult({ success: true, sentTo: data.sentTo, draftSaved: false });
      try {
        sessionStorage.removeItem(RFP_SESSION_KEY);
      } catch {
        /* ignore */
      }
      setDraftId(null);
      await loadPageData();
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "Failed to send RFP" });
    } finally {
      setSending(false);
    }
  }

  async function saveDraft() {
    if (!customerId || !energyType) {
      setResult({ error: "Select a customer and energy type before saving a draft." });
      return;
    }
    const termErr = validateCustomTermsInput();
    setCustomTermError(termErr);
    if (termErr) return;
    setSavingDraft(true);
    setResult(null);
    try {
      const res = await fetch("/api/rfp/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: draftId ?? undefined,
          customerId,
          customerContactId: customerContactId || undefined,
          energyType,
          supplierIds: selectedSupplierIds,
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
          notes: notes || undefined,
          accountLines: accountLines.map((line) => ({
            accountNumber: line.accountNumber,
            serviceAddress: line.serviceAddress || undefined,
            annualUsage: line.annualUsage,
            avgMonthlyUsage: line.avgMonthlyUsage,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save draft");
      setDraftId(data.id);
      await loadPageData();
      setResult({ success: true, draftSaved: true });
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "Failed to save draft" });
    } finally {
      setSavingDraft(false);
    }
  }

  function clearWorkspaceForm() {
    setCustomerId("");
    setCustomerContactId("");
    setEnergyType("");
    setSelectedSupplierIds([]);
    setRequestedTerms(["12", "24"]);
    setCustomTermMonths("");
    setContractStartMonth("");
    setContractStartYear("");
    setQuoteDueDate("");
    setGoogleDriveFolderUrl("");
    setSummarySpreadsheetUrl("");
    setLdcUtility("");
    setBrokerMargin("");
    setBrokerMarginUnit("MCF");
    setNotes("");
    setAccountLines([emptyAccountLine()]);
    setDraftId(null);
    setResult(null);
    setCustomTermError(null);
    try {
      sessionStorage.removeItem(RFP_SESSION_KEY);
    } catch {
      /* ignore */
    }
  }

  async function hydrateDraftFromServer(id: string) {
    try {
      const res = await fetch(`/api/rfp/${encodeURIComponent(id)}`);
      const row = await res.json();
      if (!res.ok) throw new Error(row.error || "Failed to load draft");
      if (row.status !== "draft") return;
      setDraftId(row.id);
      setCustomerId(row.customerId ?? "");
      setCustomerContactId(row.customerContactId ?? "");
      setEnergyType((row.energyType as EnergyType) ?? "");
      setQuoteDueDate(row.quoteDueDate ? String(row.quoteDueDate).slice(0, 10) : "");
      setContractStartMonth(row.contractStartMonth != null ? String(row.contractStartMonth) : "");
      setContractStartYear(row.contractStartYear != null ? String(row.contractStartYear) : "");
      setGoogleDriveFolderUrl(row.googleDriveFolderUrl ?? "");
      setSummarySpreadsheetUrl(row.summarySpreadsheetUrl ?? "");
      setLdcUtility(row.ldcUtility ?? "");
      setBrokerMargin(row.brokerMargin != null ? String(row.brokerMargin) : "");
      if (row.brokerMarginUnit === "KWH" || row.brokerMarginUnit === "MCF" || row.brokerMarginUnit === "CCF" || row.brokerMarginUnit === "DTH") setBrokerMarginUnit(row.brokerMarginUnit);
      setNotes(row.notes ?? "");
      setSelectedSupplierIds((row.suppliers as { id: string }[] | undefined)?.map((s) => s.id) ?? []);
      const terms = row.requestedTerms;
      if (Array.isArray(terms)) {
        const preset: RequestedTerm[] = [];
        const customParts: string[] = [];
        for (const entry of terms) {
          if (typeof entry === "string" && entry === "NYMEX") preset.push("NYMEX");
          else if (typeof entry === "string" && ["12", "24", "36"].includes(entry)) {
            preset.push(entry as RequestedTerm);
          } else if (entry && typeof entry === "object" && "kind" in entry) {
            const o = entry as { kind: string; months?: number };
            if (o.kind === "nymex") preset.push("NYMEX");
            else if (o.kind === "months" && o.months && ![12, 24, 36].includes(o.months)) {
              customParts.push(String(o.months));
            } else if (o.kind === "months" && o.months && [12, 24, 36].includes(o.months)) {
              preset.push(String(o.months) as RequestedTerm);
            }
          }
        }
        const uniqPreset = Array.from(new Set(preset));
        if (uniqPreset.length > 0) setRequestedTerms(uniqPreset);
        else if (customParts.length > 0) setRequestedTerms([]);
        else setRequestedTerms(["12", "24"]);
        setCustomTermMonths(customParts.join(", "));
      }
      const lines = row.accountLines as Array<{
        accountNumber: string;
        serviceAddress?: string | null;
        annualUsage: string | number;
        avgMonthlyUsage: string | number;
      }>;
      if (Array.isArray(lines) && lines.length > 0) {
        setAccountLines(
          lines.map((L) => ({
            id: crypto.randomUUID(),
            accountNumber: L.accountNumber,
            serviceAddress: L.serviceAddress ?? "",
            annualUsage: String(L.annualUsage),
            avgMonthlyUsage: String(L.avgMonthlyUsage),
            proposedRate: "",
          }))
        );
      }
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "Failed to load draft" });
    }
  }

  async function refreshSuppliersOnly() {
    try {
      const suppliersRes = await fetch("/api/suppliers?contacts=1&filter=all");
      const suppliersData = await suppliersRes.json();
      setSuppliers(Array.isArray(suppliersData) ? suppliersData : []);
    } catch {
      /* ignore */
    }
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
        <div className="flex flex-wrap gap-2 justify-end">
          <Button type="button" variant="outline" onClick={refreshSuppliersOnly}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh suppliers
          </Button>
          <Button type="button" variant="outline" onClick={() => void saveDraft()} disabled={savingDraft}>
            {savingDraft ? "Saving…" : "Save draft"}
          </Button>
          <Button type="button" variant="outline" onClick={clearWorkspaceForm}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Clear page
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setAttachContactCustomerId(null);
              setCustomerDraft(emptyCustomerDraft);
              setCustomerDialogOpen(true);
            }}
          >
            <UserPlus className="mr-2 h-4 w-4" />
            Add customer + contact
          </Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]">
        <form onSubmit={requestSendConfirm} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                RFP details
              </CardTitle>
              <CardDescription>
                Choose the customer, energy type, requested terms, return date, and bill package.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Customer *</Label>
                  <Select value={customerId} onValueChange={setCustomerId}>
                    <SelectTrigger>
                      <SelectValue placeholder={loading ? "Loading customers..." : "Select customer"} />
                    </SelectTrigger>
                    <SelectContent>
                      {customers.map((customer) => (
                        <SelectItem key={customer.id} value={customer.id}>
                          {`${customer.name}${customer.company ? ` (${customer.company})` : ""}${
                            Array.isArray(customer.contacts) && customer.contacts.length === 0
                              ? " - no contact on file"
                              : ""
                          }`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Customers without contacts can still be selected, but a customer contact must be added before sending the RFP.
                  </p>
                </div>

                <div className="grid gap-2">
                  <Label>Customer contact *</Label>
                  <Select
                    value={customerContactId}
                    onValueChange={setCustomerContactId}
                    disabled={!customerId || customerContacts.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select customer contact" />
                    </SelectTrigger>
                    <SelectContent>
                      {customerContacts.map((contact) => (
                        <SelectItem key={contact.id} value={contact.id}>
                          {`${contact.name}${contact.email ? ` — ${contact.email}` : ""}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {selectedCustomer && !selectedCustomerHasContacts && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  <p>{selectedCustomer.name} does not have a linked customer contact yet.</p>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-3"
                    onClick={() => {
                      setAttachContactCustomerId(selectedCustomer.id);
                      setCustomerDraft((current) => ({
                        ...current,
                        customerName: selectedCustomer.name,
                        company: selectedCustomer.company || "",
                      }));
                      setCustomerDialogOpen(true);
                    }}
                  >
                    Add contact for this customer
                  </Button>
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Energy type *</Label>
                  <Select
                    value={energyType || "__none__"}
                    onValueChange={(value) =>
                      setEnergyType(value === "__none__" ? "" : (value as EnergyType))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select energy type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Select energy type…</SelectItem>
                      <SelectItem value="ELECTRIC">Electric</SelectItem>
                      <SelectItem value="NATURAL_GAS">Natural gas</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label>LDC / utility *</Label>
                  <Select
                    value={
                      UTILITY_OPTIONS.includes(ldcUtility)
                        ? ldcUtility
                        : ldcUtility.trim()
                          ? "__custom__"
                          : "__none__"
                    }
                    onValueChange={(v) => {
                      if (v === "__none__") setLdcUtility("");
                      else if (v === "__custom__") setLdcUtility("");
                      else setLdcUtility(v);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select utility" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value="__none__">Select…</SelectItem>
                      {UTILITY_OPTIONS.map((utility) => (
                        <SelectItem key={utility} value={utility}>
                          {utility}
                        </SelectItem>
                      ))}
                      <SelectItem value="__custom__">Other…</SelectItem>
                    </SelectContent>
                  </Select>
                  {(() => {
                    const sel = UTILITY_OPTIONS.includes(ldcUtility)
                      ? ldcUtility
                      : ldcUtility.trim()
                        ? "__custom__"
                        : "__none__";
                    const showFreeText =
                      sel === "__custom__" ||
                      (ldcUtility.trim() !== "" && !UTILITY_OPTIONS.includes(ldcUtility));
                    return showFreeText ? (
                      <Input
                        value={ldcUtility}
                        onChange={(e) => setLdcUtility(e.target.value)}
                        placeholder="Utility name"
                      />
                    ) : null;
                  })()}
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
                      setCustomTermMonths(e.target.value);
                      setCustomTermError(validateCustomTermsInputForString(e.target.value));
                    }}
                    placeholder="Comma-separated, e.g. 18, 30, 42"
                  />
                  {customTermError && (
                    <p className="text-xs text-destructive">{customTermError}</p>
                  )}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="grid gap-2">
                  <Label>Contract start month *</Label>
                  <Input
                    type="number"
                    min="1"
                    max="12"
                    value={contractStartMonth}
                    onChange={(e) => setContractStartMonth(e.target.value)}
                    placeholder="MM"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Contract start year *</Label>
                  <Input
                    type="number"
                    min="2026"
                    value={contractStartYear}
                    onChange={(e) => setContractStartYear(e.target.value)}
                    placeholder="YYYY"
                  />
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
                  <Label>Google Drive bill folder *</Label>
                  <Input
                    value={googleDriveFolderUrl}
                    onChange={(e) => setGoogleDriveFolderUrl(e.target.value)}
                    placeholder="https://drive.google.com/..."
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Summary spreadsheet link</Label>
                  <Input
                    value={summarySpreadsheetUrl}
                    onChange={(e) => setSummarySpreadsheetUrl(e.target.value)}
                    placeholder="Required when multiple utility accounts are included"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                {energyType === "ELECTRIC"
                  ? "Select electric suppliers"
                  : energyType === "NATURAL_GAS"
                    ? "Select natural gas suppliers"
                    : "Select suppliers"}
              </CardTitle>
              <CardDescription>
                Choose who receives the RFP (toggle off suppliers to exclude them). List filters by energy
                type and contact labels.
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
                  {energyType
                    ? `No suppliers are currently tagged for ${energyType === "ELECTRIC" ? "electric" : "natural gas"}.`
                    : "Select an energy type to load matching suppliers."}
                </p>
              )}
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-400" />
                Primary / only contact for that supplier (default recipient).
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                {eligibleSuppliers.map((supplier) => {
                  const selected = selectedSupplierIds.includes(supplier.id);
                  const links = supplier.contactLinks ?? [];
                  const primaryEmail =
                    links.find((c) => c.isPriority)?.email ||
                    links.find((c) => c.email)?.email ||
                    supplier.email;
                  const onlyOne = links.length === 1;
                  return (
                    <button
                      key={supplier.id}
                      type="button"
                      onClick={() => toggleSupplier(supplier.id)}
                      className={`rounded-lg border p-4 text-left transition ${
                        selected ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium flex items-center gap-1.5">
                            {supplier.name}
                            {onlyOne && (
                              <span className="inline-flex shrink-0" title="Single supplier contact on file">
                                <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-400" aria-hidden />
                              </span>
                            )}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {primaryEmail || "No email on file"}
                          </p>
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {selected ? "Included" : "Excluded"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <FileSpreadsheet className="h-5 w-5" />
                    Utility accounts and usage
                  </CardTitle>
                  <CardDescription>
                    Enter one line per meter or utility account from the customer bills.
                  </CardDescription>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => setUtilitiesTableOpen(true)}>
                  <Table className="mr-2 h-4 w-4" />
                  Table for email
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
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
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
                  <div className="grid gap-2 md:max-w-[220px]">
                    <Label>Proposed rate for estimate</Label>
                    <Input
                      type="number"
                      step="0.000001"
                      value={line.proposedRate}
                      onChange={(e) => updateAccountLine(line.id, "proposedRate", e.target.value)}
                      placeholder="Optional quote preview"
                    />
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
                Broker margin and value preview
              </CardTitle>
              <CardDescription>
                Estimate broker income and contract value before the RFP goes out.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 md:grid-cols-3">
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
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {termsForCalculations(requestedTerms, customTermMonths).map((months) => (
                  <div key={months} className="rounded-lg border bg-muted/40 p-4 space-y-2">
                    <p className="text-sm text-muted-foreground">{months}-month view</p>
                    <p className="text-sm">
                      Broker income:{" "}
                      <span className="font-semibold">
                        {formatCurrency(totals.byTerm[months]?.brokerIncome ?? 0)}
                      </span>
                    </p>
                    <p className="text-sm">
                      Contract value:{" "}
                      <span className="font-semibold">
                        {formatCurrency(totals.byTerm[months]?.contractValue ?? 0)}
                      </span>
                    </p>
                  </div>
                ))}
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

              {result?.success && result.draftSaved && (
                <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
                  Draft saved. You can resume from Unsubmitted RFPs.
                </div>
              )}
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

              <Button type="submit" disabled={sending}>
                <Send className="mr-2 h-4 w-4" />
                {sending ? "Sending RFP..." : "Send RFP"}
              </Button>
            </CardContent>
          </Card>
        </form>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Quick checklist</CardTitle>
              <CardDescription>Before sending, make sure the package is complete.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <ChecklistItem checked={Boolean(customerId && customerContactId)}>
                Customer and contact selected
              </ChecklistItem>
              <ChecklistItem checked={Boolean(energyType)}>
                Energy type selected (electric or natural gas)
              </ChecklistItem>
              <ChecklistItem checked={selectedSupplierIds.length > 0}>
                At least one supplier included
              </ChecklistItem>
              <ChecklistItem checked={Boolean(googleDriveFolderUrl)}>
                Google Drive bill folder linked
              </ChecklistItem>
              <ChecklistItem checked={accountLines.every((line) => line.accountNumber && line.annualUsage && line.avgMonthlyUsage)}>
                Utility account lines completed
              </ChecklistItem>
              <ChecklistItem checked={accountLines.length === 1 || Boolean(summarySpreadsheetUrl)}>
                Summary spreadsheet attached when multiple accounts exist
              </ChecklistItem>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Unsubmitted RFPs</CardTitle>
              <CardDescription>Drafts saved in the database. Click to load into the form.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {draftRfqs.length === 0 && (
                <p className="text-sm text-muted-foreground">No drafts yet. Use Save draft.</p>
              )}
              {draftRfqs.map((rfp) => (
                <button
                  key={rfp.id}
                  type="button"
                  onClick={() => void hydrateDraftFromServer(rfp.id)}
                  className={`w-full rounded-lg border p-4 text-left transition hover:bg-muted/50 ${
                    focusRfpId === rfp.id ? "border-primary bg-primary/5" : ""
                  }`}
                >
                  <p className="font-medium">{rfp.customer.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {rfp.energyType === "ELECTRIC" ? "Electric" : "Natural gas"} · draft
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Click to continue editing</p>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Submitted RFPs</CardTitle>
              <CardDescription>Sent requests and follow-up.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
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
                      href={`/communications/quotes?rfpRequestId=${rfp.id}`}
                      className="inline-flex h-9 items-center justify-center rounded-md border px-3 text-sm font-medium"
                    >
                      Review quotes
                    </Link>
                    <Link
                      href={`/directory/contracts?rfpRequestId=${encodeURIComponent(rfp.id)}`}
                      className="inline-flex h-9 items-center justify-center rounded-md border border-primary px-3 text-sm font-medium"
                    >
                      Add contract (closeout)
                    </Link>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={utilitiesTableOpen} onOpenChange={setUtilitiesTableOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Utility accounts (for email)</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Use this table when you want a clean account summary paste into the supplier email body.
          </p>
          <table className="mt-4 w-full text-sm border-collapse border border-border">
            <thead>
              <tr className="bg-muted/50">
                <th className="border border-border p-2 text-left font-medium">Account #</th>
                <th className="border border-border p-2 text-left font-medium">Service address</th>
                <th className="border border-border p-2 text-right font-medium">Annual usage</th>
                <th className="border border-border p-2 text-right font-medium">Avg monthly</th>
              </tr>
            </thead>
            <tbody>
              {accountLines.map((line) => (
                <tr key={line.id}>
                  <td className="border border-border p-2">{line.accountNumber.trim() || "—"}</td>
                  <td className="border border-border p-2">{line.serviceAddress.trim() || "—"}</td>
                  <td className="border border-border p-2 text-right">{line.annualUsage.trim() || "—"}</td>
                  <td className="border border-border p-2 text-right">{line.avgMonthlyUsage.trim() || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setUtilitiesTableOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={sendConfirmOpen}
        onOpenChange={setSendConfirmOpen}
        title="Send RFP to suppliers?"
        message={`One separate email will be sent to each of ${selectedSupplierIds.length} supplier(s), and calendar reminders will be created. Continue?`}
        confirmLabel="Send now"
        cancelLabel="Cancel"
        variant="default"
        onConfirm={() => void executeSend()}
      />

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
        className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${
          checked ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
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

function marginUnitOptions(energyType: EnergyType | ""): PriceUnit[] {
  if (!energyType) return ["KWH", "MCF", "CCF", "DTH"];
  return energyType === "ELECTRIC" ? ["KWH"] : ["MCF", "CCF", "DTH"];
}

function termsForCalculations(requestedTerms: RequestedTerm[], customTermMonths: string) {
  const standardTerms = requestedTerms
    .filter((term): term is "12" | "24" | "36" => term !== "NYMEX")
    .map((term) => Number(term));
  const customParts: number[] = [];
  for (const part of customTermMonths
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    const n = Number.parseInt(part, 10);
    if (Number.isFinite(n) && n > 0) customParts.push(n);
  }
  return Array.from(new Set([...standardTerms, ...customParts])).sort((a, b) => a - b);
}

function eligibleSuppliersForEnergy(suppliers: SupplierOption[], energyType: EnergyType) {
  return suppliers.filter((supplier) => {
    const energyFlag = energyType === "ELECTRIC" ? supplier.isElectric : supplier.isNaturalGas;
    const labelMatch = supplier.contactLinks?.some((contact) => {
      const labels = parseLabelTokens(contact.label);
      return energyType === "ELECTRIC" ? labels.includes("electric") : labels.includes("gas");
    });
    return Boolean(energyFlag || labelMatch);
  });
}

function parseLabelTokens(raw: string | null | undefined) {
  if (!raw) return [];
  return raw
    .split(/[,;]+/g)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}
