import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { getGmailClient, getGoogleDriveClient } from "@/lib/gmail";
import { fetchGmailAttachmentBytes } from "@/lib/gmail-attachment-bytes";
import { parseDriveFolderId } from "@/lib/parse-drive-folder-id";

function formatUploadError(err: unknown): string {
  if (err && typeof err === "object" && "response" in err) {
    const data = (err as { response?: { data?: unknown } }).response?.data;
    if (data && typeof data === "object" && data !== null && "error" in data) {
      const inner = (data as { error?: { message?: string; errors?: Array<{ message?: string }> } }).error;
      const msg = inner?.message;
      if (typeof msg === "string" && msg.trim()) return msg.trim();
      const first = inner?.errors?.[0]?.message;
      if (typeof first === "string" && first.trim()) return first.trim();
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return "Upload failed";
}

function getHttpStatusFromGoogleError(err: unknown): number | null {
  if (err && typeof err === "object" && "response" in err) {
    const status = (err as { response?: { status?: unknown } }).response?.status;
    return typeof status === "number" ? status : null;
  }
  return null;
}

function looksLikeScopeError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("insufficient authentication scopes") ||
    m.includes("insufficientpermissions") ||
    m.includes("request had insufficient authentication scopes") ||
    m.includes("access not configured") ||
    m.includes("not authorized")
  );
}

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
      /** Required when the destination folder is on a shared drive (Team Drive); safe for My Drive too. */
      supportsAllDrives: true,
    });

    return NextResponse.json({
      id: created.data.id,
      name: created.data.name,
      webViewLink: created.data.webViewLink ?? null,
    });
  } catch (err) {
    console.error("Upload attachment to Drive error:", err);
    const message = formatUploadError(err);
    const status = getHttpStatusFromGoogleError(err) ?? 500;
    if (status === 401 || status === 403) {
      const scopeHint = looksLikeScopeError(message)
        ? "Your Google connection is missing Drive upload permission. Reconnect Google to grant Drive access, then try again."
        : "You may not have write access to that destination folder. Pick a folder you can edit, or reconnect Google and try again.";
      return NextResponse.json({ error: `${message} ${scopeHint}` }, { status });
    }
    return NextResponse.json(
      {
        error: `${message} If this is a new capability, sign out of Google in the app and reconnect so Drive upload scope is granted.`,
      },
      { status: 500 }
    );
  }
}
