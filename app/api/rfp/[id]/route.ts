import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const request = await prisma.rfpRequest.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, company: true } },
        customerContact: { select: { id: true, name: true, email: true, phone: true } },
        suppliers: { select: { id: true, name: true } },
        accountLines: { orderBy: { sortOrder: "asc" } },
        quotes: {
          include: { supplier: { select: { id: true, name: true } } },
          orderBy: [{ termMonths: "asc" }, { rate: "asc" }],
        },
      },
    });

    if (!request) {
      return NextResponse.json({ error: "RFP request not found" }, { status: 404 });
    }

    return NextResponse.json(request);
  } catch (error) {
    console.error("RFP request fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch RFP request" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const statusRaw = typeof body.status === "string" ? body.status.trim() : "";
    const notes = typeof body.notes === "string" ? body.notes.trim() : undefined;

    const data: Prisma.RfpRequestUpdateInput = {};

    if (statusRaw) {
      const allowedStatuses = new Set(["draft", "sent", "quotes_received", "completed", "cancelled"]);
      if (!allowedStatuses.has(statusRaw)) {
        return NextResponse.json({ error: "Invalid RFP status" }, { status: 400 });
      }
      data.status = statusRaw;
    }

    if (notes !== undefined) {
      data.notes = notes || null;
    }

    if (body.customerContactId !== undefined) {
      const cid =
        body.customerContactId === null || body.customerContactId === ""
          ? ""
          : String(body.customerContactId).trim();
      data.customerContact = cid ? { connect: { id: cid } } : { disconnect: true };
    }

    if (Array.isArray(body.quoteSummaryContactIds)) {
      data.quoteSummaryContactIds = body.quoteSummaryContactIds.map(String).filter(Boolean);
    }

    if (body.quoteSummarySentAt !== undefined) {
      if (body.quoteSummarySentAt === null || body.quoteSummarySentAt === "") {
        data.quoteSummarySentAt = null;
      } else {
        const d = new Date(String(body.quoteSummarySentAt));
        if (Number.isNaN(d.getTime())) {
          return NextResponse.json({ error: "Invalid quoteSummarySentAt" }, { status: 400 });
        }
        data.quoteSummarySentAt = d;
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const updated = await prisma.rfpRequest.update({
      where: { id },
      data,
      include: {
        customer: { select: { id: true, name: true, company: true } },
        customerContact: { select: { id: true, name: true, email: true, phone: true } },
        suppliers: { select: { id: true, name: true } },
        accountLines: { orderBy: { sortOrder: "asc" } },
        quotes: {
          include: { supplier: { select: { id: true, name: true } } },
          orderBy: [{ termMonths: "asc" }, { rate: "asc" }],
        },
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("RFP request update error:", error);
    return NextResponse.json({ error: "Failed to update RFP request" }, { status: 500 });
  }
}
