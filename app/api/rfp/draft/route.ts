import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { EnergyType, PriceUnit } from "@/generated/prisma/client";

/**
 * POST /api/rfp/draft — Create or replace a draft RFP (no email). Pass draftId to update the same draft.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      draftId,
      customerId,
      customerContactId,
      energyType,
      supplierIds,
      supplierContactSelections,
      requestedTerms,
      customTermMonths,
      quoteDueDate,
      contractStartMonth,
      contractStartYear,
      googleDriveFolderUrl,
      summarySpreadsheetUrl,
      ldcUtility,
      brokerMargin,
      brokerMarginUnit,
      accountLines,
      notes,
      enrollmentDetails,
    } = body;

    if (!energyType) {
      return NextResponse.json({ error: "energyType is required to save a draft" }, { status: 400 });
    }

    const resolvedCustomerId =
      customerId != null && String(customerId).trim() ? String(customerId).trim() : null;

    if (draftId) {
      const existing = await prisma.rfpRequest.findFirst({
        where: { id: String(draftId), status: "draft" },
      });
      if (!existing) {
        return NextResponse.json({ error: "Draft not found or already submitted" }, { status: 404 });
      }
    }

    const normalizedAccountLines = normalizeAccountLines(accountLines);
    const termValues = normalizeRequestedTerms(requestedTerms, customTermMonths);
    const marginValue = parseOptionalNumber(brokerMargin);
    const quoteDue = quoteDueDate ? new Date(quoteDueDate) : null;
    const primaryTermMonths =
      termValues.find((value) => value.kind === "months")?.months ?? null;

    const totals = normalizedAccountLines.reduce(
      (acc, line) => {
        acc.annualUsage += line.annualUsage;
        acc.avgMonthlyUsage += line.avgMonthlyUsage;
        return acc;
      },
      { annualUsage: 0, avgMonthlyUsage: 0 }
    );

    const supplierIdList =
      Array.isArray(supplierIds) && supplierIds.length > 0
        ? supplierIds.map((id: string) => String(id))
        : [];

    let enrollmentJson: Prisma.InputJsonValue | undefined;
    if (enrollmentDetails != null && enrollmentDetails !== "") {
      if (typeof enrollmentDetails === "object" && !Array.isArray(enrollmentDetails)) {
        enrollmentJson = enrollmentDetails as Prisma.InputJsonValue;
      } else if (typeof enrollmentDetails === "string") {
        try {
          const j = JSON.parse(enrollmentDetails) as unknown;
          if (j && typeof j === "object" && !Array.isArray(j)) {
            enrollmentJson = j as Prisma.InputJsonValue;
          }
        } catch {
          enrollmentJson = undefined;
        }
      }
    }

    const contactSelectionsRaw =
      supplierContactSelections &&
      typeof supplierContactSelections === "object" &&
      !Array.isArray(supplierContactSelections)
        ? supplierContactSelections
        : null;

    const baseData = {
      customerId: resolvedCustomerId,
      customerContactId: customerContactId ? String(customerContactId) : null,
      energyType: energyType as EnergyType,
      supplierContactSelections: (contactSelectionsRaw ?? {}) as Prisma.InputJsonValue,
      annualUsage:
        normalizedAccountLines.length > 0
          ? new Prisma.Decimal(totals.annualUsage)
          : new Prisma.Decimal(0),
      avgMonthlyUsage:
        normalizedAccountLines.length > 0
          ? new Prisma.Decimal(totals.avgMonthlyUsage)
          : new Prisma.Decimal(0),
      termMonths: primaryTermMonths,
      googleDriveFolderUrl: nonEmptyString(googleDriveFolderUrl),
      summarySpreadsheetUrl: nonEmptyString(summarySpreadsheetUrl),
      quoteDueDate: quoteDue,
      contractStartMonth: parseOptionalInteger(contractStartMonth),
      contractStartYear: parseOptionalInteger(contractStartYear),
      brokerMargin: marginValue === null ? null : new Prisma.Decimal(marginValue),
      brokerMarginUnit: isPriceUnit(brokerMarginUnit) ? brokerMarginUnit : null,
      ldcUtility: nonEmptyString(ldcUtility),
      requestedTerms: termValues.length > 0 ? termValues : [],
      notes: notes || null,
      status: "draft",
      ...(enrollmentJson !== undefined ? { enrollmentDetails: enrollmentJson } : {}),
    };

    if (draftId) {
      await prisma.rfpAccountLine.deleteMany({ where: { rfpRequestId: String(draftId) } });
      const updated = await prisma.rfpRequest.update({
        where: { id: String(draftId) },
        data: {
          ...baseData,
          suppliers: { set: supplierIdList.map((id) => ({ id })) },
          accountLines:
            normalizedAccountLines.length > 0
              ? {
                  create: normalizedAccountLines.map((line, index) => ({
                    accountNumber: line.accountNumber,
                    serviceAddress: line.serviceAddress,
                    annualUsage: new Prisma.Decimal(line.annualUsage),
                    avgMonthlyUsage: new Prisma.Decimal(line.avgMonthlyUsage),
                    sortOrder: index,
                  })),
                }
              : undefined,
        },
        include: {
          customer: { select: { id: true, name: true, company: true } },
          suppliers: { select: { id: true, name: true } },
          accountLines: { orderBy: { sortOrder: "asc" } },
        },
      });
      return NextResponse.json(updated);
    }

    const created = await prisma.rfpRequest.create({
      data: {
        ...baseData,
        suppliers:
          supplierIdList.length > 0
            ? { connect: supplierIdList.map((id) => ({ id })) }
            : undefined,
        accountLines:
          normalizedAccountLines.length > 0
            ? {
                create: normalizedAccountLines.map((line, index) => ({
                  accountNumber: line.accountNumber,
                  serviceAddress: line.serviceAddress,
                  annualUsage: new Prisma.Decimal(line.annualUsage),
                  avgMonthlyUsage: new Prisma.Decimal(line.avgMonthlyUsage),
                  sortOrder: index,
                })),
              }
            : undefined,
      },
      include: {
        customer: { select: { id: true, name: true, company: true } },
        suppliers: { select: { id: true, name: true } },
        accountLines: { orderBy: { sortOrder: "asc" } },
      },
    });

    return NextResponse.json(created);
  } catch (err) {
    console.error("RFP draft save error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save draft" },
      { status: 500 }
    );
  }
}

function parseOptionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonEmptyString(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function isPriceUnit(value: unknown): value is PriceUnit {
  return typeof value === "string" && value in PriceUnit;
}

function normalizeRequestedTerms(requestedTerms: unknown, customTermMonths: unknown) {
  const normalized: Array<{ kind: "months"; months: number } | { kind: "nymex" }> = [];
  const seen = new Set<string>();

  if (Array.isArray(requestedTerms)) {
    for (const entry of requestedTerms) {
      if (entry === "NYMEX") {
        if (!seen.has("NYMEX")) {
          normalized.push({ kind: "nymex" });
          seen.add("NYMEX");
        }
        continue;
      }
      const months = Number.parseInt(String(entry), 10);
      if (Number.isFinite(months) && months > 0) {
        const key = `M:${months}`;
        if (!seen.has(key)) {
          normalized.push({ kind: "months", months });
          seen.add(key);
        }
      }
    }
  }

  const customRaw = String(customTermMonths ?? "").trim();
  if (customRaw) {
    for (const part of customRaw.split(/[,;]+/).map((s) => s.trim()).filter(Boolean)) {
      const customMonths = Number.parseInt(part, 10);
      if (Number.isFinite(customMonths) && customMonths > 0) {
        const key = `M:${customMonths}`;
        if (!seen.has(key)) {
          normalized.push({ kind: "months", months: customMonths });
          seen.add(key);
        }
      }
    }
  }

  return normalized.sort((a, b) => {
    if (a.kind === "nymex") return 1;
    if (b.kind === "nymex") return -1;
    return a.months - b.months;
  });
}

function normalizeAccountLines(accountLines: unknown) {
  if (!Array.isArray(accountLines)) return [];

  return accountLines
    .map((line) => {
      const accountNumber = String((line as Record<string, unknown>)?.accountNumber ?? "").trim();
      const annualUsage = Number((line as Record<string, unknown>)?.annualUsage);
      const avgMonthlyUsage = Number((line as Record<string, unknown>)?.avgMonthlyUsage);
      const serviceAddress = nonEmptyString((line as Record<string, unknown>)?.serviceAddress);

      if (!accountNumber || !Number.isFinite(annualUsage) || !Number.isFinite(avgMonthlyUsage)) {
        return null;
      }

      return {
        accountNumber,
        annualUsage,
        avgMonthlyUsage,
        serviceAddress,
      };
    })
    .filter(
      (line): line is {
        accountNumber: string;
        annualUsage: number;
        avgMonthlyUsage: number;
        serviceAddress: string | null;
      } => Boolean(line)
    );
}
