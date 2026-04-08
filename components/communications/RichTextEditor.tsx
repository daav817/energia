"use client";

import { useEffect, useMemo, useRef } from "react";
import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = {
  initialHtml: string;
  resetKey: string;
  onChangeHtml: (html: string) => void;
  disabled?: boolean;
  onAttachFiles?: (files: File[]) => void;
  /** When `nonce` changes, inserts HTML/text at the caret via `insertHTML` (for placeholders, etc.). */
  insertSnippet?: { nonce: number; html: string } | null;
};

function safeHtml(html: string): string {
  // Ensure we always set some HTML; empty string yields an uncontrolled-looking editor.
  return html || "";
}

export function RichTextEditor({
  initialHtml,
  resetKey,
  onChangeHtml,
  disabled = false,
  onAttachFiles,
  insertSnippet = null,
}: Props) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const onChangeHtmlRef = useRef(onChangeHtml);
  onChangeHtmlRef.current = onChangeHtml;

  const fontOptions = useMemo(
    () => [
      "Segoe UI",
      "Segoe UI Semibold",
      "Segoe UI Light",
      "Arial",
      "Helvetica",
      "Georgia",
      "Times New Roman",
      "Courier New",
      "Verdana",
      "Tahoma",
    ],
    []
  );

  useEffect(() => {
    if (!editorRef.current) return;
    editorRef.current.innerHTML = safeHtml(initialHtml);
  }, [resetKey]);

  useEffect(() => {
    const nonce = insertSnippet?.nonce;
    const html = insertSnippet?.html;
    if (nonce == null || disabled || html == null) return;
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    try {
      document.execCommand("insertHTML", false, html);
    } catch {
      /* ignore */
    }
    onChangeHtmlRef.current(el.innerHTML ?? "");
  }, [insertSnippet?.nonce, insertSnippet?.html, disabled]);

  const apply = (command: string, value?: string) => {
    if (disabled) return;
    editorRef.current?.focus();
    try {
      document.execCommand(command, false, value);
    } catch {
      // Ignore unsupported commands.
    }
    // Push current HTML state back to parent after command.
    const html = editorRef.current?.innerHTML ?? "";
    onChangeHtml(html);
  };

  const getClosestLi = (node: Node | null): HTMLLIElement | null => {
    let cur: Node | null = node;
    while (cur) {
      if (cur instanceof HTMLElement && cur.tagName === "LI") return cur as HTMLLIElement;
      cur = cur.parentNode;
    }
    return null;
  };

  const moveCaretToEndOf = (el: HTMLElement) => {
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  };

  const indentListItem = () => {
    if (disabled) return;
    editorRef.current?.focus();

    const sel = window.getSelection();
    const li = getClosestLi(sel?.anchorNode ?? null);
    if (!li) {
      apply("indent");
      return;
    }

    const prev = li.previousElementSibling as HTMLLIElement | null;
    if (!prev) return;

    let nestedUl = prev.querySelector(":scope > ul") as HTMLUListElement | null;
    if (!nestedUl) {
      nestedUl = document.createElement("ul");
      prev.appendChild(nestedUl);
    }

    nestedUl.appendChild(li);
    moveCaretToEndOf(li);

    const html = editorRef.current?.innerHTML ?? "";
    onChangeHtml(html);
  };

  const outdentListItem = () => {
    if (disabled) return;
    editorRef.current?.focus();

    const sel = window.getSelection();
    const li = getClosestLi(sel?.anchorNode ?? null);
    if (!li) {
      apply("outdent");
      return;
    }

    const parentUl = li.parentElement;
    if (!parentUl || parentUl.tagName !== "UL") return;

    const parentLi = parentUl.parentElement;
    if (!parentLi || parentLi.tagName !== "LI") return; // already top-level

    const grandUl = parentLi.parentElement;
    if (!grandUl || grandUl.tagName !== "UL") return;

    grandUl.insertBefore(li, parentLi.nextSibling);
    if (parentUl.children.length === 0) parentUl.remove();

    moveCaretToEndOf(li);
    const html = editorRef.current?.innerHTML ?? "";
    onChangeHtml(html);
  };

  const handleInsertLink = () => {
    if (disabled) return;
    editorRef.current?.focus();
    const url = window.prompt("Enter URL for the link:");
    if (!url) return;

    const sel = window.getSelection();
    const isCollapsed = sel ? sel.isCollapsed : true;

    // If there's no selection, insert a basic "link" anchor.
    if (isCollapsed) {
      const safeUrl = url.replace(/"/g, "&quot;");
      try {
        document.execCommand("insertHTML", false, `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">link</a>`);
      } catch {
        // ignore
      }
      const html = editorRef.current?.innerHTML ?? "";
      onChangeHtml(html);
      return;
    }

    // Otherwise wrap the selection.
    apply("createLink", url);
  };

  const handleInput = () => {
    const html = editorRef.current?.innerHTML ?? "";
    onChangeHtml(html);
  };

  const handleAttachFiles = () => {
    if (disabled) return;
    if (!onAttachFiles) return;
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "*/*";
    input.onchange = () => {
      if (input.files?.length) onAttachFiles(Array.from(input.files));
    };
    input.click();
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 border rounded-md p-2 bg-muted/20">
        <Button type="button" variant="outline" size="sm" onClick={() => apply("undo")} disabled={disabled} title="Undo">
          Undo
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => apply("redo")} disabled={disabled} title="Redo">
          Redo
        </Button>

        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          defaultValue="Arial"
          onChange={(e) => apply("fontName", e.target.value)}
          disabled={disabled}
          title="Font"
        >
          {fontOptions.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>

        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          defaultValue="3"
          onChange={(e) => apply("fontSize", e.target.value)}
          disabled={disabled}
          title="Font Size"
        >
          <option value="1">Small</option>
          <option value="2">Slightly Small</option>
          <option value="3">Normal</option>
          <option value="4">Large</option>
          <option value="5">Larger</option>
          <option value="6">Huge</option>
          <option value="7">Very Huge</option>
        </select>

        <div className="flex items-center gap-1">
          <Button type="button" variant="outline" size="sm" onClick={() => apply("bold")} disabled={disabled} title="Bold">
            <span className="font-bold">B</span>
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => apply("italic")} disabled={disabled} title="Italics">
            <span className="italic">I</span>
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => apply("underline")} disabled={disabled} title="Underline">
            <span className="underline">U</span>
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => apply("strikeThrough")} disabled={disabled} title="Strike-through">
            <span className="line-through">S</span>
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Input
            type="color"
            className="h-9 w-10 p-1"
            disabled={disabled}
            defaultValue="#000000"
            onChange={(e) => apply("foreColor", e.target.value)}
            title="Text Color"
          />
        </div>

        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          defaultValue="left"
          onChange={(e) => {
            const v = e.target.value;
            if (v === "left") apply("justifyLeft");
            else if (v === "center") apply("justifyCenter");
            else if (v === "right") apply("justifyRight");
            else if (v === "justify") apply("justifyFull");
          }}
          disabled={disabled}
          title="Align"
        >
          <option value="left">Align Left</option>
          <option value="center">Align Center</option>
          <option value="right">Align Right</option>
          <option value="justify">Justify</option>
        </select>

        <div className="flex items-center gap-1">
          <Button type="button" variant="outline" size="sm" onClick={() => apply("insertOrderedList")} disabled={disabled} title="Numbered list">
            1.
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => apply("insertUnorderedList")} disabled={disabled} title="Bulleted list">
            •
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button type="button" variant="outline" size="sm" onClick={outdentListItem} disabled={disabled} title="Indent less">
            Indent less
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={indentListItem} disabled={disabled} title="Indent more">
            Indent more
          </Button>
        </div>

        <Button type="button" variant="outline" size="sm" onClick={() => apply("removeFormat")} disabled={disabled} title="Remove formatting">
          Remove formatting
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAttachFiles}
          disabled={disabled || !onAttachFiles}
          title="Attach file"
        >
          <Paperclip className="mr-1 h-4 w-4" />
          Attach
        </Button>

        <Button type="button" variant="outline" size="sm" onClick={handleInsertLink} disabled={disabled} title="Insert hyperlink">
          Link
        </Button>

        <Button type="button" variant="outline" size="sm" onClick={() => apply("formatBlock", "blockquote")} disabled={disabled} title="Quote">
          Quote
        </Button>
      </div>

      <div
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={handleInput}
        className="rich-text-editor min-h-[260px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
      />
    </div>
  );
}

