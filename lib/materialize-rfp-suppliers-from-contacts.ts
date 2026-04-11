import type { PrismaClient } from "@/generated/prisma/client";
import { normalizeCompanyKey } from "@/lib/customers-overview";
import {
  contactMatchesRfpEnergy,
  mergeContactsForSupplier,
  qualifiesContactForRfpSupplierDirectory,
  type RawContactForSupplierMerge,
} from "@/lib/supplier-rfp-contacts";

/**
 * Ensures labeled supplier contacts appear on the RFP supplier list by finding or creating
 * `Supplier` rows and linking contacts (`supplierId`) when they were only keyed by labels + company/name.
 *
 * Runs in a single transaction; callers should re-fetch suppliers and contacts afterward.
 */
export async function materializeSuppliersFromLabeledContacts(
  prisma: PrismaClient,
  contactPool: RawContactForSupplierMerge[],
  suppliersForMerge: Array<{ id: string; name: string }>
): Promise<void> {
  const linkedIds = new Set<string>();
  for (const s of suppliersForMerge) {
    for (const c of mergeContactsForSupplier(s, contactPool)) {
      linkedIds.add(c.id);
    }
  }

  const orphans = contactPool.filter(
    (c) => qualifiesContactForRfpSupplierDirectory(c.label) && !linkedIds.has(c.id)
  );
  if (orphans.length === 0) return;

  const allSuppliers = await prisma.supplier.findMany({
    select: { id: true, name: true },
  });
  const byNormName = new Map<string, { id: string; name: string }>();
  for (const s of allSuppliers) {
    const k = normalizeCompanyKey(s.name);
    if (!byNormName.has(k)) byNormName.set(k, s);
  }

  const groups = new Map<string, RawContactForSupplierMerge[]>();
  for (const c of orphans) {
    const co = (c.company || "").trim();
    const key = co ? normalizeCompanyKey(co) : `__single:${c.id}`;
    const arr = groups.get(key) ?? [];
    arr.push(c);
    groups.set(key, arr);
  }

  await prisma.$transaction(async (tx) => {
    for (const [_groupKey, group] of groups) {
      const displayName =
        (group[0]!.company || "").trim() || (group[0]!.name || "").trim() || "Supplier";
      const normDisplay = normalizeCompanyKey(displayName);

      let supplierRow = byNormName.get(normDisplay);
      if (!supplierRow) {
        const inferredElectric = group.some((x) => contactMatchesRfpEnergy(x.label, "ELECTRIC"));
        const inferredGas = group.some((x) => contactMatchesRfpEnergy(x.label, "NATURAL_GAS"));
        const created = await tx.supplier.create({
          data: {
            name: displayName,
            isElectric: inferredElectric,
            isNaturalGas: inferredGas,
          },
          select: { id: true, name: true },
        });
        supplierRow = created;
        const nk = normalizeCompanyKey(created.name);
        if (!byNormName.has(nk)) byNormName.set(nk, created);
      }

      for (const c of group) {
        if (!c.supplierId) {
          await tx.contact.update({
            where: { id: c.id },
            data: { supplierId: supplierRow.id },
          });
        }
      }
    }
  });
}
