export type CustomerQuoteEmailDraft = {
  to: string;
  cc: string;
  subject: string;
  htmlBody: string;
  templateId: string;
  recordQuoteSummaryOnSend: boolean;
};

export function parseCustomerQuoteEmailDraft(raw: unknown): CustomerQuoteEmailDraft | null {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  return {
    to: typeof o.to === "string" ? o.to : "",
    cc: typeof o.cc === "string" ? o.cc : "",
    subject: typeof o.subject === "string" ? o.subject : "",
    htmlBody: typeof o.htmlBody === "string" ? o.htmlBody : "",
    templateId: typeof o.templateId === "string" ? o.templateId : "",
    recordQuoteSummaryOnSend:
      typeof o.recordQuoteSummaryOnSend === "boolean" ? o.recordQuoteSummaryOnSend : false,
  };
}

export function canonicalCustomerQuoteDraftJson(d: CustomerQuoteEmailDraft): string {
  return JSON.stringify({
    to: d.to,
    cc: d.cc,
    subject: d.subject,
    htmlBody: d.htmlBody,
    templateId: d.templateId,
    recordQuoteSummaryOnSend: d.recordQuoteSummaryOnSend,
  });
}
