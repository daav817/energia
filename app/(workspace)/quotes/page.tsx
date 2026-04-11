"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Archive, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  QuoteComparisonTab,
  type ComparisonRfpQuote,
  type ManualQuoteRow,
  type SupplierInboxEmailDetail,
  type TermPick,
} from "@/components/quotes/quote-comparison-tab";
import { QuoteComposeCustomerTab } from "@/components/quotes/quote-compose-customer-tab";
import type { QuoteWorkspaceSnapshotV1 } from "@/lib/quote-workspace-snapshot";
import { cn } from "@/lib/utils";
import { useAppToast } from "@/components/app-toast-provider";
import { formatLocaleDateFromStoredDay } from "@/lib/calendar-date";
import { hydrateQuoteComparisonPicks, serializeQuoteComparisonPicks } from "@/lib/quote-comparison-picks";

const QUOTES_PAGE_RESIZE_HANDLE_CLASS =
  "relative h-1.5 w-full shrink-0 rounded-sm bg-border/80 outline-none hover:bg-primary/40 data-[panel-group-direction=horizontal]:mx-0.5 data-[panel-group-direction=horizontal]:h-full data-[panel-group-direction=horizontal]:w-1.5 data-[panel-group-direction=horizontal]:my-0 data-[panel-group-direction=vertical]:my-0.5";

type RfpQuote = ComparisonRfpQuote & {
  brokerMargin: number | null;
  totalMargin: number | null;
  estimatedContractValue: number | null;
  isBestOffer: boolean;
  notes: string | null;
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
  sentAt: string | null;
  requestedTerms: Array<{ kind: "months"; months: number } | { kind: "nymex" }> | null;
  customer: { id: string; name: string; company: string | null } | null;
  customerContact?: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    company?: string | null;
  } | null;
  quoteSummaryContactIds?: string[];
  quoteSummarySentAt?: string | null;
  suppliers: Array<{ id: string; name: string; email: string | null }>;
  accountLines: Array<{
    id: string;
    accountNumber: string;
    serviceAddress?: string | null;
    annualUsage: number;
    avgMonthlyUsage: number;
  }>;
  quoteComparisonPicks?: unknown;
};

const EMPTY_MANUAL_ROWS: ManualQuoteRow[] = [];

/** Select sentinel: clear RFP selection and reset workspace (after saving picks). */
const RFP_SELECT_NONE = "__none__";

