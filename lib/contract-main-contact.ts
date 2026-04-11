import { normalizeCompanyKey } from "@/lib/customers-overview";

export type ContactLike = {
  /** Optional when falling back to API shape that omits id (resolved display always uses directory rows with id). */
  id?: string;
  name: string;
  label?: string | null;
  company?: string | null;
  customerId?: string | null;
  isPriority?: boolean;
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  emails?: Array<{ email: string; type?: string | null }>;
};

export type ContractLikeForMainContact = {
  customerId: string;
  customer: { name: string; company: string | null };
  /** Fallback when grid resolution finds no customer-primary row; omit when only `mainContactId` is known. */
  mainContact?: ContactLike | null;
  /** When set, used to resolve labels from the directory for the main-contact column. */
  mainContactId?: string | null;
};

export function labelHasCustomerLabel(label: string | null | undefined): boolean {
  return (label ?? "").toLowerCase().includes("customer");
}

/** Prefer contacts whose label includes "primary" among those tagged as customer for this company. */
export function labelHasPrimaryLabel(label: string | null | undefined): boolean {
  return (label ?? "").toLowerCase().includes("primary");
}

/** Remove standalone "primary" tokens from a comma/semicolon-separated label. */
export function stripPrimaryTokenFromLabel(label: string | null | undefined): string {
  const parts = (label ?? "")
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((p) => !/^primary$/i.test(p));
  return parts.join(", ");
}

/** Append ", primary" when the label already tags the row as customer, or set a sensible default. */
export function mergePrimaryIntoCustomerLabel(label: string | null | undefined): string {
  const raw = (label ?? "").trim();
  const l = raw.toLowerCase();
  if (!raw) return "customer, primary";
  if (l.includes("primary")) return raw;
  if (l.includes("customer")) return `${raw}, primary`;
  return `${raw}, customer, primary`;
}

/**
 * Main contact for the Contracts grid: customer-tagged contacts linked to the customer or matching company name.
 * Requires label to contain "customer" (does not treat blank labels as customer contacts).
 */
export function resolveContractGridMainContact(
  contract: ContractLikeForMainContact,
  directory: ContactLike[]
): ContactLike | null {
  const companyKey = normalizeCompanyKey(contract.customer.company || contract.customer.name || "");

  const candidates = directory.filter((ct) => {
    if (!labelHasCustomerLabel(ct.label)) return false;
    if (ct.customerId && ct.customerId === contract.customerId) return true;
    const cKey = normalizeCompanyKey(ct.company || "");
    if (companyKey && cKey && cKey === companyKey) return true;
    return false;
  });

  if (candidates.length === 0) return null;

  const scored = [...candidates].sort((a, b) => {
    const ap = labelHasPrimaryLabel(a.label) ? 1 : 0;
    const bp = labelHasPrimaryLabel(b.label) ? 1 : 0;
    if (ap !== bp) return bp - ap;
    const aPri = a.isPriority ? 1 : 0;
    const bPri = b.isPriority ? 1 : 0;
    if (aPri !== bPri) return bPri - aPri;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  return scored[0] ?? null;
}

/** Display contact: resolved customer-primary-style contact, else contract main contact from DB. */
export function displayMainContactForContract(
  contract: ContractLikeForMainContact,
  directory: ContactLike[]
): ContactLike | null {
  return resolveContractGridMainContact(contract, directory) ?? contract.mainContact ?? null;
}

/**
 * Prefer directory row fields (e.g. firstName) when the display contact matches by id so salutations
 * and merges use the same data as the Contacts directory.
 */
export function enrichContactLikeFromDirectory(
  contact: ContactLike | null | undefined,
  directory: ContactLike[]
): ContactLike | null {
  if (!contact) return null;
  const id = contact.id?.trim();
  if (!id) return contact;
  const row = directory.find((d) => d.id === id);
  if (!row) return contact;
  return {
    ...row,
    ...contact,
    id: contact.id,
    firstName: row.firstName ?? contact.firstName ?? null,
    lastName: row.lastName ?? contact.lastName ?? null,
    name: (row.name || contact.name || "").trim() || contact.name,
  };
}

/** Customer-tagged contacts for this contract’s customer (same rules as main-contact resolution). */
export function customerContactCandidatesForContract(
  contract: ContractLikeForMainContact,
  directory: ContactLike[]
): ContactLike[] {
  const companyKey = normalizeCompanyKey(contract.customer.company || contract.customer.name || "");
  return directory.filter((ct) => {
    if (!labelHasCustomerLabel(ct.label)) return false;
    if (ct.customerId && ct.customerId === contract.customerId) return true;
    const cKey = normalizeCompanyKey(ct.company || "");
    if (companyKey && cKey && cKey === companyKey) return true;
    return false;
  });
}

export type PrimaryContactPromptKind = "none" | "missing_primary" | "no_customer_contacts";

export function getPrimaryContactPromptKind(
  contract: ContractLikeForMainContact,
  directory: ContactLike[]
): PrimaryContactPromptKind {
  const candidates = customerContactCandidatesForContract(contract, directory);
  if (candidates.length === 0) return "no_customer_contacts";

  const disp = displayMainContactForContract(contract, directory);
  let labelSource: string | null | undefined =
    disp?.id != null ? directory.find((d) => d.id === disp.id)?.label ?? disp.label : disp?.label;

  if ((labelSource == null || String(labelSource).trim() === "") && contract.mainContactId) {
    labelSource =
      directory.find((d) => d.id === contract.mainContactId)?.label ?? contract.mainContact?.label ?? null;
  }

  if (!labelHasCustomerLabel(labelSource)) return "missing_primary";
  if (!labelHasPrimaryLabel(labelSource)) return "missing_primary";
  return "none";
}
