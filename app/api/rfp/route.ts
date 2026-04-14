import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "";
    const energyTypeRaw = searchParams.get("energyType")?.trim() || "";

    const where: Prisma.RfpRequestWhereInput = {};
    if (status.trim()) where.status = status.trim();
    if (energyTypeRaw === "ELECTRIC" || energyTypeRaw === "NATURAL_GAS") {
      where.energyType = energyTypeRaw;
    }
    const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "1";
    const archivedOnly = new URL(request.url).searchParams.get("archivedOnly") === "1";
    if (archivedOnly) {
      where.archivedAt = { not: null };
    } else if (!includeArchived) {
      where.archivedAt = null;
    }
    const customerIdFilter = new URL(request.url).searchParams.get("customerId")?.trim();
    const workflowPicker = searchParams.get("workflowPicker") === "1";
    if (customerIdFilter) {
      if (workflowPicker) {
        const contactRows = await prisma.contact.findMany({
          where: { customerId: customerIdFilter },
          select: { id: true },
        });
        const contactIds = contactRows.map((c) => c.id);
        const branches: Prisma.RfpRequestWhereInput[] = [{ customerId: customerIdFilter }];
        if (contactIds.length > 0) {
          branches.push({
            AND: [{ customerId: null }, { customerContactId: { in: contactIds } }],
          });
        }
        where.OR = branches;
      } else {
        where.customerId = customerIdFilter;
      }
    }
    if (searchParams.get("sentOnly") === "1") {
      where.sentAt = { not: null };
    }

    if (workflowPicker) {
      const rows = await prisma.rfpRequest.findMany({
        where,
        select: {
          id: true,
          sentAt: true,
          createdAt: true,
          energyType: true,
          customerId: true,
          status: true,
          accountLines: {
            orderBy: { sortOrder: "asc" },
            take: 2,
            select: { accountNumber: true, serviceAddress: true },
          },
        },
        orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
        take: 200,
      });
      return NextResponse.json(rows);
    }

    const requests = await prisma.rfpRequest.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, company: true } },
        customerContact: {
          select: {
            id: true,
            name: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            company: true,
          },
        },
        suppliers: { select: { id: true, name: true, email: true } },
        accountLines: { orderBy: { sortOrder: "asc" } },
        quotes: {
          include: { supplier: { select: { id: true, name: true } } },
          orderBy: [{ termMonths: "asc" }, { rate: "asc" }],
        },
      },
      orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
    });

    return NextResponse.json(requests);
  } catch (error) {
    console.error("RFP request fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch RFP requests" }, { status: 500 });
  }
}
