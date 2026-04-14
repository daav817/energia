/** Calendar event title for supplier quote due (RFP). */
export function formatEnergyTypeCalendarLabel(value: string): string {
  return value === "NATURAL_GAS" ? "Natural Gas" : "Electric";
}

export function quoteDueCalendarTitle(
  customer: { name: string; company?: string | null },
  energyType: string
): string {
  const company = (customer.company ?? "").trim() || customer.name;
  return `Quote - ${company} - ${formatEnergyTypeCalendarLabel(energyType)}`;
}
