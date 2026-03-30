"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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

export function ComposeEmailModal({
  to,
  onClose,
  onSent,
}: {
  to: ComposeEmailTarget | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (to) {
      setSubject("");
      setBody("");
    }
  }, [to?.email]);

  if (!to) return null;

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      const res = await fetch("/api/emails/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: [to.email], subject: subject || "(no subject)", body }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSubject("");
      setBody("");
      onSent();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={!!to} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg z-[101]" overlayClassName="z-[100]">
        <DialogHeader>
          <DialogTitle>Compose Email</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSend} className="space-y-4 py-4">
          <div className="grid gap-2">
            <Label>To</Label>
            <Input value={to.name ? `${to.name} <${to.email}>` : to.email} readOnly className="bg-muted" />
          </div>
          <div className="grid gap-2">
            <Label>Subject</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
          </div>
          <div className="grid gap-2">
            <Label>Message</Label>
            <textarea
              className="min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your message..."
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={sending}>
              {sending ? "Sending..." : "Send"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
