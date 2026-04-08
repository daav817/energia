import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

type Row = { id: string; subject: string; sentAt: string; direction?: string };

/**
 * POST /api/contacts/recent-emails-bulk
 * Body: { ids: string[] }
 * Returns: { byId: Record<string, Row[]> } — up to 3 recent emails per contact from local DB only.
 * Address matching is case-insensitive so rows match stored Gmail/local addresses reliably.
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
      include: { emails: true },
    });

    const emailsByContact = new Map<string, Set<string>>();
    for (const c of contacts) {
      const set = new Set<string>();
      for (const e of c.emails) set.add(e.email.toLowerCase().trim());
      if (c.email) set.add(c.email.toLowerCase().trim());
      emailsByContact.set(c.id, set);
    }

    const globalAddrs = new Set<string>();
    for (const s of emailsByContact.values()) for (const a of s) {
      if (a) globalAddrs.add(a);
    }
    if (globalAddrs.size === 0) {
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
      }>
    >(Prisma.sql`
      SELECT id, message_id, subject, sent_at, direction::text, from_address, to_addresses
      FROM emails
      WHERE LOWER(TRIM(from_address)) IN (${Prisma.join(addrs)})
         OR EXISTS (
           SELECT 1 FROM unnest(to_addresses) AS u(addr)
           WHERE LOWER(TRIM(addr)) IN (${Prisma.join(addrs)})
         )
      ORDER BY sent_at DESC
      LIMIT ${take}
    `);

    const matchesContact = (contactId: string, row: (typeof dbRows)[number]): boolean => {
      const want = emailsByContact.get(contactId);
      if (!want || want.size === 0) return false;
      const from = row.from_address?.toLowerCase().trim();
      if (from && want.has(from)) return true;
      for (const to of row.to_addresses || []) {
        if (want.has(to.toLowerCase().trim())) return true;
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
