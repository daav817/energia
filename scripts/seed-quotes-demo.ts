/**
 * Seeds a fake submitted RFP (customer, suppliers, account line, sample quotes) for testing the Quotes page.
 *
 * Run from repo root with DATABASE_URL set (e.g. in .env.local):
 *   npx tsx scripts/seed-quotes-demo.ts
 *
 * Re-running removes prior rows marked with QUOTES_DEMO_SEED_V1 and recreates them.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { EnergyType, PriceUnit, Prisma, PrismaClient } from "../generated/prisma/client";

const DEMO_MARKER = "QUOTES_DEMO_SEED_V1";

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is not set. Add it to .env.local or export it before running.");
    process.exit(1);
  }
  return url;
}

async function main() {
  const connectionString = requireDatabaseUrl();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: ["warn", "error"],
  });

  try {
    await prisma.$transaction(async (tx) => {
      const existingCustomers = await tx.customer.findMany({
        where: { notes: { contains: DEMO_MARKER } },
        select: { id: true },
      });
      const custIds = existingCustomers.map((c) => c.id);
      if (custIds.length > 0) {
        const rfps = await tx.rfpRequest.findMany({
          where: { customerId: { in: custIds } },
          select: { id: true },
        });
        const rfpIds = rfps.map((r) => r.id);
        if (rfpIds.length > 0) {
          await tx.calendarEvent.deleteMany({ where: { rfpRequestId: { in: rfpIds } } });
          await tx.rfpQuote.deleteMany({ where: { rfpRequestId: { in: rfpIds } } });
          await tx.rfpAccountLine.deleteMany({ where: { rfpRequestId: { in: rfpIds } } });
          await tx.rfpRequest.deleteMany({ where: { id: { in: rfpIds } } });
        }
        await tx.contact.deleteMany({ where: { customerId: { in: custIds } } });
        await tx.customer.deleteMany({ where: { id: { in: custIds } } });
      }

      const demoSuppliers = await tx.supplier.findMany({
        where: { notes: { contains: DEMO_MARKER } },
        select: { id: true },
      });
      const supIds = demoSuppliers.map((s) => s.id);
      if (supIds.length > 0) {
        await tx.rfpQuote.deleteMany({ where: { supplierId: { in: supIds } } });
        await tx.supplier.deleteMany({ where: { id: { in: supIds } } });
      }

      const customer = await tx.customer.create({
        data: {
          name: "Pat Example",
          company: "Acme Demo Properties LLC",
          email: "pat.example@customer.example.invalid",
          phone: "555-0100",
          hasElectric: false,
          hasNaturalGas: true,
          notes: `${DEMO_MARKER} Fake customer for Quotes page QA — safe to delete.`,
        },
      });

      const customerContact = await tx.contact.create({
        data: {
          customerId: customer.id,
          name: "Pat Example",
          firstName: "Pat",
          lastName: "Example",
          email: "pat.example@customer.example.invalid",
          phone: "555-0100",
          company: "Acme Demo Properties LLC",
          label: "PRIMARY",
          source: "local",
        },
      });

      const supplierA = await tx.supplier.create({
        data: {
          name: "Northwind Gas Supply (Demo)",
          email: "quotes.demo.a@supplier.example.invalid",
          isNaturalGas: true,
          notes: `${DEMO_MARKER} Fake supplier A`,
        },
      });
      const supplierB = await tx.supplier.create({
        data: {
          name: "Contoso Energy Partners (Demo)",
          email: "quotes.demo.b@supplier.example.invalid",
          isNaturalGas: true,
          notes: `${DEMO_MARKER} Fake supplier B`,
        },
      });

      const quoteDue = new Date();
      quoteDue.setDate(quoteDue.getDate() + 14);

      const rfp = await tx.rfpRequest.create({
        data: {
          customerId: customer.id,
          customerContactId: customerContact.id,
          energyType: EnergyType.NATURAL_GAS,
          annualUsage: new Prisma.Decimal("120000"),
          avgMonthlyUsage: new Prisma.Decimal("10000"),
          quoteDueDate: quoteDue,
          contractStartMonth: 7,
          contractStartYear: 2026,
          brokerMargin: new Prisma.Decimal("0.05"),
          brokerMarginUnit: PriceUnit.MCF,
          ldcUtility: "Demo LDC — Columbia Gas OH (fake)",
          requestedTerms: [
            { kind: "months", months: 12 },
            { kind: "months", months: 24 },
          ] as Prisma.InputJsonValue,
          googleDriveFolderUrl: "https://drive.google.com/drive/folders/demo-quotes-qa",
          sentAt: new Date(),
          status: "sent",
          notes: `${DEMO_MARKER} Submitted RFP for Quotes UI testing.`,
          suppliers: { connect: [{ id: supplierA.id }, { id: supplierB.id }] },
          accountLines: {
            create: [
              {
                accountNumber: "DEMO-GA-1001",
                serviceAddress: "100 Demo Industrial Pkwy, Columbus OH",
                annualUsage: new Prisma.Decimal("120000"),
                avgMonthlyUsage: new Prisma.Decimal("10000"),
                sortOrder: 0,
              },
            ],
          },
        },
      });

      await tx.rfpQuote.createMany({
        data: [
          {
            rfpRequestId: rfp.id,
            supplierId: supplierA.id,
            rate: new Prisma.Decimal("0.429"),
            priceUnit: PriceUnit.MCF,
            termMonths: 12,
            brokerMargin: new Prisma.Decimal("0.05"),
            isBestOffer: false,
            notes: "Demo quote",
          },
          {
            rfpRequestId: rfp.id,
            supplierId: supplierA.id,
            rate: new Prisma.Decimal("0.455"),
            priceUnit: PriceUnit.MCF,
            termMonths: 24,
            brokerMargin: new Prisma.Decimal("0.05"),
            isBestOffer: false,
            notes: "Demo quote",
          },
          {
            rfpRequestId: rfp.id,
            supplierId: supplierB.id,
            rate: new Prisma.Decimal("0.441"),
            priceUnit: PriceUnit.MCF,
            termMonths: 12,
            brokerMargin: new Prisma.Decimal("0.05"),
            isBestOffer: true,
            notes: "Demo quote — best 12 mo for testing",
          },
          {
            rfpRequestId: rfp.id,
            supplierId: supplierB.id,
            rate: new Prisma.Decimal("0.468"),
            priceUnit: PriceUnit.MCF,
            termMonths: 24,
            brokerMargin: new Prisma.Decimal("0.05"),
            isBestOffer: false,
            notes: "Demo quote",
          },
        ],
      });
    });

    const seeded = await prisma.rfpRequest.findFirst({
      where: { notes: { contains: DEMO_MARKER } },
      select: { id: true, customer: { select: { name: true, company: true } } },
      orderBy: { createdAt: "desc" },
    });

    console.log("Quotes demo seed OK.");
    if (seeded) {
      console.log(`  RFP id: ${seeded.id}`);
      console.log(`  Customer: ${seeded.customer?.name} — ${seeded.customer?.company}`);
      console.log("  Open: /quotes?rfpRequestId=" + encodeURIComponent(seeded.id));
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
