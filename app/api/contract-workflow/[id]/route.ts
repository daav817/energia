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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const data: Record<string, unknown> = {};

    if (body.receivedBills === true) {
      data.receivedBillsAt = new Date();
    } else if (body.receivedBills === false) {
      data.receivedBillsAt = null;
    }

    if (body.newContractAmended === true) {
      data.newContractAmendedAt = new Date();
    } else if (body.newContractAmended === false) {
      data.newContractAmendedAt = null;
    }

    if (body.rfpQuoteClosed === true) {
      data.rfpQuoteClosedAt = new Date();
    } else if (body.rfpQuoteClosed === false) {
      data.rfpQuoteClosedAt = null;
    }

    if (typeof body.contractOutcome === "string") {
      const o = body.contractOutcome.trim();
      if (o === "" || o === "end_pursuit" || o === "refresh_rfp") {
        data.contractOutcome = o;
      }
    }

    if (body.workflowArchive === true) {
      data.workflowArchived = true;
      data.workflowArchivedAt = new Date();
    } else if (body.workflowArchive === false) {
      data.workflowArchived = false;
      data.workflowArchivedAt = null;
    }

    if (body.lastWorkflowRefresh === true) {
      data.lastWorkflowRefreshAt = new Date();
      data.contractOutcome = "";
    }

    if (body.renewalReminderNotApplicable === true) {
      data.renewalReminderNotApplicableAt = new Date();
    } else if (body.renewalReminderNotApplicable === false) {
      data.renewalReminderNotApplicableAt = null;
    }

    if (body.rfpSentOverride === true) {
      data.rfpSentOverrideAt = new Date();
    } else if (body.rfpSentOverride === false) {
      data.rfpSentOverrideAt = null;
    }

    if (body.quoteSummaryOverride === true) {
      data.quoteSummaryOverrideAt = new Date();
    } else if (body.quoteSummaryOverride === false) {
      data.quoteSummaryOverrideAt = null;
    }

    if (body.linkedRfpRequestId === null || body.linkedRfpRequestId === "") {
      data.linkedRfpRequestId = null;
    } else if (typeof body.linkedRfpRequestId === "string") {
      const rid = body.linkedRfpRequestId.trim();
      if (rid) {
        const rfp = await prisma.rfpRequest.findFirst({
          where: { id: rid, archivedAt: null },
          select: { id: true },
        });
        if (!rfp) {
          return NextResponse.json(
            { error: "RFP not found or is archived" },
            { status: 400 }
          );
        }

        const other = await prisma.contractWorkflowRow.findFirst({
          where: { linkedRfpRequestId: rid, NOT: { id } },
          select: { id: true },
        });
        if (other) {
          await prisma.contractWorkflowRow.update({
            where: { id: other.id },
            data: { linkedRfpRequestId: null },
          });
        }
        data.linkedRfpRequestId = rid;
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No valid updates" }, { status: 400 });
    }

    const updated = await prisma.contractWorkflowRow.update({
      where: { id },
      data: data as object,
      include: rowInclude,
    });
    return NextResponse.json(updated);
  } catch (e) {
    console.error("contract-workflow PATCH", e);
    return NextResponse.json({ error: "Failed to update workflow row" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.contractWorkflowRow.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("contract-workflow DELETE", e);
    return NextResponse.json({ error: "Failed to delete workflow row" }, { status: 500 });
  }
}
