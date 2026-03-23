import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * PATCH /api/rfp/quotes/[id]
 * Update quote (e.g. set isBestOffer)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { isBestOffer } = body;

    if (isBestOffer === true) {
      const quote = await prisma.rfpQuote.findUnique({ where: { id } });
      if (quote?.rfpRequestId) {
        await prisma.rfpQuote.updateMany({
          where: { rfpRequestId: quote.rfpRequestId },
          data: { isBestOffer: false },
        });
      }
    }

    const updated = await prisma.rfpQuote.update({
      where: { id },
      data: { ...(isBestOffer !== undefined && { isBestOffer }) },
    });

    return NextResponse.json(updated);
  } catch (err) {
    console.error("RFP quote update error:", err);
    return NextResponse.json(
      { error: "Failed to update quote" },
      { status: 500 }
    );
  }
}
