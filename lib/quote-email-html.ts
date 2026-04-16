/**
 * Quote email HTML finalization (browser DOM). Used for in-app preview and for the MIME body sent via
 * `/api/emails/send` so received mail matches what the user saw.
 */

import {
  finalizeQuoteEmailFragment,
  wrapQuoteEmailDocument,
} from "@/lib/quote-email-html-transforms";

/** HTML for preview and for sending customer quote emails (must match preview). */
export function finalizeQuoteEmailHtml(htmlBody: string): string {
  if (typeof document === "undefined") {
    return wrapQuoteEmailDocument(htmlBody.trim() || "<p></p>");
  }
  const inner = finalizeQuoteEmailFragment(htmlBody, document);
  return wrapQuoteEmailDocument(inner);
}

export { wrapQuoteEmailDocument } from "@/lib/quote-email-html-transforms";
