import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "";
    const energyType = searchParams.get("energyType") || "";

    const where: Record<string, unknown> = {};
    if (status.trim()) where.status = status.trim();
    if (energyType.trim()) where.energyType = energyType.trim();
    const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "1";
    const archivedOnly = new URL(request.url).searchParams.get("archivedOnly") === "1";
    if (archivedOnly) {
      where.archivedAt = { not: null };
    } else if (!includeArchived) {
      where.archivedAt = null;
    }
    const customerIdFilter = new URL(request.url).searchParams.get("customerId")?.trim();
    if (customerIdFilter) {
      where.customerId = customerIdFilter;
    }

    const requests = await prisma.rfpRequest.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, company: true } },
        customerContact: {
          select: { id: true, name: true, email: true, phone: true, company: true },
        },
        suppliers: { select: { id: true, name: true } },
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
