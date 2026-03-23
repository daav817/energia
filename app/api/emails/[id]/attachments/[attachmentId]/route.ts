import { NextRequest, NextResponse } from "next/server";
import { getGmailClient } from "@/lib/gmail";

/**
 * GET /api/emails/[id]/attachments/[attachmentId]
 * Stream a single attachment from Gmail
 *
 * Query params (optional, for nicer headers):
 * - filename: string
 * - mimeType: string
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  try {
    const { id, attachmentId } = await params;
    const gmail = await getGmailClient();

    const res = await gmail.users.messages.attachments.get({
      userId: "me",
      messageId: id,
      id: attachmentId,
    });

    const raw = res.data.data;
    if (!raw) {
      return NextResponse.json({ error: "Attachment data not found" }, { status: 404 });
    }

    // Decode base64url payload into bytes without Node Buffer typing dependency.
    const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));

    const url = new URL(request.url);
    const filename = url.searchParams.get("filename") || "attachment";
    const mimeType = url.searchParams.get("mimeType") || "application/octet-stream";

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": bytes.length.toString(),
        // Use inline so browsers can preview (PDF/images) but still allow saving
        "Content-Disposition": `inline; filename="${filename.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  } catch (err) {
    console.error("Get attachment error:", err);
    const message = err instanceof Error ? err.message : "Failed to get attachment";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

