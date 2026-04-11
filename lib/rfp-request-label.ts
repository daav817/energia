/**
 * Customer-facing line for an RFP (company / contact), aligned with the Quotes workspace dropdown.
 * Prefers CRM `company`, then CRM `name`, then main contact `company`; appends contact name when both exist.
 */
export function rfpCustomerFacingLabel(rfp: {
  customer?: { name?: string | null; company?: string | null } | null;
  customerContact?: { name?: string | null; company?: string | null } | null;
}): string {
  const company = (
    rfp.customer?.company?.trim() ||
    rfp.customer?.name?.trim() ||
    rfp.customerContact?.company?.trim() ||
    ""
  ).trim();
  const contact = (rfp.customerContact?.name || "").trim();
  if (company && contact) return `${company} — ${contact}`;
  if (company) return company;
  return contact || "Customer";
}

export function rfpListLabelWithEnergy(
  rfp: {
    customer?: { name?: string | null; company?: string | null } | null;
    customerContact?: { name?: string | null; company?: string | null } | null;
    energyType?: string;
  },
  energyType: "ELECTRIC" | "NATURAL_GAS" | string
): string {
  const energy = energyType === "ELECTRIC" ? "Electric" : "Natural Gas";
  return `${rfpCustomerFacingLabel(rfp)} · ${energy}`;
}
