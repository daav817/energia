import type { BrokerProfile } from "@/lib/broker-profile";
import { formatLocaleDateFromStoredDay } from "@/lib/calendar-date";
import { enrichContactLikeFromDirectory, type ContactLike } from "@/lib/contract-main-contact";

export type RfpAccountLine = { accountNumber: string; serviceAddress?: string | null };

/** Contract-scoped utility accounts (from DB) for templates and renewal merge. */
export type ContractAccountTemplateRow = {
  accountId: string;
  /** LDC / delivery utility (optional). */
  ldcUtility?: string | null;
  serviceAddress?: string | null;
  /** Display strings for template / email */
  annualUsage?: string | null;
  avgMonthlyUsage?: string | null;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rowHasColumnValue(rows: ContractAccountTemplateRow[], raw: (r: ContractAccountTemplateRow) => string): boolean {
  return rows.some((r) => raw(r).trim() !== "");
}

type AccountTableCol = {
  header: string;
  align: "left" | "right";
  /** Raw value used to decide if the column is omitted (column is kept only if any row is non-empty). */
  raw: (r: ContractAccountTemplateRow) => string;
  /** Cell HTML for one row (may use placeholders like — when the column is kept but this cell is empty). */
  cellHtml: (r: ContractAccountTemplateRow) => string;
};

const ACCOUNT_TABLE_COLS: AccountTableCol[] = [
  {
    header: "Account ID",
    align: "left",
    raw: (r) => (r.accountId ?? "").trim(),
    cellHtml: (r) => escapeHtml((r.accountId ?? "").trim()),
  },
  {
    header: "Utility",
    align: "left",
    raw: (r) => (r.ldcUtility ?? "").trim(),
    cellHtml: (r) => escapeHtml((r.ldcUtility ?? "").trim() || "—"),
  },
  {
    header: "Service address",
    align: "left",
    raw: (r) => (r.serviceAddress ?? "").trim(),
    cellHtml: (r) => escapeHtml((r.serviceAddress ?? "").trim()),
  },
  {
    header: "Annual usage",
    align: "right",
    raw: (r) => (r.annualUsage ?? "").trim(),
    cellHtml: (r) => escapeHtml((r.annualUsage ?? "").trim() || "—"),
  },
  {
    header: "Avg monthly usage",
    align: "right",
    raw: (r) => (r.avgMonthlyUsage ?? "").trim(),
    cellHtml: (r) => escapeHtml((r.avgMonthlyUsage ?? "").trim() || "—"),
  },
];

/**
 * HTML table for email bodies. Returns empty string when there are no rows (omit from template).
 * Omits any column that has no data in every row (so blank columns are not shown).
 */
export function buildContractAccountsTableHtml(rows: ContractAccountTemplateRow[]): string {
  if (!rows.length) return "";
  const cols = ACCOUNT_TABLE_COLS.filter((c) => rowHasColumnValue(rows, c.raw));
  if (!cols.length) return "";
  const th = cols
    .map(
      (c) =>
        `<th style="border:1px solid #ccc;padding:6px;text-align:${c.align};background:#f5f5f5;">${escapeHtml(
          c.header
        )}</th>`
    )
    .join("");
  const body = rows
    .map((r) => {
      const tds = cols
        .map((c) => {
          const ta = c.align === "right" ? "text-align:right;" : "";
          return `<td style="border:1px solid #ccc;padding:6px;${ta}">${c.cellHtml(r)}</td>`;
        })
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");
  return (
    `<table role="presentation" style="border-collapse:collapse;width:100%;max-width:640px;font-size:14px;margin:8px 0;">` +
    `<thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`
  );
}

export type RenewalContractShape = {
  energyType: string;
  pricePerUnit: string | number;
  priceUnit: string;
  startDate: string;
  expirationDate: string;
  termMonths?: number | null;
  annualUsage?: unknown;
  customerUtility?: string | null;
  customer: {
    id: string;
    name: string;
    company: string | null;
    email?: string | null;
    phone?: string | null;
  };
  supplier: { name: string };
  mainContact: {
    name: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    emails?: Array<{ email: string; type?: string | null }>;
  } | null;
};

export function applyTemplateTokens(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([\w]+)\}\}/g, (_, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key]! : `{{${key}}}`
  );
}

/** Example values for the Email Templates preview; mirrors `buildRenewalTemplateVariables` keys. */
export const EMAIL_TEMPLATE_SAMPLE_VARIABLES: Record<string, string> = {
  customerName: "Riverdale Public Schools",
  customerCompany: "Riverdale School District",
  customerEmail: "facilities@riverdale.edu",
  customerPhone: "(555) 010-4200",
  mainContactName: "Jordan Lee",
  mainContactEmail: "jordan.lee@riverdale.edu",
  greetingFirstName: "Jordan",
  supplierName: "Sample Power & Gas LLC",
  energyLabel: "Electric",
  energyType: "Electric",
  energyTypeRaw: "ELECTRIC",
  rateLabel: "$0.084500 / kWh",
  contractStartDate: "4/1/2024",
  contractEndDate: "3/31/2026",
  termMonths: "24",
  customerUtility: "Metropolitan Electric Co.",
  annualUsage: "1,245,000 kWh",
  brokerFirstName: "Alex",
  brokerLastName: "Morgan",
  brokerCompany: "Energia Brokerage Group",
  brokerPhone: "(555) 010-9001",
  brokerFax: "(555) 010-9002",
  brokerWebsite: "https://energi-example.com",
  accountLinesHtml:
    "ACC-1001 — 450 Main St, Gym<br/>ACC-1002 — 450 Main St, Admin wing",
  contractAccountsTableHtml: buildContractAccountsTableHtml([
    {
      accountId: "ACC-1001",
      ldcUtility: "Sample Electric Co.",
      serviceAddress: "450 Main St, Gym",
      annualUsage: "420000",
      avgMonthlyUsage: "35000",
    },
    {
      accountId: "ACC-1002",
      ldcUtility: "Sample Electric Co.",
      serviceAddress: "450 Main St, Admin wing",
      annualUsage: "180000",
      avgMonthlyUsage: "15000",
    },
  ]),
};

