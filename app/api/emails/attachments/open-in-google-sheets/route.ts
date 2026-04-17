import { NextRequest, NextResponse } from "next/server";
import { getGmailClient, getGoogleDriveClient } from "@/lib/gmail";
import { fetchGmailAttachmentBytes } from "@/lib/gmail-attachment-bytes";

/**
 * GET /api/emails/attachments/open-in-google-sheets?messageId=&attachmentId=&filename=
 * Imports the .xlsx attachment into Google Drive as a Google Sheet and redirects to it.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const messageId = searchParams.get("messageId")?.trim();
    const attachmentId = searchParams.get("attachmentId")?.trim();
    const filename = searchParams.get("filename")?.trim() || "workbook.xlsx";
    if (!messageId || !attachmentId) {
      return NextResponse.json({ error: "messageId and attachmentId are required" }, { status: 400 });
    }

    const gmail = await getGmailClient();
    const bytes = await fetchGmailAttachmentBytes(gmail, messageId, attachmentId);
    const drive = await getGoogleDriveClient();
    const buffer = Buffer.from(bytes);
    const baseName = filename.replace(/[/\\?%*:|"<>]/g, "-").replace(/\.(xlsx|xls)$/i, "") || "Imported spreadsheet";

    const created = await drive.files.create({
      requestBody: {
        name: `${baseName} (from email)`,
        mimeType: "application/vnd.google-apps.spreadsheet",
      },
      media: {
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        body: buffer,
      },
      fields: "id,webViewLink",
      supportsAllDrives: true,
    });

    const link = created.data.webViewLink;
    if (!link) {
      return NextResponse.json({ error: "Drive did not return a view link" }, { status: 500 });
    }
    return NextResponse.redirect(link);
  } catch (err) {
    console.error("open-in-google-sheets:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 500 }
    );
  }
}
