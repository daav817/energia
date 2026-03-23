import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { EnergyType, PriceUnit, Prisma } from "@/generated/prisma/client";

/**
 * Parse contract rate string: strip "/" and trailing letters (e.g. "0.05/mcf" -> rate 0.05, suffix "mcf").
 * Suffix mcf, ccf, dth -> Natural Gas. kwh -> Electric.
 */
function parseContractRateAndUsage(raw: string): { rate: number | null; priceUnit: PriceUnit; energyType: EnergyType } {
  const s = String(raw).trim();
  const slash = s.indexOf("/");
  let rateStr = s;
  let suffix = "";
  if (slash >= 0) {
    rateStr = s.slice(0, slash).trim();
    suffix = s.slice(slash + 1).trim().toLowerCase().replace(/[^a-z]/g, "");
  }
  const rate = parseFloat(String(rateStr).replace(/[,$]/g, ""));
  const n = isNaN(rate) ? null : rate;
  if (suffix === "kwh") {
    return { rate: n, priceUnit: PriceUnit.KWH, energyType: EnergyType.ELECTRIC };
  }
  if (suffix === "mcf" || suffix === "ccf" || suffix === "dth") {
    const unit = suffix === "ccf" ? PriceUnit.CCF : suffix === "dth" ? PriceUnit.DTH : PriceUnit.MCF;
    return { rate: n, priceUnit: unit, energyType: EnergyType.NATURAL_GAS };
  }
  return { rate: n, priceUnit: PriceUnit.MCF, energyType: EnergyType.NATURAL_GAS };
}

