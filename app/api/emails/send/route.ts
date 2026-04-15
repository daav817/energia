import { NextRequest, NextResponse } from "next/server";
import { getGmailClient } from "@/lib/gmail";
import { finalizeQuoteEmailHtmlServer } from "@/lib/quote-email-html-server";
import {
  replaceDataUrlImagesWithCid,
  type PreparedInlineImage,
} from "@/lib/email-data-url-to-cid";

type Attachment = { filename: string; content: any; mimeType: string };

/**
 * POST /api/emails/send
 * Send an email via Gmail API
 * Accepts JSON (to, cc, subject, body) or FormData (to, cc, subject, body, attachments)
 */
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";
    let toList: string[];
    let ccList: string[];
    let bccList: string[];
    let emailBody: string;
    let html: string | undefined;
    let subjectVal: string;
    let attachments: Attachment[] = [];
    let inlineImages: PreparedInlineImage[] = [];

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const toJson = formData.get("to") as string | null;
      const ccJson = formData.get("cc") as string | null;
      const bccJson = formData.get("bcc") as string | null;
      toList = toJson ? JSON.parse(toJson) : [];
      ccList = ccJson ? JSON.parse(ccJson) : [];
      bccList = bccJson ? JSON.parse(bccJson) : [];
      emailBody = (formData.get("body") as string) || "";
      html = (formData.get("html") as string) || undefined;
      subjectVal = (formData.get("subject") as string) || "(no subject)";
      const files = formData.getAll("attachments") as File[];
      for (const file of files) {
        if (file && file.size > 0) {
          const buf = Buffer.from(await file.arrayBuffer());
          const mimeType = file.type || "application/octet-stream";
          attachments.push({ filename: file.name, content: buf, mimeType });
        }
      }
      if (html && html.includes("data:image") && html.includes("base64,")) {
        const r = replaceDataUrlImagesWithCid(html);
        html = r.html;
        inlineImages = r.inlineImages;
      }
    } else {
      const body = await request.json();
      const { to, cc, bcc, subject, body: b, html: h, energiaEmailKind } = body;
      emailBody = b || "";
      html = h;
      subjectVal = subject || "(no subject)";
      toList = Array.isArray(to) ? to : to ? [to] : [];
      ccList = cc ? (Array.isArray(cc) ? cc : [cc]) : [];
      bccList = bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : [];
      if (
        html &&
        typeof html === "string" &&
        html.trim() &&
        energiaEmailKind === "customerQuote"
      ) {
        html = finalizeQuoteEmailHtmlServer(html);
      }
      if (
        html &&
        typeof html === "string" &&
        html.includes("data:image") &&
        html.includes("base64,")
      ) {
        const r = replaceDataUrlImagesWithCid(html);
        html = r.html;
        inlineImages = r.inlineImages;
      }
    }

    if (!toList?.length || (!emailBody && !html)) {
      return NextResponse.json(
        { error: "to and body (or html) are required" },
        { status: 400 }
      );
    }

    const gmail = await getGmailClient();
    const profile = await gmail.users.getProfile({ userId: "me" });
    const fromEmail = profile.data.emailAddress || "noreply@localhost";

    const raw = createMimeMessage({
      from: fromEmail,
      to: toList,
      cc: ccList,
      bcc: bccList,
      subject: subjectVal,
      text: emailBody || "",
      html,
      attachments,
      inlineImages,
    });

    const encoded = Buffer.from(raw)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const res = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: encoded },
    });

    return NextResponse.json({
      id: res.data.id,
      threadId: res.data.threadId,
      labelIds: res.data.labelIds,
    });
  } catch (err) {
    console.error("Send email error:", err);
    const message = err instanceof Error ? err.message : "Failed to send email";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function wrapBase64(str: string, lineLen = 76): string {
  const chunks: string[] = [];
  for (let i = 0; i < str.length; i += lineLen) {
    chunks.push(str.slice(i, i + lineLen));
  }
  return chunks.join("\r\n");
}

function formatRfc2822Date(): string {
  return new Date().toUTCString().replace("GMT", "+0000");
}

function createMessageId(): string {
  return `<${Date.now()}.${Math.random().toString(36).slice(2)}@energia-app>`;
}

function escapeFilename(name: string): string {
  return name.replace(/[\\"]/g, "\\$&");
}

function createMimeMessage(opts: {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: Attachment[];
  inlineImages?: PreparedInlineImage[];
}): string {
  const text = opts.text || "";
  const html = opts.html;
  const attachments = opts.attachments || [];
  const inlineImages = opts.inlineImages || [];
  const date = formatRfc2822Date();
  const messageId = createMessageId();

  const baseHeaders = [
    `From: ${opts.from}`,
    `To: ${opts.to.join(", ")}`,
    opts.cc.length ? `Cc: ${opts.cc.join(", ")}` : "",
    opts.bcc.length ? `Bcc: ${opts.bcc.join(", ")}` : "",
    `Subject: ${opts.subject}`,
    `Date: ${date}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
  ].filter(Boolean);

  /** Body only: first boundary line through closing boundary (no multipart Content-Type). */
  function multipartAlternativeInner(plain: string, htmlPart: string, boundary: string): string {
    /** Match RFP send route: single-line base64 (Gmail accepts; avoids client decode edge cases). */
    const textB64 = Buffer.from(plain, "utf-8").toString("base64");
    const htmlB64 = Buffer.from(htmlPart, "utf-8").toString("base64");
    return [
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      textB64,
      "",
      `--${boundary}`,
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      htmlB64,
      "",
      `--${boundary}--`,
    ].join("\r\n");
  }

  /** First subpart inside multipart/mixed: nested headers + blank line + nested body. */
  function firstMixedSubpart(): string {
    if (html) {
      const boundary = `----=_Part_${Date.now()}_alt`;
      const inner = multipartAlternativeInner(text, html, boundary);
      return [
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        "",
        inner,
      ].join("\r\n");
    }
    const textB64 = wrapBase64(Buffer.from(text, "utf-8").toString("base64"));
    return [
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      textB64,
    ].join("\r\n");
  }

  if (attachments.length > 0 || inlineImages.length > 0) {
    const mixedBoundary = `----=_Part_${Date.now()}_mixed`;
    const bodyPart = firstMixedSubpart();
    const parts: string[] = [
      `--${mixedBoundary}`,
      bodyPart,
    ];
    for (const img of inlineImages) {
      const imgB64 = wrapBase64(img.buffer.toString("base64"));
      const safeName = escapeFilename(img.filename);
      parts.push(
        `--${mixedBoundary}`,
        `Content-Type: ${img.mimeType}`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: inline; filename="${safeName}"`,
        `Content-ID: <${img.contentId}>`,
        "",
        imgB64
      );
    }
    for (const att of attachments) {
      const attB64 = wrapBase64(att.content.toString("base64"));
      const safeName = escapeFilename(att.filename);
      parts.push(
        `--${mixedBoundary}`,
        `Content-Type: ${att.mimeType}; name="${safeName}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${safeName}"`,
        "",
        attB64
      );
    }
    parts.push(`--${mixedBoundary}--`);
    const headers = [
      ...baseHeaders,
      `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    ].filter(Boolean);
    return headers.join("\r\n") + "\r\n\r\n" + parts.join("\r\n");
  }

  if (html) {
    const boundary = `----=_Part_${Date.now()}_alt`;
    const inner = multipartAlternativeInner(text, html, boundary);
    const headers = [
      ...baseHeaders,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ].filter(Boolean);
    return headers.join("\r\n") + "\r\n\r\n" + inner;
  }

  const headers = [
    ...baseHeaders,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
  ].filter(Boolean);
  const textB64 = wrapBase64(Buffer.from(text, "utf-8").toString("base64"));
  return headers.join("\r\n") + "\r\n\r\n" + textB64;
}
