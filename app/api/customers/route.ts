import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const withContracts = searchParams.get("contracts") === "1";
    const withContacts = searchParams.get("contacts") === "1";

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { company: { contains: search, mode: "insensitive" } },
        {
          contracts: {
            some: {
              mainContact: {
                is: {
                  OR: [
                    { name: { contains: search, mode: "insensitive" } },
                    { email: { contains: search, mode: "insensitive" } },
                  ],
                },
              },
            },
          },
        },
      ];
    }

    const include: any = {};
    if (withContracts) {
      include.contracts = {
        select: {
          id: true,
          energyType: true,
          expirationDate: true,
          status: true,
          mainContactId: true,
          mainContact: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              label: true,
            },
          },
        },
      };
    }
    if (withContacts) {
      include.contacts = {
        select: { id: true, name: true, email: true, phone: true, isPriority: true, label: true },
      };
    }

    const customers = await prisma.customer.findMany({
      where,
      orderBy: { name: "asc" },
      include: Object.keys(include).length ? include : undefined,
    });
    return NextResponse.json(customers);
  } catch (error) {
    console.error("Customers fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch customers" },
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
      company,
      address,
      city,
      state,
      zip,
      notes,
    } = body;

    if (!name) {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      );
    }

    // One unique entry per customer: reuse existing if same name+company
    const trimmedName = name.trim();
    const normalizedCompany = company?.trim() || null;
    const existing = await prisma.customer.findFirst({
      where: {
        name: { equals: trimmedName, mode: "insensitive" },
        ...(normalizedCompany === null
          ? { company: null }
          : { company: { equals: normalizedCompany, mode: "insensitive" } }),
      },
    });
    if (existing) {
      return NextResponse.json(existing);
    }

    const customer = await prisma.customer.create({
      data: {
        name: trimmedName,
        email: email || null,
        phone: phone || null,
        company: normalizedCompany,
        address: address || null,
        city: city || null,
        state: state || null,
        zip: zip || null,
        notes: notes || null,
      },
    });
    return NextResponse.json(customer);
  } catch (error) {
    console.error("Customer create error:", error);
    return NextResponse.json(
      { error: "Failed to create customer" },
      { status: 500 }
    );
  }
}
