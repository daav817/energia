"use client";

import { useEffect, useState } from "react";
import { Star, Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

type RfpQuote = {
  id: string;
  rate: number;
  priceUnit: string;
  termMonths: number;
  brokerMargin: number | null;
  totalMargin: number | null;
  estimatedContractValue: number | null;
  isBestOffer: boolean;
  notes: string | null;
  supplier: { name: string };
  rfpRequest?: { customer?: { name: string } };
};

type RfpRequestSummary = {
  id: string;
  energyType: "ELECTRIC" | "NATURAL_GAS";
  status: string;
  quoteDueDate: string | null;
  contractStartMonth: number | null;
  contractStartYear: number | null;
  brokerMargin: number | null;
  brokerMarginUnit: string | null;
  ldcUtility: string | null;
  requestedTerms: Array<{ kind: "months"; months: number } | { kind: "nymex" }> | null;
  customer: { id: string; name: string; company: string | null };
  customerContact?: { id: string; name: string; email: string | null; phone: string | null } | null;
  quoteSummaryContactIds?: string[];
  suppliers: Array<{ id: string; name: string }>;
  accountLines: Array<{ id: string; accountNumber: string; annualUsage: number; avgMonthlyUsage: number }>;
};

const emptyForm = {
  rfpRequestId: "",
  supplierId: "",
  rate: "",
  priceUnit: "MCF",
  termMonths: "",
  brokerMargin: "",
  totalMargin: "",
  estimatedContractValue: "",
  isBestOffer: false,
  notes: "",
};

type CustomerContactRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
};

