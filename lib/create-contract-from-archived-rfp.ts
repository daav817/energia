import { prisma } from "@/lib/prisma";
import { EnergyType, PriceUnit, Prisma } from "@/generated/prisma/client";
import { getOrCreatePlaceholderSupplierId } from "@/lib/placeholder-supplier";

function priceUnitFromRfp(rfp: { brokerMarginUnit: PriceUnit | null; energyType: EnergyType }): PriceUnit {
  const u = rfp.brokerMarginUnit;
  if (u === PriceUnit.KWH || u === PriceUnit.MCF || u === PriceUnit.CCF || u === PriceUnit.DTH) {
    return u;
  }
  return rfp.energyType === EnergyType.ELECTRIC ? PriceUnit.KWH : PriceUnit.MCF;
}

function resolveRfpMainContactId(rfp: {
  customerContactId: string | null;
  quoteSummaryContactIds: string[];
}): string | null {
  const direct = rfp.customerContactId?.trim();
  if (direct) return direct;
  const first = rfp.quoteSummaryContactIds?.find((id) => id?.trim());
  return first?.trim() ?? null;
}

function resolveSupplierIdFromRfp(rfp: {
  quotes: Array<{ supplierId: string; isBestOffer: boolean }>;
  suppliers: Array<{ id: string }>;
}): string | null {
  const quotes = rfp.quotes;
  const best = quotes.find((q) => q.isBestOffer);
  if (best?.supplierId) return best.supplierId;
  const firstQuote = quotes[0];
  if (firstQuote?.supplierId) return firstQuote.supplierId;
  const linked = rfp.suppliers[0]?.id;
  return linked ?? null;
}

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
    include: {
      accountLines: { orderBy: { sortOrder: "asc" } },
      quotes: {
        select: { supplierId: true, isBestOffer: true },
        orderBy: [{ termMonths: "asc" }, { rate: "asc" }],
      },
      suppliers: { select: { id: true } },
    },
  });
  if (!rfp?.customerId) return null;

  const energyType = rfp.energyType as EnergyType;
  const priceUnit = priceUnitFromRfp(rfp);

  let supplierId = resolveSupplierIdFromRfp(rfp);
  if (!supplierId) {
    supplierId = await getOrCreatePlaceholderSupplierId();
  }

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

  const lines = rfp.accountLines;
  let annualUsage = rfp.annualUsage;
  let avgMonthlyUsage = rfp.avgMonthlyUsage;
  if (lines.length > 0) {
    let annualTotal = 0;
    let avgMonthlyTotal = 0;
    for (const L of lines) {
      annualTotal += Number(L.annualUsage) || 0;
      avgMonthlyTotal += Number(L.avgMonthlyUsage) || 0;
    }
    if (annualTotal > 0) {
      annualUsage = new Prisma.Decimal(annualTotal);
    }
    if (avgMonthlyTotal > 0) {
      avgMonthlyUsage = new Prisma.Decimal(avgMonthlyTotal);
    }
  }

  const totalMeters = lines.length > 0 ? lines.length : null;
  const mainContactId = resolveRfpMainContactId(rfp);

  const header = `Created from archived RFP (confirm rate and dates from the counter-signed agreement).`;
  const rfpNote = rfp.notes?.trim();
  const notes = rfpNote ? `${header}\n\nRFP notes:\n${rfpNote}` : header;

  const contract = await prisma.contract.create({
    data: {
      customerId: rfp.customerId,
      supplierId,
      mainContactId,
      energyType,
      priceUnit,
      pricePerUnit: new Prisma.Decimal(0),
      startDate: start,
      expirationDate,
      termMonths,
      annualUsage,
      avgMonthlyUsage,
      brokerMargin: rfp.brokerMargin,
      customerUtility: rfp.ldcUtility,
      totalMeters,
      status: "active",
      notes,
      needsContractDetail: true,
      sourceRfpRequestId: rfpId,
      ...(lines.length > 0
        ? {
            accounts: {
              create: lines.map((line, sortOrder) => ({
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
