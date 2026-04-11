import {
  isSupplierCandidateContact,
  normalizeCompanyKey,
  stripEnergySuffix,
} from "@/lib/customers-overview";
import { parseRfpPreferredEmails } from "@/lib/contact-labels";

export type RawContactForSupplierMerge = {
  id: string;
  name: string;
  firstName: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  supplierId: string | null;
  label: string | null;
  isPriority: boolean;
  emails: Array<{ email: string }>;
};

export type SupplierRfpContactRow = {
  id: string;
  name: string;
  firstName?: string | null;
  email: string | null;
  /** All deliverable addresses for this contact (primary + ContactEmail rows), deduped in order. */
  emails?: string[];
  phone: string | null;
  label: string | null;
  isPriority: boolean;
  company: string | null;
};

export type RfpSupplierRecipientSlot = {
  contactId: string;
  email: string;
};

function collectDeliverableEmails(raw: RawContactForSupplierMerge): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (e: string | null | undefined) => {
    const t = (e || "").trim();
    if (!t) return;
    const k = t.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };
  add(raw.email);
  for (const row of raw.emails ?? []) add(row?.email);
  return out;
}

export function parseSupplierLabelTokens(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;]+/g)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function effectiveContactEmail(c: RawContactForSupplierMerge): string | null {
  const primary = (c.email || "").trim();
  if (primary) return primary;
  for (const row of c.emails) {
    const e = (row?.email || "").trim();
    if (e) return e;
  }
  return null;
}

