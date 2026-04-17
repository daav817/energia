"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, FileImage, FileSpreadsheet, FileText, Folder, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { DriveFileOption } from "@/components/google-drive/google-drive-bill-file-picker-dialog";

function parseFilenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const m = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"|filename=([^;\s]+)/i.exec(header);
  if (!m) return null;
  const raw = (m[1] || m[2] || m[3] || "").trim();
  try {
    return decodeURIComponent(raw.replace(/\+/g, "%20"));
  } catch {
    return raw || null;
  }
}

function renderDriveFileIcon(file: DriveFileOption) {
  const className = "h-4 w-4 shrink-0";
  if (file.isFolder) return <Folder className={`${className} text-sky-500`} />;

  const name = file.name.toLowerCase();
  const mime = file.mimeType?.toLowerCase() || "";
  if (mime === "application/pdf" || name.endsWith(".pdf")) {
    return <FileText className={`${className} text-red-500`} />;
  }
  if (mime.startsWith("image/") || /\.(png|jpg|jpeg|gif|webp|svg)$/.test(name)) {
    return <FileImage className={`${className} text-emerald-500`} />;
  }
  if (mime.includes("sheet") || mime.includes("excel") || /\.(csv|xlsx|xls)$/.test(name)) {
    return <FileSpreadsheet className={`${className} text-green-600`} />;
  }
  if (mime.includes("text") || name.endsWith(".txt")) {
    return <FileText className={`${className} text-slate-500`} />;
  }
  return <FileText className={`${className} text-muted-foreground`} />;
}

function formatDriveFileType(file: DriveFileOption) {
  const name = file.name.toLowerCase();
  const mime = file.mimeType?.toLowerCase() || "";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "PDF";
  if (mime.startsWith("image/") || name.endsWith(".png")) return "PNG / Image";
  if (mime.includes("sheet") || mime.includes("excel") || /\.(csv|xlsx|xls)$/.test(name)) {
    return "Spreadsheet";
  }
  if (mime.includes("text") || name.endsWith(".txt")) return "Text";
  return file.mimeType || "File";
}

function formatFileSize(size?: number | null) {
  if (!size || size < 0) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

type DriveBreadcrumb = { id: string; name: string };

export type GoogleDriveEmailAttachmentPickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** File is ready to append to FormData like a local pick. */
  onPickFile: (file: File) => void;
  title?: string;
};

