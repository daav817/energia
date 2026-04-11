/**
 * Electric RFP "Pricing options" — persisted on RFP and included in supplier email.
 */
export const ELECTRIC_PRICING_OPTION_DEFS = [
  {
    id: "fixed_rate_capacity_adjust",
    label: "Fixed rate capacity adjust",
    requiresNote: true,
  },
  { id: "capacity_pass_through", label: "Capacity pass-through", requiresNote: false },
  {
    id: "fixed_capacity_obligation_adjust",
    label: "Fixed capacity obligation adjust",
    requiresNote: false,
  },
  {
    id: "fully_fixed_capacity_no_adjust",
    label: "Fully fixed capacity no adjust",
    requiresNote: false,
  },
] as const;

export type ElectricPricingOptionId = (typeof ELECTRIC_PRICING_OPTION_DEFS)[number]["id"];

const KNOWN_IDS = new Set<string>(ELECTRIC_PRICING_OPTION_DEFS.map((d) => d.id));

const LABEL_BY_ID = Object.fromEntries(ELECTRIC_PRICING_OPTION_DEFS.map((d) => [d.id, d.label])) as Record<
  string,
  string
>;

export type RfpElectricPricingOptionsState = {
  selectedIds: ElectricPricingOptionId[];
  fixedRateCapacityAdjustNote: string;
};

export function emptyElectricPricingOptionsState(): RfpElectricPricingOptionsState {
  return { selectedIds: [], fixedRateCapacityAdjustNote: "" };
}

export function normalizeElectricPricingFromBody(
  body: Record<string, unknown>,
  energyType: string
): RfpElectricPricingOptionsState | null {
  if (energyType !== "ELECTRIC") return null;
  const raw = body.electricPricingOptions;
  if (raw == null || raw === "") return emptyElectricPricingOptionsState();

  let obj: Record<string, unknown> | null = null;
  if (typeof raw === "object" && !Array.isArray(raw)) obj = raw as Record<string, unknown>;
  else if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw) as unknown;
      if (p && typeof p === "object" && !Array.isArray(p)) obj = p as Record<string, unknown>;
    } catch {
      return emptyElectricPricingOptionsState();
    }
  }
  if (!obj) return emptyElectricPricingOptionsState();

  const idsRaw = obj.selectedIds ?? obj.selected;
  const selectedIds: ElectricPricingOptionId[] = [];
  if (Array.isArray(idsRaw)) {
    for (const x of idsRaw) {
      const id = String(x ?? "").trim();
      if (KNOWN_IDS.has(id)) selectedIds.push(id as ElectricPricingOptionId);
    }
  }
  const note = String(obj.fixedRateCapacityAdjustNote ?? obj.fixed_rate_capacity_adjust_note ?? "").trim();
  return {
    selectedIds: [...new Set(selectedIds)],
    fixedRateCapacityAdjustNote: note,
  };
}

export function normalizeElectricPricingFromDb(
  raw: unknown,
  energyType: string
): RfpElectricPricingOptionsState | null {
  if (energyType !== "ELECTRIC") return null;
  return normalizeElectricPricingFromBody({ electricPricingOptions: raw } as Record<string, unknown>, "ELECTRIC");
}

export function electricPricingFingerprintKey(s: RfpElectricPricingOptionsState | null): string {
  if (!s) return "";
  const ids = [...s.selectedIds].sort();
  return JSON.stringify({ ids, n: s.fixedRateCapacityAdjustNote.trim() });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const PRICING_OPTIONS_EMAIL_TITLE =
  "Pricing Options:  Please provide your rates quotes in accordance with the following options:";

/** HTML block placed after the main pricing table and usage table, before general supplier notes. */
export function formatElectricPricingForEmailHtml(state: RfpElectricPricingOptionsState | null): string {
  if (!state || state.selectedIds.length === 0) return "";
  const items: string[] = [];
  let n = 0;
  for (const id of state.selectedIds) {
    n += 1;
    const label = LABEL_BY_ID[id] ?? id;
    let block = `<strong>${n}.</strong> ${escapeHtml(label)}`;
    if (id === "fixed_rate_capacity_adjust" && state.fixedRateCapacityAdjustNote.trim()) {
      block += `<br /><span style="font-weight:400;">&#8226; ${escapeHtml(state.fixedRateCapacityAdjustNote.trim())}</span>`;
    }
    items.push(`<div style="margin-bottom:10px;">${block}</div>`);
  }
  return `
      <p style="margin-top: 20px;"><strong>${escapeHtml(PRICING_OPTIONS_EMAIL_TITLE)}</strong></p>
      <div style="margin: 8px 0 0;">
        ${items.join("\n        ")}
      </div>`.trim();
}

export function formatElectricPricingForEmailText(state: RfpElectricPricingOptionsState | null): string {
  if (!state || state.selectedIds.length === 0) return "";
  const lines: string[] = [PRICING_OPTIONS_EMAIL_TITLE, ""];
  let n = 0;
  for (const id of state.selectedIds) {
    n += 1;
    const label = LABEL_BY_ID[id] ?? id;
    lines.push(`${n}. ${label}`);
    if (id === "fixed_rate_capacity_adjust" && state.fixedRateCapacityAdjustNote.trim()) {
      lines.push(` • ${state.fixedRateCapacityAdjustNote.trim()}`);
    }
  }
  return lines.join("\n");
}
