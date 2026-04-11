"use client";

import { useCallback, useEffect, useState } from "react";
import { CloudUpload, FolderOpen, FolderPlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAppToast } from "@/components/app-toast-provider";
import { parseDriveFolderId } from "@/lib/parse-drive-folder-id";

export const EMAIL_ATTACHMENT_DRIVE_FOLDER_KEY = "energia-email-attachment-drive-folder-v1";

type DriveListFile = {
  id: string;
  name: string;
  isFolder: boolean;
  webViewLink: string | null;
};

type DriveListResponse = {
  currentFolderId: string;
  breadcrumbs: { id: string; name: string }[];
  files: DriveListFile[];
  error?: string;
};

export function EmailAttachmentDriveUploadButton({
  messageId,
  attachment,
}: {
  messageId: string;
  attachment: { attachmentId: string; filename: string; mimeType: string };
}) {
  const toast = useAppToast();
  const [open, setOpen] = useState(false);
  const [folderInput, setFolderInput] = useState("");
  const [rememberFolder, setRememberFolder] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [browseData, setBrowseData] = useState<DriveListResponse | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    try {
      const saved = localStorage.getItem(EMAIL_ATTACHMENT_DRIVE_FOLDER_KEY);
      if (saved) setFolderInput(saved);
    } catch {
      /* ignore */
    }
  }, [open]);

  const loadBrowse = useCallback(async (folderId: string) => {
    setBrowseLoading(true);
    setBrowseError(null);
    try {
      const res = await fetch(
        `/api/google-drive/files?folderId=${encodeURIComponent(folderId)}&kind=reference`
      );
      const data = (await res.json()) as DriveListResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to load Drive folder");
      setBrowseData(data);
    } catch (e) {
      setBrowseError(e instanceof Error ? e.message : "Failed to load folder");
      setBrowseData(null);
    } finally {
      setBrowseLoading(false);
    }
  }, []);

  const openPicker = () => {
    const initial = parseDriveFolderId(folderInput.trim()) || "root";
    setBrowseData(null);
    setBrowseError(null);
    setNewFolderName("");
    setPickerOpen(true);
    void loadBrowse(initial);
  };

  const createFolderHere = async () => {
    const name = newFolderName.trim();
    if (!name || !browseData) {
      toast({ message: "Enter a name for the new folder.", variant: "error" });
      return;
    }
    setCreatingFolder(true);
    try {
      const res = await fetch("/api/google-drive/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parentId: browseData.currentFolderId }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; id?: string; name?: string };
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Failed to create folder");
      toast({ message: `Created folder “${data.name ?? name}”.`, variant: "success" });
      setNewFolderName("");
      await loadBrowse(browseData.currentFolderId);
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Failed to create folder", variant: "error" });
    } finally {
      setCreatingFolder(false);
    }
  };

  const parentFolderId = (b: { id: string }[] | undefined) => {
    if (!b || b.length < 2) return "root";
    return b[b.length - 2].id;
  };

  const persistFolderPreference = (value: string) => {
    if (!rememberFolder || typeof window === "undefined") return;
    try {
      localStorage.setItem(EMAIL_ATTACHMENT_DRIVE_FOLDER_KEY, value.trim());
    } catch {
      /* ignore */
    }
  };

  const runUpload = async (opts: { folderUrl: string; folderId?: string | null }) => {
    const folderUrl = opts.folderUrl.trim();
    const resolvedId = opts.folderId ?? parseDriveFolderId(folderUrl);
    if (!folderUrl && !resolvedId) {
      toast({ message: "Enter a Google Drive folder link or id.", variant: "error" });
      return;
    }
    setUploading(true);
    try {
      const res = await fetch(
        `/api/emails/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachment.attachmentId)}/upload-to-drive`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            folderUrl: folderUrl || undefined,
            folderId: resolvedId || undefined,
            filename: attachment.filename || "attachment",
            mimeType: attachment.mimeType || "application/octet-stream",
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Upload failed");
      const link = typeof data.webViewLink === "string" ? data.webViewLink : null;
      toast({
        message: link
          ? `Saved to Google Drive.`
          : `Saved to Google Drive as ${typeof data.name === "string" ? data.name : attachment.filename}.`,
        variant: "success",
      });
      if (rememberFolder && folderUrl) persistFolderPreference(folderUrl);
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
        <CloudUpload className="h-3.5 w-3.5 mr-1" />
        Save to Drive
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Save attachment to Google Drive</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Uploads this file into a folder you choose. Paste a Drive folder URL from your browser, or pick a folder
              below. You may need to reconnect Google once so upload permission is granted.
            </p>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-2">
              <Label htmlFor="drive-folder-url">Destination folder (URL or id)</Label>
              <Input
                id="drive-folder-url"
                value={folderInput}
                onChange={(e) => setFolderInput(e.target.value)}
                placeholder="https://drive.google.com/drive/folders/…"
              />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input"
                checked={rememberFolder}
                onChange={(e) => setRememberFolder(e.target.checked)}
              />
              <span>Remember this folder for next time (this browser)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={openPicker}>
                <FolderOpen className="h-4 w-4 mr-1" />
                Browse folders
              </Button>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={uploading}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void runUpload({ folderUrl: folderInput })} disabled={uploading}>
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading…
                </>
              ) : (
                "Upload"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent
          className="max-w-lg max-h-[min(90vh,560px)] flex flex-col gap-0 overflow-hidden z-[200]"
          overlayClassName="z-[190]"
        >
          <DialogHeader>
            <DialogTitle>Pick a folder</DialogTitle>
            <p className="text-sm text-muted-foreground">Subfolders you can open are listed below.</p>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto border rounded-md p-2 text-sm space-y-2">
            {browseLoading ? (
              <p className="text-muted-foreground flex items-center gap-2 py-6 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </p>
            ) : browseError ? (
              <p className="text-destructive text-sm">{browseError}</p>
            ) : browseData ? (
              <>
                <div className="flex flex-wrap items-center gap-2 pb-2 border-b">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    disabled={browseData.breadcrumbs.length < 2}
                    onClick={() => void loadBrowse(parentFolderId(browseData.breadcrumbs))}
                  >
                    Up
                  </Button>
                  <span className="text-xs text-muted-foreground truncate">
                    {browseData.breadcrumbs.map((x) => x.name).join(" / ")}
                  </span>
                </div>
                <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border/80 bg-muted/20 p-2">
                  <div className="grid min-w-[10rem] flex-1 gap-1">
                    <Label htmlFor="new-drive-subfolder" className="text-xs text-muted-foreground">
                      New folder here
                    </Label>
                    <Input
                      id="new-drive-subfolder"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      placeholder="Folder name"
                      className="h-8 text-sm"
                      disabled={creatingFolder}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void createFolderHere();
                        }
                      }}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-8 shrink-0"
                    disabled={creatingFolder || !newFolderName.trim()}
                    onClick={() => void createFolderHere()}
                  >
                    {creatingFolder ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        Creating…
                      </>
                    ) : (
                      <>
                        <FolderPlus className="h-4 w-4 mr-1" />
                        Create
                      </>
                    )}
                  </Button>
                </div>
                <ul className="space-y-0.5">
                  {(browseData.files ?? [])
                    .filter((f) => f.isFolder)
                    .map((f) => (
                      <li key={f.id}>
                        <button
                          type="button"
                          className="w-full text-left px-2 py-1.5 rounded hover:bg-muted flex items-center gap-2"
                          onClick={() => void loadBrowse(f.id)}
                        >
                          <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="truncate">{f.name}</span>
                        </button>
                      </li>
                    ))}
                </ul>
                {(browseData.files ?? []).filter((f) => f.isFolder).length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">No subfolders here.</p>
                ) : null}
              </>
            ) : null}
          </div>
          <DialogFooter className="flex flex-wrap gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => setPickerOpen(false)}>
              Close
            </Button>
            <Button
              type="button"
              onClick={() => {
                const syntheticUrl =
                  browseData?.currentFolderId && browseData.currentFolderId !== "root"
                    ? `https://drive.google.com/drive/folders/${browseData.currentFolderId}`
                    : "";
                if (syntheticUrl) setFolderInput(syntheticUrl);
                setPickerOpen(false);
              }}
            >
              Use this folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