export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch (parseErr) {
      const msg = parseErr instanceof Error ? parseErr.message : "Invalid JSON";
      return NextResponse.json(
        { error: `Request body could not be parsed: ${msg}. If your file is very large, try importing in smaller batches.` },
        { status: 400 }
      );
    }
    const { rows, columnMap } = body as {
      rows: Record<string, string>[];
      columnMap: Record<string, string>;
    };

    if (!Array.isArray(rows) || !columnMap || typeof columnMap !== "object") {
      return NextResponse.json(
        { error: "rows and columnMap are required" },
        { status: 400 }
      );
    }

    const getVal = (row: Record<string, string>, field: string): string => {
      const col = columnMap[field];
      if (!col) return "";
      const val = row[col];
      return typeof val === "string" ? val.trim() : "";
    };

    const parseDate = (s: string): Date | null => {
      if (!s) return null;
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    };

    const parseNum = (s: string): number | null => {
      if (!s) return null;
      const n = parseFloat(String(s).replace(/[,$]/g, ""));
      return isNaN(n) ? null : n;
    };

    const created: { customers: number; suppliers: number; contracts: number } = {
      customers: 0,
      suppliers: 0,
      contracts: 0,
    };

    const customerCache = new Map<string, string>();
    const supplierCache = new Map<string, string>();
    const contactCache = new Map<string, string>();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      const companyVal = getVal(row, "company") || getVal(row, "customer");
      const supplierVal = getVal(row, "supplier");
      if (!companyVal || !supplierVal) continue;

      let customerId = customerCache.get(companyVal);
      if (!customerId) {
        const existing = await prisma.customer.findFirst({
          where: {
            OR: [
              { name: { equals: companyVal, mode: "insensitive" } },
              { company: { equals: companyVal, mode: "insensitive" } },
            ],
          },
        });
        if (existing) {
          customerId = existing.id;
        } else {
          const createdCustomer = await prisma.customer.create({
            data: {
              name: companyVal,
              company: companyVal,
            },
          });
          customerId = createdCustomer.id;
          created.customers++;
        }
        customerCache.set(companyVal, customerId);
      }

      let supplierId = supplierCache.get(supplierVal);
      if (!supplierId) {
        const existing = await prisma.supplier.findFirst({
          where: { name: { equals: supplierVal, mode: "insensitive" } },
        });
        if (existing) {
          supplierId = existing.id;
        } else {
          const createdSupplier = await prisma.supplier.create({
            data: {
              name: supplierVal,
              isElectric: false,
              isNaturalGas: true,
            },
          });
          supplierId = createdSupplier.id;
          created.suppliers++;
        }
        supplierCache.set(supplierVal, supplierId);
      }

      const contractRateRaw = getVal(row, "contractRate") || getVal(row, "pricePerUnit") || getVal(row, "rate");
      // When Contract Rate contains "/" (e.g. "0.05/mcf", "0.12/dth"), strip suffix and use it as Usage Type (priceUnit).
      // Ignore the Usage Type column for that row.
      const usageTypeColumn = getVal(row, "usageType") || getVal(row, "priceUnit") || "";
      let priceUnit: PriceUnit = PriceUnit.MCF;
      let energyType: EnergyType = EnergyType.NATURAL_GAS;
      let pricePerUnit: number | null = null;

      if (contractRateRaw && contractRateRaw.includes("/")) {
        const parsed = parseContractRateAndUsage(contractRateRaw);
        pricePerUnit = parsed.rate;
        priceUnit = parsed.priceUnit; // from suffix: mcf, ccf, dth, kwh — Usage Type column ignored
        energyType = parsed.energyType;
      } else {
        pricePerUnit = parseNum(contractRateRaw);
        const energyTypeRaw = (getVal(row, "contractType") || getVal(row, "energyType") || usageTypeColumn || "NATURAL_GAS").toUpperCase();
        energyType = energyTypeRaw.includes("ELECTRIC") || energyTypeRaw.includes("KWH") || energyTypeRaw === "ELEC"
          ? EnergyType.ELECTRIC
          : EnergyType.NATURAL_GAS;
        const usageTypeRaw = usageTypeColumn.toUpperCase();
        if (usageTypeRaw.includes("KWH") || energyType === EnergyType.ELECTRIC) {
          priceUnit = PriceUnit.KWH;
        } else if (usageTypeRaw.includes("CCF")) {
          priceUnit = PriceUnit.CCF;
        } else if (usageTypeRaw.includes("DTH")) {
          priceUnit = PriceUnit.DTH;
        }
      }

      const startDate = parseDate(getVal(row, "startDate"));
      const expirationDate = parseDate(getVal(row, "endDate") || getVal(row, "expirationDate"));
      const termMonths = parseNum(getVal(row, "termMonths") || getVal(row, "contractLength")) ?? 12;

      if (!startDate || !expirationDate || pricePerUnit == null) continue;

      const notesVal = getVal(row, "notes");
      if (notesVal) {
        await prisma.customer.update({
          where: { id: customerId },
          data: { notes: notesVal },
        });
      }

      const isExpired = expirationDate < today;
      const status = isExpired ? "archived" : "active";

      const finalPriceUnit = priceUnit ?? PriceUnit.MCF;

      let mainContactId: string | null = null;
      const mainContactVal = getVal(row, "mainContact");
      if (mainContactVal) {
        const cacheKey = mainContactVal.toLowerCase().trim();
        mainContactId = contactCache.get(cacheKey) ?? null;
        if (!mainContactId) {
          const existingContact = await prisma.contact.findFirst({
            where: {
              OR: [
                { name: { equals: mainContactVal, mode: "insensitive" } },
                { email: { equals: mainContactVal, mode: "insensitive" } },
              ],
            },
          });
          if (existingContact) {
            mainContactId = existingContact.id;
          } else {
            const newContact = await prisma.contact.create({
              data: { name: mainContactVal, source: "local" },
            });
            mainContactId = newContact.id;
          }
          contactCache.set(cacheKey, mainContactId);
        }
      }

      await prisma.contract.create({
        data: {
          customerId,
          supplierId,
          mainContactId,
          energyType,
          priceUnit: finalPriceUnit,
          pricePerUnit: new Prisma.Decimal(pricePerUnit),
          startDate,
          expirationDate,
          termMonths,
          annualUsage: parseNum(getVal(row, "annualUsage")) != null ? new Prisma.Decimal(parseNum(getVal(row, "annualUsage"))!) : null,
          avgMonthlyUsage: parseNum(getVal(row, "avgMonthlyUsage")) != null ? new Prisma.Decimal(parseNum(getVal(row, "avgMonthlyUsage"))!) : null,
          brokerMargin: parseNum(getVal(row, "brokerMargin")) != null ? new Prisma.Decimal(parseNum(getVal(row, "brokerMargin"))!) : null,
          customerUtility: getVal(row, "customerUtility") || null,
          signedDate: parseDate(getVal(row, "signedDate")),
          totalMeters: parseNum(getVal(row, "totalMeters")) ?? null,
          status,
          notes: null,
        },
      });
      created.contracts++;
    }

    return NextResponse.json({
      success: true,
      created,
      message: `Imported ${created.contracts} contract(s). Created ${created.customers} new customer(s) and ${created.suppliers} new supplier(s).`,
    });
  } catch (error) {
    console.error("Contract import error:", error);
    const message = error instanceof Error ? error.message : "Failed to import contracts";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
