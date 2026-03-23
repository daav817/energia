import { NextRequest, NextResponse } from "next/server";
import { getGmailClient } from "@/lib/gmail";

/**
 * GET /api/emails/[id]
 * Get full email by ID
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const gmail = await getGmailClient();
    const msg = await gmail.users.messages.get({
      userId: "me",
      id,
      format: "full",
    });

    const headers = (msg.data.payload?.headers || []).reduce(
      (acc, h) => {
        if (h.name && h.value) acc[h.name.toLowerCase()] = h.value;
        return acc;
      },
      {} as Record<string, string>
    );

    let body = "";
    let bodyHtml = "";
    const attachments: {
      attachmentId: string;
      filename: string;
      mimeType: string;
      size: number;
    }[] = [];
    /** Map Content-ID (normalized, no angle brackets) -> attachment for inline images (cid:) */
    const inlineImages: Record<string, { attachmentId: string; mimeType: string }> = {};

    const decodeBase64 = (data: string): string => {
      try {
        return Buffer.from(data, "base64url").toString("utf-8");
      } catch {
        return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
      }
    };

    const decodePart = (part: {
      body?: { data?: string; attachmentId?: string; size?: number };
      mimeType?: string;
      filename?: string;
      headers?: { name?: string; value?: string }[];
      parts?: unknown[];
    }): void => {
      const disposition =
        part.headers?.find((h) => h.name?.toLowerCase() === "content-disposition")?.value || "";
      const mimeType = part.mimeType || "";
      const contentIdRaw = part.headers?.find((h) => h.name?.toLowerCase() === "content-id")?.value?.trim();
      const contentId = contentIdRaw ? contentIdRaw.replace(/^<|>$/g, "").trim() : "";

      // Treat small inline images (common in signatures) as inline, not real attachments
      const isInlineImage =
        /inline/i.test(disposition) && /^image\//i.test(mimeType);

      // Inline images with Content-ID are embedded in HTML via cid: — map for frontend
      if ((isInlineImage || contentId) && part.body?.attachmentId && /^image\//i.test(mimeType)) {
        if (contentId) {
          inlineImages[contentId] = {
            attachmentId: part.body.attachmentId,
            mimeType: mimeType || "image/png",
          };
        }
      }

      // Capture attachments (non-inline, non-body parts)
      const isAttachment =
        !isInlineImage &&
        (!!part.filename ||
          /attachment/i.test(disposition) ||
          (!!part.body?.attachmentId && !/^text\//i.test(mimeType)));

      if (isAttachment && part.body?.attachmentId) {
        attachments.push({
          attachmentId: part.body.attachmentId,
          filename: part.filename || "attachment",
          mimeType: part.mimeType || "application/octet-stream",
          size: part.body.size ?? 0,
        });
      }

      if (part.body?.data) {
        const decoded = decodeBase64(part.body.data);
        if (part.mimeType === "text/plain" && !body) body = decoded;
        if (part.mimeType === "text/html" && !bodyHtml) bodyHtml = decoded;
      }
      const parts = part.parts || [];
      for (const p of parts) {
        decodePart(p as { body?: { data?: string }; mimeType?: string; parts?: unknown[] });
      }
    };

    const payload = msg.data.payload;
    if (payload?.body?.data) {
      const decoded = decodeBase64(payload.body.data);
      if (payload.mimeType === "text/html") bodyHtml = decoded;
      else body = decoded;
    }
    if (payload?.parts) {
      for (const p of payload.parts) {
        decodePart(p as { body?: { data?: string }; mimeType?: string; parts?: unknown[] });
      }
    }

    if (!body && !bodyHtml && msg.data.snippet) {
      body = msg.data.snippet;
    }

    return NextResponse.json({
      id: msg.data.id,
      threadId: msg.data.threadId,
      labelIds: msg.data.labelIds || [],
      snippet: msg.data.snippet,
      subject: headers.subject || "(no subject)",
      from: headers.from || "",
      to: headers.to || "",
      cc: headers.cc || "",
      bcc: headers.bcc || "",
      date: headers.date || "",
      body,
      bodyHtml,
      attachments,
      inlineImages,
    });
  } catch (err) {
    console.error("Get email error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to get email" },
      { status: 500 }
    );
  }
}
