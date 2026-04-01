"use client";

import { useEffect, useMemo, useState } from "react";
import { Calculator, FileSpreadsheet, FileText, Send, UserPlus } from "lucide-react";
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
  energyType: EnergyType;
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

  const [customerId, setCustomerId] = useState("");
  const [customerContactId, setCustomerContactId] = useState("");
  const [energyType, setEnergyType] = useState<EnergyType>("NATURAL_GAS");
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
  const [result, setResult] = useState<{ success?: boolean; sentTo?: number; error?: string } | null>(null);

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
    setSelectedSupplierIds((current) =>
      current.filter((id) => eligibleSuppliersForEnergy(suppliers, energyType).some((supplier) => supplier.id === id))
    );
    setBrokerMarginUnit(defaultMarginUnitForEnergy(energyType));
  }, [energyType, suppliers]);

  useEffect(() => {
    const selectedCustomer = customers.find((customer) => customer.id === customerId);
    const firstContactId = selectedCustomer?.contacts?.[0]?.id ?? "";
    setCustomerContactId((current) =>
      selectedCustomer?.contacts?.some((contact) => contact.id === current) ? current : firstContactId
    );
  }, [customerId, customers]);

  const eligibleSuppliers = useMemo(
    () => eligibleSuppliersForEnergy(suppliers, energyType),
    [suppliers, energyType]
  );
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
      setRecentRfqs(Array.isArray(rfpData) ? rfpData.slice(0, 6) : []);
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

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
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

      setResult({ success: true, sentTo: data.sentTo });
      await loadPageData();
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "Failed to send RFP" });
    } finally {
      setSending(false);
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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]">
        <form onSubmit={handleSend} className="space-y-6">
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
                          {customer.name}
                          {customer.company ? ` (${customer.company})` : ""}
                          {Array.isArray(customer.contacts) && customer.contacts.length === 0
                            ? " - no contact on file"
                            : ""}
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
                          {contact.name}
                          {contact.email ? ` — ${contact.email}` : ""}
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
                  <Select value={energyType} onValueChange={(value) => setEnergyType(value as EnergyType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ELECTRIC">Electric</SelectItem>
                      <SelectItem value="NATURAL_GAS">Natural gas</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

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
              <CardTitle>Select suppliers</CardTitle>
              <CardDescription>
                This list filters to suppliers marked for the selected energy type. Supplier labels are
                also respected where present.
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
              <div className="grid gap-3 md:grid-cols-2">
                {eligibleSuppliers.map((supplier) => {
                  const selected = selectedSupplierIds.includes(supplier.id);
                  const primaryEmail = supplier.contactLinks?.find((contact) => contact.email)?.email || supplier.email;
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
                          <p className="font-medium">{supplier.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {primaryEmail || "No email on file"}
                          </p>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {selected ? "Selected" : "Click to add"}
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
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5" />
                Utility accounts and usage
              </CardTitle>
              <CardDescription>
                Enter one line per meter or utility account from the customer bills.
              </CardDescription>
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
              <ChecklistItem checked={selectedSupplierIds.length > 0}>
                At least one supplier selected
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
                      href={`/communications/quotes?rfpRequestId=${rfp.id}`}
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

function marginUnitOptions(energyType: EnergyType): PriceUnit[] {
  return energyType === "ELECTRIC" ? ["KWH"] : ["MCF", "CCF", "DTH"];
}

function termsForCalculations(requestedTerms: RequestedTerm[], customTermMonths: string) {
  const standardTerms = requestedTerms
    .filter((term): term is "12" | "24" | "36" => term !== "NYMEX")
    .map((term) => Number(term));
  const custom = Number.parseInt(customTermMonths, 10);
  const combined = Number.isFinite(custom) && custom > 0 ? [...standardTerms, custom] : standardTerms;
  return Array.from(new Set(combined)).sort((a, b) => a - b);
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
