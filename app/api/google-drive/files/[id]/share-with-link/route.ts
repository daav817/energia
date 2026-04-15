import { NextRequest, NextResponse } from "next/server";
import { ensureAnyoneWithLinkCanViewFile } from "@/lib/google-drive-share-anyone-link";
import { removeAnyoneLinkSharing } from "@/lib/google-drive-remove-link-sharing";

/**
 * POST — set file sharing to “anyone with the link can view” so supplier RFP links work without access requests.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: raw } = await params;
    const fileId = decodeURIComponent(String(raw || "").trim());
    if (!fileId) {
      return NextResponse.json({ error: "Missing file id" }, { status: 400 });
    }

    await ensureAnyoneWithLinkCanViewFile(fileId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("google-drive share-with-link", e);
    const message =
      e instanceof Error
        ? e.message
        : "Failed to update sharing. Reconnect Google with Drive access if this continues.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE — remove “anyone with the link” access (link-only sharing) from the file.
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

    await removeAnyoneLinkSharing(fileId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("google-drive share-with-link DELETE", e);
    const message =
      e instanceof Error
        ? e.message
        : "Failed to update sharing. Reconnect Google with Drive access if this continues.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
