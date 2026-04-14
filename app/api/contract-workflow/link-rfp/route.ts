import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rfpRequestId = typeof body.rfpRequestId === "string" ? body.rfpRequestId.trim() : "";
    const workflowRowId = typeof body.workflowRowId === "string" ? body.workflowRowId.trim() : "";
    const contractId = typeof body.contractId === "string" ? body.contractId.trim() : "";
    if (!rfpRequestId) {
      return NextResponse.json({ error: "rfpRequestId required" }, { status: 400 });
    }

    const rfpExists = await prisma.rfpRequest.findFirst({
      where: { id: rfpRequestId, archivedAt: null },
      select: { id: true },
    });
    if (!rfpExists) {
      return NextResponse.json({ ok: false, message: "RFP not found or is archived" });
    }

    let row = null as { id: string } | null;
    if (workflowRowId) {
      row = await prisma.contractWorkflowRow.findFirst({
        where: { id: workflowRowId, workflowArchived: false },
        select: { id: true },
      });
    }
    if (!row && contractId) {
      row = await prisma.contractWorkflowRow.findFirst({
        where: { contractId, workflowArchived: false },
        select: { id: true },
      });
    }
    if (!row) {
      return NextResponse.json({ ok: false, message: "No workflow row to link" });
    }

    const other = await prisma.contractWorkflowRow.findFirst({
      where: { linkedRfpRequestId: rfpRequestId, NOT: { id: row.id } },
      select: { id: true },
    });
    if (other) {
      await prisma.contractWorkflowRow.update({
        where: { id: other.id },
        data: { linkedRfpRequestId: null },
      });
    }

    await prisma.contractWorkflowRow.update({
      where: { id: row.id },
      data: { linkedRfpRequestId: rfpRequestId },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("link-rfp", e);
    return NextResponse.json({ error: "Link failed" }, { status: 500 });
  }
}
