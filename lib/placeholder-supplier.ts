import { prisma } from "@/lib/prisma";

export const CONTRACT_PLACEHOLDER_SUPPLIER_NAME = "— Pending (complete in Contracts) —";

/** Supplier row used when a contract is created from an archived RFP before the winning supplier is known. */
export async function getOrCreatePlaceholderSupplierId(): Promise<string> {
  const existing = await prisma.supplier.findFirst({
    where: { name: CONTRACT_PLACEHOLDER_SUPPLIER_NAME },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.supplier.create({
    data: {
      name: CONTRACT_PLACEHOLDER_SUPPLIER_NAME,
      isElectric: true,
      isNaturalGas: true,
    },
    select: { id: true },
  });
  return created.id;
}
