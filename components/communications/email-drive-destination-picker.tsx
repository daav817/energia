"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { FolderOpen, FolderPlus, Loader2 } from "lucide-react";
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

export type EmailDrivePickResult = {
  folderUrl: string;
  folderId: string | null;
  rememberFolder: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  /** When true, disables confirm and shows spinner on confirm button */
  busy?: boolean;
  onConfirm: (pick: EmailDrivePickResult) => void | Promise<void>;
};

export function EmailDriveDestinationPicker({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Upload",
  busy = false,
  onConfirm,
}: Props) {
  const formId = useId();
  const toast = useAppToast();
  const [folderInput, setFolderInput] = useState("");
  const [rememberFolder, setRememberFolder] = useState(true);
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

  const handleMainConfirm = () => {
    const folderUrl = folderInput.trim();
    const resolvedId = parseDriveFolderId(folderUrl);
    if (!folderUrl && !resolvedId) {
      toast({ message: "Enter a Google Drive folder link or id.", variant: "error" });
      return;
    }
    if (folderUrl && !resolvedId) {
      toast({
        message:
          "That value doesn't look like a Drive folder URL or folder id. Use a link such as https://drive.google.com/drive/folders/… or pick a folder with Browse.",
        variant: "error",
      });
      return;
    }
    void onConfirm({ folderUrl, folderId: resolvedId, rememberFolder });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? (
              <p className="text-sm text-muted-foreground">{description}</p>
            ) : null}
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-2">
              <Label htmlFor={`${formId}-folder`}>Destination folder (URL or id)</Label>
              <Input
                id={`${formId}-folder`}
                value={folderInput}
                onChange={(e) => setFolderInput(e.target.value)}
                placeholder="https://drive.google.com/drive/folders/…"
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
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
                <FolderOpen className="mr-1 h-4 w-4" />
                Browse folders
              </Button>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" onClick={handleMainConfirm} disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Working…
                </>
              ) : (
                confirmLabel
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent
          className="z-[200] flex max-h-[min(90vh,560px)] max-w-lg flex-col gap-0 overflow-hidden"
          overlayClassName="z-[190]"
        >
          <DialogHeader>
            <DialogTitle>Pick a folder</DialogTitle>
            <p className="text-sm text-muted-foreground">Subfolders you can open are listed below.</p>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-md border p-2 text-sm">
            {browseLoading ? (
              <p className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </p>
            ) : browseError ? (
              <p className="text-sm text-destructive">{browseError}</p>
            ) : browseData ? (
              <>
                <div className="flex flex-wrap items-center gap-2 border-b pb-2">
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
                  <span className="truncate text-xs text-muted-foreground">
                    {browseData.breadcrumbs.map((x) => x.name).join(" / ")}
                  </span>
                </div>
                <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border/80 bg-muted/20 p-2">
                  <div className="grid min-w-[10rem] flex-1 gap-1">
                    <Label htmlFor={`${formId}-subfolder`} className="text-xs text-muted-foreground">
                      New folder here
                    </Label>
                    <Input
                      id={`${formId}-subfolder`}
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
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                        Creating…
                      </>
                    ) : (
                      <>
                        <FolderPlus className="mr-1 h-4 w-4" />
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
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
                          onClick={() => void loadBrowse(f.id)}
                        >
                          <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="truncate">{f.name}</span>
                        </button>
                      </li>
                    ))}
                </ul>
                {(browseData.files ?? []).filter((f) => f.isFolder).length === 0 ? (
                  <p className="py-2 text-xs text-muted-foreground">No subfolders here.</p>
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
                const id = browseData?.currentFolderId?.trim() || "root";
                const syntheticUrl =
                  id === "root"
                    ? "https://drive.google.com/drive/folders/root"
                    : `https://drive.google.com/drive/folders/${id}`;
                setFolderInput(syntheticUrl);
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

export function persistEmailAttachmentDriveFolderPreference(folderUrl: string, remember: boolean) {
  if (!remember || typeof window === "undefined") return;
  try {
    localStorage.setItem(EMAIL_ATTACHMENT_DRIVE_FOLDER_KEY, folderUrl.trim());
  } catch {
    /* ignore */
  }
}
