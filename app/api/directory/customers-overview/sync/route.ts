import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  buildCustomerOverviewRows,
  type ContractForOverview,
  type ContactForMatch,
} from "@/lib/customers-overview";

/**
 * Persist directory state to Postgres:
 * - Customer.hasElectric / hasNaturalGas from contracts per customer row
 * - Customer.email / phone from matched Contact (Contacts page), for all merged customer IDs in each company group
 * - Link matched Contact.customerId to canonical customer for the company group
 */
export async function POST() {
  try {
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

    const rows = buildCustomerOverviewRows(asOverview, asMatch);

    let energyUpdates = 0;
    let identityUpdates = 0;
    let linksUpdated = 0;

    const allCustomerIds = new Set<string>();
    for (const r of rows) {
      for (const id of r.customerIds) allCustomerIds.add(id);
    }

    for (const customerId of allCustomerIds) {
      const cts = await prisma.contract.findMany({
        where: { customerId },
        select: { energyType: true },
      });
      const hasElectric = cts.some((c) => c.energyType === "ELECTRIC");
      const hasNaturalGas = cts.some((c) => c.energyType === "NATURAL_GAS");
      await prisma.customer.update({
        where: { id: customerId },
        data: { hasElectric, hasNaturalGas },
      });
      energyUpdates += 1;
    }

    for (const row of rows) {
      const dc = row.directoryContact;
      if (!dc) continue;
      const email = dc.email ?? null;
      const phone = dc.phone ?? null;
      for (const customerId of row.customerIds) {
        await prisma.customer.update({
          where: { id: customerId },
          data: { email, phone },
        });
        identityUpdates += 1;
      }

      const existing = await prisma.contact.findUnique({
        where: { id: dc.id },
        select: { customerId: true },
      });
      if (existing?.customerId !== row.canonicalCustomerId) {
        await prisma.contact.update({
          where: { id: dc.id },
          data: { customerId: row.canonicalCustomerId },
        });
        linksUpdated += 1;
      }
    }

    return NextResponse.json({
      success: true,
      companyGroups: rows.length,
      energyRowsUpdated: energyUpdates,
      customerIdentityRowsUpdated: identityUpdates,
      contactLinksUpdated: linksUpdated,
    });
  } catch (error) {
    console.error("customers-overview sync error:", error);
    const message = error instanceof Error ? error.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
