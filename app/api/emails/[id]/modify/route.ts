import { NextRequest, NextResponse } from "next/server";
import { getGmailClient } from "@/lib/gmail";

/**
 * POST /api/emails/[id]/modify
 * Modify email: add/remove labels, trash, untrash, mark read/unread
 * Body: { addLabelIds?: string[], removeLabelIds?: string[], trash?: boolean, untrash?: boolean }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { addLabelIds, removeLabelIds, trash, untrash } = body;

    const gmail = await getGmailClient();

    if (trash) {
      await gmail.users.messages.trash({ userId: "me", id });
      return NextResponse.json({ success: true, trashed: true });
    }
    if (untrash) {
      await gmail.users.messages.untrash({ userId: "me", id });
      return NextResponse.json({ success: true, untrashed: true });
    }

    const update: { addLabelIds?: string[]; removeLabelIds?: string[] } = {};
    if (addLabelIds?.length) update.addLabelIds = addLabelIds;
    if (removeLabelIds?.length) update.removeLabelIds = removeLabelIds;

    if (!update.addLabelIds?.length && !update.removeLabelIds?.length) {
      return NextResponse.json(
        { error: "Provide addLabelIds, removeLabelIds, trash, or untrash" },
        { status: 400 }
      );
    }

    const res = await gmail.users.messages.modify({
      userId: "me",
      id,
      requestBody: update,
    });

    return NextResponse.json({
      success: true,
      labelIds: res.data.labelIds,
    });
  } catch (err) {
    console.error("Modify email error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to modify email" },
      { status: 500 }
    );
  }
}
