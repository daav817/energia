import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createContractFromArchivedRfp } from "@/lib/create-contract-from-archived-rfp";
import { applyWorkflowClosedFromArchivedRfp } from "@/lib/contract-workflow-sync";
import { parseCustomerQuoteEmailDraft } from "@/lib/customer-quote-email-draft";
import { resolveCustomerIdForArchivedRfp } from "@/lib/resolve-customer-id-for-archived-rfp";

/** Include shape reused after PATCH so follow-up updates return the same JSON shape as GET. */
const RFP_PATCH_INCLUDE: Prisma.RfpRequestInclude = {
  customer: { select: { id: true, name: true, company: true } },
  customerContact: {
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      email: true,
      emails: { select: { email: true }, orderBy: { order: "asc" } },
      phone: true,
      company: true,
      label: true,
      customerId: true,
    },
  },
  suppliers: { select: { id: true, name: true, email: true } },
  accountLines: { orderBy: { sortOrder: "asc" } },
  quotes: {
    include: { supplier: { select: { id: true, name: true } } },
    orderBy: [{ termMonths: "asc" }, { rate: "asc" }],
  },
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const request = await prisma.rfpRequest.findUnique({
      where: { id },
      include: RFP_PATCH_INCLUDE,
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

      if (statusRaw === "sent") {
        const explicitSentRaw =
          typeof body.sentAt === "string" ? String(body.sentAt).trim() : "";
        if (explicitSentRaw) {
          const d = new Date(explicitSentRaw);
          if (Number.isNaN(d.getTime())) {
            return NextResponse.json({ error: "Invalid sentAt" }, { status: 400 });
          }
          data.sentAt = d;
        } else {
          const existing = await prisma.rfpRequest.findUnique({
            where: { id },
            select: { sentAt: true },
          });
          if (!existing?.sentAt) {
            data.sentAt = new Date();
          }
        }
      }
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

    if (body.archive === true) {
      data.archivedAt = new Date();
      const snap = body.quoteWorkspaceSnapshot;
      if (snap != null && typeof snap === "object" && !Array.isArray(snap)) {
        data.archivedQuoteWorkspace = snap as Prisma.InputJsonValue;
      }
    } else if (body.archive === false) {
      data.archivedAt = null;
    }

    if (body.quoteComparisonPicks !== undefined) {
      if (body.quoteComparisonPicks === null) {
        data.quoteComparisonPicks = Prisma.DbNull;
      } else if (
        typeof body.quoteComparisonPicks === "object" &&
        body.quoteComparisonPicks !== null &&
        !Array.isArray(body.quoteComparisonPicks)
      ) {
        data.quoteComparisonPicks = body.quoteComparisonPicks as Prisma.InputJsonValue;
      } else {
        return NextResponse.json({ error: "Invalid quoteComparisonPicks" }, { status: 400 });
      }
    }

    if (body.customerQuoteEmailDraft !== undefined) {
      if (body.customerQuoteEmailDraft === null) {
        data.customerQuoteEmailDraft = Prisma.DbNull;
      } else if (
        typeof body.customerQuoteEmailDraft === "object" &&
        body.customerQuoteEmailDraft !== null &&
        !Array.isArray(body.customerQuoteEmailDraft)
      ) {
        const parsed = parseCustomerQuoteEmailDraft(body.customerQuoteEmailDraft);
        if (!parsed) {
          return NextResponse.json({ error: "Invalid customerQuoteEmailDraft" }, { status: 400 });
        }
        data.customerQuoteEmailDraft = parsed as unknown as Prisma.InputJsonValue;
      } else {
        return NextResponse.json({ error: "Invalid customerQuoteEmailDraft" }, { status: 400 });
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    let updated = await prisma.rfpRequest.update({
      where: { id },
      data,
      include: RFP_PATCH_INCLUDE,
    });

    /**
     * Denormalized `customerId` is required for contracts. Resolve from workflow link, contacts,
     * or quote-email draft recipients when the FK was never set (Quotes workspace often only stores draft To/Cc).
     */
    if (body.archive === true && !updated.customerId) {
      const resolvedCustomerId = await resolveCustomerIdForArchivedRfp(id);
      if (resolvedCustomerId) {
        updated = await prisma.rfpRequest.update({
          where: { id },
          data: { customerId: resolvedCustomerId },
          include: RFP_PATCH_INCLUDE,
        });
      }
    }

    let createdContractId: string | null = null;
    let archiveSkippedContractReason: string | null = null;
    if (body.archive === true) {
      if (!updated.customerId) {
        archiveSkippedContractReason =
          "No CRM customer could be resolved from this RFP (pick a customer on the RFP, or use a linked contact that is tied to a customer company), so no contract was auto-created. You can add a contract manually.";
      } else {
        createdContractId = await createContractFromArchivedRfp(id);
        if (!createdContractId) {
          archiveSkippedContractReason = "Could not create a contract for this RFP.";
        }
      }
      await applyWorkflowClosedFromArchivedRfp(id);
    }

    return NextResponse.json({
      ...updated,
      createdContractId,
      archiveSkippedContractReason,
    });
  } catch (error) {
    console.error("RFP request update error:", error);
    return NextResponse.json({ error: "Failed to update RFP request" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const row = await prisma.rfpRequest.findUnique({ where: { id }, select: { id: true } });
    if (!row) {
      return NextResponse.json({ error: "RFP request not found" }, { status: 404 });
    }
    await prisma.rfpRequest.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("RFP request delete error:", error);
    return NextResponse.json({ error: "Failed to delete RFP request" }, { status: 500 });
  }
}