/** Looser match for Contact.company vs Supplier.name (punctuation, spacing). */
export function normalizeSupplierMatchKey(raw: string): string {
  const cleaned = stripEnergySuffix((raw || "").trim()).toLowerCase();
  return cleaned.replace(/[.,'"’]/g, "").replace(/\s+/g, " ").trim();
}

/** True if label indicates natural-gas RFP routing (avoids substring hits like "Vegas"). */
function labelMentionsGasWord(label: string | null | undefined): boolean {
  const raw = (label ?? "").toLowerCase();
  if (!raw.trim()) return false;
  if (raw.includes("natural gas")) return true;
  return /\bgas\b/.test(raw);
}

/**
 * Contact must carry the RFP energy tag (gas or electric) on its label string.
 * Uses the full label text (not only comma-split tokens) so values like "Supplier, Natural gas"
 * match natural gas RFPs — token-only checks missed the "natural gas" segment.
 */
export function contactMatchesRfpEnergy(
  label: string | null | undefined,
  energyType: "ELECTRIC" | "NATURAL_GAS"
): boolean {
  const raw = (label ?? "").toLowerCase();
  if (!raw.trim()) return false;
  if (energyType === "ELECTRIC") return raw.includes("electric");
  return labelMentionsGasWord(label);
}

/** Label mentions electric or gas anywhere (same signals as RFP energy, without picking a side). */
function labelMentionsElectricOrGas(label: string | null | undefined): boolean {
  const raw = (label ?? "").toLowerCase();
  if (!raw.trim()) return false;
  return raw.includes("electric") || labelMentionsGasWord(label);
}

/** First name for email salutation; falls back to first token of full name. */
export function supplierContactGreetingName(
  firstName: string | null | undefined,
  fullName: string
): string {
  const fn = (firstName ?? "").trim();
  if (fn) return fn;
  const n = (fullName || "").trim();
  if (!n) return "";
  return n.split(/\s+/)[0] ?? "";
}

/** Pure customer-side labeling: exclude from supplier energy-only shortcut. */
function isCustomerExclusiveContactLabel(label: string | null | undefined): boolean {
  const raw = (label ?? "").toLowerCase();
  if (!raw.trim()) return false;
  return raw.includes("customer") && !raw.includes("supplier") && !raw.includes("vendor");
}

/**
 * Supplier/vendor-tagged contact marked `retired` — excluded from RFP supplier selection and supplier emails.
 * Requires supplier (or vendor) on the label so unrelated "retired" text is ignored.
 */
export function isRetiredSupplierContact(label: string | null | undefined): boolean {
  if (!isSupplierCandidateContact(label)) return false;
  const raw = (label ?? "").toLowerCase();
  return /\bretired\b/.test(raw);
}

/**
 * Contact is intended for the RFP supplier picker when labels include supplier/vendor plus an energy hint
 * (electric or gas), and it is not a customer-exclusive label.
 */
export function qualifiesContactForRfpSupplierDirectory(label: string | null | undefined): boolean {
  if (isRetiredSupplierContact(label)) return false;
  if (!isSupplierCandidateContact(label)) return false;
  if (!labelMentionsElectricOrGas(label)) return false;
  if (isCustomerExclusiveContactLabel(label)) return false;
  return true;
}

/**
 * Supplier-tagged contacts that match the current RFP energy type, ordered for the Main Contact dropdown
 * (priority / primary-default labels first, then name).
 *
 * Includes contacts labeled only with energy (e.g. `gas` or `electric`) when they are not customer-exclusive,
 * so directory-linked supplier contacts do not need the word "supplier" on the label.
 */
export function filterSupplierContactsForRfpEnergy(
  contacts: SupplierRfpContactRow[],
  energyType: "ELECTRIC" | "NATURAL_GAS"
): SupplierRfpContactRow[] {
  return contacts
    .filter((c) => {
      if (isRetiredSupplierContact(c.label)) return false;
      if (!contactMatchesRfpEnergy(c.label, energyType)) return false;
      if (isSupplierCandidateContact(c.label)) return true;
      return labelMentionsElectricOrGas(c.label) && !isCustomerExclusiveContactLabel(c.label);
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/**
 * Contacts for RFP supplier picker: explicit supplierId link OR same normalized company as supplier.name
 * with supplier/vendor-style labeling (or legacy empty / non-customer-only label).
 */
export function mergeContactsForSupplier(
  supplier: { id: string; name: string },
  pool: RawContactForSupplierMerge[]
): SupplierRfpContactRow[] {
  const key = normalizeCompanyKey(supplier.name);
  const looseKey = normalizeSupplierMatchKey(supplier.name);
  const seen = new Map<string, SupplierRfpContactRow>();

  const push = (raw: RawContactForSupplierMerge) => {
    if (isRetiredSupplierContact(raw.label)) return;
    if (seen.has(raw.id)) return;
    const emails = collectDeliverableEmails(raw);
    seen.set(raw.id, {
      id: raw.id,
      name: raw.name,
      firstName: raw.firstName,
      email: emails[0] ?? effectiveContactEmail(raw),
      emails,
      phone: raw.phone,
      label: raw.label,
      isPriority: raw.isPriority,
      company: raw.company,
    });
  };

  for (const c of pool) {
    if (c.supplierId === supplier.id) {
      push(c);
    }
  }

  for (const c of pool) {
    if (c.supplierId && c.supplierId !== supplier.id) continue;
    const co = (c.company || "").trim();
    if (!co) continue;
    const coKey = normalizeCompanyKey(co);
    const coLoose = normalizeSupplierMatchKey(co);
    if (coKey !== key && coLoose !== looseKey) continue;
    const companyMatchEligible =
      isSupplierCandidateContact(c.label) ||
      (labelMentionsElectricOrGas(c.label) && !isCustomerExclusiveContactLabel(c.label));
    if (!companyMatchEligible) continue;
    push(c);
  }

  const rows = Array.from(seen.values());
  rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return rows;
}

/**
 * Default RFP recipient rows: emails marked with `rfp:` on the contact label, else one slot (first contact by name, first email).
 */
export function defaultRecipientSlotsForContacts(contacts: SupplierRfpContactRow[]): RfpSupplierRecipientSlot[] {
  const slots: RfpSupplierRecipientSlot[] = [];
  const seen = new Set<string>();
  const add = (contactId: string, email: string) => {
    const em = email.trim();
    if (!em) return;
    const k = `${contactId}\n${em.toLowerCase()}`;
    if (seen.has(k)) return;
    seen.add(k);
    slots.push({ contactId, email: em });
  };

  let anyPref = false;
  for (const c of contacts) {
    const prefs = new Set(parseRfpPreferredEmails(c.label));
    if (prefs.size === 0) continue;
    const prefList = c.emails?.length ? c.emails : c.email ? [c.email] : [];
    for (const em of prefList) {
      if (prefs.has(em.trim().toLowerCase())) {
        add(c.id, em);
        anyPref = true;
      }
    }
  }
  if (anyPref) return slots;

  const sorted = [...contacts].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
  for (const c of sorted) {
    const list = c.emails?.length ? c.emails : c.email ? [c.email] : [];
    if (list.length > 0) {
      add(c.id, list[0]);
      return slots;
    }
  }
  return slots;
}

export type SupplierRecipientRow = {
  supplierId: string;
  supplierName: string;
  contactId: string;
  contactName: string;
  /** First name (or first token of display name) for "Hi …" in RFP email. */
  greetingName: string;
  email: string;
};

/** One row per supplier contact email (for RFP send / preview). */
export function flattenDeliverableSupplierContacts(
  suppliers: Array<{ id: string; name: string }>,
  pool: RawContactForSupplierMerge[]
): SupplierRecipientRow[] {
  const rows: SupplierRecipientRow[] = [];
  for (const supplier of suppliers) {
    const merged = mergeContactsForSupplier(supplier, pool);
    for (const c of merged) {
      if (isRetiredSupplierContact(c.label)) continue;
      const list = c.emails?.length ? c.emails : c.email ? [c.email] : [];
      for (const addr of list) {
        const e = (addr || "").trim();
        if (!e) continue;
        rows.push({
          supplierId: supplier.id,
          supplierName: supplier.name,
          contactId: c.id,
          contactName: c.name,
          greetingName: supplierContactGreetingName(c.firstName ?? null, c.name),
          email: e,
        });
      }
    }
  }
  return rows;
}
