/**
 * Shared DOM transforms for customer quote email HTML (browser + linkedom server).
 * Mirrors RFP email patterns: explicit inline styles on every block, no reliance on client inheritance.
 */

export const WRAPPER_OPEN = `<div style="font-family: Arial, Helvetica, sans-serif; color: #111111; line-height: 1.4; font-size: 14px;">`;
export const WRAPPER_CLOSE = `</div>`;

export const BLOCK_TEXT =
  "font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.375; color: #111111;";

export function mergeStyleAttr(el: HTMLElement, fragment: string) {
  const cur = (el.getAttribute("style") || "").trim().replace(/;+\s*$/, "");
  const next = [cur, fragment].filter(Boolean).join("; ").replace(/\s*;\s*;/g, "; ");
  el.setAttribute("style", next);
}

type MinimalDocument = {
  createElement: (tag: string) => HTMLElement;
};

export function unwrapTablesFromParagraphsInHost(host: HTMLElement): void {
  let guard = 0;
  while (guard++ < 200) {
    const table = host.querySelector("p > table");
    if (!table) break;
    const p = table.parentElement;
    if (!p || p.tagName !== "P") break;
    p.parentNode?.insertBefore(table, p);
    const textLeft = (p.textContent || "").trim();
    if (!textLeft && p.children.length === 0) p.remove();
  }

  guard = 0;
  while (guard++ < 200) {
    const div = host.querySelector("p > div");
    if (!div) break;
    const p = div.parentElement;
    if (!p || p.tagName !== "P") break;
    if (p.children.length !== 1 || p.children[0] !== div) break;
    const textOutside = Array.from(p.childNodes).some(
      (n) => n.nodeType === 3 && (n.textContent || "").trim() !== ""
    );
    if (textOutside) break;
    p.parentNode?.insertBefore(div, p);
    p.remove();
  }
}

/** Gmail handles strong/em + explicit styles more consistently than raw b/i from execCommand. */
export function normalizeBoldItalicInHost(host: HTMLElement, doc: MinimalDocument): void {
  for (const b of Array.from(host.querySelectorAll("b"))) {
    const strong = doc.createElement("strong");
    strong.innerHTML = b.innerHTML;
    mergeStyleAttr(strong, "font-weight: 700;");
    b.parentNode?.replaceChild(strong, b);
  }
  for (const i of Array.from(host.querySelectorAll("i"))) {
    const em = doc.createElement("em");
    em.innerHTML = i.innerHTML;
    mergeStyleAttr(em, "font-style: italic;");
    i.parentNode?.replaceChild(em, i);
  }
}

export function inlineQuoteRichTextInHost(host: HTMLElement, doc: MinimalDocument): void {
  for (const el of Array.from(host.querySelectorAll("[class]"))) {
    el.removeAttribute("class");
  }

  for (const font of Array.from(host.querySelectorAll("font"))) {
    const span = doc.createElement("span");
    const face = font.getAttribute("face");
    const size = font.getAttribute("size");
    const color = font.getAttribute("color");
    const sizeMap: Record<string, string> = {
      "1": "10px",
      "2": "12px",
      "3": "14px",
      "4": "16px",
      "5": "18px",
      "6": "24px",
      "7": "36px",
    };
    const parts: string[] = [BLOCK_TEXT];
    if (face) parts.push(`font-family: ${face.replace(/"/g, "")}`);
    if (color) parts.push(`color: ${color}`);
    if (size) parts.push(`font-size: ${sizeMap[size] ?? "14px"}`);
    span.setAttribute("style", parts.join("; "));
    span.innerHTML = font.innerHTML;
    font.parentNode?.replaceChild(span, font);
  }

  for (const el of Array.from(host.querySelectorAll("p"))) {
    if (el.closest("table")) continue;
    const st = (el.getAttribute("style") || "").trim();
    const hasColor = /color\s*:/i.test(st);
    mergeStyleAttr(
      el as HTMLElement,
      `margin: 0 0 12px 0; font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.375${
        hasColor ? "" : "; color: #111111"
      }`
    );
  }

  for (const el of Array.from(host.querySelectorAll("div"))) {
    if (el.closest("table")) continue;
    const hasOnlyTable = el.children.length === 1 && el.children[0]!.tagName === "TABLE";
    if (hasOnlyTable) {
      mergeStyleAttr(el as HTMLElement, "margin: 12px 0;");
      continue;
    }
    mergeStyleAttr(el as HTMLElement, `margin: 0 0 12px 0; ${BLOCK_TEXT}`);
  }

  for (const el of Array.from(host.querySelectorAll("ul, ol"))) {
    if (el.closest("table")) continue;
    mergeStyleAttr(el as HTMLElement, `margin: 0 0 12px 0; padding-left: 24px; ${BLOCK_TEXT}`);
  }

  for (const el of Array.from(host.querySelectorAll("li"))) {
    if (el.closest("table")) continue;
    mergeStyleAttr(el as HTMLElement, `margin: 0 0 4px 0; ${BLOCK_TEXT}`);
  }

  for (const el of Array.from(host.querySelectorAll("a"))) {
    mergeStyleAttr(el as HTMLElement, "color: #0556b3; text-decoration: underline;");
  }

  for (const el of Array.from(host.querySelectorAll("img"))) {
    mergeStyleAttr(
      el as HTMLElement,
      "max-width: 100%; height: auto; display: block; border: 0; outline: none;"
    );
  }

  for (const el of Array.from(host.querySelectorAll("h1, h2, h3, h4"))) {
    if (el.closest("table")) continue;
    mergeStyleAttr(el as HTMLElement, `margin: 16px 0 8px 0; font-weight: bold; ${BLOCK_TEXT}`);
  }

  for (const strong of Array.from(host.querySelectorAll("strong"))) {
    if (strong.closest("table")) continue;
    mergeStyleAttr(strong, "font-weight: 700;");
  }
}

export function finalizeQuoteEmailFragment(html: string, doc: MinimalDocument): string {
  const host = doc.createElement("div");
  host.innerHTML = html;
  unwrapTablesFromParagraphsInHost(host);
  normalizeBoldItalicInHost(host, doc);
  inlineQuoteRichTextInHost(host, doc);
  return host.innerHTML;
}

export function wrapQuoteEmailDocument(html: string): string {
  const t = html.trim();
  if (!t) return `${WRAPPER_OPEN}<p></p>${WRAPPER_CLOSE}`;
  return `${WRAPPER_OPEN}${t}${WRAPPER_CLOSE}`;
}
