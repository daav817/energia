/**
 * Hierarchical tokens for renewal / outbound templates. Insert as literal {{token}} in rich HTML.
 */

export type TemplatePlaceholderNode =
  | { kind: "group"; id: string; label: string; children: TemplatePlaceholderNode[] }
  | { kind: "field"; id: string; label: string; token: string; description?: string };

export const EMAIL_TEMPLATE_PLACEHOLDER_TREE: TemplatePlaceholderNode[] = [
  {
    kind: "group",
    id: "customer",
    label: "Customer",
    children: [
      { kind: "field", id: "customerName", label: "Customer name (display)", token: "{{customerName}}" },
      { kind: "field", id: "customerCompany", label: "Customer company", token: "{{customerCompany}}" },
      { kind: "field", id: "customerEmail", label: "Customer record email", token: "{{customerEmail}}" },
      { kind: "field", id: "customerPhone", label: "Customer phone", token: "{{customerPhone}}" },
    ],
  },
  {
    kind: "group",
    id: "mainContact",
    label: "Main contact (contract)",
    children: [
      { kind: "field", id: "mainContactName", label: "Full name", token: "{{mainContactName}}" },
      { kind: "field", id: "greetingFirstName", label: "First name (for Dear …)", token: "{{greetingFirstName}}" },
      { kind: "field", id: "mainContactEmail", label: "Primary email", token: "{{mainContactEmail}}" },
    ],
  },
  {
    kind: "group",
    id: "supplier",
    label: "Supplier",
    children: [
      { kind: "field", id: "supplierName", label: "Supplier name", token: "{{supplierName}}" },
    ],
  },
  {
    kind: "group",
    id: "contract",
    label: "Contract",
    children: [
      { kind: "field", id: "energyLabel", label: "Energy type (Electric / Gas)", token: "{{energyLabel}}" },
      {
        kind: "field",
        id: "energyType",
        label: "Energy type (same as label, for {{energyType}})",
        token: "{{energyType}}",
        description: 'Renders "Electric" or "Natural Gas" (not the raw ELECTRIC / NATURAL_GAS enum).',
      },
      { kind: "field", id: "energyTypeRaw", label: "Energy type (raw enum: ELECTRIC / NATURAL_GAS)", token: "{{energyTypeRaw}}" },
      { kind: "field", id: "rateLabel", label: "Rate (formatted)", token: "{{rateLabel}}" },
      { kind: "field", id: "contractStartDate", label: "Start date", token: "{{contractStartDate}}" },
      { kind: "field", id: "contractEndDate", label: "End / expiration date", token: "{{contractEndDate}}" },
      { kind: "field", id: "termMonths", label: "Term (months)", token: "{{termMonths}}" },
      { kind: "field", id: "customerUtility", label: "Utility / LDC", token: "{{customerUtility}}" },
      { kind: "field", id: "annualUsage", label: "Annual usage", token: "{{annualUsage}}" },
    ],
  },
  {
    kind: "group",
    id: "broker",
    label: "Broker (Profile)",
    children: [
      { kind: "field", id: "brokerFirstName", label: "First name", token: "{{brokerFirstName}}" },
      { kind: "field", id: "brokerLastName", label: "Last name", token: "{{brokerLastName}}" },
      { kind: "field", id: "brokerCompany", label: "Company", token: "{{brokerCompany}}" },
      { kind: "field", id: "brokerPhone", label: "Phone", token: "{{brokerPhone}}" },
      { kind: "field", id: "brokerFax", label: "Fax", token: "{{brokerFax}}" },
      { kind: "field", id: "brokerWebsite", label: "Website / LinkedIn", token: "{{brokerWebsite}}" },
    ],
  },
  {
    kind: "group",
    id: "accounts",
    label: "Contract utility accounts",
    children: [
      {
        kind: "field",
        id: "contractAccountsTableHtml",
        label: "Accounts table (full HTML)",
        token: "{{contractAccountsTableHtml}}",
        description:
          "Renders every saved utility account on the contract as one HTML table (ID, service address, annual usage, avg monthly). Empty when no accounts are saved.",
      },
      {
        kind: "field",
        id: "accountLinesHtml",
        label: "Account lines (simple list)",
        token: "{{accountLinesHtml}}",
        description:
          "Plain text lines (account — address), one per line. Uses contract accounts when set; otherwise may use RFP data.",
      },
    ],
  },
];
