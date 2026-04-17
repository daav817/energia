import { NextRequest, NextResponse } from "next/server";
import { performEmailAttachmentDriveUpload } from "@/lib/perform-email-attachment-drive-upload";

/**
 * POST /api/emails/attachments/upload-to-drive
 * Body JSON: { messageId, attachmentId, folderId?, folderUrl?, filename?, mimeType? }
 *
 * IDs are in the body so Gmail message / attachment ids are not subject to URL path encoding
 * issues (e.g. encoded slashes breaking proxies or routing).
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const messageId = typeof body.messageId === "string" ? body.messageId : "";
  const attachmentId = typeof body.attachmentId === "string" ? body.attachmentId : "";
  if (!messageId || !attachmentId) {
    return NextResponse.json(
      { error: "Request body must include messageId and attachmentId (Gmail ids)." },
      { status: 400 }
    );
  }
  const folderUrl = typeof body.folderUrl === "string" ? body.folderUrl : "";
  const folderIdRaw = typeof body.folderId === "string" ? body.folderId : "";
  const filename =
    typeof body.filename === "string" && body.filename.trim() ? body.filename.trim() : "attachment";
  const mimeType =
    typeof body.mimeType === "string" && body.mimeType.trim()
      ? body.mimeType.trim()
      : "application/octet-stream";

  return performEmailAttachmentDriveUpload({
    messageId,
    attachmentId,
    folderUrl,
    folderIdRaw,
    filename,
    mimeType,
  });
}
