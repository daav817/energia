import { NextRequest, NextResponse } from "next/server";
import { getGmailClient } from "@/lib/gmail";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/emails/sync
 * Fetch new emails from Gmail and store in DB
 * Optionally link to customer/supplier by matching email addresses
 */
export async function POST(request: NextRequest) {
  try {
    const gmail = await getGmailClient();
    const res = await gmail.users.messages.list({
      userId: "me",
      maxResults: 50,
      q: "newer_than:7d",
    });

    const messages = res.data.messages || [];
    let synced = 0;

    for (const m of messages) {
      if (!m.id) continue;

      const existing = await prisma.email.findUnique({
        where: { messageId: m.id },
      });
      if (existing) continue;

      const msg = await gmail.users.messages.get({
        userId: "me",
        id: m.id,
        format: "full",
      });

      const headers = (msg.data.payload?.headers || []).reduce(
        (acc, h) => {
          if (h.name && h.value) acc[h.name.toLowerCase()] = h.value;
          return acc;
        },
        {} as Record<string, string>
      );

      const from = headers.from || "";
      const to = headers.to || "";
      const dateStr = headers.date || new Date().toISOString();
      const sentAt = new Date(dateStr);

      let body = "";
      let bodyHtml = "";
      if (msg.data.payload?.body?.data) {
        body = Buffer.from(msg.data.payload.body.data, "base64").toString("utf-8");
      }
      const parts = msg.data.payload?.parts || [];
      for (const p of parts) {
        if (p.mimeType === "text/plain" && p.body?.data) {
          body = Buffer.from(p.body.data, "base64").toString("utf-8");
          break;
        }
      }
      for (const p of parts) {
        if (p.mimeType === "text/html" && p.body?.data) {
          bodyHtml = Buffer.from(p.body.data, "base64").toString("utf-8");
          break;
        }
      }

      const toAddresses = to.split(",").map((e) => e.trim()).filter(Boolean);
      const fromEmail = extractEmail(from);

      const customer = await prisma.customer.findFirst({
        where: { email: { equals: fromEmail, mode: "insensitive" } },
      });
      const supplier = await prisma.supplier.findFirst({
        where: { email: { equals: fromEmail, mode: "insensitive" } },
      });

      const isRfp = /rfp|request for pricing|request for quote/i.test(
        (headers.subject || "") + body
      );
      const isRfpResponse = /quote|pricing|rate|$/i.test(
        (headers.subject || "") + body
      ) && (supplier !== null || /rate|price|kwh|mcf|ccf/i.test(body));

      await prisma.email.create({
        data: {
          messageId: m.id,
          threadId: msg.data.threadId || undefined,
          direction: "INBOUND",
          subject: headers.subject || undefined,
          body: body.slice(0, 50000),
          bodyHtml: bodyHtml ? bodyHtml.slice(0, 100000) : undefined,
          fromAddress: from,
          toAddresses,
          ccAddresses: [],
          sentAt,
          receivedAt: sentAt,
          customerId: customer?.id,
          supplierId: supplier?.id,
          isRfp,
          isRfpResponse,
        },
      });
      synced++;
    }

    return NextResponse.json({ synced, total: messages.length });
  } catch (err) {
    console.error("Sync emails error:", err);
    const message = err instanceof Error ? err.message : "Failed to sync emails";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function extractEmail(str: string): string {
  const match = str.match(/<([^>]+)>/);
  return match ? match[1].trim().toLowerCase() : str.trim().toLowerCase();
}
