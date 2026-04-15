/**
 * Client-side quote email HTML finalization (same transform chain as server send).
 */

import {
  finalizeQuoteEmailFragment,
  wrapQuoteEmailDocument,
} from "@/lib/quote-email-html-transforms";

/** HTML for preview and client-side display; send path re-finalizes on the server. */
export function finalizeQuoteEmailHtml(htmlBody: string): string {
  if (typeof document === "undefined") {
    return wrapQuoteEmailDocument(htmlBody.trim() || "<p></p>");
  }
  const inner = finalizeQuoteEmailFragment(htmlBody, document);
  return wrapQuoteEmailDocument(inner);
}

export { wrapQuoteEmailDocument } from "@/lib/quote-email-html-transforms";
