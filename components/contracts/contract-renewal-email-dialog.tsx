"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  buildRenewalEmailContent,
  loadBrokerProfile,
  type BrokerProfile,
} from "@/lib/broker-profile";
import { loadEmailTemplates, RENEWAL_TEMPLATE_DEFAULT_ID } from "@/lib/email-templates";
import { displayMainContactForContract, type ContactLike } from "@/lib/contract-main-contact";
import {
  applyTemplateTokens,
  buildRenewalTemplateVariables,
  type ContractAccountTemplateRow,
  type RenewalContractShape,
  type RfpAccountLine,
} from "@/lib/renewal-email-template-merge";

async function fetchContractAccountRowsForTemplate(contractId: string): Promise<ContractAccountTemplateRow[]> {
  const accRes = await fetch(`/api/contracts/${encodeURIComponent(contractId)}/accounts`);
  if (!accRes.ok) return [];
  const list = (await accRes.json()) as Array<{
    accountId: string;
    serviceAddress?: string | null;
    annualUsage?: string | null;
    avgMonthlyUsage?: string | null;
  }>;
  if (!Array.isArray(list)) return [];
  return list.map((r) => ({
    accountId: r.accountId,
    serviceAddress: r.serviceAddress ?? null,
    annualUsage: r.annualUsage ?? "",
    avgMonthlyUsage: r.avgMonthlyUsage ?? "",
  }));
}

type ContractApi = {
  id: string;
  customerId: string;
  energyType: string;
  pricePerUnit: string | number;
  priceUnit: string;
  startDate: string;
  expirationDate: string;
  termMonths?: number | null;
  annualUsage?: unknown;
  customerUtility?: string | null;
  customer: {
    id: string;
    name: string;
    company: string | null;
    email?: string | null;
    phone?: string | null;
  };
  supplier: { name: string };
  mainContact: {
    name: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    emails?: Array<{ email: string; type?: string | null }>;
  } | null;
};

function formatEnergyType(et: string): string {
  return et === "NATURAL_GAS" ? "Natural Gas" : "Electric";
}

function formatRate(c: ContractApi): string {
  const u = (c.priceUnit ?? "").toString();
  const p = Number(c.pricePerUnit);
  if (!Number.isFinite(p)) return "—";
  return `$${p.toFixed(6)} / ${u}`;
}

function pickMainContactEmail(main: NonNullable<ContractApi["mainContact"]>): string {
  const list = main.emails ?? [];
  const work = list.find((e) => (e.type ?? "").toLowerCase() === "work")?.email?.trim();
  if (work) return work;
  for (const e of list) {
    const em = e.email?.trim();
    if (em) return em;
  }
  return (main.email ?? "").trim();
}

function decodeHtmlForDisplay(html: string): string {
  if (typeof document === "undefined") return html;
  const ta = document.createElement("textarea");
  ta.innerHTML = html;
  return ta.value;
}

function greetingFirstName(main: NonNullable<ContractApi["mainContact"]>): string {
  const fn = (main.firstName ?? "").trim();
  if (fn) return fn;
  const display = (main.name ?? "").trim();
  if (!display) return "";
  if (display.includes(",")) {
    const parts = display.split(",").map((s) => s.trim());
    const after = parts[1];
    if (after) return (after.split(/\s+/)[0] ?? after).trim();
  }
  return (display.split(/\s+/)[0] ?? display).trim();
}

function contactLikeToMainShape(resolved: ContactLike): ContractApi["mainContact"] {
  return {
    name: resolved.name,
    firstName: resolved.firstName ?? null,
    lastName: resolved.lastName ?? null,
    email: resolved.email ?? null,
    emails: resolved.emails?.map((e) => ({ email: e.email, type: e.type })) ?? [],
  };
}

function renewalToAddress(c: ContractApi, mainShape: ContractApi["mainContact"]): string {
  if (mainShape) {
    const fromContact = pickMainContactEmail(mainShape).trim();
    if (fromContact) return fromContact;
  }
  return (c.customer?.email ?? "").trim();
}

