import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST() {
  try {
    const customers = await prisma.customer.findMany({
      select: {
        id: true,
        contracts: { select: { energyType: true } },
      },
    });

    const customerUpdates = customers.map((c) => {
      const hasElectric = c.contracts.some((ct) => ct.energyType === "ELECTRIC");
      const hasNaturalGas = c.contracts.some((ct) => ct.energyType === "NATURAL_GAS");
      return prisma.customer.update({
        where: { id: c.id },
        data: { hasElectric, hasNaturalGas },
      });
    });

    const suppliers = await prisma.supplier.findMany({
      select: {
        id: true,
        contracts: { select: { energyType: true } },
      },
    });

    const supplierUpdates = suppliers.map((s) => {
      const isElectric = s.contracts.some((ct) => ct.energyType === "ELECTRIC");
      const isNaturalGas = s.contracts.some((ct) => ct.energyType === "NATURAL_GAS");
      return prisma.supplier.update({
        where: { id: s.id },
        data: { isElectric, isNaturalGas },
      });
    });

    await Promise.all([...customerUpdates, ...supplierUpdates]);

    // Read-only from Contact Management: copy primary linked contact email/phone onto Customer rows.
    // Does not create or modify Contact records (linking stays manual in the UI / Contacts page).
    // Apply primary linked contact details back onto customer records for easier directory viewing.
    // Primary = isPriority contact first, then most recently updated fallback.
    const contactsByCustomer = await prisma.contact.findMany({
      where: { customerId: { not: null } },
      select: {
        customerId: true,
        email: true,
        phone: true,
        isPriority: true,
        updatedAt: true,
      },
      orderBy: [{ isPriority: "desc" }, { updatedAt: "desc" }],
    });

    const primaryContactByCustomerId = new Map<string, { email: string | null; phone: string | null }>();
    for (const c of contactsByCustomer) {
      if (!c.customerId) continue;
      if (!primaryContactByCustomerId.has(c.customerId)) {
        primaryContactByCustomerId.set(c.customerId, {
          email: c.email || null,
          phone: c.phone || null,
        });
      }
    }

    for (const [customerId, contactIdentity] of primaryContactByCustomerId.entries()) {
      await prisma.customer.update({
        where: { id: customerId },
        data: {
          email: contactIdentity.email,
          phone: contactIdentity.phone,
        },
      });
    }

    return NextResponse.json({
      success: true,
      customersUpdated: customers.length,
      suppliersUpdated: suppliers.length,
      customerContactFieldsRefreshed: primaryContactByCustomerId.size,
    });
  } catch (error) {
    console.error("Directory sync error:", error);
    const message = error instanceof Error ? error.message : "Failed to sync directory entities";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

