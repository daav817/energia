import { NextRequest, NextResponse } from "next/server";
import { getGoogleDriveClient } from "@/lib/gmail";

const FOLDER_MIME = "application/vnd.google-apps.folder";

/**
 * POST /api/google-drive/folders
 * Body JSON: { name: string, parentId?: string } — parentId defaults to "root" (My Drive).
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const name = String(body.name ?? "").trim();
    const parentId = String(body.parentId ?? "").trim() || "root";
    if (!name) {
      return NextResponse.json({ error: "Folder name is required" }, { status: 400 });
    }

    const drive = await getGoogleDriveClient();
    const created = await drive.files.create({
      requestBody: {
        name,
        mimeType: FOLDER_MIME,
        parents: [parentId],
      },
      fields: "id,name,webViewLink",
      supportsAllDrives: false,
    });

    const id = created.data.id;
    if (!id) {
      return NextResponse.json({ error: "Drive did not return a folder id" }, { status: 500 });
    }

    return NextResponse.json({
      id,
      name: created.data.name ?? name,
      webViewLink: created.data.webViewLink ?? null,
    });
  } catch (e) {
    console.error("Drive folder create:", e);
    const msg = e instanceof Error ? e.message : "Failed to create folder";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
