/**
 * Resolve a Google Drive folder id from pasted browser URLs or a raw id string.
 */
export function parseDriveFolderId(input: string): string | null {
  const raw = String(input || "").trim();
  if (!raw) return null;
  /** My Drive root as parent id in the Drive API */
  if (raw.toLowerCase() === "root") return "root";
  const foldersMatch = raw.match(/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]+)/);
  if (foldersMatch?.[1]) return foldersMatch[1];
  const openId = raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (openId?.[1]) return openId[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(raw)) return raw;
  return null;
}
