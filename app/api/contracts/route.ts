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

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tab = searchParams.get("tab") || "active"; // active | ended
    const energyFilter = (searchParams.get("energy") || "all") as "all" | "electric" | "gas";
    const sort = searchParams.get("sort") || "expirationDate";
    const order = (searchParams.get("order") || "asc") as "asc" | "desc";

    const where: Record<string, unknown> = {};
    if (tab === "ended") {
      where.status = "archived";
    } else {
      where.status = { not: "archived" };
    }
    if (energyFilter === "electric") {
      where.energyType = EnergyType.ELECTRIC;
    } else if (energyFilter === "gas") {
      where.energyType = EnergyType.NATURAL_GAS;
    }

    const validSort = [
      "expirationDate",
      "startDate",
      "pricePerUnit",
      "brokerMargin",
      "annualUsage",
      "termMonths",
      "contractIncome",
      "signedDate",
      "customerId",
      "supplierId",
    ].includes(sort)
      ? sort
      : "expirationDate";

    const orderBy =
      validSort === "customerId"
        ? { customer: { name: order } }
        : validSort === "supplierId"
          ? { supplier: { name: order } }
          : ({ [validSort]: order } as Record<string, "asc" | "desc">);

    let contracts = await prisma.contract.findMany({
      where,
      orderBy,
      include: contractInclude,
    });

    const mergeDaysRaw = searchParams.get("mergeRecentExpiredDays");
    const mergeDays = mergeDaysRaw ? Math.min(365, Math.max(0, parseInt(mergeDaysRaw, 10) || 0)) : 0;
    if (tab === "active" && mergeDays > 0) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const windowStart = new Date(todayStart);
      windowStart.setDate(windowStart.getDate() - mergeDays);

      const recentExpired = await prisma.contract.findMany({
        where: {
          expirationDate: {
            gte: windowStart,
            lt: todayStart,
          },
        },
        orderBy,
        include: contractInclude,
      });

      const seen = new Set(contracts.map((c) => c.id));
      const flagged = recentExpired
        .filter((c) => !seen.has(c.id))
        .map((c) => ({ ...c, isRecentExpired: true as const }));
      contracts = [...contracts, ...flagged];
    }

    return NextResponse.json(contracts);
  } catch (error) {
    console.error("Contracts fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch contracts" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      customerId,
      supplierId,
      mainContactId,
      energyType,
      priceUnit,
      pricePerUnit,
      startDate,
      expirationDate,
      termMonths,
      annualUsage,
      avgMonthlyUsage,
      brokerMargin,
      customerUtility,
      signedDate,
      totalMeters,
      notes,
      signedContractDriveUrl,
    } = body;

    if (!customerId || !supplierId || !energyType || !priceUnit || !pricePerUnit || !startDate || !expirationDate || !termMonths) {
      return NextResponse.json(
        { error: "customerId, supplierId, energyType, priceUnit, pricePerUnit, startDate, expirationDate, and termMonths are required" },
        { status: 400 }
      );
    }

    const contract = await prisma.contract.create({
      data: {
        customerId,
        supplierId,
        mainContactId: mainContactId || null,
        energyType: energyType as EnergyType,
        priceUnit: priceUnit as PriceUnit,
        pricePerUnit: new Prisma.Decimal(Number(pricePerUnit)),
        startDate: new Date(startDate),
        expirationDate: new Date(expirationDate),
        termMonths: Number(termMonths),
        annualUsage: annualUsage != null ? new Prisma.Decimal(Number(annualUsage)) : null,
        avgMonthlyUsage: avgMonthlyUsage != null ? new Prisma.Decimal(Number(avgMonthlyUsage)) : null,
        brokerMargin: brokerMargin != null ? new Prisma.Decimal(Number(brokerMargin)) : null,
        customerUtility: customerUtility || null,
        signedDate: signedDate ? new Date(signedDate) : null,
        totalMeters: totalMeters != null ? Number(totalMeters) : null,
        signedContractDriveUrl:
          signedContractDriveUrl != null && String(signedContractDriveUrl).trim() !== ""
            ? String(signedContractDriveUrl).trim()
            : null,
        notes: notes != null && String(notes).trim() !== "" ? String(notes).trim() : null,
        status: "active",
      },
      include: contractInclude,
    });

    const withCustomer = await prisma.contract.findUnique({
      where: { id: contract.id },
      include: contractInclude,
    });

    return NextResponse.json(withCustomer ?? contract);
  } catch (error) {
    console.error("Contract create error:", error);
    return NextResponse.json(
      { error: "Failed to create contract" },
      { status: 500 }
    );
  }
}
