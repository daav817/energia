export const RFP_FROM_CONTRACT_SESSION_KEY = "energia-rfp-from-contract-v1";

/**
 * Staged on the Contracts directory, consumed on the RFP page (?fromContract=1).
 *
 * Cross-tab: payload is written to **localStorage** (new tabs do not share sessionStorage with the opener).
 * If localStorage is unavailable, open with `prefillContractId` in the URL so the RFP page can refetch.
 *
 * | Contract / source field | RFP control / state |
 * |-------------------------|---------------------|
 * | customer.id             | Customer company Select (match CRM id when the bucket row has `customerId`) |
 * | customer.company / name, main contact company | Same Select — **fallback** when company buckets have `customerId: null` (common; buckets are built from Contacts). Uses the same rules as loading a saved RFP. |
 * | mainContact / mainContactId | Customer contact Select |
 * | energyType              | Energy type (Electric / Natural gas) |
 * | customerUtility         | Utility (LDC) |
 * | expirationDate → YYYY-MM | Contract starting month/year |
 * | contract accounts API → lines | Account lines (number, address, annual & avg usage) |
 * | brokerMargin            | Broker margin ($) |
 * | priceUnit (normalized)  | Broker margin unit (KWH / MCF / CCF / DTH) |
 * | termMonths (if not 12/24/36) | Custom term length (months); standard checkboxes stay 12/24/36 |
 * | notes                   | RFP Notes (contract notes only; no transfer breadcrumb) |
 */
export type RfpFromContractPrefillPayload = {
  version: 1;
  /** For traceability in RFP notes */
  sourceContractId: string;
  customerId: string;
  customerContactId: string | null;
  energyType: "ELECTRIC" | "NATURAL_GAS";
  ldcUtility: string;
  /** RFP "Contract starting month/year" (YYYY-MM); taken from contract expiration month. */
  contractStartValue: string;
  accountLines: Array<{
    accountNumber: string;
    serviceAddress: string;
    annualUsage: string;
    avgMonthlyUsage: string;
  }>;
  /** Contract broker margin; maps to broker margin field */
  brokerMargin: string;
  /** Normalized from contract priceUnit when compatible with energy type */
  brokerMarginUnit: "KWH" | "MCF" | "CCF" | "DTH" | null;
  /** Contract.notes */
  notesFromContract: string;
  /**
   * When contract term is not 12, 24, or 36 months, that value is offered as the custom term
   * (standard12/24/36 checkboxes stay selected).
   */
  customTermMonths: string;
  /** From Contract.customer — used to match `/customer-companies` rows keyed by normalized company name */
  contractCustomerCompany: string;
  /** CRM customer legal/name line */
  contractCustomerName: string;
  /** Main contact’s company field (Contacts), for name fallback */
  mainContactCompany: string;
};

/** In-memory copy survives React Strict Mode remounts within the same JS realm (until URL drops `fromContract=1` or explicit clear). */
let memoryStagedPrefill: RfpFromContractPrefillPayload | null = null;

export function seedContractPrefillPayload(p: RfpFromContractPrefillPayload) {
  memoryStagedPrefill = p;
}

