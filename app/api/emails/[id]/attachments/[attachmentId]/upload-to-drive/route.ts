import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { getGmailClient, getGoogleDriveClient } from "@/lib/gmail";
import { fetchGmailAttachmentBytes } from "@/lib/gmail-attachment-bytes";
import { parseDriveFolderId } from "@/lib/parse-drive-folder-id";

/**
 * POST /api/emails/[id]/attachments/[attachmentId]/upload-to-drive
 * Body JSON: { folderId?: string, folderUrl?: string, filename?: string, mimeType?: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  try {
    const { id: messageId, attachmentId } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const folderUrl = typeof body.folderUrl === "string" ? body.folderUrl : "";
    const folderIdRaw = typeof body.folderId === "string" ? body.folderId : "";
    const folderId =
      parseDriveFolderId(folderIdRaw) || parseDriveFolderId(folderUrl) || null;
    if (!folderId) {
      return NextResponse.json(
        {
          error:
            "Provide a valid Google Drive folder URL or folder id (folderUrl or folderId). Reconnect Google if you have not granted Drive upload access yet.",
        },
        { status: 400 }
      );
    }

    const filename =
      typeof body.filename === "string" && body.filename.trim()
        ? body.filename.trim().replace(/[/\\?%*:|"<>]/g, "-")
        : "attachment";
    const mimeType =
      typeof body.mimeType === "string" && body.mimeType.trim()
        ? body.mimeType.trim()
        : "application/octet-stream";

    const gmail = await getGmailClient();
    const bytes = await fetchGmailAttachmentBytes(gmail, messageId, attachmentId);
    const drive = await getGoogleDriveClient();

    const buffer = Buffer.from(bytes);
    const created = await drive.files.create({
      requestBody: {
        name: filename,
        parents: [folderId],
      },
      media: {
        mimeType,
        body: Readable.from(buffer),
      },
      fields: "id, name, webViewLink, mimeType",
    });

    return NextResponse.json({
      id: created.data.id,
      name: created.data.name,
      webViewLink: created.data.webViewLink ?? null,
    });
  } catch (err) {
    console.error("Upload attachment to Drive error:", err);
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json(
      {
        error: `${message} If this is a new capability, sign out of Google in the app and reconnect so Drive upload scope is granted.`,
      },
      { status: 500 }
    );
  }
}