export default function RfpQuotesPage() {
  const [quotes, setQuotes] = useState<RfpQuote[]>([]);
  const [rfpRequests, setRfpRequests] = useState<RfpRequestSummary[]>([]);
  const [selectedRfpId, setSelectedRfpId] = useState("");
  const [loading, setLoading] = useState(true);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [recipientsSaving, setRecipientsSaving] = useState(false);
  const [customerContacts, setCustomerContacts] = useState<CustomerContactRow[]>([]);
  const [primaryContactId, setPrimaryContactId] = useState("");
  const [extraRecipientIds, setExtraRecipientIds] = useState<string[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const selectedRequest =
    rfpRequests.find((request) => request.id === selectedRfpId) ?? null;
  const formRequest =
    rfpRequests.find((request) => request.id === form.rfpRequestId) ?? selectedRequest;
  const availableSuppliers = formRequest?.suppliers ?? [];
  const requestedMonthTerms =
    formRequest?.requestedTerms?.filter(
      (term): term is { kind: "months"; months: number } => term.kind === "months"
    ) ?? [];
  const quoteSummaries = summarizeQuotesByTerm(quotes);

  useEffect(() => {
    void loadRfpRequests();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const fromUrl = new URL(window.location.href).searchParams.get("rfpRequestId");
    if (fromUrl) {
      setSelectedRfpId(fromUrl);
      setForm((current) => ({ ...current, rfpRequestId: fromUrl }));
    }
  }, []);

  useEffect(() => {
    if (!selectedRfpId && rfpRequests.length > 0) {
      const sentRequest = rfpRequests.find((request) => request.status === "sent") || rfpRequests[0];
      setSelectedRfpId(sentRequest.id);
      setForm((current) => ({
        ...current,
        rfpRequestId: sentRequest.id,
        brokerMargin: sentRequest.brokerMargin != null ? String(sentRequest.brokerMargin) : "",
        priceUnit: defaultPriceUnitForRequest(sentRequest),
      }));
    }
  }, [rfpRequests, selectedRfpId]);

  useEffect(() => {
    void fetchQuotes(selectedRfpId);
  }, [selectedRfpId]);

  useEffect(() => {
    if (!selectedRequest?.customer?.id) {
      setCustomerContacts([]);
      setPrimaryContactId("");
      setExtraRecipientIds([]);
      return;
    }

    setPrimaryContactId(selectedRequest.customerContact?.id ?? "");
    setExtraRecipientIds(
      (selectedRequest.quoteSummaryContactIds || []).filter(
        (id) => id && id !== selectedRequest.customerContact?.id
      )
    );

    void (async () => {
      const res = await fetch(`/api/customers/${selectedRequest.customer.id}?contacts=1`);
      const data = await res.json();
      const rows = Array.isArray(data?.contacts) ? (data.contacts as CustomerContactRow[]) : [];
      setCustomerContacts(rows);
    })();
  }, [
    selectedRequest?.id,
    selectedRequest?.customer?.id,
    selectedRequest?.customerContact?.id,
    (selectedRequest?.quoteSummaryContactIds ?? []).join(","),
  ]);

  useEffect(() => {
    const request = formRequest;
    if (!request) return;

    setForm((current) => {
      const nextBrokerMargin =
        current.brokerMargin ||
        (request.brokerMargin != null ? String(request.brokerMargin) : "");
      const nextPriceUnit = defaultPriceUnitForRequest(request);

      const derived = deriveQuoteMetrics({
        request,
        rate: current.rate,
        brokerMargin: nextBrokerMargin,
        termMonths: current.termMonths,
      });

      return {
        ...current,
        rfpRequestId: request.id,
        brokerMargin: nextBrokerMargin,
        priceUnit: nextPriceUnit,
        totalMargin: derived.totalMargin,
        estimatedContractValue: derived.estimatedContractValue,
      };
    });
  }, [selectedRfpId, formRequest]);

  useEffect(() => {
    if (!formRequest) return;
    const derived = deriveQuoteMetrics({
      request: formRequest,
      rate: form.rate,
      brokerMargin: form.brokerMargin,
      termMonths: form.termMonths,
    });

    setForm((current) => ({
      ...current,
      totalMargin: derived.totalMargin,
      estimatedContractValue: derived.estimatedContractValue,
    }));
  }, [form.rate, form.brokerMargin, form.termMonths, formRequest]);

  const loadRfpRequests = async () => {
    const response = await fetch("/api/rfp");
    const data = await response.json();
    setRfpRequests(Array.isArray(data) ? data : []);
  };

  const fetchQuotes = async (rfpRequestId?: string) => {
    setLoading(true);
    const query = rfpRequestId ? `?rfpRequestId=${encodeURIComponent(rfpRequestId)}` : "";
    const res = await fetch(`/api/rfp/quotes${query}`);
    const data = await res.json();
    setQuotes(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  const handleSetBest = async (id: string) => {
    await fetch(`/api/rfp/quotes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isBestOffer: true }),
    });
    void fetchQuotes(selectedRfpId);
  };

  const handleAddQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch("/api/rfp/quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rfpRequestId: form.rfpRequestId,
        supplierId: form.supplierId,
        rate: parseFloat(form.rate),
        priceUnit: form.priceUnit,
        termMonths: parseInt(form.termMonths, 10),
        brokerMargin: form.brokerMargin ? parseFloat(form.brokerMargin) : undefined,
        totalMargin: form.totalMargin ? parseFloat(form.totalMargin) : undefined,
        estimatedContractValue: form.estimatedContractValue || undefined,
        isBestOffer: form.isBestOffer,
        notes: form.notes || undefined,
      }),
    });
    if (res.ok) {
      setDialogOpen(false);
      setForm({
        ...emptyForm,
        rfpRequestId: selectedRfpId,
        brokerMargin:
          selectedRequest?.brokerMargin != null ? String(selectedRequest.brokerMargin) : "",
        priceUnit: selectedRequest ? defaultPriceUnitForRequest(selectedRequest) : "MCF",
      });
      void fetchQuotes(selectedRfpId);
    }
  };

  const handleStatusUpdate = async (status: string) => {
    if (!selectedRfpId) return;
    setStatusUpdating(true);
    try {
      const res = await fetch(`/api/rfp/${selectedRfpId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });

      if (res.ok) {
        await loadRfpRequests();
      }
    } finally {
      setStatusUpdating(false);
    }
  };

  const handleSaveQuoteRecipients = async () => {
    if (!selectedRequest) return;
    setRecipientsSaving(true);
    try {
      const merged = Array.from(
        new Set([primaryContactId, ...extraRecipientIds].filter(Boolean))
      );
      const res = await fetch(`/api/rfp/${selectedRequest.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerContactId: primaryContactId || null,
          quoteSummaryContactIds: merged,
        }),
      });
      if (res.ok) await loadRfpRequests();
    } finally {
      setRecipientsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">RFP Quotes</h1>
          <p className="text-muted-foreground">
            Review sent RFPs, capture supplier responses, and compare the best offer by term.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)} disabled={!selectedRfpId}>
          <Plus className="mr-2 h-4 w-4" />
          Add Quote
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Choose RFP request</CardTitle>
          <CardDescription>
            Quotes are now tied to a specific RFP so supplier responses stay grouped with the original request.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="grid gap-2">
            <Label>RFP request</Label>
            <Select value={selectedRfpId} onValueChange={setSelectedRfpId}>
              <SelectTrigger>
                <SelectValue placeholder="Select an RFP request" />
              </SelectTrigger>
              <SelectContent>
                {rfpRequests.map((request) => (
                  <SelectItem key={request.id} value={request.id}>
                    {`${request.customer.name} · ${
                      request.energyType === "ELECTRIC" ? "Electric" : "Gas"
                    }`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedRequest && (
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={selectedRequest.energyType === "ELECTRIC" ? "electric" : "gas"}>
                  {selectedRequest.energyType === "ELECTRIC" ? "Electric" : "Natural gas"}
                </Badge>
                <Badge variant="outline">{selectedRequest.status}</Badge>
              </div>
              <p className="font-medium">
                {selectedRequest.customer.name}
                {selectedRequest.customer.company ? ` (${selectedRequest.customer.company})` : ""}
              </p>
              <p className="text-sm text-muted-foreground">
                Utility: {selectedRequest.ldcUtility || "—"} · Quote due:{" "}
                {selectedRequest.quoteDueDate
                  ? new Date(selectedRequest.quoteDueDate).toLocaleDateString()
                  : "—"}
              </p>
              <p className="text-sm text-muted-foreground">
                Suppliers: {selectedRequest.suppliers.map((supplier) => supplier.name).join(", ") || "—"}
              </p>
              <p className="text-sm text-muted-foreground">
                Requested terms:{" "}
                {selectedRequest.requestedTerms?.map(formatRequestedTerm).join(", ") || "—"}
              </p>
              <p className="text-sm text-muted-foreground">
                Accounts: {selectedRequest.accountLines.length}
              </p>

              <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                <p className="text-sm font-medium">Customer quote summary recipients</p>
                <p className="text-xs text-muted-foreground">
                  Choose who should receive the consolidated quote summary. The primary contact is the main signer or
                  negotiator; check additional people at the same company to copy them as well.
                </p>
                {customerContacts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No contacts on file for this customer.</p>
                ) : (
                  <div className="grid gap-3">
                    <div className="grid gap-2">
                      <Label>Primary customer contact</Label>
                      <Select value={primaryContactId} onValueChange={setPrimaryContactId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select contact" />
                        </SelectTrigger>
                        <SelectContent>
                          {customerContacts.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {`${c.name}${c.email ? ` — ${c.email}` : ""}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label>Also send summary to</Label>
                      <div className="max-h-40 space-y-2 overflow-y-auto rounded border p-2">
                        {customerContacts.map((c) => {
                          const disabled = c.id === primaryContactId;
                          const checked = extraRecipientIds.includes(c.id);
                          return (
                            <label
                              key={c.id}
                              className={`flex items-center gap-2 text-sm ${disabled ? "opacity-50" : ""}`}
                            >
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border accent-primary"
                                disabled={disabled}
                                checked={disabled ? false : checked}
                                onChange={() => {
                                  setExtraRecipientIds((current) =>
                                    current.includes(c.id)
                                      ? current.filter((id) => id !== c.id)
                                      : [...current, c.id]
                                  );
                                }}
                              />
                              <span>
                                {c.name}
                                {c.email ? ` (${c.email})` : ""}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={recipientsSaving || !primaryContactId}
                      onClick={() => void handleSaveQuoteRecipients()}
                    >
                      {recipientsSaving ? "Saving..." : "Save recipients"}
                    </Button>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleStatusUpdate("quotes_received")}
                  disabled={statusUpdating || selectedRequest.status === "quotes_received"}
                >
                  Mark Quotes Received
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleStatusUpdate("completed")}
                  disabled={statusUpdating || selectedRequest.status === "completed"}
                >
                  Mark Completed
                </Button>
                <Link
                  href={`/communications/rfp?rfpRequestId=${selectedRequest.id}`}
                  className="inline-flex h-9 items-center justify-center rounded-md border px-3 text-sm font-medium"
                >
                  Back to RFP
                </Link>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quote comparison</CardTitle>
          <CardDescription>
            Best current pricing by requested term for the selected RFP.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {quoteSummaries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Supplier quote summaries will appear here once quotes are entered.
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {quoteSummaries.map((summary) => (
                <div key={summary.termMonths} className="rounded-lg border p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{summary.termMonths} months</p>
                    {summary.bestQuote?.isBestOffer ? <Badge>Best tagged</Badge> : null}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Lowest rate:{" "}
                    <span className="font-semibold text-foreground">
                      {summary.bestQuote
                        ? `$${Number(summary.bestQuote.rate).toFixed(6)}`
                        : "—"}
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Supplier:{" "}
                    <span className="font-semibold text-foreground">
                      {summary.bestQuote?.supplier.name || "—"}
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Total margin:{" "}
                    <span className="font-semibold text-foreground">
                      {summary.bestQuote?.totalMargin != null
                        ? formatCurrency(Number(summary.bestQuote.totalMargin))
                        : "—"}
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Contract value:{" "}
                    <span className="font-semibold text-foreground">
                      {summary.bestQuote?.estimatedContractValue != null
                        ? formatCurrency(Number(summary.bestQuote.estimatedContractValue))
                        : "—"}
                    </span>
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pricing Table</CardTitle>
          <CardDescription>
            Quotes for the selected RFP. Click the star to mark the best offer for that request.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="py-8 text-center text-muted-foreground">Loading...</p>
          ) : quotes.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No quotes yet for this RFP. Add the supplier responses as they come back.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Term</TableHead>
                  <TableHead>Broker Margin</TableHead>
                  <TableHead>Total Margin</TableHead>
                  <TableHead>Contract Value</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Best</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotes.map((q) => (
                  <TableRow key={q.id} className={q.isBestOffer ? "bg-primary/5" : ""}>
                    <TableCell className="font-medium">{q.supplier.name}</TableCell>
                    <TableCell>${Number(q.rate).toFixed(4)}</TableCell>
                    <TableCell>{q.priceUnit}</TableCell>
                    <TableCell>{q.termMonths} mo</TableCell>
                    <TableCell>
                      {q.brokerMargin != null ? `$${Number(q.brokerMargin).toFixed(4)}` : "—"}
                    </TableCell>
                    <TableCell>
                      {q.totalMargin != null ? `$${Number(q.totalMargin).toLocaleString()}` : "—"}
                    </TableCell>
                    <TableCell>
                      {q.estimatedContractValue != null
                        ? `$${Number(q.estimatedContractValue).toLocaleString()}`
                        : "—"}
                    </TableCell>
                    <TableCell className="max-w-[260px] whitespace-pre-wrap text-sm text-muted-foreground">
                      {q.notes || "—"}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleSetBest(q.id)}
                        className={q.isBestOffer ? "text-amber-500" : ""}
                      >
                        <Star className={q.isBestOffer ? "fill-current" : ""} />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add RFP Quote</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddQuote} className="space-y-4">
            <div className="grid gap-2">
              <Label>RFP request *</Label>
              <Select value={form.rfpRequestId} onValueChange={(v) => setForm({ ...form, rfpRequestId: v, supplierId: "" })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select RFP request" />
                </SelectTrigger>
                <SelectContent>
                  {rfpRequests.map((request) => (
                    <SelectItem key={request.id} value={request.id}>
                      {`${request.customer.name} · ${
                        request.energyType === "ELECTRIC" ? "Electric" : "Gas"
                      }`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Supplier *</Label>
              <Select value={form.supplierId} onValueChange={(v) => setForm({ ...form, supplierId: v })} required>
                <SelectTrigger>
                  <SelectValue placeholder="Select supplier" />
                </SelectTrigger>
                <SelectContent>
                  {availableSuppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Rate *</Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={form.rate}
                  onChange={(e) => setForm({ ...form, rate: e.target.value })}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label>Unit *</Label>
                <Select value={form.priceUnit} onValueChange={(v) => setForm({ ...form, priceUnit: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="KWH">KWH</SelectItem>
                    <SelectItem value="MCF">MCF</SelectItem>
                    <SelectItem value="CCF">CCF</SelectItem>
                    <SelectItem value="DTH">DTH</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Term (months) *</Label>
              {requestedMonthTerms.length > 0 ? (
                <Select value={form.termMonths} onValueChange={(v) => setForm({ ...form, termMonths: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select requested term" />
                  </SelectTrigger>
                  <SelectContent>
                    {requestedMonthTerms.map((term) => (
                      <SelectItem key={term.months} value={String(term.months)}>
                        {`${term.months} months`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type="number"
                  value={form.termMonths}
                  onChange={(e) => setForm({ ...form, termMonths: e.target.value })}
                  required
                />
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Broker Margin</Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={form.brokerMargin}
                  onChange={(e) => setForm({ ...form, brokerMargin: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label>Total Margin</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.totalMargin}
                  readOnly
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Estimated contract value</Label>
              <Input value={form.estimatedContractValue} readOnly />
            </div>
            <div className="grid gap-2 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
              {selectedRequest ? (
                <>
                  <p>Total monthly usage: {formatUsageTotal(selectedRequest.accountLines)}</p>
                  <p>Accounts in request: {selectedRequest.accountLines.length}</p>
                </>
              ) : (
                <p>Select an RFP request to calculate total margin and contract value.</p>
              )}
            </div>
            <div className="grid gap-2">
              <Label>Notes</Label>
              <Input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Supplier email notes or response details"
              />
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.isBestOffer}
                onChange={(e) => setForm({ ...form, isBestOffer: e.target.checked })}
              />
              <span className="text-sm">Best offer</span>
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Add</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function defaultPriceUnitForRequest(request: RfpRequestSummary) {
  return request.energyType === "ELECTRIC"
    ? "KWH"
    : request.brokerMarginUnit || "MCF";
}

function deriveQuoteMetrics({
  request,
  rate,
  brokerMargin,
  termMonths,
}: {
  request: RfpRequestSummary;
  rate: string;
  brokerMargin: string;
  termMonths: string;
}) {
  const avgMonthlyTotal = request.accountLines.reduce(
    (sum, line) => sum + Number(line.avgMonthlyUsage || 0),
    0
  );
  const months = Number.parseInt(termMonths, 10);
  const margin = Number(brokerMargin);
  const rateValue = Number(rate);

  const totalMargin =
    Number.isFinite(months) && Number.isFinite(margin)
      ? avgMonthlyTotal * months * margin
      : 0;
  const estimatedContractValue =
    Number.isFinite(months) && Number.isFinite(margin) && Number.isFinite(rateValue)
      ? avgMonthlyTotal * months * (rateValue + margin)
      : 0;

  return {
    totalMargin: totalMargin ? totalMargin.toFixed(2) : "",
    estimatedContractValue: estimatedContractValue ? estimatedContractValue.toFixed(2) : "",
  };
}

function formatRequestedTerm(term: { kind: "months"; months: number } | { kind: "nymex" }) {
  return term.kind === "nymex" ? "NYMEX" : `${term.months} months`;
}

function formatUsageTotal(
  accountLines: Array<{ avgMonthlyUsage: number }>
) {
  const total = accountLines.reduce((sum, line) => sum + Number(line.avgMonthlyUsage || 0), 0);
  return total.toLocaleString();
}

function summarizeQuotesByTerm(quotes: RfpQuote[]) {
  const grouped = new Map<number, RfpQuote[]>();

  for (const quote of quotes) {
    const existing = grouped.get(quote.termMonths) || [];
    existing.push(quote);
    grouped.set(quote.termMonths, existing);
  }

  return Array.from(grouped.entries())
    .map(([termMonths, termQuotes]) => ({
      termMonths,
      bestQuote:
        [...termQuotes].sort((a, b) => Number(a.rate) - Number(b.rate))[0] ?? null,
    }))
    .sort((a, b) => a.termMonths - b.termMonths);
}

function formatCurrency(value: number) {
  return value.toLocaleString(undefined, { style: "currency", currency: "USD" });
}
