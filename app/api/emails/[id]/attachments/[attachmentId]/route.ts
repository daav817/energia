import { NextRequest, NextResponse } from "next/server";
import { getGmailClient } from "@/lib/gmail";
import { fetchGmailAttachmentBytes } from "@/lib/gmail-attachment-bytes";

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
    const bytes = await fetchGmailAttachmentBytes(gmail, id, attachmentId);

    const url = new URL(request.url);
    const filename = url.searchParams.get("filename") || "attachment";
    const mimeType = url.searchParams.get("mimeType") || "application/octet-stream";
    const download = url.searchParams.get("download") === "1" || url.searchParams.get("download") === "true";
    const safeName = filename.replace(/"/g, "");

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": bytes.length.toString(),
        "Content-Disposition": download
          ? `attachment; filename="${safeName}"`
          : `inline; filename="${safeName}"`,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  } catch (err) {
    console.error("Get attachment error:", err);
    const message = err instanceof Error ? err.message : "Failed to get attachment";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

