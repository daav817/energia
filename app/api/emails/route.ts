import { NextRequest, NextResponse } from "next/server";
import { getGmailClient } from "@/lib/gmail";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/emails
 * List emails from Gmail (or from DB if synced)
 * Query params: maxResults, pageToken, labelIds
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get("source") || "gmail"; // "gmail" | "db"
    const maxResults = Math.min(parseInt(searchParams.get("maxResults") || "50", 10), 500);

    if (source === "db") {
      const emails = await prisma.email.findMany({
        orderBy: { sentAt: "desc" },
        take: maxResults,
      });
      return NextResponse.json(emails);
    }

    const gmail = await getGmailClient();
    const labelIds = searchParams.get("labelIds");
    const labelList = labelIds ? labelIds.split(",") : undefined;
    const q = searchParams.get("q") || undefined;
    const pageToken = searchParams.get("pageToken") || undefined;

    // Special-case Drafts: drafts.update needs a draft id, not just a message id.
    // When listing the DRAFT label, use users.drafts.list so we can return draftId alongside messageId.
    if (labelList?.length === 1 && labelList[0] === "DRAFT" && !q) {
      const res = await gmail.users.drafts.list({
        userId: "me",
        maxResults,
        pageToken,
      });
      const drafts = res.data.drafts || [];
      const details = await Promise.all(
        drafts.map(async (d) => {
          const msgId = d.message?.id;
          if (!d.id || !msgId) return null;
          const msg = await gmail.users.messages.get({
            userId: "me",
            id: msgId,
            format: "full",
          });
          const headers = (msg.data.payload?.headers || []).reduce(
            (acc, h) => {
              if (h.name && h.value) acc[h.name.toLowerCase()] = h.value;
              return acc;
            },
            {} as Record<string, string>
          );

          let hasAttachments = false;
          const visit = (part?: {
            filename?: string | null;
            mimeType?: string | null;
            body?: { attachmentId?: string | null };
            headers?: { name?: string | null; value?: string | null }[] | null;
            parts?: any[] | null;
          }) => {
            if (!part || hasAttachments) return;
            const disposition =
              part.headers?.find((h) => h.name?.toLowerCase() === "content-disposition")?.value || "";
            const mimeType = part.mimeType || "";
            const isInlineImage =
              /inline/i.test(disposition) && /^image\//i.test(mimeType);
            const isAttachment =
              !isInlineImage &&
              (!!part.filename ||
                /attachment/i.test(disposition) ||
                (!!part.body?.attachmentId && !/^text\//i.test(mimeType)));
            if (isAttachment) {
              hasAttachments = true;
              return;
            }
            if (part.parts) {
              for (const p of part.parts) {
                visit(p);
                if (hasAttachments) break;
              }
            }
          };
          visit(msg.data.payload as any);

          return {
            id: msg.data.id!,
            draftId: d.id,
            threadId: msg.data.threadId!,
            subject: headers.subject || "(no subject)",
            from: headers.from || "",
            to: headers.to || "",
            date: headers.date || "",
            snippet: msg.data.snippet || "",
            labelIds: msg.data.labelIds || [],
            hasAttachments,
          };
        })
      );

      return NextResponse.json({
        messages: details.filter(Boolean),
        nextPageToken: res.data.nextPageToken,
        resultSizeEstimate: res.data.resultSizeEstimate,
      });
    }

    const res = await gmail.users.messages.list({
      userId: "me",
      maxResults,
      labelIds: labelList,
      q,
      pageToken,
    });

    const messages = res.data.messages || [];
    const details = await Promise.all(
      messages.map(async (m) => {
        if (!m.id) return null;
        const msg = await gmail.users.messages.get({
          userId: "me",
          id: m.id,
          format: "full",
        });
        const headers = (msg.data.payload?.headers || []).reduce(
          (acc, h) => {
            if (h.name && h.value) acc[h.name.toLowerCase()] = h.value;
            return acc;
          },
          {} as Record<string, string>
        );

        let hasAttachments = false;
        const visit = (part?: {
          filename?: string | null;
          mimeType?: string | null;
          body?: { attachmentId?: string | null };
          headers?: { name?: string | null; value?: string | null }[] | null;
          parts?: any[] | null;
        }) => {
          if (!part || hasAttachments) return;
          const disposition =
            part.headers?.find((h) => h.name?.toLowerCase() === "content-disposition")?.value || "";
          const mimeType = part.mimeType || "";
          const isInlineImage =
            /inline/i.test(disposition) && /^image\//i.test(mimeType);
          const isAttachment =
            !isInlineImage &&
            (!!part.filename ||
              /attachment/i.test(disposition) ||
              (!!part.body?.attachmentId && !/^text\//i.test(mimeType)));
          if (isAttachment) {
            hasAttachments = true;
            return;
          }
          if (part.parts) {
            for (const p of part.parts) {
              visit(p);
              if (hasAttachments) break;
            }
          }
        };
        visit(msg.data.payload as any);

        return {
          id: msg.data.id!,
          draftId: undefined,
          threadId: msg.data.threadId!,
          subject: headers.subject || "(no subject)",
          from: headers.from || "",
          to: headers.to || "",
          date: headers.date || "",
          snippet: msg.data.snippet || "",
          labelIds: msg.data.labelIds || [],
          hasAttachments,
        };
      })
    );

    return NextResponse.json({
      messages: details.filter(Boolean),
      nextPageToken: res.data.nextPageToken,
      resultSizeEstimate: res.data.resultSizeEstimate,
    });
  } catch (err) {
    console.error("List emails error:", err);
    const message = err instanceof Error ? err.message : "Failed to list emails";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
