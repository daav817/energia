import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isLabelOkForSupplierCompanyMatch } from "@/lib/customers-overview";
import { contactCompanyMatchesSupplierName } from "@/lib/supplier-contact-match";

const includeRelations = {
  emails: true,
  phones: true,
  addresses: true,
  significantDates: true,
  relatedPersons: true,
} as const;

/**
 * Contacts for a supplier: explicit supplierId links plus Contacts whose company matches the
 * supplier name (relaxed matching). Unlabeled contacts are included; pure customer-only labels are excluded.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supplier = await prisma.supplier.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!supplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }

    const linked = await prisma.contact.findMany({
      where: { supplierId: id },
      include: includeRelations,
      orderBy: { name: "asc" },
    });

    const name = supplier.name.trim();
    if (name.length < 2) {
      return NextResponse.json({ contacts: linked });
    }

    const tokens = name.split(/\s+/).filter((t) => t.length >= 3);
    /** Widen DB filter so we don't drop "… Brothers" when the supplier row is "Snyder Brothers". */
    const companyClause =
      tokens.length > 0
        ? { OR: tokens.map((t) => ({ company: { contains: t, mode: "insensitive" as const } })) }
        : { company: { contains: name, mode: "insensitive" as const } };

    // Must include supplierId: null — in SQL, `supplier_id <> $id` does NOT match NULL rows,
    // so unlinked contacts were incorrectly excluded from candidates.
    const candidates = await prisma.contact.findMany({
      where: {
        AND: [
          {
            OR: [{ supplierId: null }, { supplierId: { not: id } }],
          },
          companyClause,
        ],
      },
      include: includeRelations,
    });

    const map = new Map<string, (typeof linked)[number]>();
    for (const c of linked) map.set(c.id, c);

    for (const c of candidates) {
      if (!isLabelOkForSupplierCompanyMatch(c.label)) continue;
      if (!contactCompanyMatchesSupplierName(c.company, supplier.name)) continue;
      if (!map.has(c.id)) map.set(c.id, c);
    }

    const contacts = Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );

    return NextResponse.json({ contacts });
  } catch (error) {
    console.error("supplier contacts GET:", error);
    return NextResponse.json({ error: "Failed to load supplier contacts" }, { status: 500 });
  }
}
