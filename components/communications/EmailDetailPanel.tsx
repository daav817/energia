"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  Trash2,
  Star,
  ExternalLink,
  X,
  Reply,
  Forward,
  Mail,
  FolderPlus,
  Paperclip,
} from "lucide-react";
import { RichTextEditor } from "@/components/communications/RichTextEditor";

/** Replace cid:... references in HTML with attachment URLs so embedded images display. */
function replaceCidWithAttachmentUrls(
  bodyHtml: string,
  messageId: string,
  inlineImages: Record<string, { attachmentId: string; mimeType: string }>
): string {
  if (Object.keys(inlineImages).length === 0) return bodyHtml;
  return bodyHtml.replace(/cid:([^"'\s>]+)/gi, (_, cidValue: string) => {
    const normalized = cidValue.replace(/^<|>$/g, "").trim();
    const info = inlineImages[normalized];
    if (info) {
      return `/api/emails/${messageId}/attachments/${info.attachmentId}?mimeType=${encodeURIComponent(info.mimeType)}`;
    }
    return "cid:" + cidValue;
  });
}

function restoreAttachmentUrlsToCid(
  bodyHtml: string,
  messageId: string,
  inlineImages: Record<string, { attachmentId: string; mimeType: string }>
): string {
  // Convert /api .../attachments URLs back to cid:... so Gmail can keep inline images.
  let out = bodyHtml;
  for (const [cidValue, info] of Object.entries(inlineImages)) {
    const url = `/api/emails/${messageId}/attachments/${info.attachmentId}?mimeType=${encodeURIComponent(info.mimeType)}`;
    out = out.split(url).join(`cid:${cidValue}`);
  }
  return out;
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
  const escaped = escapeHtml(text || "");
  return escaped.replace(/\r?\n/g, "<br/>");
}

function stripHtmlToText(html: string): string {
  // Very lightweight HTML-to-text conversion for the draft editor.
  // We intentionally avoid bringing in additional dependencies.
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type EmailMessage = {
  id: string;
  draftId?: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  labelIds?: string[];
};

type EmailDetail = {
  body: string;
  bodyHtml: string;
  subject: string;
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  date: string;
  labelIds: string[];
  attachments?: {
    attachmentId: string;
    filename: string;
    mimeType: string;
    size: number;
  }[];
  /** Map Content-ID (no angle brackets) -> { attachmentId, mimeType } for embedded images (cid:) */
  inlineImages?: Record<string, { attachmentId: string; mimeType: string }>;
};

type Suggestion = { name: string; email: string; source?: string };

type Props = {
  email: EmailMessage;
  detail: EmailDetail | null;
  detailLoading: boolean;
  selectedLabel?: string;
  onModify: (
    id: string,
    opts: { addLabelIds?: string[]; removeLabelIds?: string[]; trash?: boolean; untrash?: boolean }
  ) => void;
  onClose: () => void;
  onOpenInNewWindow: (email: EmailMessage) => void;
  onReply: (email: EmailMessage) => void;
  onForward: (email: EmailMessage) => void;
  onMoveToFolder?: () => void;
  isPopout?: boolean;
  /** Inline iframe / modal: message body only, no action toolbars. */
  embed?: boolean;
};

export function EmailDetailPanel({
  email,
  detail,
  detailLoading,
  selectedLabel,
  onModify,
  onClose,
  onOpenInNewWindow,
  onReply,
  onForward,
  onMoveToFolder,
  isPopout = false,
  embed = false,
}: Props) {
  const isStarred = email.labelIds?.includes("STARRED");
  const isInTrash = email.labelIds?.includes("TRASH");
  const isDraft = email.labelIds?.includes("DRAFT");
  const hasAttachments = (detail?.attachments && detail.attachments.length > 0) || false;

  const [editingDraft, setEditingDraft] = useState(false);
  const [draftSubject, setDraftSubject] = useState("");
  const [draftTo, setDraftTo] = useState("");
  const [draftCc, setDraftCc] = useState("");
  const [draftBcc, setDraftBcc] = useState("");
  const [draftHtml, setDraftHtml] = useState("");
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftInitializedForEmailId, setDraftInitializedForEmailId] = useState<string | null>(null);
  const [draftAutoSaving, setDraftAutoSaving] = useState(false);
  const [draftAutoSaveStatus, setDraftAutoSaveStatus] = useState<string | null>(null);
  const lastDraftAutoSavedRef = useRef<{ subject: string; html: string; to: string; cc: string; bcc: string } | null>(null);
  const draftAutoSaveSeqRef = useRef(0);
  const [draftAttachmentFiles, setDraftAttachmentFiles] = useState<File[]>([]);
  const [draftAttachmentEncoded, setDraftAttachmentEncoded] = useState<
    { filename: string; mimeType: string; contentBase64: string }[]
  >([]);

  const [toSuggestions, setToSuggestions] = useState<Suggestion[]>([]);
  const [ccSuggestions, setCcSuggestions] = useState<Suggestion[]>([]);
  const [bccSuggestions, setBccSuggestions] = useState<Suggestion[]>([]);
  const [toSuggestOpen, setToSuggestOpen] = useState(false);
  const [ccSuggestOpen, setCcSuggestOpen] = useState(false);
  const [bccSuggestOpen, setBccSuggestOpen] = useState(false);
  const toInputRef = useRef<HTMLInputElement>(null);
  const ccInputRef = useRef<HTMLInputElement>(null);
  const bccInputRef = useRef<HTMLInputElement>(null);

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
    if (!editingDraft) return;
    const lastPart = draftTo.split(",").pop()?.trim() || "";
    if (lastPart.length >= 2) {
      fetchSuggestions(lastPart, setToSuggestions);
      setToSuggestOpen(true);
    } else {
      setToSuggestions([]);
      setToSuggestOpen(false);
    }
  }, [draftTo, editingDraft, fetchSuggestions]);

  useEffect(() => {
    if (!editingDraft) return;
    const lastPart = draftCc.split(",").pop()?.trim() || "";
    if (lastPart.length >= 2) {
      fetchSuggestions(lastPart, setCcSuggestions);
      setCcSuggestOpen(true);
    } else {
      setCcSuggestions([]);
      setCcSuggestOpen(false);
    }
  }, [draftCc, editingDraft, fetchSuggestions]);

  useEffect(() => {
    if (!editingDraft) return;
    const lastPart = draftBcc.split(",").pop()?.trim() || "";
    if (lastPart.length >= 2) {
      fetchSuggestions(lastPart, setBccSuggestions);
      setBccSuggestOpen(true);
    } else {
      setBccSuggestions([]);
      setBccSuggestOpen(false);
    }
  }, [draftBcc, editingDraft, fetchSuggestions]);

  const saveDraftAuto = useCallback(
    async (reason: "auto" | "blur" | "manual") => {
      if (!isDraft) return;
      if (!detail) return;
      if (!editingDraft) return;
      if (!email?.id) return;

      const subjectVal = (draftSubject ?? "").trim();
      const toVal = (draftTo ?? "").trim();
      const ccVal = (draftCc ?? "").trim();
      const bccVal = (draftBcc ?? "").trim();
      const inlineImages = detail.inlineImages ?? {};
      const htmlDisplayVal = draftHtml ?? "";
      const htmlForGmail = restoreAttachmentUrlsToCid(htmlDisplayVal, email.id, inlineImages);
      const textVal = stripHtmlToText(htmlForGmail);

      if (!lastDraftAutoSavedRef.current) {
        lastDraftAutoSavedRef.current = { subject: subjectVal, html: htmlForGmail, to: toVal, cc: ccVal, bcc: bccVal };
      }

      if (
        lastDraftAutoSavedRef.current.subject === subjectVal &&
        lastDraftAutoSavedRef.current.html === htmlForGmail &&
        lastDraftAutoSavedRef.current.to === toVal &&
        lastDraftAutoSavedRef.current.cc === ccVal &&
        lastDraftAutoSavedRef.current.bcc === bccVal
      ) {
        return; // nothing changed since last save
      }

      // Allow draft autosave even if "To" is empty (common for drafts).
      const toHeader = toVal || (detail.to || email.to || "").trim();

      const seq = ++draftAutoSaveSeqRef.current;
      setDraftAutoSaving(true);
      setDraftAutoSaveStatus(reason === "auto" ? "Saving draft..." : "Saving...");
      try {
        const res = await fetch(`/api/emails/${email.id}/draft/update`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            draftId: email.draftId,
            to: toHeader,
            cc: ccVal || detail.cc || "",
            bcc: bccVal || detail.bcc || "",
            subject: subjectVal || email.subject,
            text: textVal,
            html: htmlForGmail,
            attachments: draftAttachmentEncoded.length ? draftAttachmentEncoded : [],
          }),
        });
        const data = await res.json().catch(() => ({} as any));
        if (!res.ok || (data as any).error) {
          const serverMsg = (data as any).error || res.statusText || "Draft save failed";
          const debug = (data as any).debug
            ? `\n\nDebug:\n${JSON.stringify((data as any).debug, null, 2)}`
            : "";
          throw new Error(`${serverMsg}${debug}`);
        }
        if (seq === draftAutoSaveSeqRef.current) {
          lastDraftAutoSavedRef.current = { subject: subjectVal, html: htmlForGmail, to: toVal, cc: ccVal, bcc: bccVal };
          setDraftAutoSaveStatus("Saved");
          window.setTimeout(() => {
            if (seq === draftAutoSaveSeqRef.current) setDraftAutoSaveStatus(null);
          }, 1200);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Draft autosave failed";
        if (seq === draftAutoSaveSeqRef.current) {
          setDraftAutoSaveStatus(null);
          // Keep draftError separate from auto-save status so user sees it.
          setDraftError(msg);
        }
      } finally {
        if (seq === draftAutoSaveSeqRef.current) setDraftAutoSaving(false);
      }
    },
    [
      detail,
      draftAttachmentEncoded,
      draftHtml,
      draftSubject,
      draftTo,
      draftCc,
      draftBcc,
      editingDraft,
      email.id,
      email.subject,
      email.to,
      isDraft,
    ]
  );

  const fileToBase64 = useCallback((file: File) => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(",")[1] || "";
        resolve(base64);
      };
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });
  }, []);

  const handleAttachFiles = useCallback(
    async (files: File[]) => {
      if (!isDraft) return;
      if (!files.length) return;

      setDraftAttachmentFiles((prev) => [...prev, ...files]);

      const encoded = await Promise.all(
        files.map(async (f) => ({
          filename: f.name,
          mimeType: f.type || "application/octet-stream",
          contentBase64: await fileToBase64(f),
        }))
      );
      setDraftAttachmentEncoded((prev) => [...prev, ...encoded]);
    },
    [fileToBase64, isDraft]
  );

  useEffect(() => {
    if (!isDraft) return;
    if (!detail) return;
    if (draftInitializedForEmailId === email.id) return;

    setDraftSubject(detail.subject || email.subject || "");
    setDraftTo(detail.to || "");
    setDraftCc(detail.cc || "");
    setDraftBcc(detail.bcc || "");
    const displayHtml = detail.bodyHtml
      ? replaceCidWithAttachmentUrls(detail.bodyHtml, email.id, detail.inlineImages ?? {})
      : plainTextToHtml(detail.body || "");
    setDraftHtml(displayHtml);
    setDraftError(null);
    setDraftSaving(false);
    setEditingDraft(true);
    setDraftInitializedForEmailId(email.id);
    setDraftAttachmentFiles([]);
    setDraftAttachmentEncoded([]);
    lastDraftAutoSavedRef.current = {
      subject: (detail.subject || email.subject || "").trim(),
      html: restoreAttachmentUrlsToCid(displayHtml, email.id, detail.inlineImages ?? {}),
      to: (detail.to || "").trim(),
      cc: (detail.cc || "").trim(),
      bcc: (detail.bcc || "").trim(),
    };
  }, [
    isDraft,
    detail?.subject,
    detail?.body,
    detail?.bodyHtml,
    email.id,
    email.subject,
    detail,
    draftInitializedForEmailId,
  ]);

  useEffect(() => {
    if (isDraft) return;
    setEditingDraft(false);
    setDraftInitializedForEmailId(null);
    setDraftError(null);
    setDraftSaving(false);
    setDraftAutoSaving(false);
    setDraftAutoSaveStatus(null);
    setDraftAttachmentFiles([]);
    setDraftAttachmentEncoded([]);
    lastDraftAutoSavedRef.current = null;
  }, [isDraft]);

  // Debounced auto-save while editing a draft.
  useEffect(() => {
    if (!isDraft) return;
    if (!editingDraft) return;
    if (!detail) return;

    const subjectVal = (draftSubject ?? "").trim();
    const inlineImages = detail.inlineImages ?? {};
    const htmlDisplayVal = draftHtml ?? "";
    const htmlForGmail = restoreAttachmentUrlsToCid(htmlDisplayVal, email.id, inlineImages);
    if (
      lastDraftAutoSavedRef.current?.subject === subjectVal &&
      lastDraftAutoSavedRef.current?.html === htmlForGmail
    ) {
      return;
    }

    const handle = window.setTimeout(() => {
      void saveDraftAuto("auto");
    }, 1500);

    return () => window.clearTimeout(handle);
  }, [detail, draftHtml, draftSubject, editingDraft, isDraft, saveDraftAuto]);

  const handleSendEditedDraft = async () => {
    if (!detail) return;
    const toList = (draftTo || detail.to || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!toList.length) {
      setDraftError("Missing recipient (To) for this draft email.");
      return;
    }

    setDraftSaving(true);
    setDraftError(null);
    try {
      const inlineImages = detail.inlineImages ?? {};
      const htmlForGmail = restoreAttachmentUrlsToCid(draftHtml ?? "", email.id, inlineImages);
      const textVal = stripHtmlToText(htmlForGmail);

      let res: Response;
      if (draftAttachmentFiles.length > 0) {
        const formData = new FormData();
        formData.append("to", JSON.stringify(toList));
        if ((draftCc || "").trim()) formData.append("cc", JSON.stringify(draftCc.split(",").map((s) => s.trim()).filter(Boolean)));
        if ((draftBcc || "").trim()) formData.append("bcc", JSON.stringify(draftBcc.split(",").map((s) => s.trim()).filter(Boolean)));
        formData.append("subject", (draftSubject || "").trim() || "(no subject)");
        formData.append("body", textVal || "");
        formData.append("html", htmlForGmail || "");
        draftAttachmentFiles.forEach((file) => formData.append("attachments", file));
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
            cc: (draftCc || "").trim() ? draftCc.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
            bcc: (draftBcc || "").trim() ? draftBcc.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
            subject: (draftSubject || "").trim() || "(no subject)",
            body: textVal || "",
            html: htmlForGmail || undefined,
          }),
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        throw new Error(data.error || res.statusText || "Failed to send");
      }

      // We can't "send" the Gmail draft directly with this backend yet; we send a new email,
      // and then remove it from Drafts immediately.
      try {
        onModify(email.id, { removeLabelIds: ["DRAFT"] });
      } catch {}

      setEditingDraft(false);
      setDraftInitializedForEmailId(null);
      setDraftAttachmentFiles([]);
      setDraftAttachmentEncoded([]);
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "Failed to send edited draft");
    } finally {
      setDraftSaving(false);
    }
  };

  const detailBody = (
    <>
      {onMoveToFolder && !embed && (
        <div className="mb-3 flex justify-end">
          <Tooltip content="Move to folder">
            <Button variant="ghost" size="sm" onClick={onMoveToFolder}>
              <FolderPlus className="h-4 w-4" />
            </Button>
          </Tooltip>
        </div>
      )}
      {detail?.attachments && detail.attachments.length > 0 && (
        <div className="border rounded-md bg-muted/40 px-3 py-2">
          <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Paperclip className="h-3 w-3" />
            <span>Attachments ({detail.attachments.length})</span>
          </div>
          <ul className="space-y-1 text-sm">
            {detail.attachments.map((att) => {
              const href = `/api/emails/${email.id}/attachments/${att.attachmentId}?filename=${encodeURIComponent(
                att.filename
              )}&mimeType=${encodeURIComponent(att.mimeType)}`;
              const sizeKb =
                att.size && att.size > 0 ? `${Math.round(att.size / 1024)} KB` : undefined;
              return (
                <li key={att.attachmentId}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded px-2 py-1 hover:bg-muted transition-colors"
                  >
                    <Paperclip className="h-4 w-4" />
                    <span className="truncate max-w-xs" title={att.filename}>
                      {att.filename || "attachment"}
                    </span>
                    {sizeKb && <span className="text-xs text-muted-foreground">({sizeKb})</span>}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {detailLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : editingDraft && isDraft ? (
        <div className="space-y-4">
          {draftError && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {draftError}
            </div>
          )}
          {draftAutoSaveStatus && (
            <div className="text-xs text-muted-foreground">{draftAutoSaveStatus}</div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="draft-to">To</Label>
            <div className="relative">
              <Input
                ref={toInputRef}
                id="draft-to"
                value={draftTo}
                onChange={(e) => setDraftTo(e.target.value)}
                placeholder="Recipients (comma-separated)"
                onBlur={() => setTimeout(() => setToSuggestOpen(false), 150)}
                onFocus={() => toSuggestions.length > 0 && setToSuggestOpen(true)}
              />
              {toSuggestOpen && toSuggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-md border bg-popover py-1 shadow-md max-h-48 overflow-auto">
                  {toSuggestions.map((s) => (
                    <button
                      key={`${s.email}-${s.name}-to`}
                      type="button"
                      className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => {
                        const parts = draftTo.split(",").slice(0, -1);
                        const add = parts.length ? `, ${s.email}` : s.email;
                        setDraftTo((parts.join(", ") || "") + add);
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
          </div>

          <div className="grid gap-2">
            <Label htmlFor="draft-cc">Cc</Label>
            <div className="relative">
              <Input
                ref={ccInputRef}
                id="draft-cc"
                value={draftCc}
                onChange={(e) => setDraftCc(e.target.value)}
                placeholder="Cc (optional)"
                onBlur={() => setTimeout(() => setCcSuggestOpen(false), 150)}
                onFocus={() => ccSuggestions.length > 0 && setCcSuggestOpen(true)}
              />
              {ccSuggestOpen && ccSuggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-md border bg-popover py-1 shadow-md max-h-48 overflow-auto">
                  {ccSuggestions.map((s) => (
                    <button
                      key={`${s.email}-${s.name}-cc`}
                      type="button"
                      className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => {
                        const parts = draftCc.split(",").slice(0, -1);
                        const add = parts.length ? `, ${s.email}` : s.email;
                        setDraftCc((parts.join(", ") || "") + add);
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
          </div>

          <div className="grid gap-2">
            <Label htmlFor="draft-bcc">Bcc</Label>
            <div className="relative">
              <Input
                ref={bccInputRef}
                id="draft-bcc"
                value={draftBcc}
                onChange={(e) => setDraftBcc(e.target.value)}
                placeholder="Bcc (optional)"
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
                        const parts = draftBcc.split(",").slice(0, -1);
                        const add = parts.length ? `, ${s.email}` : s.email;
                        setDraftBcc((parts.join(", ") || "") + add);
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
          </div>

          <div className="grid gap-2">
            <Label htmlFor="draft-subject">Subject</Label>
            <Input
              id="draft-subject"
              value={draftSubject}
              onChange={(e) => setDraftSubject(e.target.value)}
              placeholder="Subject"
              onBlur={() => {
                if (!draftAutoSaving) void saveDraftAuto("blur");
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="draft-body">Body</Label>
            <div
              onBlur={() => {
                if (!draftAutoSaving) void saveDraftAuto("blur");
              }}
            >
              <RichTextEditor
                initialHtml={draftHtml}
                resetKey={`draft-${email.id}`}
                onChangeHtml={(html) => setDraftHtml(html)}
                disabled={draftSaving}
                onAttachFiles={handleAttachFiles}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Draft autosave will update the Gmail draft as you edit (formatting preserved).
          </p>
        </div>
      ) : detail?.bodyHtml ? (
        <div
          className="prose prose-sm max-w-none dark:prose-invert"
          dangerouslySetInnerHTML={{
            __html: replaceCidWithAttachmentUrls(
              detail.bodyHtml,
              email.id,
              detail.inlineImages ?? {}
            ),
          }}
        />
      ) : (
        <pre className="whitespace-pre-wrap text-sm">{detail?.body || "No content"}</pre>
      )}
    </>
  );

  if (embed) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
        <header className="shrink-0 space-y-1 border-b border-border/50 px-4 py-3">
          <div className="flex items-start gap-2 min-w-0">
            <h2 className="text-base font-semibold leading-snug truncate min-w-0">
              {detail?.subject || email.subject}
            </h2>
            {hasAttachments && (
              <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                <Paperclip className="h-3 w-3 mr-0.5" />
                {detail?.attachments?.length ?? 0}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">From: {detail?.from || email.from}</p>
          <p className="text-xs text-muted-foreground">To: {detail?.to || email.to}</p>
          <p className="text-xs text-muted-foreground">{detail?.date || email.date}</p>
        </header>
        <div className="flex-1 min-h-0 overflow-auto px-4 py-3 space-y-4">{detailBody}</div>
      </div>
    );
  }

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="flex flex-row items-start justify-between py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base truncate">{detail?.subject || email.subject}</CardTitle>
            {hasAttachments && (
              <Tooltip content="This email has attachments">
                <span className="inline-flex items-center justify-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  <Paperclip className="h-3 w-3 mr-1" />
                  Attachments
                </span>
              </Tooltip>
            )}
          </div>
          <CardDescription className="text-xs">From: {detail?.from || email.from}</CardDescription>
          <CardDescription className="text-xs">To: {detail?.to || email.to}</CardDescription>
          <CardDescription className="text-xs">{detail?.date || email.date}</CardDescription>
        </div>
        <div className="flex gap-1">
          {!isPopout && (
            <Tooltip content="Open in new window">
              <Button variant="ghost" size="icon" onClick={() => onOpenInNewWindow(email)}>
                <ExternalLink className="h-4 w-4" />
              </Button>
            </Tooltip>
          )}
          <Tooltip content={isPopout ? "Close window" : "Close"}>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </Tooltip>
        </div>
      </CardHeader>
      <div className="flex flex-wrap gap-2 px-4 pb-2">
        <Tooltip content="Reply to this email">
          <Button variant="outline" size="sm" onClick={() => onReply(email)}>
            <Reply className="h-4 w-4 mr-1" />
            Reply
          </Button>
        </Tooltip>
        <Tooltip content="Forward this email">
          <Button variant="outline" size="sm" onClick={() => onForward(email)}>
            <Forward className="h-4 w-4 mr-1" />
            Forward
          </Button>
        </Tooltip>
        {isDraft && (
          <>
            {editingDraft ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditingDraft(false);
                    setDraftError(null);
                  }}
                  disabled={draftSaving}
                >
                  Cancel
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleSendEditedDraft}
                  disabled={
                    draftSaving ||
                    !stripHtmlToText(
                      restoreAttachmentUrlsToCid(draftHtml ?? "", email.id, detail?.inlineImages ?? {})
                    ).trim()
                  }
                >
                  {draftSaving ? "Sending..." : "Send edited draft"}
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (!detail) return;
                  setDraftSubject(detail.subject || email.subject || "");
                  setDraftTo(detail.to || "");
                  setDraftCc(detail.cc || "");
                  setDraftBcc(detail.bcc || "");
                    const nextDisplayHtml = detail.bodyHtml
                      ? replaceCidWithAttachmentUrls(detail.bodyHtml, email.id, detail.inlineImages ?? {})
                      : plainTextToHtml(detail.body || "");
                    setDraftHtml(nextDisplayHtml);
                  setDraftError(null);
                  setEditingDraft(true);
                }}
              >
                Edit draft
              </Button>
            )}
          </>
        )}
        <Tooltip content={isStarred ? "Remove star" : "Add star"}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onModify(email.id, isStarred ? { removeLabelIds: ["STARRED"] } : { addLabelIds: ["STARRED"] })}
          >
            <Star className={`h-4 w-4 mr-1 ${isStarred ? "fill-current" : ""}`} />
            {isStarred ? "Unstar" : "Star"}
          </Button>
        </Tooltip>
        <Tooltip content="Mark as read">
          <Button variant="outline" size="sm" onClick={() => onModify(email.id, { removeLabelIds: ["UNREAD"] })}>
            <Mail className="h-4 w-4 mr-1" />
            Read
          </Button>
        </Tooltip>
        <Tooltip content="Mark as unread">
          <Button variant="outline" size="sm" onClick={() => onModify(email.id, { addLabelIds: ["UNREAD"] })}>
            Unread
          </Button>
        </Tooltip>
        {onMoveToFolder && (
          <Tooltip content="Move to folder">
            <Button variant="outline" size="sm" onClick={onMoveToFolder}>
              <FolderPlus className="h-4 w-4 mr-1" />
              Move to folder
            </Button>
          </Tooltip>
        )}
        {!isInTrash && (
          <Tooltip content="Archive (remove from Inbox)">
            <Button variant="outline" size="sm" onClick={() => onModify(email.id, { removeLabelIds: ["INBOX"] })}>
              <Archive className="h-4 w-4" />
            </Button>
          </Tooltip>
        )}
        {!isInTrash ? (
          <Tooltip content="Move to Trash">
            <Button variant="outline" size="sm" onClick={() => onModify(email.id, { trash: true })}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </Tooltip>
        ) : (
          <Tooltip content="Restore from Trash">
            <Button variant="outline" size="sm" onClick={() => onModify(email.id, { untrash: true })}>
              Restore
            </Button>
          </Tooltip>
        )}
      </div>
      <CardContent className="flex-1 overflow-auto border-t pt-4 space-y-4">{detailBody}</CardContent>
    </Card>
  );
}