export function clearMemoryStagedContractPrefill() {
  memoryStagedPrefill = null;
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(`${RFP_FROM_CONTRACT_SESSION_KEY}-stage`);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(RFP_FROM_CONTRACT_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** True when Contracts page staged JSON in localStorage (before RFP peek consumes it). */
export function hasLocalContractPrefillPayload(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Boolean(localStorage.getItem(RFP_FROM_CONTRACT_SESSION_KEY));
  } catch {
    return false;
  }
}

export function parseRfpFromContractPrefillPayload(raw: string): RfpFromContractPrefillPayload | null {
  try {
    const j = JSON.parse(raw) as Partial<RfpFromContractPrefillPayload> & { version?: unknown };
    if (j?.version !== 1 || typeof j.customerId !== "string") return null;
    const linesIn = Array.isArray(j.accountLines) ? j.accountLines : [];
    const accountLines = linesIn.map((line) => ({
      accountNumber: typeof line?.accountNumber === "string" ? line.accountNumber : "",
      serviceAddress: typeof line?.serviceAddress === "string" ? line.serviceAddress : "",
      annualUsage: typeof line?.annualUsage === "string" ? line.annualUsage : "",
      avgMonthlyUsage: typeof line?.avgMonthlyUsage === "string" ? line.avgMonthlyUsage : "",
    }));
    return {
      version: 1,
      sourceContractId: typeof j.sourceContractId === "string" ? j.sourceContractId : "",
      customerId: j.customerId,
      customerContactId:
        j.customerContactId === null || typeof j.customerContactId === "string" ? j.customerContactId ?? null : null,
      energyType: j.energyType === "ELECTRIC" || j.energyType === "NATURAL_GAS" ? j.energyType : "NATURAL_GAS",
      ldcUtility: typeof j.ldcUtility === "string" ? j.ldcUtility : "",
      contractStartValue: typeof j.contractStartValue === "string" ? j.contractStartValue : "",
      accountLines,
      brokerMargin: typeof j.brokerMargin === "string" ? j.brokerMargin : "",
      brokerMarginUnit:
        j.brokerMarginUnit === "KWH" ||
        j.brokerMarginUnit === "MCF" ||
        j.brokerMarginUnit === "CCF" ||
        j.brokerMarginUnit === "DTH"
          ? j.brokerMarginUnit
          : null,
      notesFromContract: typeof j.notesFromContract === "string" ? j.notesFromContract : "",
      customTermMonths: typeof j.customTermMonths === "string" ? j.customTermMonths : "",
      contractCustomerCompany:
        typeof j.contractCustomerCompany === "string" ? j.contractCustomerCompany : "",
      contractCustomerName: typeof j.contractCustomerName === "string" ? j.contractCustomerName : "",
      mainContactCompany: typeof j.mainContactCompany === "string" ? j.mainContactCompany : "",
    };
  } catch {
    return null;
  }
}

/**
 * Read staged contract→RFP payload when URL has `fromContract=1`.
 * First successful read from localStorage is copied to module memory and localStorage is cleared.
 */
export function peekContractPrefillFromContractStorage(): RfpFromContractPrefillPayload | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  if (q.get("fromContract") !== "1") {
    memoryStagedPrefill = null;
    return null;
  }
  if (memoryStagedPrefill) return memoryStagedPrefill;

  try {
    const fromLocal = localStorage.getItem(RFP_FROM_CONTRACT_SESSION_KEY);
    if (fromLocal) {
      const p = parseRfpFromContractPrefillPayload(fromLocal);
      localStorage.removeItem(RFP_FROM_CONTRACT_SESSION_KEY);
      if (p) memoryStagedPrefill = p;
      return memoryStagedPrefill;
    }
  } catch {
    /* ignore */
  }

  const STAGING = `${RFP_FROM_CONTRACT_SESSION_KEY}-stage`;
  try {
    const raw = sessionStorage.getItem(STAGING);
    if (raw) {
      const p = parseRfpFromContractPrefillPayload(raw);
      sessionStorage.removeItem(STAGING);
      if (p) memoryStagedPrefill = p;
    }
  } catch {
    /* ignore */
  }
  return memoryStagedPrefill;
}

/** @deprecated Use peekContractPrefillFromContractStorage + clearMemoryStagedContractPrefill */
export function takePendingContractPrefillForRfp(): RfpFromContractPrefillPayload | null {
  return peekContractPrefillFromContractStorage();
}

/** @deprecated Use clearMemoryStagedContractPrefill */
export function clearRfpFromContractPrefillStaging() {
  clearMemoryStagedContractPrefill();
}

