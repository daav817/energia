import { NextResponse } from "next/server";
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
  if (err && typeof err === "object") {
    const o = err as { response?: { status?: unknown }; status?: unknown };
    const fromResponse = o.response?.status;
    if (typeof fromResponse === "number" && fromResponse >= 400) return fromResponse;
    const top = o.status;
    if (typeof top === "number" && top >= 400) return top;
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

export type EmailAttachmentDriveUploadInput = {
  messageId: string;
  attachmentId: string;
  folderUrl: string;
  folderIdRaw: string;
  filename: string;
  mimeType: string;
};

/**
 * Fetch a Gmail attachment and create a new file in the given Drive folder.
 */
export async function performEmailAttachmentDriveUpload(
  input: EmailAttachmentDriveUploadInput
): Promise<NextResponse> {
  try {
    const messageId = input.messageId.trim();
    const attachmentId = input.attachmentId.trim();
    if (!messageId || !attachmentId) {
      return NextResponse.json(
        { error: "messageId and attachmentId are required." },
        { status: 400 }
      );
    }

    const folderUrl = input.folderUrl.trim();
    const folderIdRaw = input.folderIdRaw.trim();
    const folderId = parseDriveFolderId(folderIdRaw) || parseDriveFolderId(folderUrl) || null;
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
      input.filename.trim().replace(/[/\\?%*:|"<>]/g, "-") || "attachment";
    const mimeType = input.mimeType.trim() || "application/octet-stream";

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
        body: buffer,
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
