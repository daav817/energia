import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  annualUsageResolved,
  calendarYearBrokerIncome,
  totalTermBrokerIncome,
  type ContractLikeForIncome,
} from "@/lib/contract-broker-income";
import { EnergyType } from "@/generated/prisma/client";

function num(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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
        startDate: true,
        expirationDate: true,
        termMonths: true,
        annualUsage: true,
        avgMonthlyUsage: true,
        brokerMargin: true,
        contractIncome: true,
      },
    });

    const year = new Date().getFullYear();
    let totalEstIncomePerYear = 0;
    let totalTermBrokerIncomeSum = 0;
    let currentYearAttributableIncome = 0;
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
      currentYearAttributableIncome += calendarYearBrokerIncome(like, year);
      if (c.energyType === EnergyType.ELECTRIC) activeElectric += 1;
      else activeGas += 1;
    }

    return NextResponse.json({
      activeContractCount: rows.length,
      activeElectric,
      activeGas,
      totalEstIncomePerYear,
      totalTermBrokerIncome: totalTermBrokerIncomeSum,
      currentYearAttributableIncome,
      incomeYear: year,
    });
  } catch (e) {
    console.error("contracts-financial-summary", e);
    return NextResponse.json({ error: "Failed to load summary" }, { status: 500 });
  }
}