export function GoogleDriveEmailAttachmentPickerDialog({
  open,
  onOpenChange,
  onPickFile,
  title = "Attach from Google Drive",
}: GoogleDriveEmailAttachmentPickerDialogProps) {
  const [drivePickerQuery, setDrivePickerQuery] = useState("");
  const [drivePickerLoading, setDrivePickerLoading] = useState(false);
  const [drivePickerError, setDrivePickerError] = useState("");
  const [driveFiles, setDriveFiles] = useState<DriveFileOption[]>([]);
  const [driveBreadcrumbs, setDriveBreadcrumbs] = useState<DriveBreadcrumb[]>([]);
  const [driveCurrentFolderId, setDriveCurrentFolderId] = useState("");
  const [driveSort, setDriveSort] = useState<"name" | "modified" | "size">("name");
  const [downloadWorking, setDownloadWorking] = useState(false);

  const sortedDriveFiles = useMemo(() => {
    const files = [...driveFiles];
    if (driveSort === "name") {
      files.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    }
    if (driveSort === "modified") {
      files.sort((a, b) => {
        const ta = a.modifiedTime ? new Date(a.modifiedTime).getTime() : 0;
        const tb = b.modifiedTime ? new Date(b.modifiedTime).getTime() : 0;
        return tb - ta;
      });
    }
    if (driveSort === "size") {
      files.sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
    }
    return files;
  }, [driveFiles, driveSort]);

  const loadDriveFiles = useCallback(
    async (options?: { query?: string; folderId?: string }) => {
      setDrivePickerLoading(true);
      setDrivePickerError("");
      try {
        const query = options?.query !== undefined ? options.query : drivePickerQuery;
        const folderId = options?.folderId !== undefined ? options.folderId : driveCurrentFolderId;
        const params = new URLSearchParams();
        if (query.trim()) params.set("q", query.trim());
        if (folderId) params.set("folderId", folderId);
        const response = await fetch(`/api/google-drive/files?${params.toString()}`);
        const data = (await response.json()) as { error?: string; files?: DriveFileOption[]; breadcrumbs?: DriveBreadcrumb[]; currentFolderId?: string };
        if (!response.ok) throw new Error(data.error || "Failed to load Google Drive files");
        setDriveFiles(Array.isArray(data.files) ? data.files : []);
        setDriveBreadcrumbs(Array.isArray(data.breadcrumbs) ? data.breadcrumbs : []);
        setDriveCurrentFolderId(typeof data.currentFolderId === "string" ? data.currentFolderId : "");
      } catch (error) {
        setDriveFiles([]);
        setDriveBreadcrumbs([]);
        setDrivePickerError(error instanceof Error ? error.message : "Failed to load Google Drive files");
      } finally {
        setDrivePickerLoading(false);
      }
    },
    [drivePickerQuery, driveCurrentFolderId]
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDrivePickerQuery("");
    setDrivePickerError("");
    setDriveFiles([]);
    setDriveBreadcrumbs([]);
    setDriveCurrentFolderId("");
    setDriveSort("name");
    setDownloadWorking(false);
    void (async () => {
      setDrivePickerLoading(true);
      try {
        const response = await fetch("/api/google-drive/files");
        const data = (await response.json()) as { error?: string; files?: DriveFileOption[]; breadcrumbs?: DriveBreadcrumb[]; currentFolderId?: string };
        if (!response.ok) throw new Error(data.error || "Failed to load Google Drive files");
        if (!cancelled) {
          setDriveFiles(Array.isArray(data.files) ? data.files : []);
          setDriveBreadcrumbs(Array.isArray(data.breadcrumbs) ? data.breadcrumbs : []);
          setDriveCurrentFolderId(typeof data.currentFolderId === "string" ? data.currentFolderId : "");
        }
      } catch (error) {
        if (!cancelled) {
          setDriveFiles([]);
          setDriveBreadcrumbs([]);
          setDrivePickerError(error instanceof Error ? error.message : "Failed to load Google Drive files");
        }
      } finally {
        if (!cancelled) setDrivePickerLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  async function handleActivate(file: DriveFileOption) {
    if (file.isFolder) {
      setDrivePickerQuery("");
      void loadDriveFiles({ query: "", folderId: file.id });
      return;
    }
    const fid = String(file.id || "").trim();
    if (!fid) {
      setDrivePickerError("This file has no Google Drive id. Choose another file or upload locally.");
      return;
    }
    setDownloadWorking(true);
    setDrivePickerError("");
    try {
      const res = await fetch(`/api/google-drive/files/${encodeURIComponent(fid)}/download`);
      if (!res.ok) {
        let msg = "Download failed";
        try {
          const data = (await res.json()) as { error?: string };
          if (data.error) msg = data.error;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const fromHeader = parseFilenameFromContentDisposition(res.headers.get("Content-Disposition"));
      const name = fromHeader || file.name || "attachment";
      const mime = blob.type || res.headers.get("Content-Type") || "application/octet-stream";
      const f = new File([blob], name, { type: mime.split(";")[0]?.trim() || "application/octet-stream" });
      onPickFile(f);
      onOpenChange(false);
    } catch (err) {
      setDrivePickerError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setDownloadWorking(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(92vw,72rem)] w-[min(92vw,72rem)] z-[200]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Browse Drive and select a file. It is downloaded and attached to your outgoing email (same as choosing a
            local file).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {driveBreadcrumbs.length === 0 ? (
              <span className="text-sm text-muted-foreground">Loading folder path...</span>
            ) : (
              driveBreadcrumbs.map((crumb, index) => (
                <button
                  key={crumb.id}
                  type="button"
                  className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setDrivePickerQuery("");
                    void loadDriveFiles({ query: "", folderId: crumb.id });
                  }}
                >
                  {index > 0 && <ChevronRight className="mr-1 h-4 w-4" />}
                  {crumb.name}
                </button>
              ))
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Input
              value={drivePickerQuery}
              onChange={(e) => setDrivePickerQuery(e.target.value)}
              placeholder="Search this folder"
            />
            <Button type="button" variant="outline" onClick={() => void loadDriveFiles()}>
              Search
            </Button>
            <Select value={driveSort} onValueChange={(value) => setDriveSort(value as "name" | "modified" | "size")}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Sort: Name</SelectItem>
                <SelectItem value="modified">Sort: Date modified</SelectItem>
                <SelectItem value="size">Sort: File size</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {downloadWorking && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              Preparing file from Google Drive…
            </div>
          )}
          {drivePickerError && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
              <p>{drivePickerError}</p>
              {drivePickerError.toLowerCase().includes("insufficient permission") && (
                <div className="mt-3">
                  <a
                    href="/api/gmail/connect"
                    className="inline-flex h-9 items-center justify-center rounded-md border border-amber-500 px-3 text-sm font-medium"
                  >
                    Reconnect Google with Drive access
                  </a>
                </div>
              )}
            </div>
          )}
          <div className="max-h-[min(60vh,520px)] overflow-auto rounded-lg border">
            <div className="grid grid-cols-[minmax(12rem,2.6fr)_minmax(5rem,1fr)_minmax(6rem,1.1fr)_minmax(4rem,0.85fr)_minmax(7.5rem,auto)] gap-x-3 gap-y-1 border-b bg-muted/40 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:px-4 sm:text-xs">
              <div>Name</div>
              <div className="hidden sm:block">Owner</div>
              <div>Modified</div>
              <div className="text-right">Size</div>
              <div className="text-right">Actions</div>
            </div>
            {drivePickerLoading && <p className="text-sm text-muted-foreground p-3">Loading Google Drive files...</p>}
            {!drivePickerLoading && sortedDriveFiles.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">No matching files or folders found in this location.</p>
            )}
            {sortedDriveFiles.map((file) => (
              <div
                key={file.id}
                role="button"
                tabIndex={0}
                title={file.name}
                className={cn(
                  "grid cursor-pointer grid-cols-[minmax(12rem,2.6fr)_minmax(5rem,1fr)_minmax(6rem,1.1fr)_minmax(4rem,0.85fr)_minmax(7.5rem,auto)] gap-x-3 gap-y-1 border-b px-3 py-2 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring sm:px-4 sm:py-3",
                  downloadWorking && "pointer-events-none opacity-50"
                )}
                onDoubleClick={() => void handleActivate(file)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleActivate(file);
                }}
              >
                <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                  {renderDriveFileIcon(file)}
                  <div className="min-w-0">
                    <p className="break-words font-medium leading-snug" title={file.name}>
                      {file.name}
                    </p>
                    <p className="break-words text-xs text-muted-foreground">
                      {file.isFolder ? "Folder · double-click to open" : formatDriveFileType(file)}
                    </p>
                  </div>
                  {file.isFolder ? <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" /> : null}
                </div>
                <div className="hidden truncate text-sm text-muted-foreground sm:block" title={file.ownerName || undefined}>
                  {file.ownerName || "—"}
                </div>
                <div
                  className="truncate text-xs text-muted-foreground sm:text-sm"
                  title={file.modifiedTime ? new Date(file.modifiedTime).toLocaleString() : undefined}
                >
                  {file.modifiedTime ? new Date(file.modifiedTime).toLocaleString() : "—"}
                </div>
                <div
                  className="text-right text-xs text-muted-foreground sm:text-sm"
                  title={file.isFolder ? undefined : formatFileSize(file.size)}
                >
                  {file.isFolder ? "—" : formatFileSize(file.size)}
                </div>
                <div className="flex justify-end gap-1">
                  {!file.isFolder ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={downloadWorking || !file.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          const url =
                            file.webViewLink?.trim() ||
                            (file.id ? `https://drive.google.com/file/d/${file.id}/view` : "");
                          if (!url || typeof window === "undefined") return;
                          window.open(url, "_blank", "noopener,noreferrer");
                        }}
                      >
                        View
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={downloadWorking || !file.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleActivate(file);
                        }}
                      >
                        Attach
                      </Button>
                    </>
                  ) : (
                    <span className="text-muted-foreground"> </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