export default function RfpQuotesPage() {
  const router = useRouter();
  const toast = useAppToast();
  const [quotes, setQuotes] = useState<RfpQuote[]>([]);
  const [rfpRequests, setRfpRequests] = useState<RfpRequestSummary[]>([]);
  const [selectedRfpId, setSelectedRfpId] = useState("");
  const [mainTab, setMainTab] = useState<"compare" | "compose">("compare");
  const [loading, setLoading] = useState(true);
  const [recipientsSaving, setRecipientsSaving] = useState(false);
  const [customerContacts, setCustomerContacts] = useState<
    Array<{ id: string; name: string; email: string | null; phone: string | null }>
  >([]);
  const [primaryContactId, setPrimaryContactId] = useState("");
  const [pickByTerm, setPickByTerm] = useState<Partial<Record<number, TermPick>>>({});
  const pickByTermRef = useRef(pickByTerm);
  pickByTermRef.current = pickByTerm;
  const selectedRfpIdRef = useRef(selectedRfpId);
  selectedRfpIdRef.current = selectedRfpId;

  const [refreshOpen, setRefreshOpen] = useState(false);
  const [refreshHasChanges, setRefreshHasChanges] = useState<boolean | null>(null);
  const [refreshDueDate, setRefreshDueDate] = useState("");
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveMessage, setArchiveMessage] = useState<string | null>(null);

  const [supplierReadEmailId, setSupplierReadEmailId] = useState<string | null>(null);
  const [supplierReadEmailDetail, setSupplierReadEmailDetail] = useState<SupplierInboxEmailDetail | null>(null);
  const [supplierReadEmailLoading, setSupplierReadEmailLoading] = useState(false);
  const [insertQuoteRowBusy, setInsertQuoteRowBusy] = useState(false);
  const [comparisonPicksSaveBusy, setComparisonPicksSaveBusy] = useState(false);
  const [rfpSwitchBusy, setRfpSwitchBusy] = useState(false);
  const lastHydratedRfpIdRef = useRef<string | null>(null);

  const [quoteSummarySentRecording, setQuoteSummarySentRecording] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [wideDetailSplit, setWideDetailSplit] = useState(true);

  const selectedRequest = rfpRequests.find((request) => request.id === selectedRfpId) ?? null;
  const defaultUnit = selectedRequest ? defaultPriceUnitForRequest(selectedRequest) : "MCF";
  const energyLabel = selectedRequest?.energyType === "ELECTRIC" ? "Electric" : "Natural gas";
  const energyLabelSubject = selectedRequest?.energyType === "ELECTRIC" ? "Electric" : "Natural Gas";
  const resolvedRfpCompanyName = selectedRequest
    ? (
        selectedRequest.customer?.company?.trim() ||
        selectedRequest.customer?.name?.trim() ||
        selectedRequest.customerContact?.company?.trim() ||
        ""
      ).trim()
    : "";

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 768px)");
    const sync = () => setWideDetailSplit(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const fromUrl = new URL(window.location.href).searchParams.get("rfpRequestId");
    if (fromUrl) {
      setSelectedRfpId(fromUrl);
    }
  }, []);

  useEffect(() => {
    if (!selectedRfpId) {
      setQuotes([]);
      setLoading(false);
      return;
    }
    void fetchQuotes(selectedRfpId);
  }, [selectedRfpId]);

  useEffect(() => {
    setSupplierReadEmailId(null);
    setSupplierReadEmailDetail(null);
  }, [selectedRfpId]);

  useEffect(() => {
    if (!selectedRfpId) {
      setPickByTerm({});
      lastHydratedRfpIdRef.current = null;
      return;
    }
    if (lastHydratedRfpIdRef.current === selectedRfpId) return;
    const row = rfpRequests.find((r) => r.id === selectedRfpId);
    if (!row) return;
    setPickByTerm(hydrateQuoteComparisonPicks(row.quoteComparisonPicks));
    lastHydratedRfpIdRef.current = selectedRfpId;
  }, [selectedRfpId, rfpRequests]);

  useEffect(() => {
    if (!supplierReadEmailId) {
      setSupplierReadEmailDetail(null);
      setSupplierReadEmailLoading(false);
      return;
    }
    let cancelled = false;
    setSupplierReadEmailLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/emails/${encodeURIComponent(supplierReadEmailId)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Load failed");
        if (cancelled) return;
        const rawAtt = data.attachments;
        const attachments: SupplierInboxEmailDetail["attachments"] = Array.isArray(rawAtt)
          ? rawAtt
              .map((a: { attachmentId?: string; filename?: string; mimeType?: string; size?: number }) => ({
                attachmentId: String(a.attachmentId ?? ""),
                filename: String(a.filename ?? "attachment"),
                mimeType: String(a.mimeType ?? "application/octet-stream"),
                size: typeof a.size === "number" ? a.size : 0,
              }))
              .filter((a) => a.attachmentId)
          : [];
        setSupplierReadEmailDetail({
          subject: String(data.subject ?? ""),
          bodyHtml: String(data.bodyHtml ?? ""),
          body: String(data.body ?? ""),
          attachments,
        });
      } catch {
        if (!cancelled) setSupplierReadEmailDetail(null);
      } finally {
        if (!cancelled) setSupplierReadEmailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supplierReadEmailId]);

  useEffect(() => {
    if (!selectedRequest?.customer?.id) {
      setCustomerContacts([]);
      setPrimaryContactId("");
      return;
    }

    setPrimaryContactId(selectedRequest.customerContact?.id ?? "");

    const custId = selectedRequest.customer?.id;
    if (!custId) {
      setCustomerContacts([]);
      return;
    }
    void (async () => {
      const res = await fetch(`/api/customers/${encodeURIComponent(custId)}?contacts=1`);
      const data = await res.json();
      const rows = Array.isArray(data?.contacts) ? data.contacts : [];
      setCustomerContacts(rows);
    })();
  }, [selectedRequest?.id, selectedRequest?.customer?.id, selectedRequest?.customerContact?.id]);

  function rfpListLabel(request: RfpRequestSummary): string {
    const company = (
      request.customer?.company?.trim() ||
      request.customer?.name?.trim() ||
      request.customerContact?.company?.trim() ||
      ""
    ).trim();
    const contact = (request.customerContact?.name || "").trim();
    const energy = request.energyType === "ELECTRIC" ? "Electric" : "Natural Gas";
    let base: string;
    if (company && contact) base = `${company} — ${contact}`;
    else if (company) base = company;
    else base = contact || "Customer";
    return `${base} · ${energy}`;
  }

  const loadRfpRequests = useCallback(async () => {
    const response = await fetch("/api/rfp");
    const data = await response.json();
    const rows = Array.isArray(data) ? (data as RfpRequestSummary[]) : [];
    setRfpRequests(rows.filter((r) => r.sentAt && r.status !== "draft"));
  }, []);

  const persistComparisonPicksForRfp = useCallback(
    async (
      rfpId: string,
      picks: Partial<Record<number, TermPick>>,
      options?: { refreshList?: boolean }
    ): Promise<{ ok: boolean }> => {
      const payload = serializeQuoteComparisonPicks(picks);
      const res = await fetch(`/api/rfp/${encodeURIComponent(rfpId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteComparisonPicks: payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          message: typeof data.error === "string" ? data.error : "Could not save picks",
          variant: "error",
        });
        return { ok: false };
      }
      if (options?.refreshList !== false) await loadRfpRequests();
      return { ok: true };
    },
    [toast, loadRfpRequests]
  );

  const handleSaveComparisonPicks = useCallback(async () => {
    if (!selectedRfpId) return;
    setComparisonPicksSaveBusy(true);
    try {
      const { ok } = await persistComparisonPicksForRfp(selectedRfpId, pickByTerm);
      if (ok) toast({ message: "Saved quote picks for this RFP.", variant: "success" });
    } finally {
      setComparisonPicksSaveBusy(false);
    }
  }, [selectedRfpId, pickByTerm, persistComparisonPicksForRfp, toast]);

  const persistAndClearWorkspace = useCallback(async () => {
    const previousId = selectedRfpIdRef.current;
    const picks = pickByTermRef.current;
    if (previousId) {
      setRfpSwitchBusy(true);
      try {
        const { ok } = await persistComparisonPicksForRfp(previousId, picks);
        if (!ok) return;
        toast({ message: "Saved quote picks. Workspace cleared.", variant: "success" });
      } finally {
        setRfpSwitchBusy(false);
      }
    }
    setSelectedRfpId("");
    lastHydratedRfpIdRef.current = null;
    setPickByTerm({});
    setQuotes([]);
    setLoading(false);
    setSupplierReadEmailId(null);
    setSupplierReadEmailDetail(null);
    router.replace("/quotes", { scroll: false });
  }, [persistComparisonPicksForRfp, router, toast]);

  const handleRfpSelectChange = useCallback(
    async (value: string) => {
      if (value === RFP_SELECT_NONE) {
        await persistAndClearWorkspace();
        return;
      }
      const previousId = selectedRfpIdRef.current;
      const picks = pickByTermRef.current;
      if (previousId && previousId !== value) {
        setRfpSwitchBusy(true);
        try {
          const { ok } = await persistComparisonPicksForRfp(previousId, picks);
          if (!ok) return;
        } finally {
          setRfpSwitchBusy(false);
        }
      }
      setSelectedRfpId(value);
    },
    [persistAndClearWorkspace, persistComparisonPicksForRfp]
  );

  useEffect(() => {
    void loadRfpRequests();
  }, [loadRfpRequests]);

  const fetchQuotes = async (rfpRequestId?: string) => {
    setLoading(true);
    const query = rfpRequestId ? `?rfpRequestId=${encodeURIComponent(rfpRequestId)}` : "";
    const res = await fetch(`/api/rfp/quotes${query}`);
    const data = await res.json();
    setQuotes(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  const handleSaveQuoteRecipients = async () => {
    if (!selectedRequest) return;
    setRecipientsSaving(true);
    try {
      const merged = primaryContactId ? [primaryContactId] : [];
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

  const handleRecordQuoteSummaryEmailSent = async () => {
    if (!selectedRequest) return;
    setQuoteSummarySentRecording(true);
    try {
      const res = await fetch(`/api/rfp/${selectedRequest.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteSummarySentAt: new Date().toISOString() }),
      });
      if (res.ok) await loadRfpRequests();
    } finally {
      setQuoteSummarySentRecording(false);
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
      if (res.ok) await loadRfpRequests();
    } finally {
      setStatusUpdating(false);
    }
  };

  const onPick = useCallback(
    (termMonths: number, pick: TermPick | null) => {
      let next: Partial<Record<number, TermPick>> | undefined;
      setPickByTerm((prev) => {
        const updated = { ...prev };
        if (pick == null) delete updated[termMonths];
        else updated[termMonths] = pick;
        next = updated;
        return updated;
      });
      const id = selectedRfpIdRef.current;
      if (id && next) void persistComparisonPicksForRfp(id, next, { refreshList: false });
    },
    [persistComparisonPicksForRfp]
  );

  const handleInsertQuoteRow = useCallback(
    async (payload: { supplierId: string; termMonths: number; rate: number }) => {
      if (!selectedRfpId) return;
      setInsertQuoteRowBusy(true);
      try {
        const unit = selectedRequest ? defaultPriceUnitForRequest(selectedRequest) : "MCF";
        const brokerMargin =
          selectedRequest?.brokerMargin != null && Number.isFinite(Number(selectedRequest.brokerMargin))
            ? Number(selectedRequest.brokerMargin)
            : undefined;
        const res = await fetch("/api/rfp/quotes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rfpRequestId: selectedRfpId,
            supplierId: payload.supplierId,
            rate: payload.rate,
            priceUnit: unit,
            termMonths: payload.termMonths,
            ...(brokerMargin != null ? { brokerMargin } : {}),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast({
            message: typeof data.error === "string" ? data.error : "Could not add quote row",
            variant: "error",
          });
          return;
        }
        await fetchQuotes(selectedRfpId);
        void loadRfpRequests();
        toast({ message: "Quote row added to the table.", variant: "success" });
      } finally {
        setInsertQuoteRowBusy(false);
      }
    },
    [selectedRfpId, selectedRequest, toast]
  );

  const onRefreshConfirm = async () => {
    if (!selectedRequest) return;
    if (refreshHasChanges === true) {
      router.push(`/rfp?rfpRequestId=${encodeURIComponent(selectedRequest.id)}&openForEdit=1`);
      setRefreshOpen(false);
      return;
    }
    if (refreshHasChanges !== false) return;
    const due = refreshDueDate.trim();
    if (!due) return;
    setRefreshBusy(true);
    setRefreshError(null);
    try {
      const res = await fetch(`/api/rfp/${encodeURIComponent(selectedRequest.id)}/refresh-suppliers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteDueDate: due }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Refresh failed");
      await loadRfpRequests();
      setRefreshOpen(false);
      setRefreshHasChanges(null);
      setRefreshDueDate("");
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshBusy(false);
    }
  };

  const onArchive = async () => {
    if (!selectedRequest) return;
    setArchiveBusy(true);
    setArchiveMessage(null);
    const pickSnap: QuoteWorkspaceSnapshotV1["pickByTerm"] = {};
    for (const [k, v] of Object.entries(pickByTerm)) {
      if (v) pickSnap[String(k)] = v;
    }
    const quoteWorkspaceSnapshot: QuoteWorkspaceSnapshotV1 = {
      version: 1,
      pickByTerm: pickSnap,
      manualRows: [],
      extraTermMonths: [],
      capturedAt: new Date().toISOString(),
    };
    try {
      const res = await fetch(`/api/rfp/${encodeURIComponent(selectedRequest.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archive: true, quoteWorkspaceSnapshot }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Archive failed");
      const cid = typeof data.createdContractId === "string" ? data.createdContractId : null;
      const skip = typeof data.archiveSkippedContractReason === "string" ? data.archiveSkippedContractReason : null;
      setArchiveOpen(false);
      setSelectedRfpId("");
      await loadRfpRequests();
      if (cid) {
        router.push(`/directory/contracts?highlightContract=${encodeURIComponent(cid)}`);
      } else if (skip) {
        setArchiveMessage(skip);
      }
    } catch (e) {
      setArchiveMessage(e instanceof Error ? e.message : "Archive failed");
    } finally {
      setArchiveBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="shrink-0">
        <h1 className="text-base font-semibold tracking-tight">Quotes</h1>
      </div>

      <PanelGroup
        direction="vertical"
        autoSaveId="energia-quotes-rfp-workflow-split"
        className="flex min-h-[min(88dvh,880px)] min-w-0 flex-1 flex-col"
      >
        <Panel defaultSize={42} minSize={20} className="min-h-0 flex flex-col">
          <Card className="flex h-full min-h-0 flex-col overflow-hidden border-border/60 shadow-sm">
        <CardContent className="grid min-h-0 flex-1 gap-3 overflow-y-auto overscroll-contain p-4 lg:grid-cols-[minmax(0,360px)_1fr] lg:gap-4">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex flex-wrap items-end gap-2 gap-y-2">
                <div className="grid min-w-[200px] flex-1 gap-1.5">
                  <Label className="text-xs">RFP</Label>
                  <Select
                    value={selectedRfpId ? selectedRfpId : RFP_SELECT_NONE}
                    onValueChange={(v) => void handleRfpSelectChange(v)}
                    disabled={rfpSwitchBusy}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select an RFP" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={RFP_SELECT_NONE}>— None —</SelectItem>
                      {rfpRequests.map((request) => (
                        <SelectItem key={request.id} value={request.id}>
                          {rfpListLabel(request)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void loadRfpRequests()}
                  >
                    <RefreshCw className="h-4 w-4 mr-1" />
                    Refresh list
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!selectedRequest}
                    onClick={() => {
                      setRefreshHasChanges(null);
                      setRefreshDueDate(selectedRequest?.quoteDueDate?.slice(0, 10) ?? "");
                      setRefreshOpen(true);
                    }}
                  >
                    Refresh RFP
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!selectedRequest}
                    onClick={() => setArchiveOpen(true)}
                  >
                    <Archive className="h-4 w-4 mr-1" />
                    Archive
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={rfpSwitchBusy}
                  onClick={() => void persistAndClearWorkspace()}
                  title="Save quote picks for the current RFP, then clear the workspace"
                >
                  <RotateCcw className="h-4 w-4 mr-1" />
                  Reset
                </Button>
              </div>
            </div>
          </div>

          {selectedRequest ? (
            <div className="rounded-lg border p-4 space-y-3 text-sm">
              <PanelGroup
                direction={wideDetailSplit ? "horizontal" : "vertical"}
                autoSaveId="energia-quotes-rfp-detail-accounts"
                className={cn(
                  "flex w-full min-w-0",
                  wideDetailSplit ? "min-h-[104px]" : "min-h-[200px]"
                )}
              >
                <Panel
                  defaultSize={wideDetailSplit ? 66 : 64}
                  minSize={wideDetailSplit ? 40 : 30}
                  className="min-h-0 min-w-0"
                >
                  <div className="min-w-0 space-y-2 pr-0 md:pr-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={selectedRequest.energyType === "ELECTRIC" ? "electric" : "gas"}>
                        {selectedRequest.energyType === "ELECTRIC" ? "Electric" : "Natural gas"}
                      </Badge>
                      <Badge variant="outline">{selectedRequest.status}</Badge>
                    </div>
                    <p className="font-medium">
                      {(
                        selectedRequest.customer?.company?.trim() ||
                        selectedRequest.customer?.name?.trim() ||
                        selectedRequest.customerContact?.company?.trim() ||
                        ""
                      ).trim() || "—"}
                    </p>
                    {selectedRequest.customer?.company?.trim() &&
                    selectedRequest.customer?.name?.trim() &&
                    selectedRequest.customer.company.trim() !== selectedRequest.customer.name.trim() ? (
                      <p className="text-xs text-muted-foreground">
                        CRM name: {selectedRequest.customer.name}
                      </p>
                    ) : null}
                    <p className="text-muted-foreground">
                      Utility: {selectedRequest.ldcUtility || "—"} · Quote due:{" "}
                      {selectedRequest.quoteDueDate
                        ? formatLocaleDateFromStoredDay(selectedRequest.quoteDueDate)
                        : "—"}
                    </p>
                    <p className="text-muted-foreground">
                      Customer contact:{" "}
                      {selectedRequest.customerContact
                        ? `${selectedRequest.customerContact.name}${
                            selectedRequest.customerContact.email
                              ? ` · ${selectedRequest.customerContact.email}`
                              : ""
                          }`
                        : "—"}
                    </p>
                    <p className="text-muted-foreground">
                      Suppliers: {selectedRequest.suppliers.map((s) => s.name).join(", ") || "—"}
                    </p>
                    <p className="text-muted-foreground">
                      Requested terms:{" "}
                      {selectedRequest.requestedTerms?.map(formatRequestedTerm).join(", ") || "—"}
                    </p>
                  </div>
                </Panel>
                <PanelResizeHandle className={QUOTES_PAGE_RESIZE_HANDLE_CLASS} />
                <Panel
                  defaultSize={wideDetailSplit ? 34 : 36}
                  minSize={wideDetailSplit ? 18 : 22}
                  className="min-h-0 min-w-0"
                >
                  <div className="min-w-0 pt-3 md:pt-0 md:pl-1">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Accounts
                    </p>
                    <div className="max-h-32 overflow-y-auto rounded-md border text-[10px] md:max-h-36">
                      <Table>
                        <TableHeader>
                          <TableRow className="[&_th]:h-7 [&_th]:px-1.5 [&_th]:py-0.5 [&_th]:text-[10px]">
                            <TableHead>Acct</TableHead>
                            <TableHead className="max-w-[100px]">Address</TableHead>
                            <TableHead className="text-right">Annual</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedRequest.accountLines.map((line) => (
                            <TableRow key={line.id} className="[&_td]:px-1.5 [&_td]:py-0.5">
                              <TableCell className="tabular-nums font-medium">{line.accountNumber}</TableCell>
                              <TableCell className="max-w-[100px] truncate text-muted-foreground">
                                {line.serviceAddress ?? "—"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {Number(line.annualUsage).toLocaleString()}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </Panel>
              </PanelGroup>

              <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                <p className="text-sm font-medium">Quote email recipients (CRM)</p>
                {customerContacts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No contacts for this customer.</p>
                ) : (
                  <>
                    <div className="grid gap-2">
                      <Label className="text-xs">Primary customer contact</Label>
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
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={recipientsSaving || !primaryContactId}
                      onClick={() => void handleSaveQuoteRecipients()}
                    >
                      {recipientsSaving ? "Saving…" : "Save recipients"}
                    </Button>
                  </>
                )}
                <div className="flex flex-col gap-1 pt-2 border-t border-border/60">
                  <p className="text-xs text-muted-foreground">
                    After the customer quote email is sent from Energia, record it here for dashboard follow-up.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={quoteSummarySentRecording}
                      onClick={() => void handleRecordQuoteSummaryEmailSent()}
                    >
                      {quoteSummarySentRecording ? "Recording…" : "Record quote summary email sent"}
                    </Button>
                    {selectedRequest.quoteSummarySentAt ? (
                      <span className="text-xs text-muted-foreground">
                        Logged{" "}
                        {new Date(selectedRequest.quoteSummarySentAt).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleStatusUpdate("quotes_received")}
                  disabled={statusUpdating || selectedRequest.status === "quotes_received"}
                >
                  Mark quotes received
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleStatusUpdate("completed")}
                  disabled={statusUpdating || selectedRequest.status === "completed"}
                >
                  Mark completed
                </Button>
              </div>

              <Link
                href={`/rfp?rfpRequestId=${selectedRequest.id}`}
                className="inline-flex text-sm font-medium text-primary hover:underline"
              >
                Open full RFP →
              </Link>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              Choose a submitted RFP to begin.
            </div>
          )}
        </CardContent>
          </Card>
        </Panel>

        <PanelResizeHandle className={QUOTES_PAGE_RESIZE_HANDLE_CLASS} />

        <Panel defaultSize={58} minSize={24} className="min-h-0 flex flex-col">
          <Card className="flex h-full min-h-0 flex-col overflow-hidden border-border/60 shadow-sm">
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4 pt-4">
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <div className="flex w-fit max-w-full gap-1 rounded-lg border border-border/80 bg-muted/40 p-1 text-sm shadow-sm">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={cn(
                  "whitespace-nowrap px-4 font-medium transition-colors",
                  mainTab === "compare"
                    ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                )}
                onClick={() => setMainTab("compare")}
              >
                Quote comparison
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={cn(
                  "whitespace-nowrap px-4 font-medium transition-colors",
                  mainTab === "compose"
                    ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                )}
                onClick={() => setMainTab("compose")}
              >
                Compose customer quote
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {!selectedRequest ? (
            <p className="text-sm text-muted-foreground">Select an RFP above.</p>
          ) : (
            <>
              <div className={cn("min-h-0", mainTab !== "compare" && "hidden")}>
                <QuoteComparisonTab
                  rfp={{
                    id: selectedRequest.id,
                    quoteDueDate: selectedRequest.quoteDueDate,
                    requestedTerms: selectedRequest.requestedTerms,
                    energyType: selectedRequest.energyType,
                    suppliers: selectedRequest.suppliers,
                    accountLines: selectedRequest.accountLines,
                  }}
                  quotes={quotes}
                  pickByTerm={pickByTerm}
                  onPick={onPick}
                  defaultPriceUnit={defaultUnit}
                  onInsertQuoteRow={handleInsertQuoteRow}
                  insertQuoteRowBusy={insertQuoteRowBusy}
                  quotesLoading={loading}
                  onSaveComparisonPicks={handleSaveComparisonPicks}
                  comparisonPicksSaveBusy={comparisonPicksSaveBusy}
                  manualRows={EMPTY_MANUAL_ROWS}
                  selectedEmailId={supplierReadEmailId}
                  onSelectedEmailIdChange={setSupplierReadEmailId}
                  emailDetail={supplierReadEmailDetail}
                  emailDetailLoading={supplierReadEmailLoading}
                />
              </div>
              <div className={cn("min-h-0", mainTab !== "compose" && "hidden")}>
                <QuoteComposeCustomerTab
                  rfpRequestId={selectedRequest.id}
                  defaultPriceUnit={defaultUnit}
                  energyTypeLabel={energyLabel}
                  energyTypeSubjectSegment={energyLabelSubject}
                  resolvedCompanyName={resolvedRfpCompanyName}
                  rfp={{
                    accountLines: selectedRequest.accountLines,
                    ldcUtility: selectedRequest.ldcUtility,
                    customer: selectedRequest.customer,
                  }}
                  quotes={quotes}
                  pickByTerm={pickByTerm}
                  manualRows={EMPTY_MANUAL_ROWS}
                  customerContact={selectedRequest.customerContact ?? null}
                  contractStartMonth={selectedRequest.contractStartMonth}
                  contractStartYear={selectedRequest.contractStartYear}
                  onQuoteEmailSent={() => void loadRfpRequests()}
                />
              </div>
            </>
          )}
          </div>
        </CardContent>
          </Card>
        </Panel>
      </PanelGroup>

      {archiveMessage ? (
        <p className="text-sm text-amber-700 dark:text-amber-400">{archiveMessage}</p>
      ) : null}

      <Dialog
        open={refreshOpen}
        onOpenChange={(o) => {
          setRefreshOpen(o);
          if (!o) {
            setRefreshHasChanges(null);
            setRefreshError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Refresh supplier quotes</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Supplier quotes are usually only good for the day you receive them. If the customer needs fresh pricing, you
            can re-open the RFP to edit details, or keep the same package and only move the supplier quote due date.
          </p>
          <div className="grid gap-2">
            <Label htmlFor="quotes-refresh-quote-due">New supplier quote due date</Label>
            <Input
              id="quotes-refresh-quote-due"
              type="date"
              value={refreshDueDate}
              onChange={(e) => setRefreshDueDate(e.target.value)}
            />
          </div>
          <div className="space-y-3">
            <p className="text-sm font-medium">Do you need to change anything on the RFP before re-sending?</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={refreshHasChanges === true ? "secondary" : "outline"}
                onClick={() => setRefreshHasChanges(true)}
              >
                Yes — edit on RFP page
              </Button>
              <Button
                type="button"
                size="sm"
                variant={refreshHasChanges === false ? "secondary" : "outline"}
                onClick={() => setRefreshHasChanges(false)}
              >
                No — same package
              </Button>
            </div>
            {refreshError ? (
              <p className="text-sm text-destructive">{refreshError}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRefreshOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                refreshBusy ||
                refreshHasChanges == null ||
                (refreshHasChanges === false && !refreshDueDate.trim())
              }
              onClick={() => void onRefreshConfirm()}
            >
              {refreshBusy ? "Working…" : refreshHasChanges === true ? "Continue" : "Send to suppliers"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive RFP and quote work?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This hides the RFP from active lists, keeps all quote rows in the database, adds an Archives entry under
            Settings, and creates a contract stub (when a CRM customer is linked) for you to complete with executed
            terms.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setArchiveOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={archiveBusy} onClick={() => void onArchive()}>
              {archiveBusy ? "Archiving…" : "Archive"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function defaultPriceUnitForRequest(request: RfpRequestSummary) {
  return request.energyType === "ELECTRIC" ? "KWH" : request.brokerMarginUnit || "MCF";
}

function formatRequestedTerm(term: { kind: "months"; months: number } | { kind: "nymex" }) {
  return term.kind === "nymex" ? "NYMEX" : `${term.months} months`;
}
