/**
 * Contract-derived customer directory: one row per unique company name,
 * matched to Contacts (customer label) by primary name from contract Main Contact.
 */

export function stripEnergySuffix(raw: string): string {
  return raw
    .replace(/\s*\(\s*(?:electric|natural\s*gas|natural_gas|gas)\s*\)\s*$/i, "")
    .replace(/\s*[-–]\s*(?:electric|natural\s*gas|natural_gas|gas)\s*$/i, "")
    .trim();
}

export function normalizeCompanyKey(companyOrName: string): string {
  const cleaned = stripEnergySuffix((companyOrName || "").trim());
  return cleaned.toLowerCase().replace(/\s+/g, " ");
}

export function normalizePersonName(s: string): string {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Use in Contact matching pool: unlabeled legacy, or label mentions customer; exclude supplier-only. */
export function isCustomerCandidateContact(label: string | null | undefined): boolean {
  const raw = label == null ? "" : String(label).trim();
  if (raw === "") return true;
  const l = raw.toLowerCase();
  if (l.includes("supplier") && !l.includes("customer")) return false;
  return l.includes("customer");
}

/** Supplier-side contacts for directory / Contracts supplier modal (requires explicit supplier/vendor in label). */
export function isSupplierCandidateContact(label: string | null | undefined): boolean {
  const raw = label == null ? "" : String(label).trim();
  if (raw === "") return false;
  const l = raw.toLowerCase();
  if (l.includes("customer") && !l.includes("supplier") && !l.includes("vendor")) return false;
  return l.includes("supplier") || l.includes("vendor");
}

/**
 * When matching contacts by company name to a supplier, allow unlabeled legacy rows and any label
 * except pure "customer" (no supplier/vendor). Matches the older /api/contacts?company= behavior.
 */
export function isLabelOkForSupplierCompanyMatch(label: string | null | undefined): boolean {
  const raw = label == null ? "" : String(label).trim();
  if (raw === "") return true;
  const l = raw.toLowerCase();
  if (l.includes("customer") && !l.includes("supplier") && !l.includes("vendor")) return false;
  return true;
}

export type ContactForMatch = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  label: string | null;
  isPriority: boolean;
  updatedAt: Date;
  company: string | null;
};

export type ContractForOverview = {
  id: string;
  energyType: string;
  expirationDate: Date;
  status: string;
  customer: { id: string; name: string; company: string | null; notes: string | null };
  mainContact: { id: string; name: string } | null;
  supplier: { name: string };
};

export type OverviewContractOut = {
  id: string;
  energyType: string;
  expirationDate: string;
  status: string;
  supplierName: string;
  mainContactName: string | null;
};

export type OverviewRowOut = {
  companyKey: string;
  companyDisplay: string;
  customerIds: string[];
  canonicalCustomerId: string;
  notes: string | null;
  primaryNameFromContracts: string | null;
  directoryContact: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    label: string | null;
    company: string | null;
  } | null;
  contactMatchHint: "matched" | "no_primary_on_contracts" | "no_matching_contact";
  hasElectric: boolean;
  hasNaturalGas: boolean;
  /** At least one non-archived contract (same as Active tab in Contract Management). */
  isActive: boolean;
  contracts: OverviewContractOut[];
};

/** Pick Main Contact name from contracts: non-archived first, then unexpired, then latest expiration. */
export function pickPrimaryNameFromContracts(contracts: ContractForOverview[]): string | null {
  const withMc = contracts.filter((c) => c.mainContact?.name?.trim());
  if (withMc.length === 0) return null;
  const now = Date.now();
  const sorted = withMc.slice().sort((a, b) => {
    const aArch = a.status === "archived" ? 1 : 0;
    const bArch = b.status === "archived" ? 1 : 0;
    if (aArch !== bArch) return aArch - bArch;
    const ae = new Date(a.expirationDate).getTime();
    const be = new Date(b.expirationDate).getTime();
    const aActive = ae >= now;
    const bActive = be >= now;
    if (aActive !== bActive) return aActive ? -1 : 1;
    return be - ae;
  });
  return sorted[0]?.mainContact?.name?.trim() ?? null;
}

export function findDirectoryContactMatch(
  primaryName: string | null,
  candidates: ContactForMatch[]
): ContactForMatch | null {
  if (!primaryName?.trim()) return null;
  const target = normalizePersonName(primaryName);
  if (!target) return null;
  const matches = candidates.filter((c) => normalizePersonName(c.name) === target);
  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    if (a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });
  return matches[0] ?? null;
}

function toIso(d: Date): string {
  return d.toISOString();
}

