import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function collectContactEmails(
  contacts: Array<{ email: string | null; emails: Array<{ email: string }> }>
): string[] {
  const out: string[] = [];
  for (const c of contacts) {
    const legacy = c.email?.trim();
    if (legacy) out.push(legacy);
    for (const row of c.emails) {
      const em = row.email?.trim();
      if (em) out.push(em);
    }
  }
  return out;
}

/**
 * GET /api/rfp/[id]/supplier-inbox-emails?supplierId=optional
 * Unique emails for Gmail `from:` filters: supplier directory row + selected supplier contact(s).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supplierIdFilter = new URL(request.url).searchParams.get("supplierId")?.trim() || "";

    const rfp = await prisma.rfpRequest.findUnique({
      where: { id },
      select: {
        supplierContactSelections: true,
        suppliers: { select: { id: true, email: true } },
      },
    });
    if (!rfp) {
      return NextResponse.json({ error: "RFP not found" }, { status: 404 });
    }

    const selections =
      rfp.supplierContactSelections && typeof rfp.supplierContactSelections === "object" && !Array.isArray(rfp.supplierContactSelections)
        ? (rfp.supplierContactSelections as Record<string, string>)
        : {};

    const emails = new Set<string>();

    if (supplierIdFilter) {
      const s = rfp.suppliers.find((x) => x.id === supplierIdFilter);
      const rowEmail = s?.email?.trim();
      if (rowEmail) emails.add(rowEmail);
      const cid = selections[supplierIdFilter]?.trim();
      if (cid) {
        const contacts = await prisma.contact.findMany({
          where: { id: cid },
          select: { email: true, emails: { select: { email: true } } },
        });
        for (const em of collectContactEmails(contacts)) emails.add(em);
      }
    } else {
      for (const s of rfp.suppliers) {
        const e = s.email?.trim();
        if (e) emails.add(e);
      }
      const ids = [
        ...new Set(Object.values(selections).map((v) => String(v ?? "").trim()).filter(Boolean)),
      ];
      if (ids.length > 0) {
        const contacts = await prisma.contact.findMany({
          where: { id: { in: ids } },
          select: { email: true, emails: { select: { email: true } } },
        });
        for (const em of collectContactEmails(contacts)) emails.add(em);
      }
    }

    return NextResponse.json({ emails: [...emails].sort((a, b) => a.localeCompare(b)) });
  } catch (err) {
    console.error("supplier-inbox-emails", err);
    return NextResponse.json({ error: "Failed to resolve supplier emails" }, { status: 500 });
  }
}
