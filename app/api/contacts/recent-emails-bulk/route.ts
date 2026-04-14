import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { extractEmailFromHeader } from "@/lib/email-header";
import { prisma } from "@/lib/prisma";

type Row = { id: string; subject: string; sentAt: string; direction?: string };

function buildMatchWhereSql(addrs: string[], supplierIds: string[]): Prisma.Sql | null {
  const parts: Prisma.Sql[] = [];
  if (addrs.length > 0) {
    parts.push(Prisma.sql`(
      LOWER(TRIM(COALESCE(NULLIF(TRIM(SUBSTRING(from_address FROM '<([^>]+)>')), ''), TRIM(from_address)))) IN (${Prisma.join(addrs)})
      OR EXISTS (
        SELECT 1 FROM unnest(to_addresses) AS u(addr)
        WHERE LOWER(TRIM(COALESCE(NULLIF(TRIM(SUBSTRING(addr FROM '<([^>]+)>')), ''), TRIM(addr)))) IN (${Prisma.join(addrs)})
      )
    )`);
  }
  if (supplierIds.length > 0) {
    parts.push(Prisma.sql`supplier_id IN (${Prisma.join(supplierIds)})`);
  }
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return Prisma.sql`${parts[0]} OR ${parts[1]}`;
}

/**
 * POST /api/contacts/recent-emails-bulk
 * Body: { ids: string[] }
 * Returns: { byId: Record<string, Row[]> } — up to 3 recent emails per contact from local DB only.
 * Matches MIME headers (Name <addr>) and links by supplier_id for supplier-linked contacts.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawIds = body.ids;
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return NextResponse.json({ byId: {} });
    }
    const ids = [...new Set(rawIds.map((x: unknown) => String(x)).filter(Boolean))].slice(0, 500);
    if (ids.length === 0) return NextResponse.json({ byId: {} });

    const contacts = await prisma.contact.findMany({
      where: { id: { in: ids } },
      include: { emails: true, supplier: { select: { email: true } } },
    });

    const contactSupplierById = new Map<string, string>();
    const emailsByContact = new Map<string, Set<string>>();
    for (const c of contacts) {
      const set = new Set<string>();
      for (const e of c.emails) {
        const a = e.email.toLowerCase().trim();
        if (a) set.add(a);
      }
      if (c.email) {
        const a = c.email.toLowerCase().trim();
        if (a) set.add(a);
      }
      if (c.supplierId) {
        contactSupplierById.set(c.id, c.supplierId);
        const se = c.supplier?.email?.toLowerCase().trim();
        if (se) set.add(se);
      }
      emailsByContact.set(c.id, set);
    }

    const globalAddrs = new Set<string>();
    for (const s of emailsByContact.values()) for (const a of s) {
      if (a) globalAddrs.add(a);
    }
    const supplierIds = [...new Set([...contactSupplierById.values()])];

    if (globalAddrs.size === 0 && supplierIds.length === 0) {
      const byId: Record<string, Row[]> = {};
      for (const id of ids) byId[id] = [];
      return NextResponse.json({ byId });
    }

    const matchWhere = buildMatchWhereSql([...globalAddrs], supplierIds);
    if (!matchWhere) {
      const byId: Record<string, Row[]> = {};
      for (const id of ids) byId[id] = [];
      return NextResponse.json({ byId });
    }

    const addrs = [...globalAddrs];
    const take = Math.min(4000, Math.max(400, ids.length * 25));

    const dbRows = await prisma.$queryRaw<
      Array<{
        id: string;
        message_id: string | null;
        subject: string | null;
        sent_at: Date;
        direction: string;
        from_address: string;
        to_addresses: string[];
        supplier_id: string | null;
      }>
    >(Prisma.sql`
      SELECT id, message_id, subject, sent_at, direction::text, from_address, to_addresses, supplier_id
      FROM emails
      WHERE ${matchWhere}
      ORDER BY sent_at DESC
      LIMIT ${take}
    `);

    const matchesContact = (contactId: string, row: (typeof dbRows)[number]): boolean => {
      const sid = contactSupplierById.get(contactId);
      if (sid && row.supplier_id === sid) return true;

      const want = emailsByContact.get(contactId);
      if (!want || want.size === 0) return false;

      const from = extractEmailFromHeader(row.from_address);
      if (from && want.has(from)) return true;
      for (const to of row.to_addresses || []) {
        if (want.has(extractEmailFromHeader(to))) return true;
      }
      return false;
    };

    const byId: Record<string, Row[]> = {};
    for (const id of ids) {
      const picked: Row[] = [];
      for (const e of dbRows) {
        if (!matchesContact(id, e)) continue;
        const gmailId = e.message_id?.trim();
        picked.push({
          id: gmailId && gmailId.length > 0 ? gmailId : e.id,
          subject: e.subject || "(no subject)",
          sentAt: e.sent_at.toISOString(),
          direction: e.direction ?? undefined,
        });
        if (picked.length >= 3) break;
      }
      byId[id] = picked;
    }

    return NextResponse.json({ byId });
  } catch (error) {
    console.error("recent-emails-bulk", error);
    return NextResponse.json({ error: "Failed to load recent emails" }, { status: 500 });
  }
}
