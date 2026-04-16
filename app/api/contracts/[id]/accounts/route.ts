import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

/** Accepts values like "1,234,567.89" from the UI. */
function parseUsageDecimal(raw: unknown): Prisma.Decimal | null {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/,/g, "").trim();
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return new Prisma.Decimal(n);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: contractId } = await params;
    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      select: { id: true },
    });
    if (!contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }
    const rows = await prisma.contractAccount.findMany({
      where: { contractId },
      orderBy: { sortOrder: "asc" },
    });
    return NextResponse.json(
      rows.map((r) => ({
        id: r.id,
        accountId: r.accountId,
        ldcUtility: r.ldcUtility,
        serviceAddress: r.serviceAddress,
        annualUsage: r.annualUsage != null ? r.annualUsage.toString() : null,
        avgMonthlyUsage: r.avgMonthlyUsage != null ? r.avgMonthlyUsage.toString() : null,
        sortOrder: r.sortOrder,
      }))
    );
  } catch (e) {
    console.error("Contract accounts GET:", e);
    return NextResponse.json({ error: "Failed to load accounts" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: contractId } = await params;
    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      select: { id: true },
    });
    if (!contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }

    const body = await request.json();
    const raw = body.accounts;
    if (!Array.isArray(raw)) {
      return NextResponse.json({ error: "accounts array required" }, { status: 400 });
    }

    const accounts: {
      accountId: string;
      ldcUtility: string | null;
      serviceAddress: string | null;
      annualUsage: Prisma.Decimal | null;
      avgMonthlyUsage: Prisma.Decimal | null;
    }[] = [];

    for (let i = 0; i < raw.length; i++) {
      const a = raw[i] as Record<string, unknown>;
      const accountId = String(a.accountId ?? "").trim();
      if (!accountId) {
        return NextResponse.json({ error: `Row ${i + 1}: account id is required` }, { status: 400 });
      }
      const ldcUtility =
        a.ldcUtility != null && String(a.ldcUtility).trim() !== "" ? String(a.ldcUtility).trim() : null;
      const serviceAddress =
        a.serviceAddress != null && String(a.serviceAddress).trim() !== ""
          ? String(a.serviceAddress).trim()
          : null;
      let annualUsage: Prisma.Decimal | null = null;
      if (a.annualUsage != null && String(a.annualUsage).trim() !== "") {
        const parsed = parseUsageDecimal(a.annualUsage);
        if (parsed == null) {
          return NextResponse.json({ error: `Row ${i + 1}: invalid annual usage` }, { status: 400 });
        }
        annualUsage = parsed;
      }
      let avgMonthlyUsage: Prisma.Decimal | null = null;
      if (a.avgMonthlyUsage != null && String(a.avgMonthlyUsage).trim() !== "") {
        const parsed = parseUsageDecimal(a.avgMonthlyUsage);
        if (parsed == null) {
          return NextResponse.json({ error: `Row ${i + 1}: invalid average monthly usage` }, { status: 400 });
        }
        avgMonthlyUsage = parsed;
      }
      accounts.push({ accountId, ldcUtility, serviceAddress, annualUsage, avgMonthlyUsage });
    }

    await prisma.contractAccount.deleteMany({ where: { contractId } });
    if (accounts.length > 0) {
      await prisma.contractAccount.createMany({
        data: accounts.map((a, sortOrder) => ({
          contractId,
          accountId: a.accountId,
          ldcUtility: a.ldcUtility,
          serviceAddress: a.serviceAddress,
          annualUsage: a.annualUsage,
          avgMonthlyUsage: a.avgMonthlyUsage,
          sortOrder,
        })),
      });
    }

    const rows = await prisma.contractAccount.findMany({
      where: { contractId },
      orderBy: { sortOrder: "asc" },
    });
    return NextResponse.json(
      rows.map((r) => ({
        id: r.id,
        accountId: r.accountId,
        ldcUtility: r.ldcUtility,
        serviceAddress: r.serviceAddress,
        annualUsage: r.annualUsage != null ? r.annualUsage.toString() : null,
        avgMonthlyUsage: r.avgMonthlyUsage != null ? r.avgMonthlyUsage.toString() : null,
        sortOrder: r.sortOrder,
      }))
    );
  } catch (e) {
    console.error("Contract accounts PUT:", e);
    return NextResponse.json({ error: "Failed to save accounts" }, { status: 500 });
  }
}
