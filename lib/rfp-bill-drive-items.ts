/**
 * Normalized bill PDF entries from Google Drive (and optional pasted links) for RFP emails.
 */
export type RfpBillDriveItem = {
  fileId?: string;
  webViewLink: string;
  filename?: string;
};

export function normalizeRfpBillDriveItemsFromBody(body: Record<string, unknown>): RfpBillDriveItem[] {
  const raw = body.billDriveItems;
  const out: RfpBillDriveItem[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      let webViewLink = String(o.webViewLink ?? o.url ?? "").trim();
      const fileId = String(o.fileId ?? "").trim() || undefined;
      const filename = String(o.filename ?? "").trim() || undefined;
      if (!webViewLink && fileId) webViewLink = driveFileViewUrl(fileId);
      if (!webViewLink && !fileId) continue;
      out.push({
        webViewLink,
        ...(fileId ? { fileId } : {}),
        ...(filename ? { filename } : {}),
      });
    }
    if (out.length > 0) return dedupeBillDriveItems(out);
  }

  const legacyUrl = typeof body.googleDriveFolderUrl === "string" ? body.googleDriveFolderUrl.trim() : "";
  const legacyId = typeof body.billDriveFileId === "string" ? body.billDriveFileId.trim() : "";
  if (legacyUrl || legacyId) {
    let url = legacyUrl;
    if (!url && legacyId) url = driveFileViewUrl(legacyId);
    return dedupeBillDriveItems([{ webViewLink: url, ...(legacyId ? { fileId: legacyId } : {}) }]);
  }
  return [];
}

function driveFileViewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

export function normalizeRfpBillDriveItemsFromDb(raw: unknown): RfpBillDriveItem[] {
  if (!Array.isArray(raw)) return [];
  const body = { billDriveItems: raw };
  return normalizeRfpBillDriveItemsFromBody(body);
}

function dedupeBillDriveItems(items: RfpBillDriveItem[]): RfpBillDriveItem[] {
  const seen = new Set<string>();
  const out: RfpBillDriveItem[] = [];
  for (const it of items) {
    const key = (it.fileId && `id:${it.fileId}`) || `url:${it.webViewLink.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

export function billDriveItemsFingerprintKey(items: RfpBillDriveItem[]): string {
  const norm = [...items]
    .map((i) => ({
      f: (i.fileId || "").trim(),
      u: (i.webViewLink || "").trim(),
      n: (i.filename || "").trim(),
    }))
    .sort((a, b) => (a.f || a.u).localeCompare(b.f || b.u, undefined, { sensitivity: "base" }));
  return JSON.stringify(norm);
}

/** HTML fragment: one or more bill links for the pricing table cell. */
export function formatBillLinksForEmailHtml(items: RfpBillDriveItem[]): string {
  if (items.length === 0) return "—";
  return items
    .map((it, idx) => {
      const url = escapeHtmlAttr(it.webViewLink);
      const label = escapeHtmlText(
        it.filename?.trim() || (items.length > 1 ? `Bill ${idx + 1}` : "Bill link")
      );
      return `<a href="${url}" style="font-weight:700;text-decoration:underline;">${label}</a>`;
    })
    .join(items.length > 1 ? "<br />" : "");
}

export function formatBillLinksForEmailText(items: RfpBillDriveItem[]): string {
  if (items.length === 0) return "—";
  return items
    .map((it, idx) => {
      const label = it.filename?.trim() || (items.length > 1 ? `Bill ${idx + 1}` : "Bill");
      return `${label}: ${it.webViewLink}`;
    })
    .join("\n");
}

function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeHtmlAttr(s: string): string {
  return escapeHtmlText(s);
}
