export const RFP_FROM_CONTRACT_SESSION_KEY = "energia-rfp-from-contract-v1";

export type RfpFromContractPrefillPayload = {
  version: 1;
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
};

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

/**
 * Read prefill placed by the Contracts directory (new tab with ?fromContract=1).
 * Keeps a staging copy in sessionStorage until `clearRfpFromContractPrefillStaging()` so React Strict Mode
 * remounts can re-apply the same payload.
 */
export function takePendingContractPrefillForRfp(): RfpFromContractPrefillPayload | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  if (q.get("fromContract") !== "1") return null;

  const STAGING = `${RFP_FROM_CONTRACT_SESSION_KEY}-stage`;
  try {
    const primary = sessionStorage.getItem(RFP_FROM_CONTRACT_SESSION_KEY);
    if (primary) {
      sessionStorage.setItem(STAGING, primary);
      sessionStorage.removeItem(RFP_FROM_CONTRACT_SESSION_KEY);
    }
    const raw = sessionStorage.getItem(STAGING);
    if (!raw) return null;
    const j = JSON.parse(raw) as RfpFromContractPrefillPayload;
    return j?.version === 1 ? j : null;
  } catch {
    return null;
  }
}

export function clearRfpFromContractPrefillStaging() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(`${RFP_FROM_CONTRACT_SESSION_KEY}-stage`);
}
