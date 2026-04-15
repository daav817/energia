export type PreparedInlineImage = {
  /** Value for `cid:` in HTML and inside `Content-ID` angle brackets. */
  contentId: string;
  mimeType: string;
  buffer: Buffer;
  filename: string;
};

function extForMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("gif")) return "gif";
  if (m.includes("webp")) return "webp";
  return "bin";
}

function parseDataImageUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const compact = dataUrl.replace(/\s+/g, "");
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i.exec(compact);
  if (!m) return null;
  try {
    const buffer = Buffer.from(m[2], "base64");
    if (!buffer.length) return null;
    return { mime: m[1], buffer };
  } catch {
    return null;
  }
}

/**
 * Replace `img` src data URLs with `cid:` references and collect parts for multipart MIME.
 * Dedupes identical data URLs so one part is reused. Outlook/Gmail handle cid; many block raw data: URLs.
 */
export function replaceDataUrlImagesWithCid(html: string): {
  html: string;
  inlineImages: PreparedInlineImage[];
} {
  const seen = new Map<string, string>();
  const inlineImages: PreparedInlineImage[] = [];

  const out = html.replace(
    /\bsrc\s*=\s*(["'])(data:image\/[a-z0-9.+-]+;base64,[\s\S]*?)\1/gi,
    (full, quote: string, dataUrl: string) => {
      const compact = dataUrl.replace(/\s+/g, "");
      let cid = seen.get(compact);
      if (!cid) {
        const parsed = parseDataImageUrl(compact);
        if (!parsed) return full;
        const n = inlineImages.length;
        cid = `energia-inline-${n}@energia-app.local`;
        seen.set(compact, cid);
        inlineImages.push({
          contentId: cid,
          mimeType: parsed.mime,
          buffer: parsed.buffer,
          filename: `embedded-image-${n}.${extForMime(parsed.mime)}`,
        });
      }
      return `src=${quote}cid:${cid}${quote}`;
    }
  );

  return { html: out, inlineImages };
}
