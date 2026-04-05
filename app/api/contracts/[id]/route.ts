import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { EnergyType, PriceUnit, Prisma } from "@/generated/prisma/client";

const contractInclude = {
  customer: true,
  supplier: true,
  mainContact: {
    include: {
      emails: true,
      phones: true,
      addresses: true,
    },
  },
  documents: true,
} as const;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const contract = await prisma.contract.findUnique({
      where: { id },
      include: contractInclude,
    });
    if (!contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }
    return NextResponse.json(contract);
  } catch (error) {
    console.error("Contract fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch contract" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    if (body.status === "archived") {
      const contract = await prisma.contract.update({
        where: { id },
        data: { status: "archived" },
        include: contractInclude,
      });
      return NextResponse.json(contract);
    }

    if (body.status === "active") {
      const contract = await prisma.contract.update({
        where: { id },
        data: { status: "active" },
        include: contractInclude,
      });
      return NextResponse.json(contract);
    }

    // Notes are stored on Customer (single note shared with Customers page and all contracts for that customer).
    const notesPayload = body.notes;
    const shouldUpdateCustomerNotes = notesPayload !== undefined;

    const data: Record<string, unknown> = {};
    const fields = [
      "customerId",
      "supplierId",
      "mainContactId",
      "energyType",
      "priceUnit",
      "pricePerUnit",
      "startDate",
      "expirationDate",
      "termMonths",
      "annualUsage",
      "avgMonthlyUsage",
      "brokerMargin",
      "customerUtility",
      "signedDate",
      "totalMeters",
      "signedContractDriveUrl",
    ] as const;

    for (const field of fields) {
      const val = body[field];
      if (val === undefined) continue;
      if (field === "mainContactId") {
        data[field] = val || null;
      } else if (field === "pricePerUnit" || field === "annualUsage" || field === "avgMonthlyUsage" || field === "brokerMargin") {
        data[field] = val != null ? new Prisma.Decimal(Number(val)) : null;
      } else if (field === "startDate" || field === "expirationDate" || field === "signedDate") {
        data[field] = val ? new Date(val) : null;
      } else if (field === "termMonths" || field === "totalMeters") {
        data[field] = val != null ? Number(val) : null;
      } else {
        data[field] = val;
      }
    }

    if (Object.keys(data).length > 0) {
      await prisma.contract.update({
        where: { id },
        data,
      });
    }

    if (shouldUpdateCustomerNotes) {
      const row = await prisma.contract.findUnique({
        where: { id },
        select: { customerId: true },
      });
      if (row) {
        await prisma.customer.update({
          where: { id: row.customerId },
          data: { notes: notesPayload == null || notesPayload === "" ? null : String(notesPayload) },
        });
      }
    }

    const contract = await prisma.contract.findUnique({
      where: { id },
      include: contractInclude,
    });
    if (!contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }
    return NextResponse.json(contract);
  } catch (error) {
    console.error("Contract update error:", error);
    return NextResponse.json(
      { error: "Failed to update contract" },
      { status: 500 }
    );
  }
}
