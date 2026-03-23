import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getGmailClient } from "@/lib/gmail";

/**
 * GET /api/contacts/[id]/recent-emails
 * Returns last 3 emails involving this contact (by email address match).
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
      include: { emails: true },
    });
    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    const contactEmails = [
      ...(contact.emails.map((e) => e.email.toLowerCase())),
      ...(contact.email ? [contact.email.toLowerCase()] : []),
    ].filter(Boolean);
    if (contactEmails.length === 0) {
      return NextResponse.json([]);
    }

    let emails: Array<{ id: string; subject: string; sentAt: string; direction?: string }> = [];

    const dbEmails = await prisma.email.findMany({
      where: {
        OR: [
          { fromAddress: { in: contactEmails } },
          { toAddresses: { hasSome: contactEmails } },
        ],
      },
      orderBy: { sentAt: "desc" },
      take: 3,
      select: { id: true, messageId: true, subject: true, sentAt: true, direction: true },
    });
    emails = dbEmails.map((e) => ({
      id: e.messageId || e.id,
      subject: e.subject || "(no subject)",
      sentAt: e.sentAt.toISOString(),
      direction: e.direction,
    }));

    if (emails.length === 0) {
      try {
        const gmail = await getGmailClient();
        const q = contactEmails.map((e) => "from:" + e + " OR to:" + e).join(" OR ");
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
