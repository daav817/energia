"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ComposeBrokerInsertMenu, insertTextAtTextareaSelection } from "@/components/compose-broker-insert-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type ComposeEmailTarget = { email: string; name?: string };

export type ComposeEmailTargets = ComposeEmailTarget | ComposeEmailTarget[] | null;

function normalizeComposeTargets(to: ComposeEmailTargets): ComposeEmailTarget[] {
  if (!to) return [];
  return Array.isArray(to) ? to : [to];
}

export function ComposeEmailModal({
  to,
  onClose,
  onSent,
  sendSeparatelyPerRecipient = false,
  title,
}: {
  to: ComposeEmailTargets;
  onClose: () => void;
  onSent: () => void;
  /** When true, each selected address receives its own message (no shared To / Cc visibility). */
  sendSeparatelyPerRecipient?: boolean;
  title?: string;
}) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState<string | null>(null);
  const [selectedLower, setSelectedLower] = useState<Set<string>>(new Set());

  const targets = normalizeComposeTargets(to);
  const toKey = targets
    .map((x) => x.email.toLowerCase())
    .sort()
    .join("|");

  useEffect(() => {
    if (targets.length > 0) {
      setSubject("");
      setBody("");
      setSendProgress(null);
      setSelectedLower(new Set(targets.map((t) => t.email.trim().toLowerCase()).filter(Boolean)));
    }
  }, [toKey]);

  if (targets.length === 0) return null;

  const toDisplay = targets.map((t) => (t.name ? `${t.name} <${t.email}>` : t.email)).join(", ");

  const toggleRecipient = (email: string) => {
    const k = email.trim().toLowerCase();
    if (!k) return;
    setSelectedLower((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const selectAllRecipients = () => {
    setSelectedLower(new Set(targets.map((t) => t.email.trim().toLowerCase()).filter(Boolean)));
  };

  const deselectAllRecipients = () => {
    setSelectedLower(new Set());
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setSendProgress(null);
    try {
      const subjectVal = subject || "(no subject)";
      if (sendSeparatelyPerRecipient) {
        const recipients = targets.filter((t) => selectedLower.has(t.email.trim().toLowerCase()));
        if (recipients.length === 0) {
          throw new Error("Select at least one recipient.");
        }
        const errors: string[] = [];
        let i = 0;
        for (const r of recipients) {
          i += 1;
          setSendProgress(`Sending ${i} of ${recipients.length}…`);
          const res = await fetch("/api/emails/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              to: [r.email.trim()],
              subject: subjectVal,
              body,
            }),
          });
          const data = await res.json();
          if (data.error) errors.push(`${r.email}: ${data.error}`);
        }
        if (errors.length > 0) throw new Error(errors.join("\n"));
      } else {
        const res = await fetch("/api/emails/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: targets.map((t) => t.email),
            subject: subjectVal,
            body,
          }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
      }
      setSubject("");
      setBody("");
      onSent();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
      setSendProgress(null);
    }
  };

  return (
    <Dialog open={targets.length > 0} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg z-[101]" overlayClassName="z-[100]">
        <DialogHeader>
          <DialogTitle>{title ?? "Compose Email"}</DialogTitle>
          {sendSeparatelyPerRecipient ? (
            <p className="text-left text-sm font-normal text-muted-foreground">
              One separate message is sent to each selected address so recipients do not see each other.
            </p>
          ) : null}
        </DialogHeader>
        <form onSubmit={handleSend} className="space-y-4 py-4">
          <div className="grid gap-2">
            <Label>To</Label>
            {sendSeparatelyPerRecipient ? (
              <div className="space-y-2 rounded-md border border-input bg-muted/40 px-3 py-2">
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={selectAllRecipients}>
                    Select all
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={deselectAllRecipients}>
                    Deselect all
                  </Button>
                </div>
                <ul className="max-h-40 space-y-2 overflow-y-auto text-sm">
                  {targets.map((t) => {
                    const k = t.email.trim().toLowerCase();
                    return (
                      <li key={k} className="flex gap-2">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 rounded border-input"
                          checked={selectedLower.has(k)}
                          onChange={() => toggleRecipient(t.email)}
                          aria-label={`Send to ${t.email}`}
                        />
                        <span className="min-w-0 break-all">{t.name ? `${t.name} <${t.email}>` : t.email}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <textarea
                readOnly
                rows={Math.min(6, Math.max(2, targets.length))}
                value={toDisplay}
                className="w-full resize-y rounded-md border border-input bg-muted px-3 py-2 text-sm"
              />
            )}
          </div>
          <div className="grid gap-2">
            <Label>Subject</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
          </div>
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="mb-0">Message</Label>
              <ComposeBrokerInsertMenu
                disabled={sending}
                onInsert={(text) => insertTextAtTextareaSelection(bodyRef, body, setBody, text)}
              />
            </div>
            <textarea
              ref={bodyRef}
              className="min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your message..."
              required
            />
          </div>
          {sendProgress ? <p className="text-xs text-muted-foreground">{sendProgress}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={sending}>
              {sending
                ? "Sending…"
                : sendSeparatelyPerRecipient
                  ? `Send (${selectedLower.size})`
                  : "Send"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
