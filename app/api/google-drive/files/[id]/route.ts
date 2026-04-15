import { NextRequest, NextResponse } from "next/server";
import { getGoogleDriveClient } from "@/lib/gmail";

/**
 * DELETE — move file to Drive trash (default Google Drive API behavior).
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: raw } = await params;
    const fileId = decodeURIComponent(String(raw || "").trim());
    if (!fileId) {
      return NextResponse.json({ error: "Missing file id" }, { status: 400 });
    }

    const drive = await getGoogleDriveClient();
    await drive.files.delete({
      fileId,
      supportsAllDrives: true,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("google-drive files DELETE", e);
    const message =
      e instanceof Error
        ? e.message
        : "Failed to delete file. Reconnect Google with Drive access if this continues.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
