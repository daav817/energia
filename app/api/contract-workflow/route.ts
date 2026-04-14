import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const rowInclude = {
  contract: {
    include: {
      customer: true,
      supplier: true,
      mainContact: { include: { emails: { orderBy: { order: "asc" as const } } } },
    },
  },
  customer: true,
  linkedRfp: {
    select: {
      id: true,
      sentAt: true,
      quoteSummarySentAt: true,
      archivedAt: true,
    },
  },
} as const;

function sortWorkflowRows<T extends { contractId: string | null; contract: { expirationDate: Date } | null; createdAt: Date }>(
  rows: T[]
): T[] {
  return [...rows].sort((a, b) => {
    const aNew = !a.contractId;
    const bNew = !b.contractId;
    if (aNew !== bNew) return aNew ? -1 : 1;
    if (aNew && bNew) return b.createdAt.getTime() - a.createdAt.getTime();
    const ea = a.contract?.expirationDate ? new Date(a.contract.expirationDate).getTime() : Number.MAX_SAFE_INTEGER;
    const eb = b.contract?.expirationDate ? new Date(b.contract.expirationDate).getTime() : Number.MAX_SAFE_INTEGER;
    return ea - eb;
  });
}

export async function GET(request: NextRequest) {
  try {
    const archived = request.nextUrl.searchParams.get("archived") === "1";
    const activeContracts = await prisma.contract.findMany({
      where: { status: { not: "archived" } },
      select: { id: true },
    });
    for (const c of activeContracts) {
      await prisma.contractWorkflowRow.upsert({
        where: { contractId: c.id },
        create: { contractId: c.id },
        update: {},
      });
    }
    const rows = await prisma.contractWorkflowRow.findMany({
      where: { workflowArchived: archived },
      include: rowInclude,
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ rows: sortWorkflowRows(rows) });
  } catch (e) {
    console.error("contract-workflow GET", e);
    return NextResponse.json({ error: "Failed to load workflow" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const customerId = typeof body.customerId === "string" ? body.customerId.trim() : "";
    const energyRaw = body.energyType;
    const energyType =
      energyRaw === "ELECTRIC" || energyRaw === "NATURAL_GAS" ? energyRaw : null;
    const displayLabel = typeof body.displayLabel === "string" ? body.displayLabel.trim() || null : null;
    if (!customerId) {
      return NextResponse.json({ error: "customerId is required" }, { status: 400 });
    }
    if (!energyType) {
      return NextResponse.json({ error: "energyType is required" }, { status: 400 });
    }
    const row = await prisma.contractWorkflowRow.create({
      data: {
        customerId,
        energyType,
        displayLabel,
      },
      include: rowInclude,
    });
    return NextResponse.json(row);
  } catch (e) {
    console.error("contract-workflow POST", e);
    return NextResponse.json({ error: "Failed to create workflow row" }, { status: 500 });
  }
}