function applyStoredOrLegacyTemplate(
  c: ContractApi,
  lines: RfpAccountLine[],
  directory: ContactLike[],
  broker: BrokerProfile,
  templateId: string,
  contractAccountRows: ContractAccountTemplateRow[] = []
): { subject: string; html: string; to: string } {
  const resolved = displayMainContactForContract(c, directory);
  const mainShape = resolved ? contactLikeToMainShape(resolved) : c.mainContact;
  const toEmail = renewalToAddress(c, mainShape);

  const templates = loadEmailTemplates();
  const tpl = templates.find((t) => t.id === templateId) ?? templates[0];

  const end = new Date(c.expirationDate);
  const start = new Date(c.startDate);
  const contactName = (mainShape?.name ?? c.customer.name).trim();
  const greet =
    mainShape != null ? greetingFirstName(mainShape) : contactName.split(/\s+/)[0] ?? contactName;
  const builtLegacy = buildRenewalEmailContent({
    energyLabel: formatEnergyType(c.energyType),
    supplierName: c.supplier.name,
    contactName,
    greetingFirstName: greet,
    contractEndDate: end.toLocaleDateString(),
    rateLabel: formatRate(c),
    startDate: start.toLocaleDateString(),
    endDate: end.toLocaleDateString(),
    accountLines: lines,
    broker,
  });

  if (tpl) {
    const vars = buildRenewalTemplateVariables(
      c as unknown as RenewalContractShape,
      broker,
      lines,
      mainShape,
      contractAccountRows
    );
    let subjectOut = applyTemplateTokens(tpl.subject, vars).trim();
    let htmlOut = applyTemplateTokens(tpl.htmlBody, vars);
    if (!subjectOut) subjectOut = builtLegacy.subject;
    if (!htmlOut.trim()) htmlOut = builtLegacy.html;
    if (!subjectOut.trim()) subjectOut = builtLegacy.subject;
    return {
      to: toEmail,
      subject: subjectOut,
      html: htmlOut,
    };
  }

  return { to: toEmail, subject: builtLegacy.subject, html: builtLegacy.html };
}