/** Contract end calendar month/year as RFP contract-start month picker value. */
export function expirationDateToRfpContractStartMonth(iso: string | null | undefined): string {
  if (iso == null || String(iso).trim() === "") return "";
  const dayKey = String(iso).trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    return dayKey.slice(0, 7);
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Map contract price unit to RFP broker margin unit when valid for the energy type. */
export function brokerMarginUnitFromContractPriceUnit(
  energyType: "ELECTRIC" | "NATURAL_GAS",
  priceUnit: string | null | undefined
): "KWH" | "MCF" | "CCF" | "DTH" | null {
  const u = (priceUnit || "").toUpperCase().trim();
  if (energyType === "ELECTRIC") {
    return u === "KWH" ? "KWH" : null;
  }
  if (u === "MCF" || u === "CCF" || u === "DTH") return u;
  return null;
}

/** If term is not a standard RFP preset, return it for the custom-term field; else "". */
export function customTermMonthsFromContractTerm(termMonths: number | null | undefined): string {
  const tm = Number(termMonths);
  if (!Number.isFinite(tm) || tm <= 0) return "";
  const rounded = Math.round(tm);
  if (rounded === 12 || rounded === 24 || rounded === 36) return "";
  return String(rounded);
}

export type ContractRowForRfpPrefill = {
  id: string;
  customer: { id: string; company?: string | null; name?: string | null };
  mainContactId: string | null;
  mainContact?: { id?: string; company?: string | null } | null;
  /**
   * When set (e.g. Contracts grid `displayMainContactForContract`), wins over `mainContact` / `mainContactId`
   * for the RFP customer contact Select.
   */
  resolvedCustomerContactId?: string | null;
  energyType: "ELECTRIC" | "NATURAL_GAS";
  expirationDate: string | null | undefined;
  termMonths: number | null | undefined;
  annualUsage: unknown;
  avgMonthlyUsage: unknown;
  brokerMargin: unknown;
  customerUtility: string | null | undefined;
  priceUnit: string | null | undefined;
  notes: string | null | undefined;
};

function notesFromContractRow(c: ContractRowForRfpPrefill): string {
  return (c.notes ?? "").trim() ? String(c.notes) : "";
}

/**
 * Build the JSON payload Contracts saves to localStorage — same shape the RFP page consumes.
 * `accountLines` should be the normalized rows from `/api/contracts/[id]/accounts` or a single fallback line from contract-level usage.
 */
export function buildRfpFromContractPrefillPayload(
  c: ContractRowForRfpPrefill,
  accountLines: Array<{
    accountNumber: string;
    serviceAddress: string;
    annualUsage: string;
    avgMonthlyUsage: string;
  }>
): RfpFromContractPrefillPayload {
  const fromIds =
    (((c.mainContact?.id ?? c.mainContactId) ?? "") as string).trim() || null;
  const customerContactId =
    c.resolvedCustomerContactId !== undefined && c.resolvedCustomerContactId !== null
      ? (String(c.resolvedCustomerContactId).trim() || null)
      : fromIds;
  const brokerMargin =
    c.brokerMargin != null && String(c.brokerMargin).trim() !== "" ? String(c.brokerMargin) : "";
  return {
    version: 1,
    sourceContractId: c.id,
    customerId: c.customer.id,
    customerContactId,
    energyType: c.energyType,
    ldcUtility: (c.customerUtility ?? "").trim(),
    contractStartValue: expirationDateToRfpContractStartMonth(c.expirationDate ?? null),
    accountLines,
    brokerMargin,
    brokerMarginUnit: brokerMarginUnitFromContractPriceUnit(c.energyType, c.priceUnit),
    notesFromContract: notesFromContractRow(c),
    customTermMonths: customTermMonthsFromContractTerm(
      c.termMonths != null ? Number(c.termMonths) : null
    ),
    contractCustomerCompany: (c.customer.company ?? "").trim(),
    contractCustomerName: (c.customer.name ?? "").trim(),
    mainContactCompany: (c.mainContact?.company ?? "").trim(),
  };
}

/** When localStorage failed, RFP can rebuild prefill from GET /api/contracts/[id] + accounts. */
export async function fetchRfpFromContractPrefillPayload(contractId: string): Promise<RfpFromContractPrefillPayload | null> {
  const res = await fetch(`/api/contracts/${encodeURIComponent(contractId)}`);
  if (!res.ok) return null;
  const c = (await res.json()) as Record<string, unknown>;
  const id = typeof c.id === "string" ? c.id : "";
  const customerRaw = c.customer as Record<string, unknown> | undefined;
  const customerId =
    customerRaw && typeof customerRaw.id === "string" ? customerRaw.id : typeof c.customerId === "string" ? c.customerId : "";
  if (!id || !customerId) return null;

  type AccRow = { accountNumber: string; serviceAddress: string; annualUsage: string; avgMonthlyUsage: string };
  let lines: AccRow[] = [];
  try {
    const ar = await fetch(`/api/contracts/${encodeURIComponent(contractId)}/accounts`);
    if (ar.ok) {
      const rows = (await ar.json()) as Array<{
        accountId?: string;
        serviceAddress?: string | null;
        annualUsage?: string | null;
        avgMonthlyUsage?: string | null;
      }>;
      if (Array.isArray(rows) && rows.length > 0) {
        lines = rows.map((r) => ({
          accountNumber: String(r.accountId ?? "").trim(),
          serviceAddress: String(r.serviceAddress ?? "").trim(),
          annualUsage:
            r.annualUsage != null && String(r.annualUsage).trim() !== "" ? String(r.annualUsage) : "",
          avgMonthlyUsage:
            r.avgMonthlyUsage != null && String(r.avgMonthlyUsage).trim() !== ""
              ? String(r.avgMonthlyUsage)
              : "",
        }));
      }
    }
  } catch {
    /* use contract-level usage */
  }
  if (lines.length === 0) {
    lines = [
      {
        accountNumber: "",
        serviceAddress: "",
        annualUsage: c.annualUsage != null ? String(c.annualUsage) : "",
        avgMonthlyUsage: c.avgMonthlyUsage != null ? String(c.avgMonthlyUsage) : "",
      },
    ];
  }

  const mainContact = c.mainContact as { id?: string; company?: string | null } | null | undefined;
  const row: ContractRowForRfpPrefill = {
    id,
    customer: {
      id: customerId,
      company: typeof customerRaw?.company === "string" ? customerRaw.company : null,
      name: typeof customerRaw?.name === "string" ? customerRaw.name : null,
    },
    mainContactId: typeof c.mainContactId === "string" ? c.mainContactId : null,
    mainContact: mainContact ?? null,
    energyType: c.energyType === "ELECTRIC" || c.energyType === "NATURAL_GAS" ? c.energyType : "NATURAL_GAS",
    expirationDate: c.expirationDate != null ? String(c.expirationDate) : null,
    termMonths: typeof c.termMonths === "number" ? c.termMonths : c.termMonths != null ? Number(c.termMonths) : null,
    annualUsage: c.annualUsage,
    avgMonthlyUsage: c.avgMonthlyUsage,
    brokerMargin: c.brokerMargin,
    customerUtility: typeof c.customerUtility === "string" ? c.customerUtility : null,
    priceUnit: typeof c.priceUnit === "string" ? c.priceUnit : null,
    notes: typeof c.notes === "string" ? c.notes : null,
  };
  return buildRfpFromContractPrefillPayload(row, lines);
}
