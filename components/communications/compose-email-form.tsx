"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Send, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { ComposeBrokerInsertMenu } from "@/components/compose-broker-insert-menu";
import { RichTextEditor } from "@/components/communications/RichTextEditor";

function extractEmail(str: string): string {
  const match = str.match(/<([^>]+)>/);
  return match ? match[1] : str.trim();
}

type Suggestion = { name: string; email: string; source?: string };

export function stripHtmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** True if the compose body should allow send: visible text and/or embedded images (paste), etc. */
export function composeEmailBodyHasContent(html: string): boolean {
  if (stripHtmlToText(html).trim().length > 0) return true;
  const h = html.toLowerCase();
  if (/<img[\s/>]/.test(h)) return true;
  if (/<picture[\s>]/.test(h)) return true;
  return false;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function plainTextToHtml(text: string): string {
  return escapeHtml(text || "").replace(/\r?\n/g, "<br/>");
}

export type ComposeEmailFormProps = {
  formId?: string;
  /** Page shows large title; dialog uses compact header + optional close. */
  layout?: "page" | "dialog";
  onClose?: () => void;
  /** If set, called after successful send instead of navigating away. */
  onSent?: () => void;
  /** When true (default), navigate to /inbox after send if `onSent` is not provided. */
  navigateToInboxAfterSend?: boolean;
  replyId?: string | null;
  forwardId?: string | null;
  initialTo?: string | null;
};

export function ComposeEmailForm({
  formId = "energia-compose-form",
  layout = "page",
  onClose,
  onSent,
  navigateToInboxAfterSend = true,
  replyId = null,
  forwardId = null,
  initialTo = null,
}: ComposeEmailFormProps) {
  const router = useRouter();
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [composeEditorKey, setComposeEditorKey] = useState(0);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ success?: boolean; error?: string } | null>(null);
  const [loadingReply, setLoadingReply] = useState(false);
  const [toSuggestions, setToSuggestions] = useState<Suggestion[]>([]);
  const [ccSuggestions, setCcSuggestions] = useState<Suggestion[]>([]);
  const [bccSuggestions, setBccSuggestions] = useState<Suggestion[]>([]);
  const [toSuggestOpen, setToSuggestOpen] = useState(false);
  const [ccSuggestOpen, setCcSuggestOpen] = useState(false);
  const [bccSuggestOpen, setBccSuggestOpen] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const toInputRef = useRef<HTMLInputElement>(null);
  const ccInputRef = useRef<HTMLInputElement>(null);
  const bccInputRef = useRef<HTMLInputElement>(null);
  const brokerInsertNonce = useRef(0);
  const [brokerInsertSnippet, setBrokerInsertSnippet] = useState<{ nonce: number; html: string } | null>(null);

  const insertBrokerAtCaret = useCallback((text: string) => {
    brokerInsertNonce.current += 1;
    const html = escapeHtml(text).replace(/\r?\n/g, "<br/>");
    setBrokerInsertSnippet({ nonce: brokerInsertNonce.current, html });
  }, []);

  useEffect(() => {
    if (initialTo && !replyId && !forwardId) {
      setTo(decodeURIComponent(initialTo));
    }
  }, [initialTo, replyId, forwardId]);

  const fetchSuggestions = useCallback(async (q: string, setter: (s: Suggestion[]) => void) => {
    if (!q || q.length < 2) {
      setter([]);
      return;
    }
    try {
      const [dbRes, googleRes] = await Promise.all([
        fetch(`/api/contacts/suggest?q=${encodeURIComponent(q)}&limit=10`),
        fetch(`/api/contacts/google-suggest?q=${encodeURIComponent(q)}&limit=10`),
      ]);
      const dbData = await dbRes.json();
      const googleData = await googleRes.json();
      const dbList = Array.isArray(dbData) ? dbData : [];
      const googleList = Array.isArray(googleData) ? googleData : [];
      const seen = new Set<string>();
      const merged: Suggestion[] = [];
      for (const s of [...dbList, ...googleList]) {
        const key = (s.email || "").toLowerCase();
        if (key && !seen.has(key)) {
          seen.add(key);
          merged.push(s);
        }
      }
      setter(merged.slice(0, 15));
    } catch {
      setter([]);
    }
  }, []);

  useEffect(() => {
    const lastPart = to.split(",").pop()?.trim() || "";
    if (lastPart.length >= 2) {
      fetchSuggestions(lastPart, setToSuggestions);
      setToSuggestOpen(true);
    } else {
      setToSuggestions([]);
      setToSuggestOpen(false);
    }
  }, [to, fetchSuggestions]);

  useEffect(() => {
    const lastPart = cc.split(",").pop()?.trim() || "";
    if (lastPart.length >= 2) {
      fetchSuggestions(lastPart, setCcSuggestions);
      setCcSuggestOpen(true);
    } else {
      setCcSuggestions([]);
      setCcSuggestOpen(false);
    }
  }, [cc, fetchSuggestions]);

  useEffect(() => {
    const lastPart = bcc.split(",").pop()?.trim() || "";
    if (lastPart.length >= 2) {
      fetchSuggestions(lastPart, setBccSuggestions);
      setBccSuggestOpen(true);
    } else {
      setBccSuggestions([]);
      setBccSuggestOpen(false);
    }
  }, [bcc, fetchSuggestions]);

  useEffect(() => {
    if (!replyId && !forwardId) return;
    setLoadingReply(true);
    fetch(`/api/emails/${replyId || forwardId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        if (replyId) {
          setTo(extractEmail(data.from));
          setCc("");
          setBcc("");
          setSubject(data.subject?.startsWith("Re:") ? data.subject : `Re: ${data.subject || ""}`);
          const quoted = `\n\nOn ${data.date}, ${data.from} wrote:\n${(data.body || "").replace(/^/gm, "> ")}`;
          setBodyHtml(plainTextToHtml(quoted));
          setComposeEditorKey((k) => k + 1);
        } else {
          setTo("");
          setCc("");
          setBcc("");
          setSubject(data.subject?.startsWith("Fwd:") ? data.subject : `Fwd: ${data.subject || ""}`);
          const quoted = `\n\n---------- Forwarded message ---------\nFrom: ${data.from}\nDate: ${data.date}\nTo: ${data.to}\nSubject: ${data.subject}\n\n${data.body || ""}`;
          setBodyHtml(plainTextToHtml(quoted));
          setComposeEditorKey((k) => k + 1);
        }
      })
      .catch(() => setResult({ error: "Failed to load email" }))
      .finally(() => setLoadingReply(false));
  }, [replyId, forwardId]);

  const addFiles = useCallback((files: FileList | null) => {
    if (files?.length) {
      setAttachments((prev) => [...prev, ...Array.from(files)]);
    }
  }, []);

  const addFilesFromEditor = useCallback((files: File[]) => {
    if (!files?.length) return;
    setAttachments((prev) => [...prev, ...files]);
  }, []);

  const triggerFileInput = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "*/*";
    input.style.position = "fixed";
    input.style.left = "-9999px";
    const cleanup = () => {
      input.remove();
      window.removeEventListener("focus", cleanup);
    };
    input.onchange = () => {
      if (input.files?.length) {
        setAttachments((prev) => [...prev, ...Array.from(input.files!)]);
      }
      cleanup();
    };
    window.addEventListener("focus", cleanup);
    document.body.appendChild(input);
    input.click();
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    addFiles(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setResult(null);
    try {
      const toList = to.split(",").map((e) => e.trim()).filter(Boolean);
      const ccList = cc ? cc.split(",").map((e) => e.trim()).filter(Boolean) : [];
      const bccList = bcc ? bcc.split(",").map((e) => e.trim()).filter(Boolean) : [];
      const bodyText = stripHtmlToText(bodyHtml);

      let res: Response;
      if (attachments.length > 0) {
        const formData = new FormData();
        formData.append("to", JSON.stringify(toList));
        formData.append("cc", JSON.stringify(ccList));
        formData.append("bcc", JSON.stringify(bccList));
        formData.append("subject", subject);
        formData.append("body", bodyText);
        formData.append("html", bodyHtml);
        attachments.forEach((file) => formData.append("attachments", file));
        res = await fetch("/api/emails/send", {
          method: "POST",
          body: formData,
        });
      } else {
        res = await fetch("/api/emails/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: toList,
            cc: ccList.length ? ccList : undefined,
            bcc: bccList.length ? bccList : undefined,
            subject,
            body: bodyText,
            html: bodyHtml || undefined,
          }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send");
      setResult({ success: true });
      setTo("");
      setCc("");
      setBcc("");
      setSubject("");
      setBodyHtml("");
      setComposeEditorKey((k) => k + 1);
      setAttachments([]);
      if (onSent) {
        onSent();
      } else if (navigateToInboxAfterSend) {
        router.push("/inbox");
      }
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : "Failed to send" });
    } finally {
      setSending(false);
    }
  };

  const header = (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        {layout === "page" ? (
          <>
            <h1 className="text-3xl font-bold tracking-tight">Compose Email</h1>
            <p className="text-muted-foreground mt-1">
              Send emails to customers and suppliers via your Gmail account.
              {replyId ? " Replying to an email." : forwardId ? " Forwarding an email." : ""}
            </p>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold tracking-tight">Compose email</h2>
            <p className="text-muted-foreground text-sm mt-0.5">
              {replyId ? "Reply" : forwardId ? "Forward" : "New message"}
            </p>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        {layout === "dialog" && onClose ? (
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={triggerFileInput}>
          <Paperclip className="mr-2 h-4 w-4" />
          Attachments
        </Button>
        <Button
          type="submit"
          form={formId}
          size="sm"
          disabled={sending || !composeEmailBodyHasContent(bodyHtml)}
        >
          {sending ? (
            <>Sending…</>
          ) : (
            <>
              <Send className="mr-2 h-4 w-4" />
              Send Email
            </>
          )}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {header}
      <Card className={layout === "dialog" ? "border-0 shadow-none" : undefined}>
        <CardContent className={layout === "dialog" ? "px-0 pt-0" : "pt-6"}>
          {loadingReply && <p className="text-sm text-muted-foreground mb-4">Loading email…</p>}
          <form id={formId} onSubmit={handleSend} className="space-y-4">
            <div className="grid gap-2 relative">
              <Label htmlFor={formId + "-to"}>To *</Label>
              <Input
                ref={toInputRef}
                id={formId + "-to"}
                placeholder="Start typing for suggestions (customers, suppliers, contacts)"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                onBlur={() => setTimeout(() => setToSuggestOpen(false), 150)}
                onFocus={() => toSuggestions.length > 0 && setToSuggestOpen(true)}
                required
              />
              {toSuggestOpen && toSuggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-md border bg-popover py-1 shadow-md max-h-48 overflow-auto">
                  {toSuggestions.map((s) => (
                    <button
                      key={`${s.email}-${s.name}`}
                      type="button"
                      className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => {
                        const parts = to.split(",").slice(0, -1);
                        const add = parts.length ? `, ${s.email}` : s.email;
                        setTo((parts.join(", ") || "") + add);
                        setToSuggestOpen(false);
                      }}
                    >
                      <span className="font-medium">{s.name}</span>
                      <span className="text-muted-foreground text-xs">{s.email}</span>
                      {s.source && <span className="text-xs text-primary/80">{s.source}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid gap-2 relative">
              <Label htmlFor={formId + "-cc"}>Cc</Label>
              <Input
                ref={ccInputRef}
                id={formId + "-cc"}
                placeholder="Optional - start typing for suggestions"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                onBlur={() => setTimeout(() => setCcSuggestOpen(false), 150)}
                onFocus={() => ccSuggestions.length > 0 && setCcSuggestOpen(true)}
              />
              {ccSuggestOpen && ccSuggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-md border bg-popover py-1 shadow-md max-h-48 overflow-auto">
                  {ccSuggestions.map((s) => (
                    <button
                      key={`${s.email}-${s.name}`}
                      type="button"
                      className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => {
                        const parts = cc.split(",").slice(0, -1);
                        const add = parts.length ? `, ${s.email}` : s.email;
                        setCc((parts.join(", ") || "") + add);
                        setCcSuggestOpen(false);
                      }}
                    >
                      <span className="font-medium">{s.name}</span>
                      <span className="text-muted-foreground text-xs">{s.email}</span>
                      {s.source && <span className="text-xs text-primary/80">{s.source}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid gap-2 relative">
              <Label htmlFor={formId + "-bcc"}>Bcc</Label>
              <Input
                ref={bccInputRef}
                id={formId + "-bcc"}
                placeholder="Optional - start typing for suggestions"
                value={bcc}
                onChange={(e) => setBcc(e.target.value)}
                onBlur={() => setTimeout(() => setBccSuggestOpen(false), 150)}
                onFocus={() => bccSuggestions.length > 0 && setBccSuggestOpen(true)}
              />
              {bccSuggestOpen && bccSuggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-md border bg-popover py-1 shadow-md max-h-48 overflow-auto">
                  {bccSuggestions.map((s) => (
                    <button
                      key={`${s.email}-${s.name}-bcc`}
                      type="button"
                      className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => {
                        const parts = bcc.split(",").slice(0, -1);
                        const add = parts.length ? `, ${s.email}` : s.email;
                        setBcc((parts.join(", ") || "") + add);
                        setBccSuggestOpen(false);
                      }}
                    >
                      <span className="font-medium">{s.name}</span>
                      <span className="text-muted-foreground text-xs">{s.email}</span>
                      {s.source && <span className="text-xs text-primary/80">{s.source}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor={formId + "-subject"}>Subject</Label>
              <Input
                id={formId + "-subject"}
                placeholder="Email subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="mb-0">Message</Label>
                <ComposeBrokerInsertMenu disabled={sending} onInsert={insertBrokerAtCaret} />
              </div>
              <RichTextEditor
                initialHtml={bodyHtml}
                resetKey={`compose-${composeEditorKey}`}
                onChangeHtml={(html) => setBodyHtml(html)}
                disabled={sending}
                onAttachFiles={addFilesFromEditor}
                insertSnippet={brokerInsertSnippet}
              />
            </div>
            <div className="grid gap-2">
              <Label>Attached files</Label>
              <div
                className="rounded-lg border-2 border-dashed border-muted-foreground/25 bg-muted/30 p-4 transition-colors hover:border-muted-foreground/40 hover:bg-muted/50"
                onDrop={handleDrop}
                onDragOver={handleDragOver}
              >
                <p className="text-sm text-muted-foreground mb-2">
                  Drag and drop files here or use <strong>Attachments</strong> above.
                </p>
                {attachments.length > 0 ? (
                  <ul className="flex flex-wrap gap-2">
                    {attachments.map((file, i) => (
                      <li
                        key={`${file.name}-${file.size}-${i}`}
                        className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                      >
                        <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate max-w-[200px]" title={file.name}>
                          {file.name}
                        </span>
                        <span className="shrink-0 text-muted-foreground text-xs">
                          {(file.size / 1024).toFixed(1)} KB
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            removeAttachment(i);
                          }}
                          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          aria-label={"Remove " + file.name}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">No attachments yet</p>
                )}
              </div>
            </div>
            {result?.success && layout === "page" && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
                Email sent successfully.
              </div>
            )}
            {result?.error && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                {result.error}
              </div>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
