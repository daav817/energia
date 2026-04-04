import {
  isSupplierCandidateContact,
  normalizeCompanyKey,
  stripEnergySuffix,
} from "@/lib/customers-overview";

export type RawContactForSupplierMerge = {
  id: string;
  name: string;
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
  email: string | null;
  phone: string | null;
  label: string | null;
  isPriority: boolean;
  company: string | null;
};

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

export function rankForDefaultMainContact(c: SupplierRfpContactRow): number {
  if (c.isPriority) return 0;
  const t = parseSupplierLabelTokens(c.label);
  if (t.includes("primary") || t.includes("default")) return 1;
  return 2;
}

/** Contact must carry the RFP energy tag (gas or electric) on its label string. */
export function contactMatchesRfpEnergy(
  label: string | null | undefined,
  energyType: "ELECTRIC" | "NATURAL_GAS"
): boolean {
  const labels = parseSupplierLabelTokens(label);
  return energyType === "ELECTRIC" ? labels.includes("electric") : labels.includes("gas");
}

/**
 * Supplier-tagged contacts that match the current RFP energy type, ordered for the Main Contact dropdown
 * (priority / primary-default labels first, then name).
 */
export function filterSupplierContactsForRfpEnergy(
  contacts: SupplierRfpContactRow[],
  energyType: "ELECTRIC" | "NATURAL_GAS"
): SupplierRfpContactRow[] {
  return contacts
    .filter((c) => isSupplierCandidateContact(c.label) && contactMatchesRfpEnergy(c.label, energyType))
    .sort((a, b) => {
      const dr = rankForDefaultMainContact(a) - rankForDefaultMainContact(b);
      if (dr !== 0) return dr;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
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
    if (seen.has(raw.id)) return;
    seen.set(raw.id, {
      id: raw.id,
      name: raw.name,
      email: effectiveContactEmail(raw),
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
    if (!isSupplierCandidateContact(c.label)) continue;
    push(c);
  }

  const rows = Array.from(seen.values());
  rows.sort((a, b) => {
    const dr = rankForDefaultMainContact(a) - rankForDefaultMainContact(b);
    if (dr !== 0) return dr;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return rows;
}

/** Prefer deliverable email; still respects primary/default ordering first. */
/** Default RFP recipient: must have email; prefers isPriority, then label primary/default, then name. */
export function pickDefaultSupplierContactId(contacts: SupplierRfpContactRow[]): string {
  const withEmail = contacts.filter((c) => (c.email || "").trim());
  if (withEmail.length === 0) return "";
  const sorted = [...withEmail].sort((a, b) => {
    const dr = rankForDefaultMainContact(a) - rankForDefaultMainContact(b);
    if (dr !== 0) return dr;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return sorted[0].id;
}

export type SupplierRecipientRow = {
  supplierId: string;
  supplierName: string;
  contactId: string;
  contactName: string;
  email: string;
};

/** One row per supplier contact that has a deliverable email (for RFP send / preview). */
export function flattenDeliverableSupplierContacts(
  suppliers: Array<{ id: string; name: string }>,
  pool: RawContactForSupplierMerge[]
): SupplierRecipientRow[] {
  const rows: SupplierRecipientRow[] = [];
  for (const supplier of suppliers) {
    const merged = mergeContactsForSupplier(supplier, pool);
    for (const c of merged) {
      const e = (c.email || "").trim();
      if (!e) continue;
      rows.push({
        supplierId: supplier.id,
        supplierName: supplier.name,
        contactId: c.id,
        contactName: c.name,
        email: e,
      });
    }
  }
  return rows;
}
