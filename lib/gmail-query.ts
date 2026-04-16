/**
 * Build a Gmail search `from:` token. Quotes addresses that contain spaces, parens, or quotes.
 * See https://support.google.com/mail/answer/7190
 */
export function gmailFromToken(email: string): string {
  const e = email.trim();
  if (!e) return "";
  const needsQuote = /[\s()"]/.test(e);
  if (needsQuote) {
    const escaped = e.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `from:"${escaped}"`;
  }
  return `from:${e}`;
}

/** Gmail `label:` search token; quotes names with special characters. */
export function gmailLabelToken(labelName: string): string {
  const n = labelName.trim();
  if (!n) return "";
  const escaped = n.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `label:"${escaped}"`;
}
