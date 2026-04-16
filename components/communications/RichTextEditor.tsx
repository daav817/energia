"use client";

import { useEffect, useMemo, useRef, type ClipboardEvent } from "react";
import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = {
  initialHtml: string;
  resetKey: string;
  onChangeHtml: (html: string) => void;
  disabled?: boolean;
  onAttachFiles?: (files: File[]) => void;
  /** When `nonce` changes, inserts HTML/text at the caret via `insertHTML` (for placeholders, etc.). */
  insertSnippet?: { nonce: number; html: string } | null;
  /**
   * Use in a flex column with bounded height: toolbar stays compact; editor grows and scrolls.
   * Parent should be `flex flex-col min-h-0` with `flex-1` on this component’s wrapper.
   */
  fillHeight?: boolean;
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
  fillHeight = false,
}: Props) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const onChangeHtmlRef = useRef(onChangeHtml);
  onChangeHtmlRef.current = onChangeHtml;
  /** Prevents re-running `insertHTML` when `disabled` flips (e.g. test send) with the same snippet. */
  const lastAppliedInsertNonceRef = useRef<number | null>(null);

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
    lastAppliedInsertNonceRef.current = null;
  }, [resetKey]);

  useEffect(() => {
    const nonce = insertSnippet?.nonce;
    const html = insertSnippet?.html;
    if (nonce == null || disabled || html == null) return;
    if (lastAppliedInsertNonceRef.current === nonce) return;
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    try {
      document.execCommand("insertHTML", false, html);
    } catch {
      /* ignore */
    }
    lastAppliedInsertNonceRef.current = nonce;
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

  const handlePaste = (e: ClipboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const items = e.clipboardData?.items;
    if (items?.length) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const el = editorRef.current;
        if (!el) continue;
        el.focus();
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = typeof reader.result === "string" ? reader.result : "";
          if (!dataUrl || !editorRef.current) return;
          const safe = dataUrl.replace(/"/g, "&quot;");
          try {
            document.execCommand(
              "insertHTML",
              false,
              `<img src="${safe}" alt="" style="max-width:100%;height:auto;display:block;" />`
            );
          } catch {
            /* ignore */
          }
          onChangeHtmlRef.current(editorRef.current.innerHTML ?? "");
        };
        reader.readAsDataURL(file);
        return;
      }
    }
    // Text / rich paste: ensure parent state updates (some browsers skip input on paste).
    window.setTimeout(() => {
      const el = editorRef.current;
      if (el) onChangeHtmlRef.current(el.innerHTML ?? "");
    }, 0);
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

  const tb = fillHeight ? "h-7 px-2 text-xs" : "h-9 text-sm";
  const tbBtn = fillHeight ? "h-7 px-2 text-xs" : "";

  return (
    <div className={cn(fillHeight ? "flex min-h-0 flex-1 flex-col gap-1.5" : "space-y-2")}>
      <div
        className={cn(
          "flex flex-wrap items-center border rounded-md bg-muted/20",
          fillHeight ? "shrink-0 gap-1 p-1.5" : "gap-2 p-2"
        )}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(tbBtn)}
          onClick={() => apply("undo")}
          disabled={disabled}
          title="Undo"
        >
          Undo
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(tbBtn)}
          onClick={() => apply("redo")}
          disabled={disabled}
          title="Redo"
        >
          Redo
        </Button>

        <select
          className={cn(
            "rounded-md border border-input bg-background px-2",
            tb
          )}
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
          className={cn("rounded-md border border-input bg-background px-2", tb)}
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

        <div className={cn("flex items-center", fillHeight ? "gap-0.5" : "gap-1")}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(tbBtn)}
            onClick={() => apply("bold")}
            disabled={disabled}
            title="Bold"
          >
            <span className="font-bold">B</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(tbBtn)}
            onClick={() => apply("italic")}
            disabled={disabled}
            title="Italics"
          >
            <span className="italic">I</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(tbBtn)}
            onClick={() => apply("underline")}
            disabled={disabled}
            title="Underline"
          >
            <span className="underline">U</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(tbBtn)}
            onClick={() => apply("strikeThrough")}
            disabled={disabled}
            title="Strike-through"
          >
            <span className="line-through">S</span>
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Input
            type="color"
            className={cn(fillHeight ? "h-7 w-9 p-0.5" : "h-9 w-10 p-1")}
            disabled={disabled}
            defaultValue="#000000"
            onChange={(e) => apply("foreColor", e.target.value)}
            title="Text Color"
          />
        </div>

        <select
          className={cn("rounded-md border border-input bg-background px-2", tb)}
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

        <div className={cn("flex items-center", fillHeight ? "gap-0.5" : "gap-1")}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(tbBtn)}
            onClick={() => apply("insertOrderedList")}
            disabled={disabled}
            title="Numbered list"
          >
            1.
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(tbBtn)}
            onClick={() => apply("insertUnorderedList")}
            disabled={disabled}
            title="Bulleted list"
          >
            •
          </Button>
        </div>

        <div className={cn("flex items-center", fillHeight ? "gap-0.5" : "gap-1")}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(tbBtn)}
            onClick={outdentListItem}
            disabled={disabled}
            title="Indent less"
          >
            Indent less
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(tbBtn)}
            onClick={indentListItem}
            disabled={disabled}
            title="Indent more"
          >
            Indent more
          </Button>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(tbBtn)}
          onClick={() => apply("removeFormat")}
          disabled={disabled}
          title="Remove formatting"
        >
          Remove formatting
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(tbBtn)}
          onClick={handleAttachFiles}
          disabled={disabled || !onAttachFiles}
          title="Attach file"
        >
          <Paperclip className={cn("mr-1", fillHeight ? "h-3.5 w-3.5" : "h-4 w-4")} />
          Attach
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(tbBtn)}
          onClick={handleInsertLink}
          disabled={disabled}
          title="Insert hyperlink"
        >
          Link
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(tbBtn)}
          onClick={() => apply("formatBlock", "blockquote")}
          disabled={disabled}
          title="Quote"
        >
          Quote
        </Button>
      </div>

      <div
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={handleInput}
        onPaste={handlePaste}
        className={cn(
          "rich-text-editor w-full rounded-md border border-input bg-background outline-none focus:ring-1 focus:ring-ring",
          fillHeight
            ? "min-h-[120px] flex-1 overflow-y-auto px-2 py-1.5 text-sm"
            : "min-h-[260px] px-3 py-2 text-sm"
        )}
      />
    </div>
  );
}