export function buildCustomerOverviewRows(
  contracts: ContractForOverview[],
  allContacts: ContactForMatch[],
  search?: string
): OverviewRowOut[] {
  const candidates = allContacts.filter((c) => isCustomerCandidateContact(c.label));

  type Group = {
    companyKey: string;
    companyDisplay: string;
    customerIds: Set<string>;
    contracts: ContractForOverview[];
    customerNotes: Map<string, string | null>;
  };

  const groups = new Map<string, Group>();

  for (const ct of contracts) {
    const cust = ct.customer;
    const rawLabel = (cust.company || cust.name || "").trim();
    const companyDisplay = stripEnergySuffix(rawLabel) || cust.name || "Unknown";
    const key = normalizeCompanyKey(cust.company || cust.name || "");
    if (!key) continue;

    if (!groups.has(key)) {
      groups.set(key, {
        companyKey: key,
        companyDisplay,
        customerIds: new Set(),
        contracts: [],
        customerNotes: new Map(),
      });
    }
    const g = groups.get(key)!;
    g.customerIds.add(cust.id);
    g.contracts.push(ct);
    if (!g.customerNotes.has(cust.id)) g.customerNotes.set(cust.id, cust.notes ?? null);
    if (companyDisplay.length > (g.companyDisplay || "").length) {
      g.companyDisplay = companyDisplay;
    }
  }

  const q = (search || "").trim().toLowerCase();
  const rows: OverviewRowOut[] = [];

  for (const g of groups.values()) {
    const primaryName = pickPrimaryNameFromContracts(g.contracts);
    const directoryMatch = findDirectoryContactMatch(primaryName, candidates);

    let contactMatchHint: OverviewRowOut["contactMatchHint"] = "matched";
    if (!primaryName) contactMatchHint = "no_primary_on_contracts";
    else if (!directoryMatch) contactMatchHint = "no_matching_contact";

    const customerIds = Array.from(g.customerIds);
    const contractCountByCustomer = new Map<string, number>();
    for (const id of customerIds) contractCountByCustomer.set(id, 0);
    for (const ct of g.contracts) {
      contractCountByCustomer.set(
        ct.customer.id,
        (contractCountByCustomer.get(ct.customer.id) ?? 0) + 1
      );
    }
    customerIds.sort((a, b) => (contractCountByCustomer.get(b) ?? 0) - (contractCountByCustomer.get(a) ?? 0));
    const canonicalCustomerId = customerIds[0]!;

    let notes: string | null = null;
    for (const id of customerIds) {
      const n = g.customerNotes.get(id);
      if (n && String(n).trim()) {
        notes = n;
        break;
      }
    }

    const hasElectric = g.contracts.some((c) => c.energyType === "ELECTRIC");
    const hasNaturalGas = g.contracts.some((c) => c.energyType === "NATURAL_GAS");
    const isActive = g.contracts.some((c) => c.status !== "archived");

    const contractsOut: OverviewContractOut[] = g.contracts.map((c) => ({
      id: c.id,
      energyType: c.energyType,
      expirationDate: toIso(c.expirationDate),
      status: c.status,
      supplierName: c.supplier?.name || "",
      mainContactName: c.mainContact?.name ?? null,
    }));

    const row: OverviewRowOut = {
      companyKey: g.companyKey,
      companyDisplay: g.companyDisplay,
      customerIds,
      canonicalCustomerId,
      notes,
      primaryNameFromContracts: primaryName,
      directoryContact: directoryMatch
        ? {
            id: directoryMatch.id,
            name: directoryMatch.name,
            email: directoryMatch.email,
            phone: directoryMatch.phone,
            label: directoryMatch.label,
            company: directoryMatch.company,
          }
        : null,
      contactMatchHint,
      hasElectric,
      hasNaturalGas,
      isActive,
      contracts: contractsOut,
    };

    if (q) {
      const hay = [
        g.companyDisplay,
        primaryName || "",
        directoryMatch?.name || "",
        directoryMatch?.email || "",
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) continue;
    }

    rows.push(row);
  }

  rows.sort((a, b) => a.companyDisplay.localeCompare(b.companyDisplay, undefined, { sensitivity: "base" }));
  return rows;
}

/** Legacy `Contact.email` or first row in `emails` — matches Contacts UI / RFP cards. */
export function effectiveContactEmailFromRecord(row: {
  email?: string | null;
  emails?: Array<{ email?: string | null }> | null;
}): string | null {
  const legacy = row.email != null ? String(row.email).trim() : "";
  if (legacy) return legacy;
  for (const e of row.emails ?? []) {
    const em = e?.email != null ? String(e.email).trim() : "";
    if (em) return em;
  }
  return null;
}
