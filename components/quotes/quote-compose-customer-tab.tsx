"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, Loader2, Mail, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  loadEmailTemplates,
  CUSTOMER_QUOTES_TEMPLATE_DEFAULT_ID,
  type StoredEmailTemplate,
} from "@/lib/email-templates";
import { loadBrokerProfile } from "@/lib/broker-profile";
import { ComposeBrokerInsertMenu } from "@/components/compose-broker-insert-menu";
import { RichTextEditor } from "@/components/communications/RichTextEditor";
import {
  composeEmailBodyHasContent,
  stripHtmlToText,
} from "@/components/communications/compose-email-form";
import {
  buildCustomerQuotesTableHtml,
  formatTermLengthWithRange,
  totalContractValueUsd,
  unitLabelForEnergy,
  impliedMonthlyEnergyCostUsd,
  combinedAnnualUsageFromAccounts,
} from "@/lib/rfp-quote-math";
import { finalizeQuoteEmailHtml } from "@/lib/quote-email-html";
import type {
  ComparisonRfpQuote,
  ManualQuoteRow,
  TermPick,
} from "@/components/quotes/quote-comparison-tab";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useAppToast } from "@/components/app-toast-provider";
import { useUnsavedNavigationBlock } from "@/components/unsaved-navigation-guard";
import {
  canonicalCustomerQuoteDraftJson,
  parseCustomerQuoteEmailDraft,
} from "@/lib/customer-quote-email-draft";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function composeDraftStorageKey(rfpRequestId: string): string {
  return `energia-quotes-compose-draft:${rfpRequestId}`;
}

function buildQuoteEmailSubject(company: string, energySegment: string, brokerCompany: string): string {
  const c = company.trim() || "Customer";
  const e = energySegment.trim() || "Energy";
  const b = brokerCompany.trim() || "your broker";
  return `${c} ${e} Supply Quotes from ${b}`;
}

type CustomerContact = { name: string; email: string | null } | null | undefined;

type PersistedComposeDraft = {
  to: string;
  cc: string;
  subject: string;
  htmlBody: string;
  templateId: string;
  recordQuoteSummaryOnSend: boolean;
};

