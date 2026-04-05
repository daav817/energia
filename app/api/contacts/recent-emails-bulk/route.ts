import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Row = { id: string; subject: string; sentAt: string; direction?: string };

/**
 * POST /api/contacts/recent-emails-bulk
 * Body: { ids: string[] }
 * Returns: { byId: Record<string, Row[]> } — up to 3 recent emails per contact from local DB only.
 * Avoids N per-contact Prisma round-trips when rendering the Contacts table.
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
      for (const e of c.emails) set.add(e.email.toLowerCase());
      if (c.email) set.add(c.email.toLowerCase());
      emailsByContact.set(c.id, set);
    }

    const globalAddrs = new Set<string>();
    for (const s of emailsByContact.values()) for (const a of s) globalAddrs.add(a);
    if (globalAddrs.size === 0) {
      const byId: Record<string, Row[]> = {};
      for (const id of ids) byId[id] = [];
      return NextResponse.json({ byId });
    }

    const addrList = [...globalAddrs];
    const take = Math.min(4000, Math.max(400, ids.length * 25));

    const dbEmails = await prisma.email.findMany({
      where: {
        OR: [{ fromAddress: { in: addrList } }, { toAddresses: { hasSome: addrList } }],
      },
      orderBy: { sentAt: "desc" },
      take,
      select: {
        id: true,
        messageId: true,
        subject: true,
        sentAt: true,
        direction: true,
        fromAddress: true,
        toAddresses: true,
      },
    });

    const matchesContact = (contactId: string, row: (typeof dbEmails)[number]): boolean => {
      const addrs = emailsByContact.get(contactId);
      if (!addrs || addrs.size === 0) return false;
      const from = row.fromAddress?.toLowerCase();
      if (from && addrs.has(from)) return true;
      for (const to of row.toAddresses) {
        if (addrs.has(to.toLowerCase())) return true;
      }
      return false;
    };

    const byId: Record<string, Row[]> = {};
    for (const id of ids) {
      const picked: Row[] = [];
      for (const e of dbEmails) {
        if (!matchesContact(id, e)) continue;
        picked.push({
          id: e.messageId || e.id,
          subject: e.subject || "(no subject)",
          sentAt: e.sentAt.toISOString(),
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
