/** Local broker identity + templates (single workspace user). Extend later with DB-backed multi-user. */

export const BROKER_PROFILE_STORAGE_KEY = "energia-broker-profile-v1";

/** Fired on `window` after `saveBrokerProfile` in this tab (storage event handles other tabs). */
export const BROKER_PROFILE_UPDATED_EVENT = "energia-broker-profile-updated";

export type BrokerProfile = {
  firstName: string;
  lastName: string;
  companyName: string;
  email: string;
  phone: string;
  fax: string;
  websiteOrLinkedIn: string;
};

export const EMPTY_BROKER_PROFILE: BrokerProfile = {
  firstName: "",
  lastName: "",
  companyName: "",
  email: "",
  phone: "",
  fax: "",
  websiteOrLinkedIn: "",
};

export function loadBrokerProfile(): BrokerProfile {
  if (typeof window === "undefined") return { ...EMPTY_BROKER_PROFILE };
  try {
    const raw = localStorage.getItem(BROKER_PROFILE_STORAGE_KEY);
    if (!raw) return { ...EMPTY_BROKER_PROFILE };
    const j = JSON.parse(raw) as Partial<BrokerProfile>;
    return {
      firstName: String(j.firstName ?? ""),
      lastName: String(j.lastName ?? ""),
      companyName: String(j.companyName ?? ""),
      email: String(j.email ?? ""),
      phone: String(j.phone ?? ""),
      fax: String(j.fax ?? ""),
      websiteOrLinkedIn: String(j.websiteOrLinkedIn ?? ""),
    };
  } catch {
    return { ...EMPTY_BROKER_PROFILE };
  }
}

export function saveBrokerProfile(p: BrokerProfile) {
  if (typeof window === "undefined") return;
  localStorage.setItem(BROKER_PROFILE_STORAGE_KEY, JSON.stringify(p));
  window.dispatchEvent(new Event(BROKER_PROFILE_UPDATED_EVENT));
}

export const RENEWAL_EMAIL_TEMPLATE_ID = "renewal_v1";

export function buildRenewalEmailContent(opts: {
  energyLabel: string;
  supplierName: string;
  /** Full display name (e.g. signature / references). */
  contactName: string;
  /** First name for "Dear …" salutation. */
  greetingFirstName: string;
  contractEndDate: string;
  rateLabel: string;
  startDate: string;
  endDate: string;
  accountLines: Array<{ accountNumber: string; serviceAddress?: string | null }>;
  broker: BrokerProfile;
}): { subject: string; html: string; text: string } {
  const accounts =
    opts.accountLines.length > 0
      ? opts.accountLines
          .map((a) => `${a.accountNumber}${a.serviceAddress ? ` — ${a.serviceAddress}` : ""}`)
          .join("<br/>")
      : "—";

  const subject = `URGENT: Your ${opts.energyLabel} Contract with ${opts.supplierName} is Expiring – Action Required`;

  const greeting = opts.greetingFirstName.trim() || opts.contactName.trim();
  const html = `
<p>Dear ${greeting},</p>
<p>I am writing to notify you that your current energy supply agreement for your properties is approaching its expiration date (${opts.contractEndDate}). To ensure you maintain budget stability and avoid a lapse into high-cost &quot;holdover&quot; variable rates, we need to begin the renewal process immediately.</p>
<p><strong>Current Contract Overview:</strong></p>
<ul>
<li>Current Supplier: ${opts.supplierName}</li>
<li>Contracted Rate: ${opts.rateLabel}</li>
<li>Start Date: ${opts.startDate}</li>
<li>End Date: ${opts.endDate} (Upcoming Meter Read)</li>
</ul>
<p><strong>Accounts within the Current Contract</strong></p>
<p>${accounts}</p>
<p><strong>Next Steps:</strong><br/>
To provide you with the most accurate and competitive proposal from our network of suppliers, I require updated data for all your accounts.<br/>
Please reply to this email with a copy/scan of recent energy bill(s) (all pages) for every account you wish to renew.</p>
<p>I look forward to securing your next contract and keeping your energy costs managed and predictable.</p>
<p>Best regards,<br/>
${opts.broker.firstName} ${opts.broker.lastName}<br/>
${opts.broker.companyName}<br/>
${opts.broker.email ? `${opts.broker.email}<br/>` : ""}
${opts.broker.phone}<br/>
${opts.broker.fax ? `${opts.broker.fax}<br/>` : ""}</p>
`.trim();

  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  return { subject, html, text };
}
