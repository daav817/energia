/**
 * Parse a bare email from a MIME From/To/Cc style header value.
 * Examples: "Jane <jane@x.com>" -> "jane@x.com", "jane@x.com" -> "jane@x.com"
 */
export function extractEmailFromHeader(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const angle = s.match(/<([^>]+)>/);
  const inner = angle ? angle[1].trim() : s;
  return inner.toLowerCase();
}
