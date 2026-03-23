import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PriceUnit } from "@/generated/prisma/client";

/**
 * GET /api/rfp/quotes
 * List RFP quotes, optionally filtered by rfpRequestId
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const rfpRequestId = searchParams.get("rfpRequestId");

    const where = rfpRequestId ? { rfpRequestId } : {};

    const quotes = await prisma.rfpQuote.findMany({
      where,
      include: {
        supplier: { select: { name: true, email: true } },
        rfpRequest: {
          include: { customer: { select: { name: true } } },
        },
      },
      orderBy: { rate: "asc" },
    });

    return NextResponse.json(quotes);
  } catch (err) {
    console.error("RFP quotes fetch error:", err);
    return NextResponse.json(
      { error: "Failed to fetch quotes" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/rfp/quotes
 * Add an RFP quote (e.g. from supplier email response)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      rfpRequestId,
      supplierId,
      rate,
      priceUnit,
      termMonths,
      brokerMargin,
      totalMargin,
      isBestOffer,
      notes,
    } = body;

    if (!supplierId || rate === undefined || !priceUnit || !termMonths) {
      return NextResponse.json(
        { error: "supplierId, rate, priceUnit, and termMonths are required" },
        { status: 400 }
      );
    }

    if (isBestOffer) {
      await prisma.rfpQuote.updateMany({
        where: { rfpRequestId: rfpRequestId || undefined },
        data: { isBestOffer: false },
      });
    }

    const quote = await prisma.rfpQuote.create({
      data: {
        rfpRequestId: rfpRequestId || null,
        supplierId,
        rate: parseFloat(rate),
        priceUnit: priceUnit as PriceUnit,
        termMonths: parseInt(termMonths, 10),
        brokerMargin: brokerMargin ? parseFloat(brokerMargin) : null,
        totalMargin: totalMargin ? parseFloat(totalMargin) : null,
        isBestOffer: Boolean(isBestOffer),
        notes: notes || null,
      },
    });

    return NextResponse.json(quote);
  } catch (err) {
    console.error("RFP quote create error:", err);
    return NextResponse.json(
      { error: "Failed to create quote" },
      { status: 500 }
    );
  }
}
