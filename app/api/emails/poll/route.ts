import { NextRequest, NextResponse } from "next/server";
import { getGmailClient } from "@/lib/gmail";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/emails/poll
 * Lightweight check for new emails - can be called by a cron job or frontend interval
 * Fetches latest messages and returns count of new ones (optionally syncs to DB)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sync = searchParams.get("sync") === "1";

    const gmail = await getGmailClient();
    const res = await gmail.users.messages.list({
      userId: "me",
      maxResults: 10,
      q: "newer_than:1d",
    });

    const messages = res.data.messages || [];
    let newCount: number | undefined;

    if (sync && messages.length > 0) {
      try {
        let count = 0;
        for (const m of messages) {
          if (!m.id) continue;
          const existing = await prisma.email.findUnique({
            where: { messageId: m.id },
          });
          if (!existing) count++;
        }
        newCount = count;
      } catch (dbErr) {
        // Database may not be running or credentials invalid - poll still succeeds
        console.warn("Poll: DB unavailable for sync check:", dbErr);
      }
    }

    return NextResponse.json({
      recentCount: messages.length,
      newInDb: sync ? newCount : undefined,
    });
  } catch (err) {
    console.error("Poll emails error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Poll failed" },
      { status: 500 }
    );
  }
}
