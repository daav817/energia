"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  Download,
  File,
  Folder,
  FolderOpen,
  HardDrive,
  Image as ImageIcon,
  Loader2,
  Search,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
type DriveBreadcrumb = { id: string; name: string };

type DriveFileRow = {
  id: string;
  name: string;
  mimeType?: string;
  isFolder?: boolean;
  webViewLink?: string;
  modifiedTime?: string;
  size?: number | null;
  iconLink?: string;
};

export default function DrivePage() {
  const [localFiles, setLocalFiles] = useState<{ name: string; size: number; file: File }[]>([]);
  const [query, setQuery] = useState("");
  const [folderId, setFolderId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [files, setFiles] = useState<DriveFileRow[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<DriveBreadcrumb[]>([]);

  const loadGoogle = useCallback(
    async (opts?: { nextFolder?: string | null; nextQuery?: string | null }) => {
      setLoading(true);
      setError("");
      try {
        const fid =
          opts && Object.prototype.hasOwnProperty.call(opts, "nextFolder")
            ? opts.nextFolder ?? ""
            : folderId;
        const q =
          opts && Object.prototype.hasOwnProperty.call(opts, "nextQuery") ? opts.nextQuery ?? "" : query;
        const params = new URLSearchParams({ kind: "reference" });
        if (fid) params.set("folderId", fid);
        if (q.trim()) params.set("query", q.trim());
        const res = await fetch(`/api/google-drive/files?${params.toString()}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load Drive");
        setFiles(Array.isArray(data.files) ? data.files : []);
        setBreadcrumbs(Array.isArray(data.breadcrumbs) ? data.breadcrumbs : []);
        if (typeof data.currentFolderId === "string") setFolderId(data.currentFolderId);
      } catch (e) {
        setFiles([]);
        setBreadcrumbs([]);
        setError(e instanceof Error ? e.message : "Could not load Google Drive");
      } finally {
        setLoading(false);
      }
    },
    [folderId, query]
  );

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/google-drive/files?kind=reference");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load Drive");
        setFiles(Array.isArray(data.files) ? data.files : []);
        setBreadcrumbs(Array.isArray(data.breadcrumbs) ? data.breadcrumbs : []);
        if (typeof data.currentFolderId === "string") setFolderId(data.currentFolderId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load Google Drive");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const sorted = useMemo(() => {
    const list = [...files];
    list.sort((a, b) => {
      if (!!a.isFolder !== !!b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
    return list;
  }, [files]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <header className="shrink-0 rounded-xl border border-border/60 bg-card/90 px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white shadow">
              <HardDrive className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight truncate">Drive</h1>
              <p className="text-xs text-muted-foreground truncate">
                Google Drive folders and a local file list (Drive-style layout)
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer">
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  setLocalFiles((prev) => [
                    ...prev,
                    ...picked.map((file) => ({ name: file.name, size: file.size, file })),
                  ]);
                  e.target.value = "";
                }}
              />
              <span className="inline-flex items-center rounded-md border bg-background px-3 py-2 text-sm font-medium hover:bg-muted">
                <Upload className="mr-2 h-4 w-4" />
                Upload to local list
              </span>
            </label>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2 overflow-hidden">
        <section className="flex min-h-0 flex-col rounded-xl border border-border/70 bg-white shadow-sm dark:bg-zinc-950/80 overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-zinc-50/90 px-3 py-2 dark:bg-zinc-900/90">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input
              className="h-9 max-w-md flex-1 border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
              placeholder="Search in Drive…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void loadGoogle()}
            />
            <Button type="button" size="sm" className="h-9" onClick={() => void loadGoogle()}>
              Search
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-1 px-3 py-2 text-sm text-blue-700 dark:text-blue-300 border-b border-border/40">
            {breadcrumbs.length === 0 ? (
              <button
                type="button"
                className="font-medium hover:underline"
                onClick={() => void loadGoogle({ nextFolder: "" })}
              >
                My Drive
              </button>
            ) : (
              breadcrumbs.map((crumb, i) => (
                <span key={`${crumb.id}-${i}`} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                  <button
                    type="button"
                    className="hover:underline font-medium truncate max-w-[10rem]"
                    title={crumb.name}
                    onClick={() => void loadGoogle({ nextFolder: crumb.id })}
                  >
                    {crumb.name}
                  </button>
                </span>
              ))
            )}
          </div>
          <div className="grid grid-cols-[minmax(0,2fr)_7rem_6rem_5rem] gap-2 border-b border-border/50 bg-zinc-100/80 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            <div>Name</div>
            <div className="text-right">Modified</div>
            <div className="text-right">Size</div>
            <div className="text-right">Get</div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                Loading…
              </div>
            ) : error ? (
              <p className="p-4 text-sm text-destructive">{error}</p>
            ) : sorted.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">This folder is empty or Drive is not connected.</p>
            ) : (
              <ul>
                {sorted.map((f) => {
                  const isFolder = !!f.isFolder || f.mimeType === "application/vnd.google-apps.folder";
                  const isPdf = (f.mimeType || "").includes("pdf");
                  const isImg = (f.mimeType || "").startsWith("image/");
                  return (
                    <li
                      key={f.id}
                      className="grid grid-cols-[minmax(0,2fr)_7rem_6rem_5rem] gap-2 border-b border-border/40 px-3 py-2 text-sm hover:bg-blue-50/60 dark:hover:bg-zinc-900/60"
                    >
                      <button
                        type="button"
                        className="flex min-w-0 items-center gap-2 text-left font-medium text-blue-800 dark:text-blue-100"
                        onClick={() => {
                          if (isFolder) void loadGoogle({ nextFolder: f.id });
                          else if (f.webViewLink) window.open(f.webViewLink, "_blank", "noopener,noreferrer");
                        }}
                      >
                        {isFolder ? (
                          <Folder className="h-4 w-4 shrink-0 text-amber-500" />
                        ) : isPdf ? (
                          <File className="h-4 w-4 shrink-0 text-red-500" />
                        ) : isImg ? (
                          <ImageIcon className="h-4 w-4 shrink-0 text-emerald-500" />
                        ) : (
                          <File className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate">{f.name}</span>
                      </button>
                      <span className="text-xs text-muted-foreground text-right tabular-nums pt-0.5">
                        {f.modifiedTime
                          ? new Date(f.modifiedTime).toLocaleDateString(undefined, { month: "short", day: "numeric" })
                          : "—"}
                      </span>
                      <span className="text-xs text-muted-foreground text-right tabular-nums pt-0.5">
                        {typeof f.size === "number" && f.size > 0
                          ? `${Math.max(1, Math.round(f.size / 1024))} KB`
                          : "—"}
                      </span>
                      <div className="flex justify-end pt-0.5">
                        {isFolder ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <a
                            href={`/api/google-drive/files/${encodeURIComponent(f.id)}/download`}
                            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-primary hover:bg-muted"
                            title="Download"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Download className="h-3.5 w-3.5" />
                            Save
                          </a>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <section className="flex min-h-0 flex-col rounded-xl border border-border/70 bg-white shadow-sm dark:bg-zinc-950/80 overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border/60 bg-emerald-50/90 px-3 py-2 text-sm font-semibold text-emerald-950 dark:bg-emerald-950/50 dark:text-emerald-100">
            <FolderOpen className="h-4 w-4" />
            This device
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {localFiles.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                Use <strong>Upload to local list</strong> to pick files from your computer. Names appear here like a
                second Drive panel.
              </p>
            ) : (
              <ul>
                {localFiles.map((f, i) => (
                  <li
                    key={`${f.name}-${i}`}
                    className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-2 text-sm"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <File className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate font-medium">{f.name}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {Math.max(1, Math.round(f.size / 1024))} KB
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1 px-2 text-xs"
                        onClick={() => {
                          const url = URL.createObjectURL(f.file);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = f.name;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
