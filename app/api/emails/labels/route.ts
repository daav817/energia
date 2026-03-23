import { NextRequest, NextResponse } from "next/server";
import { getGmailClient } from "@/lib/gmail";

/**
 * GET /api/emails/labels
 * List Gmail labels (folders)
 */
export async function GET() {
  try {
    const gmail = await getGmailClient();
    const res = await gmail.users.labels.list({ userId: "me" });
    const baseLabels = res.data.labels || [];

    // Fetch full label details so we always get messagesUnread/messagesTotal,
    // which are not guaranteed on the list response.
    const detailed = await Promise.all(
      baseLabels.map(async (l) => {
        try {
          const full = await gmail.users.labels.get({ userId: "me", id: l.id! });
          return full.data;
        } catch {
          return l;
        }
      })
    );

    const labels = detailed.map((l) => ({
      id: l.id!,
      name: l.name!,
      type: l.type,
      messageListVisibility: l.messageListVisibility,
      labelListVisibility: l.labelListVisibility,
      messagesUnread: l.messagesUnread ?? 0,
      messagesTotal: l.messagesTotal ?? 0,
    }));
    return NextResponse.json(labels);
  } catch (err) {
    console.error("List labels error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list labels" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/emails/labels
 * Create a new Gmail label
 * Body: { name: string } - e.g. "Suppliers" or "Suppliers/Subfolder"
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name } = body;
    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const gmail = await getGmailClient();
    const res = await gmail.users.labels.create({
      userId: "me",
      requestBody: {
        name: name.trim(),
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      },
    });
    return NextResponse.json({
      id: res.data.id,
      name: res.data.name,
      type: res.data.type,
    });
  } catch (err) {
    console.error("Create label error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create label" },
      { status: 500 }
    );
  }
}
