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
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(requests);
  } catch (error) {
    console.error("RFP request fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch RFP requests" }, { status: 500 });
  }
}
