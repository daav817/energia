import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * All non-archived RFPs for the workflow “link RFP” combobox.
 * Intentionally unfiltered so the broker can pick the correct RFP for any contract row.
 */
export async function GET(_request: NextRequest) {
  try {
    const rfps = await prisma.rfpRequest.findMany({
      where: { archivedAt: null },
      select: {
        id: true,
        sentAt: true,
        createdAt: true,
        updatedAt: true,
        energyType: true,
        customerId: true,
        status: true,
        customer: { select: { name: true, company: true } },
        customerContact: { select: { name: true, company: true } },
        accountLines: {
          orderBy: { sortOrder: "asc" as const },
          take: 2,
          select: { accountNumber: true, serviceAddress: true },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { sentAt: "desc" }, { createdAt: "desc" }],
      take: 600,
    });

    return NextResponse.json(rfps);
  } catch (e) {
    console.error("contract-workflow submitted-rfps GET", e);
    return NextResponse.json({ error: "Failed to load RFPs" }, { status: 500 });
  }
}
