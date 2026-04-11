import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { annualUsageResolved, totalTermBrokerIncome, type ContractLikeForIncome } from "@/lib/contract-broker-income";
import {
  activeBookAnnualBrokerIncomeTotals,
  activeBookAnnualUsageTotals,
  aggregateUsageByCalendarYear,
  type ContractLikeForUsageCalendar,
} from "@/lib/broker-usage-calendar";
import { EnergyType } from "@/generated/prisma/client";
import { coerceFiniteNumber } from "@/lib/coerce-number";

function num(v: unknown): number {
  return coerceFiniteNumber(v);
}

function estIncomePerYear(c: ContractLikeForIncome): number {
  return num(c.brokerMargin) * annualUsageResolved(c);
}

/**
 * GET /api/broker/contracts-financial-summary
 * Aggregates non-archived contracts for broker overview (nav modal, etc.).
 */
export async function GET() {
  try {
    const rows = await prisma.contract.findMany({
      where: { status: { not: "archived" } },
      select: {
        energyType: true,
        priceUnit: true,
        status: true,
        startDate: true,
        expirationDate: true,
        termMonths: true,
        annualUsage: true,
        avgMonthlyUsage: true,
        brokerMargin: true,
        contractIncome: true,
      },
    });

    const usageRows = await prisma.contract.findMany({
      where: { NOT: { status: "cancelled" } },
      select: {
        startDate: true,
        expirationDate: true,
        energyType: true,
        priceUnit: true,
        annualUsage: true,
        avgMonthlyUsage: true,
        brokerMargin: true,
        status: true,
      },
    });

    const usageSlice = usageRows.map(
      (r): ContractLikeForUsageCalendar => ({
        startDate: r.startDate.toISOString(),
        expirationDate: r.expirationDate.toISOString(),
        energyType: String(r.energyType),
        priceUnit: r.priceUnit,
        annualUsage: r.annualUsage,
        avgMonthlyUsage: r.avgMonthlyUsage,
        brokerMargin: r.brokerMargin,
        status: r.status,
      })
    );

    const bookUsageSlice = rows.map(
      (r): ContractLikeForUsageCalendar => ({
        startDate: r.startDate.toISOString(),
        expirationDate: r.expirationDate.toISOString(),
        energyType: String(r.energyType),
        priceUnit: r.priceUnit,
        annualUsage: r.annualUsage,
        avgMonthlyUsage: r.avgMonthlyUsage,
        brokerMargin: r.brokerMargin,
        status: r.status,
      })
    );

    const usageByYear = aggregateUsageByCalendarYear(usageSlice);
    const { electricKwh: activeBookElectricKwh, naturalGasMcf: activeBookGasMcf } =
      activeBookAnnualUsageTotals(bookUsageSlice);
    const { electricUsd: activeBookElectricBrokerIncomeUsd, gasUsd: activeBookGasBrokerIncomeUsd } =
      activeBookAnnualBrokerIncomeTotals(bookUsageSlice);

    let totalEstIncomePerYear = 0;
    let totalTermBrokerIncomeSum = 0;
    let activeElectric = 0;
    let activeGas = 0;

    for (const c of rows) {
      const like: ContractLikeForIncome = {
        startDate: c.startDate.toISOString(),
        expirationDate: c.expirationDate.toISOString(),
        termMonths: c.termMonths,
        annualUsage: c.annualUsage,
        avgMonthlyUsage: c.avgMonthlyUsage,
        brokerMargin: c.brokerMargin,
        contractIncome: c.contractIncome,
      };
      totalEstIncomePerYear += estIncomePerYear(like);
      totalTermBrokerIncomeSum += totalTermBrokerIncome(like);
      if (c.energyType === EnergyType.ELECTRIC) activeElectric += 1;
      else activeGas += 1;
    }

    return NextResponse.json({
      activeContractCount: rows.length,
      activeElectric,
      activeGas,
      totalEstIncomePerYear,
      totalTermBrokerIncome: totalTermBrokerIncomeSum,
      usageByYear,
      activeBookElectricKwh,
      activeBookGasMcf,
      activeBookElectricBrokerIncomeUsd,
      activeBookGasBrokerIncomeUsd,
    });
  } catch (e) {
    console.error("contracts-financial-summary", e);
    return NextResponse.json({ error: "Failed to load summary" }, { status: 500 });
  }
}
