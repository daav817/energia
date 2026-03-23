import { NextRequest, NextResponse } from "next/server";
import { getGmailClient } from "@/lib/gmail";

function formatRfc2822Date(): string {
  return new Date().toUTCString().replace("GMT", "+0000");
}

function createMessageId(): string {
  return `<${Date.now()}.${Math.random().toString(36).slice(2)}@energia-app>`;
}

function extractEmail(value: string): string {
  // Handles "Name <addr@x.com>" and raw "addr@x.com"
  const match = value.match(/<([^>]+)>/);
  return match ? match[1] : value.trim();
}

function extractEmailsFromToHeader(raw: string): string[] {
  // Extract email-like tokens without relying on comma-splitting (which breaks for names with commas).
  const sanitized = raw.replace(/[\r\n]/g, "");
  const regex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const matches = sanitized.match(regex) || [];
  // Normalize and dedupe (lowercase).
  return Array.from(new Set(matches.map((m) => m.toLowerCase())));
}

function createMimeMessage(opts: {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: {
    filename: string;
    mimeType: string;
    contentBase64: string;
  }[];
}): string {
  const wrapBase64 = (b64: string, lineLen = 76) => {
    const s = b64.replace(/\s+/g, "");
    const chunks: string[] = [];
    for (let i = 0; i < s.length; i += lineLen) chunks.push(s.slice(i, i + lineLen));
    return chunks.join("\r\n");
  };

  const date = formatRfc2822Date();
  const messageId = createMessageId();
  // Drafts can legitimately have no recipients yet; Gmail still expects a syntactically valid To header.
  // Use sender as a safe fallback (works better with Gmail than "undisclosed-recipients:;").
  const toHeader = opts.to.length ? opts.to.join(", ") : opts.from;
  const ccHeader = (opts.cc ?? []).join(", ");
  const bccHeader = (opts.bcc ?? []).join(", ");

  const textVal = (opts.text || "").replace(/\n/g, "\r\n");
  const htmlVal = (opts.html || "").replace(/\n/g, "\r\n");
  const attachments = opts.attachments ?? [];

  const hasHtml = !!htmlVal.trim();

  if (attachments.length > 0) {
    const boundaryMixed = `----=_energia_app_mixed_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const boundaryAlt = `----=_energia_app_alt_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const parts: string[] = [];

    // Alternative part (text + html)
    parts.push(
      `--${boundaryMixed}`,
      `Content-Type: multipart/alternative; boundary="${boundaryAlt}"`,
      "Content-Transfer-Encoding: 7bit",
      "",
      `--${boundaryAlt}`,
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: 7bit",
      "",
      textVal,
      "",
      ...(hasHtml
        ? [
            `--${boundaryAlt}`,
            'Content-Type: text/html; charset="utf-8"',
            "Content-Transfer-Encoding: 7bit",
            "",
            htmlVal,
            "",
          ]
        : []),
      `--${boundaryAlt}--`
    );

    // Attachments
    for (const att of attachments) {
      const filename = String(att.filename ?? "attachment").replace(/[\r\n"]/g, "");
      const mimeType = String(att.mimeType ?? "application/octet-stream").replace(/[\r\n"]/g, "");
      const b64 = String(att.contentBase64 ?? "").replace(/\s+/g, "");
      parts.push(
        `--${boundaryMixed}`,
        `Content-Type: ${mimeType}; name="${filename}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${filename}"`,
        "",
        wrapBase64(b64),
        ""
      );
    }

    parts.push(`--${boundaryMixed}--`);

    return [
      `From: ${opts.from}`,
      `To: ${toHeader}`,
      ccHeader ? `Cc: ${ccHeader}` : "",
      bccHeader ? `Bcc: ${bccHeader}` : "",
      `Subject: ${opts.subject || "(no subject)"}`,
      `Date: ${date}`,
      `Message-ID: ${messageId}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundaryMixed}"`,
      "Content-Transfer-Encoding: 7bit",
      "",
      ...parts,
    ].filter(Boolean).join("\r\n");
  }

  if (hasHtml) {
    const boundary = `----=_energia_app_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return [
      `From: ${opts.from}`,
      `To: ${toHeader}`,
      ccHeader ? `Cc: ${ccHeader}` : "",
      bccHeader ? `Bcc: ${bccHeader}` : "",
      `Subject: ${opts.subject || "(no subject)"}`,
      `Date: ${date}`,
      `Message-ID: ${messageId}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "Content-Transfer-Encoding: 7bit",
      "",
      `--${boundary}`,
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: 7bit",
      "",
      textVal,
      "",
      `--${boundary}`,
      'Content-Type: text/html; charset="utf-8"',
      "Content-Transfer-Encoding: 7bit",
      "",
      htmlVal,
      "",
      `--${boundary}--`,
    ].filter(Boolean).join("\r\n");
  }

  return [
    `From: ${opts.from}`,
    `To: ${toHeader}`,
    ccHeader ? `Cc: ${ccHeader}` : "",
    bccHeader ? `Bcc: ${bccHeader}` : "",
    `Subject: ${opts.subject || "(no subject)"}`,
    `Date: ${date}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    textVal,
  ].filter(Boolean).join("\r\n");
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let messageId: string | undefined;
  let matchingDraftId: string | undefined;
  let fromEmail: string | undefined;
  let toRaw: string | undefined;
  let ccRaw: string | undefined;
  let bccRaw: string | undefined;
  let toEmails: string[] | undefined;
  let ccEmails: string[] | undefined;
  let bccEmails: string[] | undefined;
  let rawPreview: string | undefined;
  try {
    const awaitedParams = await params;
    messageId = awaitedParams?.id;
    if (!messageId) {
      return NextResponse.json(
        { error: "Missing required parameters: id (message id missing)", receivedParams: awaitedParams },
        { status: 400 }
      );
    }
    const body = await request.json().catch(() => ({}));

    const { to, cc, bcc, subject, text, html, attachments, draftId } = body as {
      to?: string | string[];
      cc?: string | string[];
      bcc?: string | string[];
      subject?: string;
      text?: string;
      html?: string;
      attachments?: {
        filename: string;
        mimeType: string;
        contentBase64: string;
      }[];
      draftId?: string;
    };

    toRaw = Array.isArray(to) ? to.join(",") : typeof to === "string" ? to : "";
    ccRaw = Array.isArray(cc) ? cc.join(",") : typeof cc === "string" ? cc : "";
    bccRaw = Array.isArray(bcc) ? bcc.join(",") : typeof bcc === "string" ? bcc : "";
    toEmails = extractEmailsFromToHeader(String(toRaw || ""));
    ccEmails = extractEmailsFromToHeader(String(ccRaw || ""));
    bccEmails = extractEmailsFromToHeader(String(bccRaw || ""));
    const subjectVal = typeof subject === "string" ? subject : "(no subject)";
    const textVal = typeof text === "string" ? text : "";
    const htmlVal = typeof html === "string" ? html : undefined;

    // Allow drafts with no recipients yet.

    const gmail = await getGmailClient();

    // If the UI already knows the draftId (best case), skip the messageId->draftId lookup.
    if (typeof draftId === "string" && draftId.trim()) {
      matchingDraftId = draftId.trim();
    }

    // UI passes Gmail "message id" (from users.messages.get). Gmail drafts.update requires the *draft id*,
    // so we must locate the draft whose draft.message.id matches this message id.
    if (!matchingDraftId) {
      let pageToken: string | undefined;
      do {
        const listRes = await gmail.users.drafts.list({
          userId: "me",
          maxResults: 50,
          pageToken,
        });
        const drafts = listRes.data.drafts ?? [];
        for (const d of drafts) {
          if (d?.id && d?.message?.id === messageId) {
            matchingDraftId = d.id;
            break;
          }
        }
        pageToken = listRes.data.nextPageToken ?? undefined;
        if (matchingDraftId) break;
      } while (pageToken);
    }

    if (!matchingDraftId) {
      return NextResponse.json(
        { error: "Requested entity was not found (no matching Gmail draft for message id)", messageId, debug: { messageId } },
        { status: 404 }
      );
    }

    const profile = await gmail.users.getProfile({ userId: "me" });
    fromEmail = profile.data.emailAddress || "noreply@localhost";

    const raw = createMimeMessage({
      from: fromEmail,
      to: toEmails,
      cc: ccEmails,
      bcc: bccEmails,
      subject: subjectVal.trim() || "(no subject)",
      text: textVal,
      html: htmlVal,
      attachments: Array.isArray(attachments) ? attachments : [],
    });
    rawPreview = raw.split("\r\n").slice(0, 40).join("\r\n");

    const encoded = Buffer.from(raw)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    await gmail.users.drafts.update({
      userId: "me",
      // drafts.update uses `id` as the draft id.
      id: matchingDraftId,
      requestBody: {
        message: { raw: encoded },
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Draft update error:", err);
    const anyErr = err as any;
    const gmailStatus = anyErr?.response?.status ?? anyErr?.code;
    const gmailData = anyErr?.response?.data ?? undefined;
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to autosave draft",
        messageId,
        matchingDraftId,
        debug: {
          messageId,
          matchingDraftId,
          fromEmail,
          toRaw,
          ccRaw,
          bccRaw,
          toEmails,
          ccEmails,
          bccEmails,
          rawPreview,
          gmailStatus,
          gmailData,
        },
      },
      { status: 500 }
    );
  }
}

