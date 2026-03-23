import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const includeRelations = {
  emails: true,
  phones: true,
  addresses: true,
  significantDates: true,
  relatedPersons: true,
} as const;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const contact = await prisma.contact.findUnique({
      where: { id },
      include: includeRelations,
    });
    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }
    return NextResponse.json(contact);
  } catch (error) {
    console.error("Contact fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch contact" },
      { status: 500 }
    );
  }
}

function buildUpdateData(body: Record<string, unknown>) {
  const firstName = body.firstName as string | undefined;
  const lastName = body.lastName as string | undefined;
  const name =
    (body.name as string)?.trim() ||
    [firstName, lastName].filter(Boolean).join(" ").trim();
  const emails = body.emails as Array<{ email: string; type?: string }> | undefined;
  const phones = body.phones as Array<{ phone: string; type?: string }> | undefined;
  const addresses = body.addresses as Array<{ street?: string; city?: string; state?: string; zip?: string; type?: string }> | undefined;
  const significantDates = body.significantDates as Array<{ label: string; date: string }> | undefined;
  const relatedPersons = body.relatedPersons as Array<{ name: string; relation?: string }> | undefined;

  const base: Record<string, unknown> = {};
  if (firstName != null) base.firstName = firstName?.trim() || null;
  if (lastName != null) base.lastName = lastName?.trim() || null;
  if (name) base.name = name;
  if (body.email != null) base.email = (body.email as string)?.trim() || null;
  if (body.phone != null) base.phone = (body.phone as string)?.trim() || null;
  if (body.company != null) base.company = (body.company as string)?.trim() || null;
  if (body.jobTitle != null) base.jobTitle = (body.jobTitle as string)?.trim() || null;
  if (body.label != null) base.label = (body.label as string)?.trim() || null;
  if (body.website != null) base.website = (body.website as string)?.trim() || null;
  if (body.notes != null) base.notes = (body.notes as string)?.trim() || null;
  if (body.isPriority != null) base.isPriority = !!body.isPriority;
  if (body.customerId !== undefined) {
    base.customerId =
      body.customerId === null || body.customerId === ""
        ? null
        : String(body.customerId);
  }
  if (body.supplierId !== undefined) {
    base.supplierId =
      body.supplierId === null || body.supplierId === ""
        ? null
        : String(body.supplierId);
  }

  return { base, emails, phones, addresses, significantDates, relatedPersons };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { base, emails, phones, addresses, significantDates, relatedPersons } =
      buildUpdateData(body);

    const updateData: Record<string, unknown> = { ...base };

    // Keep directory classification consistent with Contact.label.
    // We only clear the opposite side here; re-linking to the correct Customer/Supplier
    // record is handled by the directory sync / contract linking logic.
    if (base.label !== undefined) {
      const labelLower = String(base.label ?? "").toLowerCase();
      const wantsCustomer = labelLower.includes("customer");
      const wantsSupplier = labelLower.includes("supplier");

      if (!wantsCustomer) updateData.customerId = null;
      if (!wantsSupplier) updateData.supplierId = null;
    }

    if (emails !== undefined) {
      const emailList = Array.isArray(emails) ? emails : [];
      updateData.emails = {
        deleteMany: {},
        create: emailList
          .filter((e) => e?.email?.trim())
          .map((e, i) => ({ email: e.email.trim(), type: e.type || "work", order: i })),
      };
    }
    if (phones !== undefined) {
      const phoneList = Array.isArray(phones) ? phones : [];
      updateData.phones = {
        deleteMany: {},
        create: phoneList
          .filter((p) => p?.phone?.trim())
          .map((p, i) => ({ phone: p.phone.trim(), type: p.type || "work", order: i })),
      };
    }
    if (addresses !== undefined) {
      const addressList = Array.isArray(addresses) ? addresses : [];
      updateData.addresses = {
        deleteMany: {},
        create: addressList
          .filter((a) => a?.street || a?.city || a?.zip)
          .map((a, i) => ({
            street: a.street?.trim() || null,
            city: a.city?.trim() || null,
            state: a.state?.trim() || null,
            zip: a.zip?.trim() || null,
            type: a.type || "work",
            order: i,
          })),
      };
    }
    if (significantDates !== undefined) {
      const dateList = Array.isArray(significantDates) ? significantDates : [];
      updateData.significantDates = {
        deleteMany: {},
        create: dateList
          .filter((d) => d?.label && d?.date)
          .map((d, i) => ({ label: d.label, date: new Date(d.date), order: i }))
          .filter((d) => !isNaN(d.date.getTime())),
      };
    }
    if (relatedPersons !== undefined) {
      const personList = Array.isArray(relatedPersons) ? relatedPersons : [];
      updateData.relatedPersons = {
        deleteMany: {},
        create: personList
          .filter((r) => r?.name?.trim())
          .map((r, i) => ({
            name: r.name.trim(),
            relation: r.relation?.trim() || null,
            order: i,
          })),
      };
    }

    const contact = await prisma.contact.update({
      where: { id },
      data: updateData,
      include: includeRelations,
    });
    return NextResponse.json(contact);
  } catch (error) {
    console.error("Contact update error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to update contact";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.contact.delete({
      where: { id },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Contact delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete contact" },
      { status: 500 }
    );
  }
}
