import { prisma } from "@/lib/prisma";
import { EnergyType, PriceUnit, Prisma } from "@/generated/prisma/client";
import { getOrCreatePlaceholderSupplierId } from "@/lib/placeholder-supplier";

/**
 * Creates a single contract stub (and copies RFP account lines) when an RFP is archived.
 * Idempotent: returns existing contract id if already created for this RFP.
 */
export async function createContractFromArchivedRfp(rfpId: string): Promise<string | null> {
  const existing = await prisma.contract.findFirst({
    where: { sourceRfpRequestId: rfpId },
    select: { id: true },
  });
  if (existing) return existing.id;

  const rfp = await prisma.rfpRequest.findUnique({
    where: { id: rfpId },
    include: { accountLines: { orderBy: { sortOrder: "asc" } } },
  });
  if (!rfp?.customerId) return null;

  const supplierId = await getOrCreatePlaceholderSupplierId();
  const energyType = rfp.energyType as EnergyType;
  const priceUnit: PriceUnit = energyType === EnergyType.ELECTRIC ? PriceUnit.KWH : PriceUnit.MCF;

  const termMonths = rfp.termMonths ?? 12;
  let start: Date;
  if (rfp.contractStartYear != null && rfp.contractStartMonth != null) {
    start = new Date(rfp.contractStartYear, rfp.contractStartMonth - 1, 1);
  } else {
    const now = new Date();
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  const expirationDate = new Date(start);
  expirationDate.setMonth(expirationDate.getMonth() + termMonths);

  const header = `Created from archived RFP (placeholder dates & rate — complete from counter-signed agreement).`;
  const rfpNote = rfp.notes?.trim();
  const notes = rfpNote ? `${header}\n\nRFP notes:\n${rfpNote}` : header;

  const contract = await prisma.contract.create({
    data: {
      customerId: rfp.customerId,
      supplierId,
      mainContactId: rfp.customerContactId,
      energyType,
      priceUnit,
      pricePerUnit: new Prisma.Decimal(0),
      startDate: start,
      expirationDate,
      termMonths,
      annualUsage: rfp.annualUsage,
      avgMonthlyUsage: rfp.avgMonthlyUsage,
      customerUtility: rfp.ldcUtility,
      status: "active",
      notes,
      needsContractDetail: true,
      sourceRfpRequestId: rfpId,
      ...(rfp.accountLines.length > 0
        ? {
            accounts: {
              create: rfp.accountLines.map((line, sortOrder) => ({
                accountId: line.accountNumber,
                serviceAddress: line.serviceAddress,
                annualUsage: line.annualUsage,
                avgMonthlyUsage: line.avgMonthlyUsage,
                sortOrder,
              })),
            },
          }
        : {}),
    },
    select: { id: true },
  });

  return contract.id;
}