export function ContractRenewalEmailDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: string | null;
}) {
  const { open, onOpenChange, contractId } = props;
  const [contract, setContract] = useState<ContractApi | null>(null);
  const [contactDirectory, setContactDirectory] = useState<ContactLike[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [broker, setBroker] = useState<BrokerProfile>(() => loadBrokerProfile());
  const [templateChoices, setTemplateChoices] = useState<{ id: string; label: string }[]>([]);
  const [templateId, setTemplateId] = useState<string>(RENEWAL_TEMPLATE_DEFAULT_ID);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [htmlBody, setHtmlBody] = useState("");
  const [bodyMode, setBodyMode] = useState<"preview" | "html" | "decoded">("preview");
  /** Blocks template Select from re-applying during initial load (avoids wiping subject/body). */
  const suppressTemplateReapplyRef = useRef(false);

  const accountLinesFromRfp = useCallback(
    async (customerId: string): Promise<RfpAccountLine[]> => {
      const res = await fetch(
        `/api/rfp?customerId=${encodeURIComponent(customerId)}&includeArchived=1`
      );
      if (!res.ok) return [];
      const rows = (await res.json()) as Array<{ sentAt?: string | null; accountLines?: RfpAccountLine[] }>;
      const sent = rows.filter((r) => r.sentAt && Array.isArray(r.accountLines) && r.accountLines.length > 0);
      sent.sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt)));
      const first = sent[0];
      return (
        first?.accountLines?.map((l) => ({
          accountNumber: l.accountNumber,
          serviceAddress: l.serviceAddress ?? null,
        })) ?? []
      );
    },
    []
  );

  const load = useCallback(async () => {
    if (!contractId) return;
    suppressTemplateReapplyRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const [cRes, coRes, contractAccountRows] = await Promise.all([
        fetch(`/api/contracts/${encodeURIComponent(contractId)}`),
        fetch("/api/contacts"),
        fetchContractAccountRowsForTemplate(contractId),
      ]);
      const coJson = await coRes.json().catch(() => ({}));
      const dir = (Array.isArray(coJson.contacts) ? coJson.contacts : []) as ContactLike[];
      setContactDirectory(dir);

      const data = await cRes.json();
      if (!cRes.ok) throw new Error(typeof data.error === "string" ? data.error : "Failed to load contract");
      const c = data as ContractApi;
      setContract(c);

      const rfpLines = c.customer?.id ? await accountLinesFromRfp(c.customer.id) : [];
      const lines: RfpAccountLine[] =
        contractAccountRows.length > 0
          ? contractAccountRows.map((r) => ({
              accountNumber: r.accountId,
              serviceAddress: r.serviceAddress ?? null,
            }))
          : rfpLines;
      const b = loadBrokerProfile();
      setBroker(b);

      const templates = loadEmailTemplates();
      const choices = templates.map((t) => ({ id: t.id, label: t.name || "Untitled" }));
      setTemplateChoices(choices);
      const tid =
        templates.find((t) => t.id === RENEWAL_TEMPLATE_DEFAULT_ID)?.id ??
        templates[0]?.id ??
        RENEWAL_TEMPLATE_DEFAULT_ID;
      setTemplateId(tid);

      const { to: toAddr, subject: subj, html } = applyStoredOrLegacyTemplate(
        c,
        lines,
        dir,
        b,
        tid,
        contractAccountRows
      );
      setTo(toAddr);
      setSubject(subj);
      setHtmlBody(html);
      setBodyMode("preview");
    } catch (e) {
      setContract(null);
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
      requestAnimationFrame(() => {
        suppressTemplateReapplyRef.current = false;
      });
    }
  }, [contractId, accountLinesFromRfp]);

  useEffect(() => {
    if (open && contractId) void load();
  }, [open, contractId, load]);

  const canSend = useMemo(() => to.trim() && (htmlBody.trim() || subject.trim()), [to, htmlBody, subject]);

  const reapplyTemplate = useCallback(
    (tid: string) => {
      if (suppressTemplateReapplyRef.current) return;
      if (!contract) return;
      setTemplateId(tid);
      const b = loadBrokerProfile();
      setBroker(b);
      void (async () => {
        const rows = await fetchContractAccountRowsForTemplate(contract.id);
        const rfpLines = contract.customer?.id ? await accountLinesFromRfp(contract.customer.id) : [];
        const lines: RfpAccountLine[] =
          rows.length > 0
            ? rows.map((r) => ({
                accountNumber: r.accountId,
                serviceAddress: r.serviceAddress ?? null,
              }))
            : rfpLines;
        const { to: toAddr, subject: subj, html } = applyStoredOrLegacyTemplate(
          contract,
          lines,
          contactDirectory,
          b,
          tid,
          rows
        );
        setTo(toAddr);
        setSubject(subj);
        setHtmlBody(html);
        setBodyMode("preview");
      })();
    },
    [contract, contactDirectory, accountLinesFromRfp]
  );

  const onSend = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/emails/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: [to.trim()],
          cc: cc
            .split(/[,;]+/)
            .map((s) => s.trim())
            .filter(Boolean),
          subject: subject.trim(),
          html: htmlBody,
          body: htmlBody.replace(/<[^>]+>/g, " "),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Send failed");
      if (contractId) {
        await fetch(`/api/contracts/${encodeURIComponent(contractId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ renewalReminderSentAt: new Date().toISOString() }),
        }).catch(() => {});
      }
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send renewal email</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading contract…</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : contract ? (
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              {contract.customer.name} — {contract.supplier.name} — {formatEnergyType(contract.energyType)}
            </p>
            <div className="grid gap-2">
              <Label>Template</Label>
              {templateChoices.length > 0 ? (
                <Select
                  key={templateChoices.map((t) => t.id).join("|")}
                  value={
                    templateChoices.some((x) => x.id === templateId)
                      ? templateId
                      : templateChoices[0]!.id
                  }
                  onValueChange={(v) => reapplyTemplate(v)}
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
                <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  No saved templates — using built-in renewal subject and body. Add templates under Settings → Email
                  templates.
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label>To</Label>
              <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="customer@example.com" />
            </div>
            <div className="grid gap-2">
              <Label>CC (optional, comma-separated)</Label>
              <Input value={cc} onChange={(e) => setCc(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Subject</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="mb-0">Email body</Label>
                <div className="flex flex-wrap gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={bodyMode === "preview" ? "secondary" : "outline"}
                    className="h-8 text-xs"
                    onClick={() => setBodyMode("preview")}
                  >
                    Preview
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={bodyMode === "html" ? "secondary" : "outline"}
                    className="h-8 text-xs"
                    onClick={() => setBodyMode("html")}
                  >
                    HTML source
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={bodyMode === "decoded" ? "secondary" : "outline"}
                    className="h-8 text-xs"
                    onClick={() => setBodyMode("decoded")}
                    title="HTML with character references decoded (read-only)"
                  >
                    Unencoded HTML
                  </Button>
                </div>
              </div>
              {bodyMode === "preview" ? (
                <div
                  className={cn(
                    "min-h-[240px] max-h-[min(50vh,420px)] overflow-y-auto rounded-md border border-input bg-card px-4 py-3 text-sm",
                    "[&_a]:text-primary [&_a]:underline [&_p]:mb-3 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mb-1"
                  )}
                  dangerouslySetInnerHTML={{ __html: htmlBody }}
                />
              ) : bodyMode === "decoded" ? (
                <textarea
                  readOnly
                  className="min-h-[240px] w-full rounded-md border border-input bg-muted/40 px-3 py-2 text-sm font-mono"
                  value={decodeHtmlForDisplay(htmlBody)}
                  spellCheck={false}
                />
              ) : (
                <textarea
                  className="min-h-[240px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                  value={htmlBody}
                  onChange={(e) => setHtmlBody(e.target.value)}
                  spellCheck={false}
                />
              )}
              {bodyMode === "decoded" && (
                <p className="text-xs text-muted-foreground">
                  Character references are decoded for readability. Use <strong>HTML source</strong> to edit markup.
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Broker sign-off uses Dashboard → Settings → Profile. Edit templates via Settings → Email templates. Account
              lines use the most recent sent RFP when available. “To” prefers a customer-labeled contact (with “primary”
              in the label when present) matched to this customer or company, then the contract Main contact, then the
              customer email.
            </p>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!canSend || sending || loading} onClick={() => void onSend()}>
            {sending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
