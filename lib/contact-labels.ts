/** Split stored contact.label (comma/semicolon separated) into distinct tokens. */
export function parseContactLabels(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,;]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Serialize labels for API (comma-separated, case-insensitive dedupe, preserve first casing). */
export function formatContactLabels(labels: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of labels) {
    const t = l.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.join(", ");
}

/** Stored on Contact.label as a single comma token, e.g. `rfp:sales@acme.com`. */
export const RFP_EMAIL_LABEL_PREFIX = "rfp:";

/** Emails (lowercase) the user wants pre-selected for supplier RFP sends. */
export function parseRfpPreferredEmails(raw: string | null | undefined): string[] {
  const out: string[] = [];
  for (const t of parseContactLabels(raw)) {
    const lower = t.toLowerCase();
    if (lower.startsWith(RFP_EMAIL_LABEL_PREFIX)) {
      const rest = t.slice(RFP_EMAIL_LABEL_PREFIX.length).trim().toLowerCase();
      if (rest) out.push(rest);
    }
  }
  return out;
}

/** Add or remove `rfp:<email>` on the contact label; other tokens preserved. */
export function setRfpEmailPreferenceInLabel(
  raw: string | null | undefined,
  email: string,
  want: boolean
): string {
  const target = email.trim().toLowerCase();
  if (!target) return (raw ?? "").trim();
  const tokens = parseContactLabels(raw);
  const filtered = tokens.filter((t) => {
    const l = t.toLowerCase();
    if (!l.startsWith(RFP_EMAIL_LABEL_PREFIX)) return true;
    const rest = t.slice(RFP_EMAIL_LABEL_PREFIX.length).trim().toLowerCase();
    return rest !== target;
  });
  if (want) filtered.push(`${RFP_EMAIL_LABEL_PREFIX}${target}`);
  return formatContactLabels(filtered);
}

/** Add or remove the `primary` label token (case-insensitive); other tokens are preserved. */
export function setPrimaryLabelToken(raw: string | null | undefined, wantPrimary: boolean): string {
  const tokens = parseContactLabels(raw);
  if (wantPrimary) {
    if (!tokens.some((t) => t.toLowerCase() === "primary")) tokens.push("primary");
    return formatContactLabels(tokens);
  }
  return formatContactLabels(tokens.filter((t) => t.toLowerCase() !== "primary"));
}
