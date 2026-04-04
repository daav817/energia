import { NextRequest, NextResponse } from "next/server";
import { mergeContactsForSupplier } from "@/lib/supplier-rfp-contacts";
import { prisma } from "@/lib/prisma";

type EnergyFilter = "electric" | "gas" | "both" | "all";

function buildWhere(filter: EnergyFilter) {
  if (filter === "all") return {};
  if (filter === "electric") return { isElectric: true };
  if (filter === "gas") return { isNaturalGas: true };
  if (filter === "both") return { isElectric: true, isNaturalGas: true };
  return {};
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const filter = (searchParams.get("filter") || "all") as EnergyFilter;
    const search = searchParams.get("search") || "";
    const withContacts = searchParams.get("contacts") === "1";

    const where: Record<string, unknown> = buildWhere(filter);
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ];
    }

    const suppliers = await prisma.supplier.findMany({
      where,
      orderBy: { name: "asc" },
    });

    if (!withContacts) {
      return NextResponse.json(suppliers);
    }

    const supplierIds = suppliers.map((s) => s.id);
    const contactPool =
      supplierIds.length === 0
        ? []
        : await prisma.contact.findMany({
            where: {
              OR: [
                { supplierId: { in: supplierIds } },
                { label: { contains: "supplier", mode: "insensitive" } },
                { label: { contains: "vendor", mode: "insensitive" } },
              ],
            },
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              company: true,
              supplierId: true,
              label: true,
              isPriority: true,
              emails: { orderBy: { order: "asc" }, select: { email: true } },
            },
          });

    const suppliersWithContacts = suppliers.map((supplier) => ({
      ...supplier,
      contactLinks: mergeContactsForSupplier(supplier, contactPool),
    }));

    return NextResponse.json(suppliersWithContacts);
  } catch (error) {
    console.error("Suppliers fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch suppliers" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      name,
      email,
      phone,
      website,
      address,
      city,
      state,
      zip,
      notes,
      isElectric,
      isNaturalGas,
    } = body;

    if (!name) {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      );
    }

    const supplier = await prisma.supplier.create({
      data: {
        name,
        email: email || null,
        phone: phone || null,
        website: website || null,
        address: address || null,
        city: city || null,
        state: state || null,
        zip: zip || null,
        notes: notes || null,
        isElectric: Boolean(isElectric),
        isNaturalGas: Boolean(isNaturalGas),
      },
    });
    return NextResponse.json(supplier);
  } catch (error) {
    console.error("Supplier create error:", error);
    return NextResponse.json(
      { error: "Failed to create supplier" },
      { status: 500 }
    );
  }
}
