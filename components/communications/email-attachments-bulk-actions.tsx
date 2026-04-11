"use client";

import { useState } from "react";
import { CloudUpload, HardDrive, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppToast } from "@/components/app-toast-provider";
import {
  EmailDriveDestinationPicker,
  persistEmailAttachmentDriveFolderPreference,
} from "@/components/communications/email-drive-destination-picker";

type Att = { attachmentId: string; filename: string; mimeType: string };

async function readApiErrorResponse(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const j = JSON.parse(text) as { error?: unknown };
    if (typeof j.error === "string" && j.error.trim()) return j.error.trim();
  } catch {
    /* not JSON */
  }
  const excerpt = text.replace(/\s+/g, " ").trim().slice(0, 320);
  if (excerpt) return excerpt;
  return `${res.status} ${res.statusText || "Request failed"}`;
}

function sanitizeFilenameForDisk(name: string, used: Set<string>): string {
  const raw = (name || "attachment").replace(/[/\\?%*:|"<>]/g, "-").trim() || "attachment";
  let candidate = raw;
  let n = 1;
  while (used.has(candidate.toLowerCase())) {
    const dot = raw.lastIndexOf(".");
    if (dot > 0) {
      candidate = `${raw.slice(0, dot)} (${n})${raw.slice(dot)}`;
    } else {
      candidate = `${raw} (${n})`;
    }
    n++;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

export function EmailAttachmentsBulkActions({
  messageId,
  attachments,
}: {
  messageId: string;
  attachments: Att[];
}) {
  const toast = useAppToast();
  const [driveOpen, setDriveOpen] = useState(false);
  const [driveBusy, setDriveBusy] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);

  if (attachments.length < 2) return null;

  const attachmentFetchUrl = (att: Att) =>
    `/api/emails/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(att.attachmentId)}?filename=${encodeURIComponent(att.filename)}&mimeType=${encodeURIComponent(att.mimeType)}&download=1`;

  const downloadAllLocal = async () => {
    setLocalBusy(true);
    try {
      const win = window as unknown as {
        showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
      };
      if (typeof win.showDirectoryPicker === "function") {
        const dirHandle = await win.showDirectoryPicker();
        const used = new Set<string>();
        for (const att of attachments) {
          const res = await fetch(attachmentFetchUrl(att));
          if (!res.ok) throw new Error(`Failed to download ${att.filename || "file"}`);
          const blob = await res.blob();
          const name = sanitizeFilenameForDisk(att.filename || "attachment", used);
          const fileHandle = await dirHandle.getFileHandle(name, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
        }
        toast({ message: `Saved ${attachments.length} files to the folder you chose.`, variant: "success" });
        return;
      }
      for (let i = 0; i < attachments.length; i++) {
        const att = attachments[i];
        const a = document.createElement("a");
        a.href = attachmentFetchUrl(att);
        a.download = att.filename || "attachment";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        await new Promise((r) => setTimeout(r, 400));
      }
      toast({
        message:
          "Started downloads for each attachment. If your browser blocked multiple files, allow downloads for this site or use “Save all locally” in Chrome/Edge to pick one folder.",
        variant: "success",
      });
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      toast({ message: e instanceof Error ? e.message : "Could not save files locally.", variant: "error" });
    } finally {
      setLocalBusy(false);
    }
  };

  const uploadAllDrive = async (pick: {
    folderUrl: string;
    folderId: string | null;
    rememberFolder: boolean;
  }) => {
    const folderUrl = pick.folderUrl.trim();
    const resolvedId = pick.folderId;
    if (!folderUrl && !resolvedId) return;
    setDriveBusy(true);
    try {
      let ok = 0;
      for (let i = 0; i < attachments.length; i++) {
        const att = attachments[i];
        const res = await fetch(
          `/api/emails/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(att.attachmentId)}/upload-to-drive`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              folderUrl: folderUrl || undefined,
              folderId: resolvedId || undefined,
              filename: att.filename || "attachment",
              mimeType: att.mimeType || "application/octet-stream",
            }),
          }
        );
        if (!res.ok) {
          const detail = await readApiErrorResponse(res);
          throw new Error(`${detail} (${att.filename || att.attachmentId})`);
        }
        ok++;
        if (i < attachments.length - 1) {
          await new Promise((r) => setTimeout(r, 450));
        }
      }
      persistEmailAttachmentDriveFolderPreference(folderUrl, pick.rememberFolder);
      toast({ message: `Uploaded ${ok} attachment(s) to Google Drive.`, variant: "success" });
      setDriveOpen(false);
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Bulk upload failed", variant: "error" });
    } finally {
      setDriveBusy(false);
    }
  };

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 border-b border-border/60 pb-2">
      <span className="text-xs font-medium text-muted-foreground">All attachments:</span>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-8 text-xs"
        disabled={localBusy}
        onClick={() => void downloadAllLocal()}
      >
        {localBusy ? (
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
        ) : (
          <HardDrive className="mr-1 h-3.5 w-3.5" />
        )}
        Save all locally…
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-8 text-xs"
        disabled={driveBusy}
        onClick={() => setDriveOpen(true)}
      >
        <CloudUpload className="mr-1 h-3.5 w-3.5" />
        Save all to Drive…
      </Button>
      <EmailDriveDestinationPicker
        open={driveOpen}
        onOpenChange={setDriveOpen}
        title={`Save ${attachments.length} attachments to Google Drive`}
        description="All attachments are uploaded into the same folder. Paste a Drive folder URL or browse to choose where they go."
        confirmLabel={`Upload ${attachments.length} files`}
        busy={driveBusy}
        onConfirm={(pick) => void uploadAllDrive(pick)}
      />
    </div>
  );
}
