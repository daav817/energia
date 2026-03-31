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
      estimatedContractValue,
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

    let computedTotalMargin: number | null =
      totalMargin !== undefined && totalMargin !== null && totalMargin !== ""
        ? parseFloat(totalMargin)
        : null;
    let computedEstimatedContractValue: number | null =
      estimatedContractValue !== undefined &&
      estimatedContractValue !== null &&
      estimatedContractValue !== ""
        ? parseFloat(estimatedContractValue)
        : null;

    if (rfpRequestId) {
      const rfpRequest = await prisma.rfpRequest.findUnique({
        where: { id: rfpRequestId },
        include: {
          suppliers: { select: { id: true } },
          accountLines: { select: { avgMonthlyUsage: true } },
        },
      });

      if (!rfpRequest) {
        return NextResponse.json({ error: "RFP request not found" }, { status: 404 });
      }

      const supplierAllowed = rfpRequest.suppliers.some((supplier) => supplier.id === supplierId);
      if (!supplierAllowed) {
        return NextResponse.json(
          { error: "Supplier is not attached to this RFP request" },
          { status: 400 }
        );
      }

      const marginValue =
        brokerMargin !== undefined && brokerMargin !== null && brokerMargin !== ""
          ? parseFloat(brokerMargin)
          : null;
      if (marginValue !== null && Number.isFinite(marginValue)) {
        const avgMonthlyUsageTotal = rfpRequest.accountLines.reduce(
          (sum, line) => sum + Number(line.avgMonthlyUsage),
          0
        );
        const termMonthsValue = parseInt(termMonths, 10);
        const rateValue = parseFloat(rate);
        computedTotalMargin = avgMonthlyUsageTotal * termMonthsValue * marginValue;
        if (Number.isFinite(rateValue)) {
          computedEstimatedContractValue =
            avgMonthlyUsageTotal * termMonthsValue * (rateValue + marginValue);
        }
      }
    }

    const quote = await prisma.rfpQuote.create({
      data: {
        rfpRequestId: rfpRequestId || null,
        supplierId,
        rate: parseFloat(rate),
        priceUnit: priceUnit as PriceUnit,
        termMonths: parseInt(termMonths, 10),
        brokerMargin: brokerMargin ? parseFloat(brokerMargin) : null,
        totalMargin: computedTotalMargin,
        estimatedContractValue: computedEstimatedContractValue,
        isBestOffer: Boolean(isBestOffer),
        notes: notes || null,
      },
      include: {
        supplier: { select: { id: true, name: true, email: true } },
        rfpRequest: {
          include: {
            customer: { select: { name: true } },
          },
        },
      },
    });

    if (rfpRequestId) {
      await prisma.rfpRequest.update({
        where: { id: rfpRequestId },
        data: { status: "quotes_received" },
      });
    }

    return NextResponse.json(quote);
  } catch (err) {
    console.error("RFP quote create error:", err);
    return NextResponse.json(
      { error: "Failed to create quote" },
      { status: 500 }
    );
  }
}
