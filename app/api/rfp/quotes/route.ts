import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PriceUnit, RfpQuoteComparisonBucket } from "@/generated/prisma/client";

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
        supplier: { select: { id: true, name: true, email: true } },
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
      comparisonBucket: comparisonBucketBody,
    } = body;

    if (!supplierId || rate === undefined || !priceUnit || !termMonths) {
      return NextResponse.json(
        { error: "supplierId, rate, priceUnit, and termMonths are required" },
        { status: 400 }
      );
    }

    const termMonthsValue = parseInt(String(termMonths), 10);
    if (!Number.isFinite(termMonthsValue)) {
      return NextResponse.json({ error: "Invalid termMonths" }, { status: 400 });
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

    let resolvedComparisonBucket: RfpQuoteComparisonBucket | null = null;
    if (
      comparisonBucketBody === "ELECTRIC_FIXED_CAPACITY_ADJUST" ||
      comparisonBucketBody === "ELECTRIC_CAPACITY_PASS_THROUGH"
    ) {
      resolvedComparisonBucket = comparisonBucketBody as RfpQuoteComparisonBucket;
    }

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

      if (rfpRequest.energyType === "NATURAL_GAS") {
        resolvedComparisonBucket = null;
      } else if (rfpRequest.energyType === "ELECTRIC" && !resolvedComparisonBucket) {
        resolvedComparisonBucket = RfpQuoteComparisonBucket.ELECTRIC_FIXED_CAPACITY_ADJUST;
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
        const rateValue = parseFloat(rate);
        computedTotalMargin = avgMonthlyUsageTotal * termMonthsValue * marginValue;
        if (Number.isFinite(rateValue)) {
          computedEstimatedContractValue =
            avgMonthlyUsageTotal * termMonthsValue * (rateValue + marginValue);
        }
      }
    }

    const quoteData = {
      rfpRequestId: rfpRequestId || null,
      supplierId,
      rate: parseFloat(rate),
      priceUnit: priceUnit as PriceUnit,
      termMonths: termMonthsValue,
      comparisonBucket: resolvedComparisonBucket,
      brokerMargin: brokerMargin ? parseFloat(brokerMargin) : null,
      totalMargin: computedTotalMargin,
      estimatedContractValue: computedEstimatedContractValue,
      isBestOffer: Boolean(isBestOffer),
      notes: notes || null,
    };

    const existingForCell =
      rfpRequestId != null && String(rfpRequestId).trim() !== ""
        ? await prisma.rfpQuote.findFirst({
            where: {
              rfpRequestId: String(rfpRequestId),
              supplierId: String(supplierId),
              termMonths: termMonthsValue,
              comparisonBucket: resolvedComparisonBucket,
            },
            select: { id: true },
          })
        : null;

    const quote = existingForCell
      ? await prisma.rfpQuote.update({
          where: { id: existingForCell.id },
          data: quoteData,
          include: {
            supplier: { select: { id: true, name: true, email: true } },
            rfpRequest: {
              include: {
                customer: { select: { name: true } },
              },
            },
          },
        })
      : await prisma.rfpQuote.create({
          data: quoteData,
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

/**
 * DELETE /api/rfp/quotes
 * Remove all quote rows for one supplier × term cell (shows as "—" in the UI; does not store zero).
 * Body: { rfpRequestId, supplierId, termMonths, comparisonBucket? }
 * - Natural gas: omit comparisonBucket (stored as null on rows).
 * - Electric — Fixed Capacity Adjust table: "ELECTRIC_FIXED_CAPACITY_ADJUST" (also clears legacy rows with null bucket).
 * - Electric — Capacity Pass-Through: "ELECTRIC_CAPACITY_PASS_THROUGH".
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { rfpRequestId, supplierId, termMonths, comparisonBucket: comparisonBucketBody } = body as {
      rfpRequestId?: string;
      supplierId?: string;
      termMonths?: unknown;
      comparisonBucket?: string | null;
    };

    if (!rfpRequestId?.trim() || !supplierId?.trim() || termMonths === undefined || termMonths === null) {
      return NextResponse.json(
        { error: "rfpRequestId, supplierId, and termMonths are required" },
        { status: 400 }
      );
    }

    const termMonthsValue = parseInt(String(termMonths), 10);
    if (!Number.isFinite(termMonthsValue) || termMonthsValue <= 0) {
      return NextResponse.json({ error: "Invalid termMonths" }, { status: 400 });
    }

    const rfpRequest = await prisma.rfpRequest.findUnique({
      where: { id: rfpRequestId },
      select: {
        id: true,
        energyType: true,
        suppliers: { select: { id: true } },
      },
    });

    if (!rfpRequest) {
      return NextResponse.json({ error: "RFP request not found" }, { status: 404 });
    }

    if (!rfpRequest.suppliers.some((s) => s.id === supplierId)) {
      return NextResponse.json(
        { error: "Supplier is not attached to this RFP request" },
        { status: 400 }
      );
    }

    if (rfpRequest.energyType === "NATURAL_GAS") {
      const deleted = await prisma.rfpQuote.deleteMany({
        where: {
          rfpRequestId,
          supplierId,
          termMonths: termMonthsValue,
          comparisonBucket: null,
        },
      });
      return NextResponse.json({ deleted: deleted.count });
    }

    if (comparisonBucketBody === "ELECTRIC_CAPACITY_PASS_THROUGH") {
      const deleted = await prisma.rfpQuote.deleteMany({
        where: {
          rfpRequestId,
          supplierId,
          termMonths: termMonthsValue,
          comparisonBucket: RfpQuoteComparisonBucket.ELECTRIC_CAPACITY_PASS_THROUGH,
        },
      });
      return NextResponse.json({ deleted: deleted.count });
    }

    if (
      comparisonBucketBody === "ELECTRIC_FIXED_CAPACITY_ADJUST" ||
      comparisonBucketBody === null ||
      comparisonBucketBody === undefined
    ) {
      const deleted = await prisma.rfpQuote.deleteMany({
        where: {
          rfpRequestId,
          supplierId,
          termMonths: termMonthsValue,
          OR: [
            { comparisonBucket: RfpQuoteComparisonBucket.ELECTRIC_FIXED_CAPACITY_ADJUST },
            { comparisonBucket: null },
          ],
        },
      });
      return NextResponse.json({ deleted: deleted.count });
    }

    return NextResponse.json(
      {
        error:
          "For electric RFPs, comparisonBucket must be ELECTRIC_FIXED_CAPACITY_ADJUST or ELECTRIC_CAPACITY_PASS_THROUGH",
      },
      { status: 400 }
    );
  } catch (err) {
    console.error("RFP quote delete error:", err);
    return NextResponse.json({ error: "Failed to delete quote row(s)" }, { status: 500 });
  }
}
