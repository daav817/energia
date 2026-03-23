import { NextRequest, NextResponse } from "next/server";
import { getGmailClient } from "@/lib/gmail";

const SYSTEM_LABEL_IDS = ["INBOX", "SENT", "DRAFT", "TRASH", "SPAM", "STARRED", "UNREAD"];

/**
 * DELETE /api/emails/labels/[id]
 * Delete a Gmail label (user-created only, not system labels)
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (SYSTEM_LABEL_IDS.includes(id)) {
      return NextResponse.json(
        { error: "Cannot delete system labels (Inbox, Sent, Trash, etc.)" },
        { status: 400 }
      );
    }
    const gmail = await getGmailClient();
    await gmail.users.labels.delete({ userId: "me", id });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete label error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete label" },
      { status: 500 }
    );
  }
}
