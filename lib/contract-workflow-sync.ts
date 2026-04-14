import { prisma } from "@/lib/prisma";

/** When an RFP is archived, mark linked workflow row(s) as quote/RFP closed. */
export async function applyWorkflowClosedFromArchivedRfp(rfpId: string): Promise<void> {
  const now = new Date();
  await prisma.contractWorkflowRow.updateMany({
    where: {
      linkedRfpRequestId: rfpId,
      workflowArchived: false,
    },
    data: { rfpQuoteClosedAt: now },
  });
}