export function QuoteComposeCustomerTab({
  rfpRequestId,
  defaultPriceUnit,
  energyTypeLabel,
  energyTypeSubjectSegment,
  resolvedCompanyName,
  rfp,
  quotes,
  pickByTerm,
  manualRows,
  customerContact,
  contractStartMonth,
  contractStartYear,
  customerQuoteEmailDraft,
  onQuoteComposeDraftSaved,
  onQuoteEmailSent,
}: {
  rfpRequestId: string;
  defaultPriceUnit: string;
  energyTypeLabel: string;
  /** e.g. "Electric" | "Natural Gas" for the subject line */
  energyTypeSubjectSegment: string;
  /** Company line from CRM / contact (same logic as RFP dropdown) */
  resolvedCompanyName: string;
  rfp: {
    accountLines: Array<{ annualUsage: number | string }>;
    ldcUtility: string | null;
    customer: { name: string; company: string | null } | null;
  };
  quotes: ComparisonRfpQuote[];
  pickByTerm: Partial<Record<number, TermPick>>;
  manualRows: ManualQuoteRow[];
  customerContact: CustomerContact;
  contractStartMonth: number | null;
  contractStartYear: number | null;
  /** Persisted draft from the RFP row (optional). */
  customerQuoteEmailDraft?: unknown;
  onQuoteComposeDraftSaved?: () => void;
  onQuoteEmailSent?: () => void;
}) {
  const toast = useAppToast();
  const [templates, setTemplates] = useState<StoredEmailTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>(CUSTOMER_QUOTES_TEMPLATE_DEFAULT_ID);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [htmlBody, setHtmlBody] = useState("<p></p>");
  const [quoteComposeEditorKey, setQuoteComposeEditorKey] = useState(0);
  const quoteBodyInsertNonce = useRef(0);
  const [quoteBodyInsertSnippet, setQuoteBodyInsertSnippet] = useState<{ nonce: number; html: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [recordQuoteSummaryOnSend, setRecordQuoteSummaryOnSend] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sendConfirmOpen, setSendConfirmOpen] = useState(false);
  const [quoteTestEmail, setQuoteTestEmail] = useState("");
  const [testingQuoteEmail, setTestingQuoteEmail] = useState(false);
  const [quoteTestMessageId, setQuoteTestMessageId] = useState<string | null>(null);
  const [quoteTestViewOpen, setQuoteTestViewOpen] = useState(false);
  const appliedTemplateBootstrapRef = useRef<string | null>(null);
  const prevRestoreRfpIdRef = useRef<string | null>(null);
  const lastAppliedServerDraftCanonRef = useRef<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [noServerBaseline, setNoServerBaseline] = useState<string | null>(null);
  const draftRefForBaseline = useRef<PersistedComposeDraft>({
    to: "",
    cc: "",
    subject: "",
    htmlBody: "<p></p>",
    templateId: "",
    recordQuoteSummaryOnSend: false,
  });

  const annualUsage = useMemo(() => combinedAnnualUsageFromAccounts(rfp.accountLines), [rfp.accountLines]);

  const serverDraftParsed = useMemo(() => {
    if (customerQuoteEmailDraft == null) return null;
    return parseCustomerQuoteEmailDraft(customerQuoteEmailDraft);
  }, [customerQuoteEmailDraft]);
  const serverCanonical = useMemo(
    () => (serverDraftParsed != null ? canonicalCustomerQuoteDraftJson(serverDraftParsed) : null),
    [serverDraftParsed]
  );

  const localCanonical = useMemo(
    () =>
      canonicalCustomerQuoteDraftJson({
        to,
        cc,
        subject,
        htmlBody,
        templateId,
        recordQuoteSummaryOnSend,
      }),
    [to, cc, subject, htmlBody, templateId, recordQuoteSummaryOnSend]
  );

  draftRefForBaseline.current = {
    to,
    cc,
    subject,
    htmlBody,
    templateId,
    recordQuoteSummaryOnSend,
  };

  useEffect(() => {
    setNoServerBaseline(null);
  }, [rfpRequestId]);

  useEffect(() => {
    if (serverCanonical !== null) return;
    if (!rfpRequestId || templates.length === 0) return;
    const t = window.setTimeout(() => {
      setNoServerBaseline(canonicalCustomerQuoteDraftJson(draftRefForBaseline.current));
    }, 450);
    return () => window.clearTimeout(t);
  }, [rfpRequestId, serverCanonical, templates.length]);

  const isComposeDirty =
    serverCanonical !== null
      ? localCanonical !== serverCanonical
      : noServerBaseline !== null && localCanonical !== noServerBaseline;

  useEffect(() => {
    if (!isComposeDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isComposeDirty]);

  useUnsavedNavigationBlock(
    isComposeDirty,
    "You have unsaved changes to this quote email draft. Leave without saving?"
  );

  const greetingFirstName = useMemo(() => {
    const raw = (customerContact?.name ?? rfp.customer?.name ?? "there").trim();
    return raw.split(/\s+/)[0] || "there";
  }, [customerContact?.name, rfp.customer?.name]);

  /** Merge vars into the selected template HTML (no React state updates). */
  const mergedTemplateHtmlForId = useCallback(
    (id: string): string | null => {
      const tpl = templates.find((t) => t.id === id);
      if (!tpl) return null;
      const broker = loadBrokerProfile();
      const greet = greetingFirstName;
      const companyLine =
        resolvedCompanyName.trim() ||
        [rfp.customer?.company, rfp.customer?.name].filter(Boolean).join(" — ").trim() ||
        "Customer";
      const vars: Record<string, string> = {
        customerName: greet,
        greetingFirstName: greet,
        customerCompany: companyLine,
        energyLabel: energyTypeLabel,
        brokerFirstName: broker.firstName,
        brokerLastName: broker.lastName,
        brokerCompany: broker.companyName,
        brokerPhone: broker.phone,
        brokerFax: broker.fax,
        accountLinesHtml: "",
        supplierName: "",
        rateLabel: "",
        contractEndDate: "",
        contractStartDate: "",
      };
      let html = tpl.htmlBody;
      for (const [k, v] of Object.entries(vars)) {
        const re = new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, "g");
        html = html.replace(re, v);
      }
      return html.trim() ? html : "<p></p>";
    },
    [templates, greetingFirstName, resolvedCompanyName, energyTypeLabel, rfp.customer]
  );

  /** Replace merge vars in template HTML; subject always follows workspace formula */
  const applyTemplateBodyOnly = useCallback(
    (id: string) => {
      setTemplateId(id);
      const html = mergedTemplateHtmlForId(id);
      if (html == null) return;
      setHtmlBody(html);
      setQuoteComposeEditorKey((k) => k + 1);
      const broker = loadBrokerProfile();
      setSubject(buildQuoteEmailSubject(resolvedCompanyName, energyTypeSubjectSegment, broker.companyName));
    },
    [mergedTemplateHtmlForId, resolvedCompanyName, energyTypeSubjectSegment]
  );

  /** Clear inserted tables/images and restore the selected template body; subject unchanged. */
  const resetEmailBodyToTemplate = useCallback(() => {
    const html = mergedTemplateHtmlForId(templateId);
    if (html != null) {
      setHtmlBody(html);
      setQuoteComposeEditorKey((k) => k + 1);
      return;
    }
    const greet = escapeHtml(greetingFirstName);
    setHtmlBody(
      `<p>Dear ${greet},</p>\n<p>Please find indicative quotes below for your review.</p>\n<p>Best regards</p>`
    );
    setQuoteComposeEditorKey((k) => k + 1);
  }, [mergedTemplateHtmlForId, templateId, greetingFirstName]);

  useEffect(() => {
    const list = loadEmailTemplates();
    setTemplates(list);
    if (list.length === 0) return;
    const customerQuotes = list.find((t) => t.id === CUSTOMER_QUOTES_TEMPLATE_DEFAULT_ID);
    setTemplateId(customerQuotes?.id ?? list[0]!.id);
  }, []);

  useEffect(() => {
    const em = customerContact?.email?.trim();
    if (typeof window === "undefined" || !rfpRequestId) {
      setTo(em || "");
      return;
    }
    const key = composeDraftStorageKey(rfpRequestId);
    const raw = sessionStorage.getItem(key);
    if (raw) {
      try {
        const d = JSON.parse(raw) as PersistedComposeDraft;
        if (typeof d.to === "string" && d.to.trim() !== "") return;
      } catch {
        /* prefill */
      }
    }
    if (customerQuoteEmailDraft != null) {
      const d = parseCustomerQuoteEmailDraft(customerQuoteEmailDraft);
      if (d && d.to.trim() !== "") return;
    }
    setTo(em || "");
  }, [customerContact?.email, rfpRequestId, customerQuoteEmailDraft]);

  /** Restore draft or reset fields when switching RFP */
  useEffect(() => {
    if (typeof window === "undefined" || !rfpRequestId) return;
    if (prevRestoreRfpIdRef.current !== rfpRequestId) {
      prevRestoreRfpIdRef.current = rfpRequestId;
      lastAppliedServerDraftCanonRef.current = null;
    }
    appliedTemplateBootstrapRef.current = null;
    const key = composeDraftStorageKey(rfpRequestId);
    const raw = sessionStorage.getItem(key);
    if (raw) {
      try {
        const d = JSON.parse(raw) as PersistedComposeDraft;
        if (typeof d.to === "string") setTo(d.to);
        if (typeof d.cc === "string") setCc(d.cc);
        if (typeof d.subject === "string") setSubject(d.subject);
        if (typeof d.htmlBody === "string") {
          setHtmlBody(d.htmlBody);
          setQuoteComposeEditorKey((k) => k + 1);
        }
        if (typeof d.templateId === "string") setTemplateId(d.templateId);
        if (typeof d.recordQuoteSummaryOnSend === "boolean") setRecordQuoteSummaryOnSend(d.recordQuoteSummaryOnSend);
        appliedTemplateBootstrapRef.current = rfpRequestId;
        return;
      } catch {
        /* fall through */
      }
    }
    if (customerQuoteEmailDraft != null) {
      const d = parseCustomerQuoteEmailDraft(customerQuoteEmailDraft);
      if (d) {
        const canon = canonicalCustomerQuoteDraftJson(d);
        if (lastAppliedServerDraftCanonRef.current === canon) {
          appliedTemplateBootstrapRef.current = rfpRequestId;
          return;
        }
        lastAppliedServerDraftCanonRef.current = canon;
        setTo(d.to);
        setCc(d.cc);
        setSubject(d.subject);
        setHtmlBody(d.htmlBody.trim() ? d.htmlBody : "<p></p>");
        setQuoteComposeEditorKey((k) => k + 1);
        if (d.templateId.trim()) setTemplateId(d.templateId);
        setRecordQuoteSummaryOnSend(d.recordQuoteSummaryOnSend);
        appliedTemplateBootstrapRef.current = rfpRequestId;
        return;
      }
    }
    const broker = loadBrokerProfile();
    setSubject(buildQuoteEmailSubject(resolvedCompanyName, energyTypeSubjectSegment, broker.companyName));
    setCc("");
    setRecordQuoteSummaryOnSend(false);
    const greet = escapeHtml(greetingFirstName);
    setHtmlBody(
      `<p>Dear ${greet},</p>\n<p>Please find indicative quotes below for your review.</p>\n<p>Best regards</p>`
    );
    setQuoteComposeEditorKey((k) => k + 1);
  }, [
    rfpRequestId,
    resolvedCompanyName,
    energyTypeSubjectSegment,
    greetingFirstName,
    customerQuoteEmailDraft,
  ]);

  useEffect(() => {
    setQuoteTestMessageId(null);
  }, [rfpRequestId]);

  /** When no saved draft, merge email template body once templates load */
  useEffect(() => {
    if (typeof window === "undefined" || !rfpRequestId || templates.length === 0) return;
    const key = composeDraftStorageKey(rfpRequestId);
    if (sessionStorage.getItem(key)) return;
    if (appliedTemplateBootstrapRef.current === rfpRequestId) return;
    const preferredId =
      templates.find((t) => t.id === CUSTOMER_QUOTES_TEMPLATE_DEFAULT_ID)?.id ?? templates[0]!.id;
    applyTemplateBodyOnly(preferredId);
    appliedTemplateBootstrapRef.current = rfpRequestId;
  }, [templates, rfpRequestId, applyTemplateBodyOnly]);

  useEffect(() => {
    if (typeof window === "undefined" || !rfpRequestId) return;
    const key = composeDraftStorageKey(rfpRequestId);
    const t = window.setTimeout(() => {
      const draft: PersistedComposeDraft = {
        to,
        cc,
        subject,
        htmlBody,
        templateId,
        recordQuoteSummaryOnSend,
      };
      try {
        sessionStorage.setItem(key, JSON.stringify(draft));
      } catch {
        /* quota */
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [rfpRequestId, to, cc, subject, htmlBody, templateId, recordQuoteSummaryOnSend]);

  async function handleSaveDraft() {
    if (!rfpRequestId) return;
    setSavingDraft(true);
    try {
      const res = await fetch(`/api/rfp/${encodeURIComponent(rfpRequestId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerQuoteEmailDraft: {
            to,
            cc,
            subject,
            htmlBody,
            templateId,
            recordQuoteSummaryOnSend,
          },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Save failed");
      lastAppliedServerDraftCanonRef.current = canonicalCustomerQuoteDraftJson({
        to,
        cc,
        subject,
        htmlBody,
        templateId,
        recordQuoteSummaryOnSend,
      });
      toast({ message: "Quote email draft saved to this RFP.", variant: "success" });
      onQuoteComposeDraftSaved?.();
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Save failed", variant: "error" });
    } finally {
      setSavingDraft(false);
    }
  }

  const insertHtmlAtCaret = useCallback((html: string) => {
    quoteBodyInsertNonce.current += 1;
    setQuoteBodyInsertSnippet({ nonce: quoteBodyInsertNonce.current, html });
  }, []);

  const insertBrokerAtCaret = useCallback(
    (text: string) => {
      const html = escapeHtml(text).replace(/\r?\n/g, "<br/>");
      insertHtmlAtCaret(html);
    },
    [insertHtmlAtCaret]
  );

  const applyTemplate = (id: string) => {
    applyTemplateBodyOnly(id);
  };

  const sortedPickedTerms = useMemo(() => {
    return Object.keys(pickByTerm)
      .map(Number)
      .filter((n) => Number.isFinite(n) && pickByTerm[n])
      .sort((a, b) => a - b);
  }, [pickByTerm]);

  const insertQuotesTable = () => {
    const rows: Parameters<typeof buildCustomerQuotesTableHtml>[0] = [];

    for (const term of sortedPickedTerms) {
      const pick = pickByTerm[term];
      if (!pick) continue;
      let supplierName = "";
      let rate = 0;
      let unit = defaultPriceUnit;
      if (pick.kind === "quote") {
        const q = quotes.find((x) => x.id === pick.quoteId);
        if (!q) continue;
        supplierName = q.supplier.name;
        rate = Number(q.rate);
        unit = q.priceUnit || defaultPriceUnit;
      } else {
        const row = manualRows.find((m) => m.id === pick.rowId);
        if (!row) continue;
        const raw = row.rates[term];
        const r = raw != null ? Number.parseFloat(String(raw)) : NaN;
        if (!Number.isFinite(r)) continue;
        supplierName = row.supplierName.trim() || "Supplier";
        rate = r;
        unit = row.units[term] || defaultPriceUnit;
      }
      const totalVal = totalContractValueUsd({ baseRatePerUnit: rate, termMonths: term, annualUsage });
      const monthlyAvg = impliedMonthlyEnergyCostUsd({ baseRatePerUnit: rate, annualUsage });

      rows.push({
        termLabel: formatTermLengthWithRange({
          termMonths: term,
          contractStartMonth,
          contractStartYear,
        }),
        baseRateLabel: `$${rate.toFixed(4)} / ${unitLabelForEnergy(unit)}`,
        supplierName,
        totalContractValueLabel: `$${totalVal.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
        monthlyAverageLabel: `$${monthlyAvg.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
      });
    }

    if (rows.length === 0) {
      insertHtmlAtCaret("<p><em>(No term columns selected on the Quote Comparison tab.)</em></p>");
      return;
    }

    const table = buildCustomerQuotesTableHtml(rows);
    const usageBracket = `${annualUsage.toLocaleString()} ${unitLabelForEnergy(defaultPriceUnit)}`;
    const note = `<p style="font-size:12px;line-height:1.45;color:#666666;margin:10px 0 0 0;font-family:Arial, Helvetica, sans-serif;">Note:  The Total Contract Value and Monthly Average amounts are based upon the Annual Usage [${escapeHtml(usageBracket)}] taken from the submitted energy bills</p>`;
    insertHtmlAtCaret(`<div style="margin:12px 0;">${table}${note}</div>`);
  };

  async function handleQuoteTestSend() {
    const addr = quoteTestEmail.trim();
    if (!addr) {
      toast({ message: "Enter a test email address.", variant: "error" });
      return;
    }
    if (!composeEmailBodyHasContent(htmlBody)) {
      toast({ message: "Add email body content before sending a test.", variant: "error" });
      return;
    }
    setTestingQuoteEmail(true);
    setQuoteTestMessageId(null);
    try {
      const subj = subject.trim() || buildQuoteEmailSubject(resolvedCompanyName, energyTypeSubjectSegment, loadBrokerProfile().companyName);
      const res = await fetch("/api/emails/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: [addr],
          cc: [],
          subject: `[TEST] ${subj}`,
          html: htmlBody,
          body: stripHtmlToText(htmlBody),
          energiaEmailKind: "customerQuote",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Test send failed");
      if (typeof data.id === "string" && data.id) {
        setQuoteTestMessageId(data.id);
      }
      toast({
        message: `Test quote email sent to ${addr}. Subject starts with [TEST] — no CC, not recorded on the RFP.`,
        variant: "success",
      });
      setPreviewOpen(false);
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Test send failed", variant: "error" });
    } finally {
      setTestingQuoteEmail(false);
    }
  }

  const performSend = async () => {
    const toAddr = to.trim();
    if (!toAddr) {
      toast({ message: "Add a recipient email (customer main contact).", variant: "error" });
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/emails/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: [toAddr],
          cc: cc
            .split(/[,;]+/)
            .map((s) => s.trim())
            .filter(Boolean),
          subject: subject.trim(),
          html: htmlBody,
          body: stripHtmlToText(htmlBody),
          energiaEmailKind: "customerQuote",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Send failed");

      if (recordQuoteSummaryOnSend && rfpRequestId) {
        const sentAt = new Date().toISOString();
        const patchRes = await fetch(`/api/rfp/${encodeURIComponent(rfpRequestId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quoteSummarySentAt: sentAt }),
        });
        const patchData = await patchRes.json().catch(() => ({}));
        if (!patchRes.ok) {
          toast({
            message: `Sent to ${toAddr}, but could not record quote summary time (${typeof patchData.error === "string" ? patchData.error : "save failed"}).`,
            variant: "error",
          });
          onQuoteEmailSent?.();
          return;
        }
        toast({
          message: `Sent to ${toAddr}. Quote summary “sent” time recorded for the dashboard.`,
          variant: "success",
        });
      } else {
        toast({ message: `Sent to ${toAddr}.`, variant: "success" });
      }
      onQuoteEmailSent?.();
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Send failed", variant: "error" });
    } finally {
      setSending(false);
    }
  };

  const templateChoices = useMemo(() => templates.map((t) => ({ id: t.id, label: t.name })), [templates]);

  return (
    <div className="space-y-4">
      <ConfirmDialog
        open={sendConfirmOpen}
        onOpenChange={setSendConfirmOpen}
        title="Send quote email to customer?"
        message={`This will email the customer at ${to.trim() || "(no address)"} with the subject and body you composed. Continue?`}
        confirmLabel="Send now"
        cancelLabel="Cancel"
        variant="default"
        onConfirm={() => void performSend()}
      />

      <Dialog open={quoteTestViewOpen} onOpenChange={setQuoteTestViewOpen}>
        <DialogContent className="z-[120] flex max-h-[92vh] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
          <DialogHeader className="shrink-0 space-y-1 border-b px-6 py-4">
            <DialogTitle>Test quote email</DialogTitle>
            <p className="text-left text-sm font-normal text-muted-foreground">
              Scroll to see the full message. Inbox chrome is hidden in this embed.
            </p>
          </DialogHeader>
          {quoteTestMessageId ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <iframe
                title="Test quote email"
                className="block h-[min(78vh,760px)] w-full min-h-[400px] border-0 bg-background"
                src={`/inbox/email/${encodeURIComponent(quoteTestMessageId)}?embed=1`}
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-[min(96vw,720px)] max-h-[min(90vh,820px)] flex flex-col gap-0 overflow-hidden">
          <DialogHeader>
            <DialogTitle>Email preview</DialogTitle>
            <p className="text-xs text-muted-foreground font-normal pt-1 break-all">Subject: {subject.trim() || "—"}</p>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border bg-muted/20 p-4">
            <div
              className="rounded-md border bg-white p-4 text-[14px] leading-snug text-[#111] dark:border-border dark:bg-background dark:text-foreground [&_table]:max-w-none"
              dangerouslySetInnerHTML={{
                __html:
                  finalizeQuoteEmailHtml(htmlBody || "<p><em>(Empty body)</em></p>"),
              }}
            />
          </div>
          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => setPreviewOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="grid gap-2 sm:col-span-2 lg:col-span-1">
          <Label>Email template (optional)</Label>
          {templateChoices.length > 0 ? (
            <Select
              value={templateChoices.some((x) => x.id === templateId) ? templateId : templateChoices[0]?.id}
              onValueChange={(v) => applyTemplate(v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {templateChoices.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-xs text-muted-foreground rounded-md border bg-muted/30 px-2 py-2">
              No templates saved. Compose below or add templates under Settings → Email templates.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-2 justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleSaveDraft()}
            disabled={sending || testingQuoteEmail || savingDraft || !isComposeDirty}
          >
            {savingDraft ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-1" />
                Save draft
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPreviewOpen(true)}
            disabled={sending || testingQuoteEmail}
          >
            <Eye className="h-4 w-4 mr-1" />
            Preview
          </Button>
          <Input
            value={quoteTestEmail}
            onChange={(e) => setQuoteTestEmail(e.target.value)}
            placeholder="Test email"
            className="h-8 w-[min(100%,11rem)] sm:w-44"
            disabled={sending || testingQuoteEmail}
            aria-label="Test recipient email"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleQuoteTestSend()}
            disabled={
              sending ||
              testingQuoteEmail ||
              !quoteTestEmail.trim() ||
              !composeEmailBodyHasContent(htmlBody)
            }
          >
            {testingQuoteEmail ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Sending…
              </>
            ) : (
              <>
                <Mail className="h-4 w-4 mr-1" />
                Test quote email
              </>
            )}
          </Button>
          {quoteTestMessageId ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setQuoteTestViewOpen(true)}
              disabled={sending || testingQuoteEmail}
            >
              View test
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setSendConfirmOpen(true)}
            disabled={sending || testingQuoteEmail || !composeEmailBodyHasContent(htmlBody)}
          >
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Sending…
              </>
            ) : (
              "Send quote email"
            )}
          </Button>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer w-fit">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-input"
          checked={recordQuoteSummaryOnSend}
          onChange={(e) => setRecordQuoteSummaryOnSend(e.target.checked)}
        />
        <span>
          After send, record <strong className="font-medium">quote summary sent</strong> on this RFP (dashboard follow-up)
        </span>
      </label>

      <div className="grid gap-2">
        <Label>To (customer main contact)</Label>
        <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="customer@example.com" />
      </div>
      <div className="grid gap-2">
        <Label>CC (optional)</Label>
        <Input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="comma-separated" />
      </div>
      <div className="grid gap-2">
        <Label>Subject</Label>
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
      </div>

      <div className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Label className="mb-0">Email body</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={resetEmailBodyToTemplate}
              disabled={sending || testingQuoteEmail}
              title="Replace body with the current template (removes inserted tables and images)"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              Reset body
            </Button>
          </div>
          <div className="flex flex-wrap gap-1">
            <ComposeBrokerInsertMenu disabled={sending || testingQuoteEmail} onInsert={insertBrokerAtCaret} />
            <Button
              type="button"
              size="sm"
              className="h-8 text-xs"
              onClick={insertQuotesTable}
              disabled={sending || testingQuoteEmail}
            >
              Insert quotes table
            </Button>
          </div>
        </div>
        <RichTextEditor
          initialHtml={htmlBody}
          resetKey={`quote-customer-compose-${quoteComposeEditorKey}`}
          onChangeHtml={(html) => setHtmlBody(html)}
          disabled={sending || testingQuoteEmail}
          insertSnippet={quoteBodyInsertSnippet}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Subject defaults to <span className="font-medium">Company</span> + <span className="font-medium">energy type</span>{" "}
        + Supply Quotes from <span className="font-medium">your broker company</span>. Salutations use the main
        contact&apos;s <span className="font-medium">first name</span>. The quotes table uses the same monthly average as
        the comparison tab (estimated monthly energy cost from rate and annual usage).{" "}
        <span className="font-medium">Test quote email</span> sends only to the test address with a{" "}
        <span className="font-medium">[TEST]</span> subject prefix, no CC, and does not record quote summary on the RFP.
      </p>
    </div>
  );
}
