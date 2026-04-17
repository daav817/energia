"use client";

import { useState } from "react";
import { CloudUpload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppToast } from "@/components/app-toast-provider";
import {
  EmailDriveDestinationPicker,
  persistEmailAttachmentDriveFolderPreference,
} from "@/components/communications/email-drive-destination-picker";

/** @deprecated Use EMAIL_ATTACHMENT_DRIVE_FOLDER_KEY from email-drive-destination-picker */
export { EMAIL_ATTACHMENT_DRIVE_FOLDER_KEY } from "@/components/communications/email-drive-destination-picker";

export function EmailAttachmentDriveUploadButton({
  messageId,
  attachment,
}: {
  messageId: string;
  attachment: { attachmentId: string; filename: string; mimeType: string };
}) {
  const toast = useAppToast();
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  const runUpload = async (opts: {
    folderUrl: string;
    folderId: string | null;
    rememberFolder: boolean;
  }) => {
    const folderUrl = opts.folderUrl.trim();
    const resolvedId = opts.folderId;
    if (!folderUrl && !resolvedId) return;
    setUploading(true);
    try {
      const res = await fetch("/api/emails/attachments/upload-to-drive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId,
          attachmentId: attachment.attachmentId,
          folderUrl: folderUrl || undefined,
          folderId: resolvedId || undefined,
          filename: attachment.filename || "attachment",
          mimeType: attachment.mimeType || "application/octet-stream",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Upload failed");
      const link = typeof data.webViewLink === "string" ? data.webViewLink : null;
      toast({
        message: link
          ? "Saved to Google Drive."
          : `Saved to Google Drive as ${typeof data.name === "string" ? data.name : attachment.filename}.`,
        variant: "success",
      });
      persistEmailAttachmentDriveFolderPreference(folderUrl, opts.rememberFolder);
      setOpen(false);
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Upload failed", variant: "error" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setOpen(true)}>
        <CloudUpload className="mr-1 h-3.5 w-3.5" />
        Save to Drive
      </Button>

      <EmailDriveDestinationPicker
        open={open}
        onOpenChange={setOpen}
        title="Save attachment to Google Drive"
        description="Uploads this file into a folder you choose. Paste a Drive folder URL from your browser, or pick a folder below. You may need to reconnect Google once so upload permission is granted."
        confirmLabel="Upload"
        busy={uploading}
        onConfirm={(pick) => runUpload(pick)}
      />
    </>
  );
}
