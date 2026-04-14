import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const includeRelations = {
  emails: true,
  phones: true,
  addresses: true,
  significantDates: true,
  relatedPersons: true,
} as const;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const company = searchParams.get("company") || "";
    const supplierId = searchParams.get("supplierId") || "";
    const labelFilter = searchParams.get("labelFilter") || ""; // __all__ | __none__ | substring match on label
    const sort = searchParams.get("sort") || "name";
    const order = searchParams.get("order") || "asc";
    const priorityOnly = searchParams.get("priority") === "true";

    const where: Record<string, unknown> = {};
    if (priorityOnly) {
      where.isPriority = true;
    }

    const andClauses: Record<string, unknown>[] = [];
    if (labelFilter === "__none__") {
      andClauses.push({ OR: [{ label: null }, { label: "" }] });
    } else if (labelFilter && labelFilter !== "__all__") {
      andClauses.push({ label: { contains: labelFilter.trim(), mode: "insensitive" } });
    }
    if (supplierId.trim()) {
      andClauses.push({ supplierId: supplierId.trim() });
    }
    if (company.trim()) {
      andClauses.push({ company: { contains: company.trim(), mode: "insensitive" } });
    }
    if (search.trim()) {
      const term = search.trim();
      andClauses.push({
        OR: [
          { name: { contains: term, mode: "insensitive" } },
          { firstName: { contains: term, mode: "insensitive" } },
          { lastName: { contains: term, mode: "insensitive" } },
          { email: { contains: term, mode: "insensitive" } },
          { phone: { contains: term, mode: "insensitive" } },
          { company: { contains: term, mode: "insensitive" } },
          { jobTitle: { contains: term, mode: "insensitive" } },
          { label: { contains: term, mode: "insensitive" } },
          { notes: { contains: term, mode: "insensitive" } },
          { website: { contains: term, mode: "insensitive" } },
          { phones: { some: { phone: { contains: term, mode: "insensitive" } } } },
          { emails: { some: { email: { contains: term, mode: "insensitive" } } } },
        ],
      });
    }
    if (andClauses.length) {
      where.AND = andClauses;
    }

    const validSort = ["name", "company", "email", "phone", "jobTitle", "label", "notes", "createdAt", "updatedAt"].includes(sort)
      ? sort
      : "name";
    const orderBy = { [validSort]: order as "asc" | "desc" };

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        orderBy,
        include: includeRelations,
      }),
      prisma.contact.count({ where }),
    ]);
    return NextResponse.json({ contacts, total });
  } catch (error) {
    console.error("Contacts fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch contacts" },
      { status: 500 }
    );
  }
}

function buildContactData(body: Record<string, unknown>) {
  const firstName = body.firstName as string | undefined;
  const lastName = body.lastName as string | undefined;
  const name =
    (body.name as string)?.trim() ||
    [firstName, lastName].filter(Boolean).join(" ").trim() ||
    "Unknown";
  const company = (body.company as string)?.trim() || null;
  const jobTitle = (body.jobTitle as string)?.trim() || null;
  const label = (body.label as string)?.trim() || null;
  const website = (body.website as string)?.trim() || null;
  const notes = (body.notes as string)?.trim() || null;

  const emails = (body.emails as Array<{ email: string; type?: string }>) || [];
  const phones = (body.phones as Array<{ phone: string; type?: string; extension?: string | null }>) || [];
  const addresses = (body.addresses as Array<{ street?: string; city?: string; state?: string; zip?: string; type?: string }>) || [];
  const significantDates = (body.significantDates as Array<{ label: string; date: string }>) || [];
  const relatedPersons = (body.relatedPersons as Array<{ name: string; relation?: string }>) || [];

  const primaryEmail = emails[0]?.email?.trim() || (body.email as string)?.trim() || null;
  const primaryPhone = phones[0]?.phone?.trim() || (body.phone as string)?.trim() || null;

  return {
    firstName: firstName?.trim() || null,
    lastName: lastName?.trim() || null,
    name,
    email: primaryEmail,
    phone: primaryPhone,
    company,
    jobTitle,
    label,
    website,
    notes,
    customerId:
      body.customerId === null || body.customerId === undefined || body.customerId === ""
        ? null
        : String(body.customerId),
    supplierId:
      body.supplierId === null || body.supplierId === undefined || body.supplierId === ""
        ? null
        : String(body.supplierId),
    emails,
    phones,
    addresses,
    significantDates,
    relatedPersons,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = buildContactData(body);

    if (!data.name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const contact = await prisma.contact.create({
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        name: data.name,
        email: data.email,
        phone: data.phone,
        company: data.company,
        jobTitle: data.jobTitle,
        label: data.label,
        website: data.website,
        notes: data.notes,
        customerId: data.customerId,
        supplierId: data.supplierId,
        source: "local",
        addedToContactsAt: new Date(),
        emails: {
          create: data.emails
            .filter((e) => e?.email?.trim())
            .map((e, i) => ({ email: e.email.trim(), type: e.type || "work", order: i })),
        },
        phones: {
          create: data.phones
            .filter((p) => p?.phone?.trim())
            .map((p, i) => ({
              phone: p.phone.trim(),
              extension: p.extension != null && String(p.extension).trim() ? String(p.extension).trim() : null,
              type: p.type || "work",
              order: i,
            })),
        },
        addresses: {
          create: data.addresses
            .filter((a) => a?.street || a?.city || a?.zip)
            .map((a, i) => ({
              street: a.street?.trim() || null,
              city: a.city?.trim() || null,
              state: a.state?.trim() || null,
              zip: a.zip?.trim() || null,
              type: a.type || "work",
              order: i,
            })),
        },
        significantDates: {
          create: data.significantDates
            .filter((d) => d?.label && d?.date)
            .map((d, i) => ({
              label: d.label,
              date: new Date(d.date),
              order: i,
            })),
        },
        relatedPersons: {
          create: data.relatedPersons
            .filter((r) => r?.name?.trim())
            .map((r, i) => ({
              name: r.name.trim(),
              relation: r.relation?.trim() || null,
              order: i,
            })),
        },
      },
      include: includeRelations,
    });
    return NextResponse.json(contact);
  } catch (error) {
    console.error("Contact create error:", error);
    return NextResponse.json(
      { error: "Failed to create contact" },
      { status: 500 }
    );
  }
}
