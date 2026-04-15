/** Shared math + HTML helpers for the Quotes → customer email workflow. */

export function combinedAnnualUsageFromAccounts(
  accountLines: Array<{ annualUsage: number | string | { toString: () => string } }>
): number {
  return accountLines.reduce((sum, line) => sum + Number(line.annualUsage ?? 0), 0);
}

/** Total contract value: base rate × term months × (annual usage / 12). */
export function totalContractValueUsd(params: {
  baseRatePerUnit: number;
  termMonths: number;
  annualUsage: number;
}): number {
  const { baseRatePerUnit, termMonths, annualUsage } = params;
  if (!Number.isFinite(baseRatePerUnit) || !Number.isFinite(termMonths) || !Number.isFinite(annualUsage)) {
    return 0;
  }
  return baseRatePerUnit * termMonths * (annualUsage / 12);
}

/** Implied monthly energy spend at the quoted unit rate. */
export function impliedMonthlyEnergyCostUsd(params: { baseRatePerUnit: number; annualUsage: number }): number {
  const { baseRatePerUnit, annualUsage } = params;
  if (!Number.isFinite(baseRatePerUnit) || !Number.isFinite(annualUsage)) return 0;
  return baseRatePerUnit * (annualUsage / 12);
}

export function monthlySavingsVsBillUsd(params: {
  currentMonthlyBill: number;
  newMonthlyEnergyCost: number;
}): number {
  return params.currentMonthlyBill - params.newMonthlyEnergyCost;
}

export function formatTermLengthWithRange(params: {
  termMonths: number;
  contractStartMonth: number | null;
  contractStartYear: number | null;
}): string {
  const { termMonths, contractStartMonth, contractStartYear } = params;
  if (
    contractStartMonth == null ||
    contractStartYear == null ||
    !Number.isFinite(termMonths) ||
    termMonths <= 0
  ) {
    return `${termMonths} months`;
  }
  const start = new Date(contractStartYear, contractStartMonth - 1, 1);
  const endMonth = new Date(contractStartYear, contractStartMonth - 1 + termMonths - 1, 1);
  const fmt = (d: Date) =>
    `${d.toLocaleString("en-US", { month: "short" })} '${String(d.getFullYear()).slice(-2)}`;
  return `${termMonths} month (${fmt(start)} - ${fmt(endMonth)})`;
}

export function unitLabelForEnergy(priceUnit: string): string {
  const u = (priceUnit || "").toUpperCase();
  if (u === "KWH") return "kWh";
  if (u === "MCF" || u === "CCF" || u === "DTH") return u;
  return u || "unit";
}

export type CustomerQuoteTableRow = {
  termLabel: string;
  baseRateLabel: string;
  supplierName: string;
  totalContractValueLabel: string;
  monthlyAverageLabel: string;
};

export function buildCustomerQuotesTableHtml(rows: CustomerQuoteTableRow[]): string {
  /** Outlook (Word HTML) often ignores CSS `border` on cells unless `border` / explicit attrs exist. */
  const cellBorder =
    "border-width:1px;border-style:solid;border-color:#111111;mso-border-alt:solid #111111 .75pt;";
  const th = (label: string) =>
    `<th align="left" valign="top" style="${cellBorder}padding:8px;text-align:left;vertical-align:top;">${escapeHtml(label)}</th>`;
  const td = (cell: string) =>
    `<td align="left" valign="top" style="${cellBorder}padding:8px;vertical-align:top;">${escapeHtml(cell)}</td>`;
  const head =
    "<tr>" +
    [
      "Term Length",
      "Base Rate (per energy unit)",
      "Supplier",
      "Total Contract Value",
      "Monthly Average",
    ]
      .map(th)
      .join("") +
    "</tr>";
  const body = rows
    .map(
      (r) =>
        "<tr>" +
        [
          r.termLabel,
          r.baseRateLabel,
          r.supplierName,
          r.totalContractValueLabel,
          r.monthlyAverageLabel,
        ]
          .map(td)
          .join("") +
        "</tr>"
    )
    .join("");
  return `<table role="presentation" border="1" cellspacing="0" cellpadding="8" width="100%" style="border-collapse:collapse;width:100%;max-width:760px;border:1px solid #111111;mso-table-lspace:0pt;mso-table-rspace:0pt;"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
