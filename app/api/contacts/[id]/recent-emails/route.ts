import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { extractEmailFromHeader } from "@/lib/email-header";
import { getGmailClient } from "@/lib/gmail";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/contacts/[id]/recent-emails
 * Returns last 3 emails involving this contact (by parsed address match and supplier link).
 * Tries local DB first; if empty, fetches from Gmail API.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const contact = await prisma.contact.findUnique({
      where: { id },
      include: { emails: true, supplier: { select: { email: true } } },
    });
    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    const contactEmails = new Set<string>();
    for (const e of contact.emails) {
      const a = e.email.toLowerCase().trim();
      if (a) contactEmails.add(a);
    }
    if (contact.email) {
      const a = contact.email.toLowerCase().trim();
      if (a) contactEmails.add(a);
    }
    if (contact.supplier?.email) {
      const a = contact.supplier.email.toLowerCase().trim();
      if (a) contactEmails.add(a);
    }

    const addrs = [...contactEmails];
    const whereParts: Prisma.Sql[] = [];
    if (addrs.length > 0) {
      whereParts.push(Prisma.sql`(
        LOWER(TRIM(COALESCE(NULLIF(TRIM(SUBSTRING(from_address FROM '<([^>]+)>')), ''), TRIM(from_address)))) IN (${Prisma.join(addrs)})
        OR EXISTS (
          SELECT 1 FROM unnest(to_addresses) AS u(addr)
          WHERE LOWER(TRIM(COALESCE(NULLIF(TRIM(SUBSTRING(addr FROM '<([^>]+)>')), ''), TRIM(addr)))) IN (${Prisma.join(addrs)})
        )
      )`);
    }
    if (contact.supplierId) {
      whereParts.push(Prisma.sql`supplier_id = ${contact.supplierId}`);
    }

    let emails: Array<{ id: string; subject: string; sentAt: string; direction?: string }> = [];

    if (whereParts.length > 0) {
      const whereSql =
        whereParts.length === 1 ? whereParts[0] : Prisma.sql`${whereParts[0]} OR ${whereParts[1]}`;

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
        WHERE ${whereSql}
        ORDER BY sent_at DESC
        LIMIT 50
      `);

      const want = contactEmails;
      const filtered = dbRows.filter((row) => {
        if (contact.supplierId && row.supplier_id === contact.supplierId) return true;
        if (want.size === 0) return false;
        const from = extractEmailFromHeader(row.from_address);
        if (from && want.has(from)) return true;
        for (const to of row.to_addresses || []) {
          if (want.has(extractEmailFromHeader(to))) return true;
        }
        return false;
      });

      emails = filtered.slice(0, 3).map((e) => ({
        id: e.message_id?.trim() || e.id,
        subject: e.subject || "(no subject)",
        sentAt: e.sent_at.toISOString(),
        direction: e.direction,
      }));
    }

    if (addrs.length > 0 && emails.length === 0) {
      try {
        const gmail = await getGmailClient();
        const q = addrs.map((e) => "from:" + e + " OR to:" + e).join(" OR ");
        const res = await gmail.users.messages.list({
          userId: "me",
          maxResults: 3,
          q,
        });
        const messages = res.data.messages || [];
        for (const m of messages) {
          if (!m.id) continue;
          const msg = await gmail.users.messages.get({
            userId: "me",
            id: m.id,
            format: "metadata",
            metadataHeaders: ["Subject", "Date"],
          });
          const headers = (msg.data.payload?.headers || []).reduce(
            (acc: Record<string, string>, h) => {
              if (h.name && h.value) acc[h.name.toLowerCase()] = h.value;
              return acc;
            },
            {}
          );
          emails.push({
            id: m.id,
            subject: headers.subject || "(no subject)",
            sentAt: headers.date || new Date().toISOString(),
          });
        }
      } catch {
        // Gmail fallback failed (e.g. not connected); return empty
      }
    }

    return NextResponse.json(emails);
  } catch (error) {
    console.error("Recent emails error:", error);
    return NextResponse.json(
      { error: "Failed to fetch recent emails" },
      { status: 500 }
    );
  }
}
