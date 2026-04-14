import { NextRequest, NextResponse } from "next/server";
import { getGoogleDriveClient } from "@/lib/gmail";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const GOOGLE_DOC = "application/vnd.google-apps.document";
const GOOGLE_SHEET = "application/vnd.google-apps.spreadsheet";
const GOOGLE_SLIDE = "application/vnd.google-apps.presentation";

function safeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "_").trim() || "download";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: fileId } = await params;
    if (!fileId?.trim()) {
      return NextResponse.json({ error: "Missing file id" }, { status: 400 });
    }

    const inline =
      request.nextUrl.searchParams.get("inline") === "1" ||
      request.nextUrl.searchParams.get("inline") === "true";

    const drive = await getGoogleDriveClient();

    const meta = await drive.files.get({
      fileId,
      fields: "id,name,mimeType",
      supportsAllDrives: true,
    });

    const mime = meta.data.mimeType || "";
    const baseName = safeFilename(meta.data.name || "download");

    if (mime === FOLDER_MIME) {
      return NextResponse.json({ error: "Folders cannot be downloaded" }, { status: 400 });
    }

    let body: ArrayBuffer;
    let contentType: string;
    let filename: string;

    if (mime === GOOGLE_DOC) {
      const res = await drive.files.export(
        { fileId, mimeType: "application/pdf" },
        { responseType: "arraybuffer" }
      );
      body = res.data as ArrayBuffer;
      contentType = "application/pdf";
      filename = baseName.toLowerCase().endsWith(".pdf") ? baseName : `${baseName}.pdf`;
    } else if (mime === GOOGLE_SHEET) {
      const res = await drive.files.export(
        {
          fileId,
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
        { responseType: "arraybuffer" }
      );
      body = res.data as ArrayBuffer;
      contentType =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      filename = baseName.toLowerCase().endsWith(".xlsx") ? baseName : `${baseName}.xlsx`;
    } else if (mime === GOOGLE_SLIDE) {
      const res = await drive.files.export(
        { fileId, mimeType: "application/pdf" },
        { responseType: "arraybuffer" }
      );
      body = res.data as ArrayBuffer;
      contentType = "application/pdf";
      filename = baseName.toLowerCase().endsWith(".pdf") ? baseName : `${baseName}.pdf`;
    } else if (mime.startsWith("application/vnd.google-apps.")) {
      return NextResponse.json(
        { error: "This Google file type must be opened in Google Workspace" },
        { status: 400 }
      );
    } else {
      const res = await drive.files.get(
        { fileId, alt: "media", supportsAllDrives: true },
        { responseType: "arraybuffer" }
      );
      body = res.data as ArrayBuffer;
      contentType = mime || "application/octet-stream";
      filename = baseName;
    }

    const asciiName = filename.replace(/[^\x20-\x7E]/g, "_");
    const encoded = encodeURIComponent(filename);
    const disposition = inline
      ? `inline; filename="${asciiName}"; filename*=UTF-8''${encoded}`
      : `attachment; filename="${asciiName}"; filename*=UTF-8''${encoded}`;

    return new NextResponse(body, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": disposition,
      },
    });
  } catch (err) {
    console.error("Drive download error:", err);
    const message = err instanceof Error ? err.message : "Download failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
