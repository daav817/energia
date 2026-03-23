import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildCustomerOverviewRows, type ContractForOverview, type ContactForMatch } from "@/lib/customers-overview";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || undefined;

    const [contracts, contacts] = await Promise.all([
      prisma.contract.findMany({
        include: {
          customer: { select: { id: true, name: true, company: true, notes: true } },
          mainContact: { select: { id: true, name: true } },
          supplier: { select: { name: true } },
        },
      }),
      prisma.contact.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          label: true,
          isPriority: true,
          updatedAt: true,
          company: true,
        },
      }),
    ]);

    const asOverview: ContractForOverview[] = contracts.map((c) => ({
      id: c.id,
      energyType: c.energyType,
      expirationDate: c.expirationDate,
      status: c.status,
      customer: c.customer,
      mainContact: c.mainContact,
      supplier: c.supplier,
    }));

    const asMatch: ContactForMatch[] = contacts.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      label: c.label,
      isPriority: c.isPriority,
      updatedAt: c.updatedAt,
      company: c.company,
    }));

    const rows = buildCustomerOverviewRows(asOverview, asMatch, search);
    return NextResponse.json(rows);
  } catch (error) {
    console.error("customers-overview GET error:", error);
    return NextResponse.json({ error: "Failed to build customers overview" }, { status: 500 });
  }
}
