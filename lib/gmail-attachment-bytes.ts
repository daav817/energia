import type { gmail_v1 } from "googleapis";

type GmailClient = gmail_v1.Gmail;

/** Decode Gmail attachment body (base64url) to bytes. */
export function decodeGmailAttachmentBase64(raw: string): Uint8Array {
  const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

export async function fetchGmailAttachmentBytes(
  gmail: GmailClient,
  messageId: string,
  attachmentId: string
): Promise<Uint8Array> {
  const res = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId,
    id: attachmentId,
  });
  const data = res.data.data;
  if (!data) throw new Error("Attachment data not found");
  return decodeGmailAttachmentBase64(data);
}
