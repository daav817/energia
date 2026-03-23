import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/contacts/suggest?q=...
 * Returns email suggestions from customers, suppliers, supplier contacts, and contacts
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") || "").trim().toLowerCase();
    const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 50);

    if (!q || q.length < 2) {
      return NextResponse.json([]);
    }

    const [customers, suppliers, supplierContacts, contacts] = await Promise.all([
      prisma.customer.findMany({
        where: {
          OR: [
            { email: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
          ],
          email: { not: null },
        },
        select: { name: true, email: true },
        take: limit,
      }),
      prisma.supplier.findMany({
        where: {
          OR: [
            { email: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
          ],
          email: { not: null },
        },
        select: { name: true, email: true },
        take: limit,
      }),
      prisma.supplierContact.findMany({
        where: {
          OR: [
            { email: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
          ],
          email: { not: null },
        },
        select: { name: true, email: true },
        take: limit,
      }),
      prisma.contact.findMany({
        where: {
          OR: [
            { email: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
          ],
          email: { not: null },
        },
        select: { name: true, email: true },
        take: limit,
      }),
    ]);

    const seen = new Set<string>();
    const results: { name: string; email: string; source?: string }[] = [];

    for (const c of customers) {
      if (c.email && !seen.has(c.email.toLowerCase())) {
        seen.add(c.email.toLowerCase());
        results.push({ name: c.name, email: c.email, source: "Customer" });
      }
    }
    for (const s of suppliers) {
      if (s.email && !seen.has(s.email.toLowerCase())) {
        seen.add(s.email.toLowerCase());
        results.push({ name: s.name, email: s.email, source: "Supplier" });
      }
    }
    for (const sc of supplierContacts) {
      if (sc.email && !seen.has(sc.email.toLowerCase())) {
        seen.add(sc.email.toLowerCase());
        results.push({ name: sc.name, email: sc.email, source: "Supplier Contact" });
      }
    }
    for (const c of contacts) {
      if (c.email && !seen.has(c.email.toLowerCase())) {
        seen.add(c.email.toLowerCase());
        results.push({ name: c.name, email: c.email, source: "Contact" });
      }
    }

    return NextResponse.json(results.slice(0, limit));
  } catch (error) {
    console.error("Suggest error:", error);
    return NextResponse.json(
      { error: "Failed to fetch suggestions" },
      { status: 500 }
    );
  }
}
