import { parseHTML } from "linkedom";
import {
  finalizeQuoteEmailFragment,
  wrapQuoteEmailDocument,
} from "@/lib/quote-email-html-transforms";

/**
 * Server-side finalization for `/api/emails/send` so received mail matches RFP-style MIME HTML
 * even when the browser DOM differs from linkedom.
 */
export function finalizeQuoteEmailHtmlServer(htmlBody: string): string {
  const { document } = parseHTML(
    "<!DOCTYPE html><html><head></head><body></body></html>"
  );
  const inner = finalizeQuoteEmailFragment(htmlBody, document);
  return wrapQuoteEmailDocument(inner);
}
