/** Browser-local email templates (subject + HTML). Replace with DB when multi-user. */

export const EMAIL_TEMPLATES_STORAGE_KEY = "energia-email-templates-v1";
export const RENEWAL_TEMPLATE_DEFAULT_ID = "renewal-reminder-v1";
/** Default id for the Quotes “customer summary” outbound template (editable under Email templates). */
export const CUSTOMER_QUOTES_TEMPLATE_DEFAULT_ID = "customer-quotes-v1";

export type StoredEmailTemplate = {
  id: string;
  name: string;
  subject: string;
  htmlBody: string;
  updatedAt: string;
};

const DEFAULT_RENEWAL_SUBJECT =
  "URGENT: Your {{energyLabel}} Contract with {{supplierName}} is Expiring – Action Required";

const DEFAULT_RENEWAL_HTML = `
<p>Dear {{greetingFirstName}},</p>
<p>I am writing to notify you that your current energy supply agreement for your properties is approaching its expiration date ({{contractEndDate}}). To ensure you maintain budget stability and avoid a lapse into high-cost variable rates, we need to begin the renewal process immediately.</p>
<p><strong>Current contract overview</strong></p>
<ul>
<li>Supplier: {{supplierName}}</li>
<li>Rate: {{rateLabel}}</li>
<li>Start: {{contractStartDate}}</li>
<li>End: {{contractEndDate}}</li>
</ul>
<p><strong>Accounts</strong></p>
<p>{{accountLinesHtml}}</p>
<p><strong>Next steps</strong><br/>
Please reply with recent energy bill(s) for every account you wish to renew.</p>
<p>Best regards,<br/>
{{brokerFirstName}} {{brokerLastName}}<br/>
{{brokerCompany}}<br/>
{{brokerPhone}}<br/>
{{brokerFax}}</p>
`.trim();

const DEFAULT_CUSTOMER_QUOTES_SUBJECT = "Your {{energyLabel}} supply quotes for review";

const DEFAULT_CUSTOMER_QUOTES_HTML = `
<p>Dear {{greetingFirstName}},</p>
<p>Please find indicative quotes below for your review. Reply with any questions or your preferred option.</p>
<p><strong>Next steps</strong><br/>
Add your comparison table using <em>Insert quotes table</em> on the Quotes page, or paste details here.</p>
<p>Best regards,<br/>
{{brokerFirstName}} {{brokerLastName}}<br/>
{{brokerCompany}}<br/>
{{brokerPhone}}<br/>
{{brokerFax}}</p>
`.trim();

/** Clears all templates (empty list). Renewal email still uses built-in content when none are stored. */
export function clearAllEmailTemplates() {
  if (typeof window === "undefined") return;
  localStorage.setItem(EMAIL_TEMPLATES_STORAGE_KEY, "[]");
}

export function loadEmailTemplates(): StoredEmailTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(EMAIL_TEMPLATES_STORAGE_KEY);
    if (!raw) {
      const seeded = seedDefaultTemplates();
      saveEmailTemplates(seeded);
      return seeded;
    }
    const j = JSON.parse(raw) as unknown;
    if (Array.isArray(j) && j.length === 0) {
      return [];
    }
    if (!Array.isArray(j)) {
      const seeded = seedDefaultTemplates();
      saveEmailTemplates(seeded);
      return seeded;
    }
    const mapped = j
      .map((row) => row as Partial<StoredEmailTemplate>)
      .filter((t) => t.id && t.name != null && t.subject != null && t.htmlBody != null)
      .map((t) => ({
        id: String(t.id),
        name: String(t.name),
        subject: String(t.subject),
        htmlBody: String(t.htmlBody),
        updatedAt: typeof t.updatedAt === "string" ? t.updatedAt : new Date().toISOString(),
      }));
    const merged = ensureCustomerQuotesBuiltinTemplate(mapped);
    if (merged.length > mapped.length) {
      try {
        saveEmailTemplates(merged);
      } catch {
        /* ignore */
      }
    }
    return merged;
  } catch {
    const seeded = seedDefaultTemplates();
    try {
      saveEmailTemplates(seeded);
    } catch {
      /* ignore */
    }
    return seeded;
  }
}

function defaultCustomerQuotesRow(now: string): StoredEmailTemplate {
  return {
    id: CUSTOMER_QUOTES_TEMPLATE_DEFAULT_ID,
    name: "Customer quotes (summary)",
    subject: DEFAULT_CUSTOMER_QUOTES_SUBJECT,
    htmlBody: DEFAULT_CUSTOMER_QUOTES_HTML,
    updatedAt: now,
  };
}

function ensureCustomerQuotesBuiltinTemplate(list: StoredEmailTemplate[]): StoredEmailTemplate[] {
  if (list.some((t) => t.id === CUSTOMER_QUOTES_TEMPLATE_DEFAULT_ID)) return list;
  return [...list, defaultCustomerQuotesRow(new Date().toISOString())];
}

function seedDefaultTemplates(): StoredEmailTemplate[] {
  const now = new Date().toISOString();
  return [
    {
      id: RENEWAL_TEMPLATE_DEFAULT_ID,
      name: "Renewal reminder",
      subject: DEFAULT_RENEWAL_SUBJECT,
      htmlBody: DEFAULT_RENEWAL_HTML,
      updatedAt: now,
    },
    defaultCustomerQuotesRow(now),
  ];
}

export function saveEmailTemplates(list: StoredEmailTemplate[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(EMAIL_TEMPLATES_STORAGE_KEY, JSON.stringify(list));
}