function formatEnergyType(et: string): string {
  return et === "NATURAL_GAS" ? "Natural Gas" : "Electric";
}

function formatRate(c: RenewalContractShape): string {
  const u = (c.priceUnit ?? "").toString();
  const p = Number(c.pricePerUnit);
  if (!Number.isFinite(p)) return "—";
  return `$${p.toFixed(6)} / ${u}`;
}

function pickMainContactEmail(main: NonNullable<RenewalContractShape["mainContact"]>): string {
  const list = main.emails ?? [];
  const work = list.find((e) => (e.type ?? "").toLowerCase() === "work")?.email?.trim();
  if (work) return work;
  for (const e of list) {
    const em = e.email?.trim();
    if (em) return em;
  }
  return (main.email ?? "").trim();
}

function greetingFirstName(main: NonNullable<RenewalContractShape["mainContact"]>): string {
  const fn = (main.firstName ?? "").trim();
  if (fn) return fn;
  const display = (main.name ?? "").trim();
  if (!display) return "";
  if (display.includes(",")) {
    const parts = display.split(",").map((s) => s.trim());
    const after = parts[1];
    if (after) return (after.split(/\s+/)[0] ?? after).trim();
  }
  return (display.split(/\s+/)[0] ?? display).trim();
}

function renewalGreetingFirstName(
  c: RenewalContractShape,
  resolvedMain: RenewalContractShape["mainContact"]
): string {
  if (resolvedMain) {
    const g = greetingFirstName(resolvedMain);
    if (g) return g;
  }
  const nm = (c.customer?.name ?? "").trim();
  return nm ? (nm.split(/\s+/)[0] ?? nm).trim() : "";
}

export function buildRenewalTemplateVariables(
  c: RenewalContractShape,
  broker: BrokerProfile,
  accountLines: RfpAccountLine[],
  resolvedMainContact: RenewalContractShape["mainContact"],
  contractAccountRows: ContractAccountTemplateRow[] = [],
  directory?: ContactLike[]
): Record<string, string> {
  let main: RenewalContractShape["mainContact"] = resolvedMainContact ?? c.mainContact;
  if (directory && main) {
    const enriched = enrichContactLikeFromDirectory(main as ContactLike, directory);
    if (enriched) {
      main = {
        ...main,
        firstName: enriched.firstName ?? main.firstName ?? null,
        lastName: enriched.lastName ?? main.lastName ?? null,
        name: (enriched.name || main.name || "").trim() || main.name,
      };
    }
  }
  const contactName = (main?.name ?? c.customer.name).trim();
  const greet = renewalGreetingFirstName(c, main);
  const mainEmail = main ? pickMainContactEmail(main) : "";
  const annual =
    c.annualUsage != null && String(c.annualUsage).trim() !== ""
      ? String(c.annualUsage)
      : "—";

  const accountsHtmlFromContract =
    contractAccountRows.length > 0
      ? contractAccountRows
          .map((a) => {
            const util = (a.ldcUtility ?? "").trim();
            const addr = (a.serviceAddress ?? "").trim();
            const mid = [util && `(${util})`, addr && `— ${addr}`].filter(Boolean).join(" ");
            return `${a.accountId}${mid ? ` ${mid}` : ""}`;
          })
          .join("<br/>")
      : null;

  const accountsHtmlFromRfp =
    accountLines.length > 0
      ? accountLines
          .map(
            (a) =>
              `${a.accountNumber}${a.serviceAddress ? ` — ${a.serviceAddress}` : ""}`
          )
          .join("<br/>")
      : null;

  const accountsHtml = accountsHtmlFromContract ?? accountsHtmlFromRfp ?? "—";
  const contractAccountsTableHtml = buildContractAccountsTableHtml(contractAccountRows);

  return {
    customerName: c.customer.name,
    customerCompany: c.customer.company ?? "",
    customerEmail: c.customer.email ?? "",
    customerPhone: c.customer.phone ?? "",
    mainContactName: main?.name?.trim() ?? "",
    mainContactEmail: mainEmail,
    greetingFirstName: greet || contactName.split(/\s+/)[0] || contactName,
    supplierName: c.supplier.name,
    energyLabel: formatEnergyType(c.energyType),
    energyType: formatEnergyType(c.energyType),
    energyTypeRaw: c.energyType,
    rateLabel: formatRate(c),
    contractStartDate: formatLocaleDateFromStoredDay(c.startDate),
    contractEndDate: formatLocaleDateFromStoredDay(c.expirationDate),
    termMonths: c.termMonths != null ? String(c.termMonths) : "",
    customerUtility: c.customerUtility ?? "",
    annualUsage: annual,
    brokerFirstName: broker.firstName,
    brokerLastName: broker.lastName,
    brokerCompany: broker.companyName,
    brokerEmail: broker.email,
    brokerPhone: broker.phone,
    brokerFax: broker.fax,
    brokerWebsite: broker.websiteOrLinkedIn,
    accountLinesHtml: accountsHtml,
    contractAccountsTableHtml,
  };
}
