"use client";

import { useEffect, useState, useCallback } from "react";
import {
  RefreshCw,
  Star,
  Pin,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Search,
  FolderOpen,
  FolderPlus,
  Paperclip,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmailDetailPanel } from "@/components/communications/EmailDetailPanel";
import { FolderTree, buildFolderTree, type FolderNode } from "@/components/communications/FolderTree";
import { MoveToFolderDialog } from "@/components/communications/MoveToFolderDialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type Label = { id: string; name: string; type: string; messagesUnread?: number; messagesTotal?: number };
type EmailMessage = {
  id: string;
  draftId?: string;
  threadId?: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  labelIds?: string[];
  hasAttachments?: boolean;
};

const FOLDER_PRIORITY = ["INBOX", "SENT", "DRAFT", "TRASH", "SPAM", "STARRED"];
const SYSTEM_IDS = ["INBOX", "SENT", "DRAFT", "TRASH", "SPAM", "STARRED", "UNREAD"];

function collectParentPaths(nodes: FolderNode[]): { value: string; label: string }[] {
  const result: { value: string; label: string }[] = [{ value: "", label: "(Root — top level)" }];
  function walk(ns: FolderNode[]) {
    for (const n of ns) {
      if (n.labelId && SYSTEM_IDS.includes(n.labelId)) continue;
      result.push({ value: n.id, label: n.id });
      if (n.children.length > 0) walk(n.children);
    }
  }
  walk(nodes);
  return result;
}

function formatFolderName(name: string): string {
  return name.replace(/^\[Gmail\]\/?/i, "").trim() || name;
}

function getPrimaryFolder(labelIds: string[] = [], labelMap: Map<string, string>): string {
  const systemFirst = FOLDER_PRIORITY.find((id) => labelIds.includes(id));
  if (systemFirst) return systemFirst;
  const userLabels = labelIds
    .filter((id) => !SYSTEM_IDS.includes(id))
    .map((id) => formatFolderName(labelMap.get(id) || id))
    .filter(Boolean);
  return userLabels[0] || "Other";
}

const PINNED_KEY = "energia-pinned-emails";
const FOLDERS_WIDTH_KEY = "energia-folders-width";
const LIST_WIDTH_KEY = "energia-list-width";
const DETAIL_WIDTH_KEY = "energia-detail-width";

function getPinnedIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(PINNED_KEY) || "[]");
  } catch {
    return [];
  }
}

function setPinnedIds(ids: string[]) {
  localStorage.setItem(PINNED_KEY, JSON.stringify(ids));
}

export default function InboxPage() {
  const [labels, setLabels] = useState<Label[]>([]);
  const [selectedLabel, setSelectedLabel] = useState("INBOX");
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [pinnedIds, setPinnedIdsState] = useState<string[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<EmailMessage | null>(null);
  const [emailDetail, setEmailDetail] = useState<{
    body: string;
    bodyHtml: string;
    subject: string;
    from: string;
    to: string;
    cc: string;
    bcc: string;
    date: string;
    labelIds: string[];
    attachments?: {
      attachmentId: string;
      filename: string;
      mimeType: string;
      size: number;
    }[];
    inlineImages?: Record<string, { attachmentId: string; mimeType: string }>;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [labelsLoading, setLabelsLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [foldersCollapsed, setFoldersCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<EmailMessage[] | null>(null);
  const [unreadResults, setUnreadResults] = useState<EmailMessage[] | null>(null);
  const [lastSearchQuery, setLastSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"inbox" | "search" | "unread">("inbox");
  const [searching, setSearching] = useState(false);
  const [filterDate, setFilterDate] = useState("");
  const [filterStarred, setFilterStarred] = useState(false);
  const [foldersWidth, setFoldersWidth] = useState(256);
  const [folderExpanded, setFolderExpanded] = useState<Set<string>>(new Set());
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderParent, setNewFolderParent] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [assignFolderEmailId, setAssignFolderEmailId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMoveIds, setBulkMoveIds] = useState<string[] | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    type: "folder" | "trash";
    id?: string;
    ids?: string[];
    name?: string;
  } | null>(null);
  const [listWidth, setListWidth] = useState(400);
  const [detailWidth, setDetailWidth] = useState(420);

  const startResizeFolders = (startX: number) => {
    const startW = foldersWidth;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - startX;
      const w = Math.max(80, Math.min(500, startW + dx));
      setFoldersWidth(w);
      localStorage.setItem(FOLDERS_WIDTH_KEY, String(w));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    setPinnedIdsState(getPinnedIds());
    try {
      const fw = parseInt(localStorage.getItem(FOLDERS_WIDTH_KEY) || "256", 10);
      if (fw >= 64) setFoldersWidth(fw);
      const lw = parseInt(localStorage.getItem(LIST_WIDTH_KEY) || "400", 10);
      if (lw >= 200) setListWidth(lw);
      const dw = parseInt(localStorage.getItem(DETAIL_WIDTH_KEY) || "420", 10);
      if (dw >= 280) setDetailWidth(dw);
    } catch {}
  }, []);

  const startResizeListDetail = (startX: number) => {
    const startList = listWidth;
    const startDetail = detailWidth;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - startX;
      const newList = Math.max(200, Math.min(800, startList + dx));
      const newDetail = Math.max(280, Math.min(800, startDetail - dx));
      setListWidth(newList);
      setDetailWidth(newDetail);
      localStorage.setItem(LIST_WIDTH_KEY, String(newList));
      localStorage.setItem(DETAIL_WIDTH_KEY, String(newDetail));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    fetchLabels();
  }, []);

  useEffect(() => {
    if (selectedLabel && activeTab === "inbox") fetchEmails(selectedLabel);
  }, [selectedLabel, filterDate, filterStarred, activeTab]);

  useEffect(() => {
    if (selectedEmail) fetchEmailDetail(selectedEmail.id);
    else setEmailDetail(null);
  }, [selectedEmail?.id]);


  const handleSelectEmail = (msg: EmailMessage) => {
    setSelectedEmail(msg);
    // In the Unread tab we don't auto-mark as read; user must use "Mark as read".
    if (activeTab !== "unread" && msg.labelIds?.includes("UNREAD")) {
      modifyEmail(msg.id, { removeLabelIds: ["UNREAD"] });
    }
  };

  const fetchLabels = async () => {
    setLabelsLoading(true);
    try {
      const res = await fetch("/api/emails/labels");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setLabels(data);
      if (!selectedLabel || !data.some((l: Label) => l.id === selectedLabel)) {
        setSelectedLabel("INBOX");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load labels");
    } finally {
      setLabelsLoading(false);
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    const fullName = newFolderParent
      ? `${newFolderParent.trim()}/${newFolderName.trim()}`
      : newFolderName.trim();
    setCreatingFolder(true);
    try {
      const res = await fetch("/api/emails/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: fullName }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setNewFolderName("");
      setNewFolderParent("");
      setCreateFolderOpen(false);
      fetchLabels();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create folder");
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleDeleteFolder = async (labelId: string, name: string) => {
    try {
      const res = await fetch(`/api/emails/labels/${labelId}`, { method: "DELETE" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (selectedLabel === labelId) setSelectedLabel("INBOX");
      fetchLabels();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete folder");
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirm) return;
    if (deleteConfirm.type === "folder" && deleteConfirm.name && deleteConfirm.id) {
      await handleDeleteFolder(deleteConfirm.id, deleteConfirm.name);
    } else if (deleteConfirm.type === "trash") {
      const ids = deleteConfirm.ids ?? (deleteConfirm.id ? [deleteConfirm.id] : []);
      for (const id of ids) {
        await modifyEmail(id, { trash: true });
      }
      setSelectedIds(new Set());
    }
    setDeleteConfirm(null);
  };

  const modifyEmailWithConfirm = (
    id: string,
    opts: { addLabelIds?: string[]; removeLabelIds?: string[]; trash?: boolean; untrash?: boolean }
  ) => {
    if (opts.trash) {
      setDeleteConfirm({ type: "trash", id });
    } else {
      modifyEmail(id, opts);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const display = activeTab === "search" ? searchByFolder.flatMap(([, e]) => e) : sortedEmails;
    const allIds = new Set(display.map((e) => e.id));
    if (selectedIds.size >= allIds.size) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(allIds);
    }
  };

  const handleBulkDelete = () => {
    setDeleteConfirm({ type: "trash", ids: Array.from(selectedIds) });
  };

  const handleBulkMove = () => {
    setBulkMoveIds(Array.from(selectedIds));
  };

  const handleAssignToFolder = async (emailIds: string[], labelId: string) => {
    try {
      for (const id of emailIds) {
        await modifyEmail(id, { addLabelIds: [labelId] });
      }
      setAssignFolderEmailId(null);
      setBulkMoveIds(null);
      setSelectedIds(new Set());
    } catch {
      setAssignFolderEmailId(null);
      setBulkMoveIds(null);
    }
  };

  const buildQuery = useCallback((labelId: string) => {
    const parts: string[] = [];
    if (filterDate) {
      const d = new Date(filterDate);
      parts.push(`after:${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`);
    }
    if (filterStarred) parts.push("is:starred");
    return parts.join(" ");
  }, [filterDate, filterStarred]);

  const fetchEmails = async (labelId: string, token?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        maxResults: "50",
        labelIds: labelId,
      });
      if (token) params.set("pageToken", token);
      const q = buildQuery(labelId);
      if (q) params.set("q", q);
      const res = await fetch(`/api/emails?${params}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setEmails(data.messages || []);
      setNextPageToken(data.nextPageToken || null);
      setSelectedEmail(null);
      setSelectedIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load emails");
      setEmails([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchFolderOpen({});
    try {
      const allMessages: EmailMessage[] = [];
      let pageToken: string | undefined;
      const pageSize = searchPageSize === 0 ? 500 : searchPageSize;
      do {
        const params = new URLSearchParams({ maxResults: String(pageSize), q: searchQuery });
        if (pageToken) params.set("pageToken", pageToken);
        const res = await fetch(`/api/emails?${params}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        allMessages.push(...(data.messages || []));
        pageToken = data.nextPageToken || undefined;
      } while (pageToken && searchPageSize === 0);
      setSearchResults(searchPageSize === 0 ? allMessages : allMessages.slice(0, searchPageSize));
      setLastSearchQuery(searchQuery);
      setActiveTab("search");
      setSelectedEmail(null);
      setSelectedIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const fetchUnread = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        maxResults: "100",
        labelIds: "UNREAD",
      });
      const res = await fetch(`/api/emails?${params.toString()}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setUnreadResults(data.messages || []);
      setSelectedEmail(null);
      setSelectedIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load unread emails");
      setUnreadResults([]);
    } finally {
      setLoading(false);
    }
  };

  const collapseAllSearchFolders = () => {
    setSearchFolderOpen(
      Object.fromEntries(searchByFolder.map(([folder]) => [folder, false]))
    );
  };

  const expandAllSearchFolders = () => {
    setSearchFolderOpen(
      Object.fromEntries(searchByFolder.map(([folder]) => [folder, true]))
    );
  };

  const fetchEmailDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/emails/${id}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setEmailDetail({
        body: data.body,
        bodyHtml: data.bodyHtml,
        subject: data.subject,
        from: data.from,
        to: data.to,
        cc: data.cc || "",
        bcc: data.bcc || "",
        date: data.date,
        labelIds: data.labelIds || [],
        attachments: data.attachments || [],
        inlineImages: data.inlineImages ?? {},
      });
    } catch {
      setEmailDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const modifyEmail = async (
    id: string,
    opts: { addLabelIds?: string[]; removeLabelIds?: string[]; trash?: boolean; untrash?: boolean }
  ) => {
    try {
      const res = await fetch(`/api/emails/${id}/modify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (opts.trash || opts.removeLabelIds?.includes("INBOX")) {
        setEmails((prev) => prev.filter((e) => e.id !== id));
        setSearchResults((prev) => (prev ? prev.filter((e) => e.id !== id) : null));
        setSelectedEmail(null);
      } else {
        const nextLabelIds = data.labelIds ?? (() => {
          const e = [...emails, ...(searchResults || [])].find((x) => x.id === id);
          if (!e) return undefined;
          let ids = [...(e.labelIds || [])];
          if (opts.addLabelIds) ids = [...ids, ...opts.addLabelIds];
          if (opts.removeLabelIds) ids = ids.filter((l) => !opts.removeLabelIds!.includes(l));
          return ids;
        })();
        if (nextLabelIds) {
          const removedFromCurrentFolder =
            activeTab === "inbox" && selectedLabel && !nextLabelIds.includes(selectedLabel);

          if (removedFromCurrentFolder) {
            setEmails((prev) => prev.filter((e) => e.id !== id));
            setSearchResults((prev) => (prev ? prev.filter((e) => e.id !== id) : null));
            if (selectedEmail?.id === id) setSelectedEmail(null);
          } else {
            setEmails((prev) =>
              prev.map((e) => (e.id === id ? { ...e, labelIds: nextLabelIds } : e))
            );
            setSearchResults((prev) =>
              prev
                ? prev.map((e) => (e.id === id ? { ...e, labelIds: nextLabelIds } : e))
                : null
            );
            if (selectedEmail?.id === id) {
              setSelectedEmail((prev) => (prev ? { ...prev, labelIds: nextLabelIds } : null));
              setEmailDetail((d) => (d ? { ...d, labelIds: nextLabelIds } : null));
            }
          }
        } else {
          if (activeTab === "search")
            setSearchResults((prev) =>
              prev ? prev.map((e) => (e.id === id ? { ...e, labelIds: data.labelIds || e.labelIds } : e)) : null
            );
          else fetchEmails(selectedLabel);
        }
      }
      // Refresh label/unread counts & unread tab when UNREAD status changes.
      if (opts.addLabelIds?.includes("UNREAD") || opts.removeLabelIds?.includes("UNREAD")) {
        fetchLabels();
        // Keep Unread tab in sync regardless of current tab.
        fetchUnread();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to modify");
    }
  };

  const togglePin = (id: string) => {
    const next = pinnedIds.includes(id) ? pinnedIds.filter((x) => x !== id) : [...pinnedIds, id];
    setPinnedIdsState(next);
    setPinnedIds(next);
  };

  const openInNewWindow = (msg: { id: string }) => {
    const url = `/communications/inbox/email/${msg.id}`;
    window.open(url, "_blank", "width=800,height=600");
  };

  const handleReply = (msg: { id: string }) => {
    window.location.href = `/communications/compose?reply=${msg.id}`;
  };

  const handleForward = (msg: { id: string }) => {
    window.location.href = `/communications/compose?forward=${msg.id}`;
  };

  const labelMap = new Map(labels.map((l) => [l.id, l.name]));
  const folderTreeNodes = buildFolderTree(labels);
  const displayEmails =
    activeTab === "search" && searchResults
      ? searchResults
      : activeTab === "unread" && unreadResults
        ? unreadResults
        : emails;
  const pinned = displayEmails.filter((e) => pinnedIds.includes(e.id));
  const unpinned = displayEmails.filter((e) => !pinnedIds.includes(e.id));
  const sortedEmails = [...pinned, ...unpinned];

  const searchByFolder = (() => {
    if (!searchResults || searchResults.length === 0) return [];
    const byFolder = new Map<string, EmailMessage[]>();
    for (const msg of searchResults) {
      const folder = getPrimaryFolder(msg.labelIds, labelMap);
      if (!byFolder.has(folder)) byFolder.set(folder, []);
      byFolder.get(folder)!.push(msg);
    }
    return Array.from(byFolder.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  })();

  const [searchFolderOpen, setSearchFolderOpen] = useState<Record<string, boolean>>({});
  const [searchPageSize, setSearchPageSize] = useState(50); // 0 = All

  const unreadByFolder = (() => {
    if (!unreadResults || unreadResults.length === 0) return [];
    const byFolder = new Map<string, EmailMessage[]>();
    for (const msg of unreadResults) {
      const folder = getPrimaryFolder(msg.labelIds, labelMap);
      if (!byFolder.has(folder)) byFolder.set(folder, []);
      byFolder.get(folder)!.push(msg);
    }
    return Array.from(byFolder.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  })();

  const [unreadFolderOpen, setUnreadFolderOpen] = useState<Record<string, boolean>>({});

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-0 w-full comms-inbox">
      <MoveToFolderDialog
        open={!!assignFolderEmailId || !!bulkMoveIds?.length}
        onOpenChange={(open) => {
          if (!open) {
            setAssignFolderEmailId(null);
            setBulkMoveIds(null);
          }
        }}
        emailIds={bulkMoveIds ?? (assignFolderEmailId ? [assignFolderEmailId] : [])}
        labels={labels}
        onSelect={handleAssignToFolder}
      />
      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={(open) => !open && setDeleteConfirm(null)}
        title={deleteConfirm?.type === "folder" ? "Delete folder" : "Move to Trash"}
        message={
          deleteConfirm?.type === "folder"
            ? `Are you sure you want to delete the folder "${deleteConfirm.name}"? Emails in this folder will not be deleted.`
            : (deleteConfirm?.ids?.length ?? 0) > 1
              ? `Are you sure you want to move ${deleteConfirm?.ids?.length ?? 0} emails to Trash?`
              : "Are you sure you want to move this email to Trash?"
        }
        confirmLabel={deleteConfirm?.type === "folder" ? "Delete" : "Move to Trash"}
        onConfirm={handleConfirmDelete}
      />
      <Dialog
        open={createFolderOpen}
        onOpenChange={(open) => {
          setCreateFolderOpen(open);
          if (!open) {
            setNewFolderName("");
            setNewFolderParent("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create folder</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium">Parent folder</label>
              <p className="text-xs text-muted-foreground mt-0.5 mb-2">
                Choose where in the folder hierarchy this folder will be created.
              </p>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                value={newFolderParent}
                onChange={(e) => setNewFolderParent(e.target.value)}
              >
                {collectParentPaths(folderTreeNodes).map(({ value, label }) => (
                  <option key={value || "__root__"} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Folder name</label>
              <Input
                placeholder="e.g. Suppliers"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
                className="mt-2"
              />
              {newFolderParent && (
                <p className="text-xs text-muted-foreground mt-1">
                  Full path: {newFolderParent}/{newFolderName || "..."}
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateFolderOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateFolder} disabled={creatingFolder || !newFolderName.trim()}>
              {creatingFolder ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Folder sidebar - resizable, collapsible */}
      <div
        className="shrink-0 transition-all flex flex-col relative"
        style={{ width: foldersCollapsed ? 56 : foldersWidth }}
      >
        <Card className="flex-1 flex flex-col min-h-0">
          <CardHeader className="flex flex-row items-center justify-between py-3 gap-1">
            {foldersCollapsed ? (
              <div className="flex w-full justify-center py-1">
                <Tooltip content="Expand folders">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={() => setFoldersCollapsed(false)}
                  >
                    <ChevronRight className="h-5 w-5" />
                  </Button>
                </Tooltip>
              </div>
            ) : (
              <>
                <CardTitle className="text-base truncate">Folders</CardTitle>
                <div className="flex items-center gap-1">
                  <Tooltip content="New folder">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setCreateFolderOpen(true)}
                      aria-label="New folder"
                      title="New folder"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </Tooltip>
                  <Tooltip content="Collapse">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setFoldersCollapsed(true)}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </Tooltip>
                </div>
              </>
            )}
          </CardHeader>
          {!foldersCollapsed && (
            <CardContent className="py-0 flex-1 overflow-auto">
              <FolderTree
                nodes={folderTreeNodes}
                selectedLabel={selectedLabel}
                expanded={folderExpanded}
                onSelect={(id) => { setSelectedLabel(id); setActiveTab("inbox"); }}
                onToggleExpand={(id) => setFolderExpanded((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; })}
                onDelete={(id, name) => setDeleteConfirm({ type: "folder", id, name })}
              />
            </CardContent>
          )}
        </Card>
        {!foldersCollapsed && (
          <>
            {/* Visible grab handle */}
            <div
              className="w-3 shrink-0 cursor-col-resize hover:bg-primary/40 bg-muted/50 transition-colors rounded-r"
              onMouseDown={(e) => {
                e.preventDefault();
                startResizeFolders(e.clientX);
              }}
              title="Drag to resize"
            />
            {/* Invisible overlay to make the divider easier to grab anywhere along the edge */}
            <div
              className="absolute top-0 right-0 bottom-0 w-4 cursor-col-resize"
              onMouseDown={(e) => {
                e.preventDefault();
                startResizeFolders(e.clientX);
              }}
            />
          </>
        )}
      </div>

      {/* Email list - resizable */}
      <div
        className="shrink-0 flex flex-col min-w-0"
        style={{
          width: selectedEmail ? listWidth : undefined,
          minWidth: selectedEmail ? 200 : undefined,
          flex: selectedEmail ? undefined : 1,
        }}
      >
        <Card className="flex flex-1 flex-col min-w-0 comms-card h-full">
        <CardHeader className="space-y-3 py-4">
          <div className="flex flex-row items-center justify-between gap-4">
            <div className="flex border-b border-border -mb-[1px]">
              <button
                type="button"
                onClick={() => setActiveTab("inbox")}
                className={`px-4 py-2 text-sm font-medium rounded-t-md border border-b-0 border-transparent transition-colors ${
                  activeTab === "inbox"
                    ? "bg-background border-border text-foreground shadow-sm -mb-px"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                Inbox
              </button>
              <button
                type="button"
                onClick={() => searchResults && setActiveTab("search")}
                disabled={!searchResults}
                title={searchResults ? `Search: "${lastSearchQuery}"` : "Run a search first"}
                className={`px-4 py-2 text-sm font-medium rounded-t-md border border-b-0 border-transparent transition-colors ${
                  activeTab === "search"
                    ? "bg-background border-border text-foreground shadow-sm -mb-px"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed"
                }`}
              >
                Search Results {searchResults ? `(${searchResults.length})` : ""}
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!unreadResults) {
                    await fetchUnread();
                  }
                  setActiveTab("unread");
                }}
                className={`px-4 py-2 text-sm font-medium rounded-t-md border border-b-0 border-transparent transition-colors ${
                  activeTab === "unread"
                    ? "bg-background border-border text-foreground shadow-sm -mb-px"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                Unread {unreadResults ? `(${unreadResults.length})` : ""}
              </button>
            </div>
            <div className="flex gap-2 items-center">
              {(() => {
                const display =
                  activeTab === "search"
                    ? searchByFolder.flatMap(([, e]) => e)
                    : activeTab === "unread" && unreadResults
                      ? unreadResults
                      : sortedEmails;
                const hasEmails = display.length > 0;
                const count = selectedIds.size;
                return (
                    <>
                    {hasEmails && (
                      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={count > 0 && count >= display.length}
                          ref={(el) => { if (el) el.indeterminate = count > 0 && count < display.length; }}
                          onChange={toggleSelectAll}
                          className="rounded"
                        />
                        <span className="text-muted-foreground">Select all</span>
                      </label>
                    )}
                    {count > 0 && (
                      <>
                        <span className="text-sm text-muted-foreground">{count} selected</span>
                        {activeTab === "unread" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              const ids = Array.from(selectedIds);
                              for (const id of ids) {
                                await modifyEmail(id, { removeLabelIds: ["UNREAD"] });
                              }
                              setUnreadResults((prev) =>
                                prev ? prev.filter((e) => !selectedIds.has(e.id)) : prev
                              );
                              setSelectedIds(new Set());
                            }}
                          >
                            Mark as read
                          </Button>
                        ) : (
                          <>
                            <Button variant="outline" size="sm" onClick={handleBulkDelete}>
                              Delete
                            </Button>
                            <Button variant="outline" size="sm" onClick={handleBulkMove}>
                              Move to folder
                            </Button>
                          </>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                          Clear
                        </Button>
                      </>
                    )}
                    <Tooltip content="Check for new emails now">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          await fetch("/api/emails/poll?sync=1");
                          fetchEmails(selectedLabel);
                          fetchUnread();
                        }}
                        disabled={loading}
                      >
                        <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                      </Button>
                    </Tooltip>
                  </>
                );
              })()}
            </div>
          </div>
          {/* Search */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search all folders..."
                className="pl-9"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
            </div>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={searchPageSize}
              onChange={(e) => setSearchPageSize(Number(e.target.value))}
              title="Results per search"
            >
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={0}>All</option>
            </select>
            <Button variant="secondary" size="sm" onClick={handleSearch} disabled={searching}>
              {searching ? "Searching..." : "Search"}
            </Button>
            {activeTab === "search" && (searchResults || searchQuery) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchQuery("");
                  setSearchResults(null);
                  setLastSearchQuery("");
                  setActiveTab("inbox");
                  setSelectedEmail(null);
                  setSelectedIds(new Set());
                }}
              >
                Clear
              </Button>
            )}
            {activeTab === "search" && searchByFolder.length > 0 && (
              <>
                <Button variant="ghost" size="sm" onClick={expandAllSearchFolders}>
                  Expand all
                </Button>
                <Button variant="ghost" size="sm" onClick={collapseAllSearchFolders}>
                  Collapse all
                </Button>
              </>
            )}
          </div>
          {activeTab === "inbox" && (
            <div className="flex flex-wrap gap-2">
              <Input
                type="date"
                className="w-40"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={filterStarred}
                  onChange={(e) => setFilterStarred(e.target.checked)}
                />
                Starred only
              </label>
              {(filterDate || filterStarred) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFilterDate("");
                    setFilterStarred(false);
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent className="flex-1 overflow-auto p-0">
          {labelsLoading ? (
            <p className="py-8 text-center text-muted-foreground">Connecting to Gmail...</p>
          ) : error ? (
            <div className="mx-4 mb-4 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : loading && emails.length === 0 && activeTab === "inbox" ? (
            <p className="py-8 text-center text-muted-foreground">Connecting to Gmail...</p>
          ) : activeTab === "search" && searchByFolder.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              {searchResults?.length === 0 ? "No search results." : "Run a search to see results."}
            </p>
          ) : activeTab === "search" ? (
            <div className="divide-y">
              {searchByFolder.map(([folder, folderEmails]) => {
                const isOpen = searchFolderOpen[folder] === true;
                return (
                  <div key={folder}>
                    <button
                      className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm font-medium bg-muted/50 hover:bg-muted"
                      onClick={() => setSearchFolderOpen((o) => ({ ...o, [folder]: !isOpen }))}
                    >
                      {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <span>{folder}</span>
                      <span className="text-muted-foreground">({folderEmails.length})</span>
                    </button>
                    {isOpen && (
                      <div className="divide-y">
                        {folderEmails.map((msg) => (
                          <EmailRow
                            key={msg.id}
                            msg={msg}
                            selectedEmail={selectedEmail}
                            pinnedIds={pinnedIds}
                            selectedIds={selectedIds}
                            onSelect={handleSelectEmail}
                            onToggleSelect={toggleSelect}
                            onModify={modifyEmailWithConfirm}
                            onTogglePin={togglePin}
                            onAssignFolderOpen={setAssignFolderEmailId}
                            folderLabel={folder}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : activeTab === "unread" ? (
            unreadByFolder.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">
                {unreadResults && unreadResults.length === 0
                  ? "No unread emails."
                  : "Loading unread emails..."}
              </p>
            ) : (
              <div className="divide-y">
                {unreadByFolder.map(([folder, folderEmails]) => {
                  const isOpen = unreadFolderOpen[folder] === true;
                  const allSelected = folderEmails.every((m) => selectedIds.has(m.id));
                  const someSelected =
                    !allSelected && folderEmails.some((m) => selectedIds.has(m.id));
                  return (
                    <div key={folder}>
                      <div className="flex w-full items-center gap-2 px-4 py-2 bg-muted/50 hover:bg-muted">
                        <button
                          type="button"
                          className="flex items-center gap-2 text-left text-sm font-medium flex-1"
                          onClick={() =>
                            setUnreadFolderOpen((o) => ({ ...o, [folder]: !isOpen }))
                          }
                        >
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                          <span>{folder}</span>
                          <span className="text-muted-foreground">
                            ({folderEmails.length})
                          </span>
                        </button>
                        <label className="flex items-center gap-1 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            ref={(el) => {
                              if (el) el.indeterminate = someSelected;
                            }}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setSelectedIds((prev) => {
                                const next = new Set(prev);
                                if (checked) {
                                  folderEmails.forEach((m) => next.add(m.id));
                                } else {
                                  folderEmails.forEach((m) => next.delete(m.id));
                                }
                                return next;
                              });
                            }}
                          />
                          <span>Select all</span>
                        </label>
                      </div>
                      {isOpen && (
                        <div className="divide-y">
                          {folderEmails.map((msg) => (
                            <EmailRow
                              key={msg.id}
                              msg={msg}
                              selectedEmail={selectedEmail}
                              pinnedIds={pinnedIds}
                              selectedIds={selectedIds}
                              onSelect={handleSelectEmail}
                              onToggleSelect={toggleSelect}
                              onModify={modifyEmailWithConfirm}
                              onTogglePin={togglePin}
                              onAssignFolderOpen={setAssignFolderEmailId}
                              folderLabel={folder}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          ) : sortedEmails.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">No emails in this folder.</p>
          ) : (
            <div className="divide-y">
              {sortedEmails.map((msg) => (
                <EmailRow
                  key={msg.id}
                  msg={msg}
                  selectedEmail={selectedEmail}
                  pinnedIds={pinnedIds}
                  selectedIds={selectedIds}
                  onSelect={handleSelectEmail}
                  onToggleSelect={toggleSelect}
                  onModify={modifyEmailWithConfirm}
                  onTogglePin={togglePin}
                  onAssignFolderOpen={setAssignFolderEmailId}
                  isDraftFolder={selectedLabel === "DRAFT"}
                />
              ))}
            </div>
          )}
          {nextPageToken && activeTab === "inbox" && (
            <div className="p-4">
              <Button variant="outline" size="sm" onClick={() => fetchEmails(selectedLabel, nextPageToken)}>
                Load more
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      </div>

      {/* Resize handle between list and detail */}
      {selectedEmail && (
        <div
          className="w-2 shrink-0 cursor-col-resize hover:bg-primary/40 bg-muted/50 transition-colors rounded"
          onMouseDown={(e) => { e.preventDefault(); startResizeListDetail(e.clientX); }}
          title="Drag to resize panels"
        />
      )}

      {/* Email detail panel - grows to fill remaining space, resizable min */}
      {selectedEmail && (
        <div
          className="flex-1 flex flex-col overflow-hidden min-w-0"
          style={{ minWidth: Math.max(detailWidth, 280) }}
        >
          <EmailDetailPanel
            email={selectedEmail}
            detail={emailDetail}
            detailLoading={detailLoading}
            selectedLabel={selectedLabel}
            onModify={modifyEmailWithConfirm}
            onClose={() => setSelectedEmail(null)}
            onOpenInNewWindow={openInNewWindow}
            onReply={handleReply}
            onForward={handleForward}
            onMoveToFolder={() => setAssignFolderEmailId(selectedEmail.id)}
          />
        </div>
      )}
    </div>
  );
}

function EmailRow({
  msg,
  selectedEmail,
  pinnedIds,
  selectedIds,
  onSelect,
  onToggleSelect,
  onModify,
  onTogglePin,
  onAssignFolderOpen,
  folderLabel,
  isDraftFolder = false,
}: {
  msg: EmailMessage;
  selectedEmail: EmailMessage | null;
  pinnedIds: string[];
  selectedIds: Set<string>;
  onSelect: (m: EmailMessage) => void;
  onToggleSelect: (id: string) => void;
  onModify: (id: string, opts: { addLabelIds?: string[]; removeLabelIds?: string[]; trash?: boolean; untrash?: boolean }) => void;
  onTogglePin: (id: string) => void;
  onAssignFolderOpen: (id: string | null) => void;
  folderLabel?: string;
  isDraftFolder?: boolean;
}) {
  const isSelected = selectedIds.has(msg.id);
  return (
    <div
      onClick={() => onSelect(msg)}
      className={`relative flex cursor-pointer flex-col gap-1 px-4 py-3 transition-colors hover:bg-muted ${
        selectedEmail?.id === msg.id ? "bg-primary/20" : ""
      } ${isSelected ? "bg-primary/5" : ""}`}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => { e.stopPropagation(); onToggleSelect(msg.id); }}
          onClick={(e) => e.stopPropagation()}
          className="mt-0.5 shrink-0 rounded cursor-pointer"
        />
        <button
          onClick={(e) => { e.stopPropagation(); onModify(msg.id, msg.labelIds?.includes("STARRED") ? { removeLabelIds: ["STARRED"] } : { addLabelIds: ["STARRED"] }); }}
          className="shrink-0 text-amber-500 hover:text-amber-600"
          title={msg.labelIds?.includes("STARRED") ? "Unstar" : "Star"}
        >
          <Star className={`h-4 w-4 ${msg.labelIds?.includes("STARRED") ? "fill-current" : ""}`} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onTogglePin(msg.id); }}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          title={pinnedIds.includes(msg.id) ? "Unpin" : "Pin"}
        >
          <Pin className={`h-4 w-4 ${pinnedIds.includes(msg.id) ? "fill-current" : ""}`} />
        </button>
        <Tooltip content="Move to folder">
          <button
            onClick={(e) => { e.stopPropagation(); onAssignFolderOpen(msg.id); }}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <FolderPlus className="h-4 w-4" />
          </button>
        </Tooltip>
        <div className="min-w-0 flex-1">
          {isDraftFolder ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <span
                  className={`truncate flex-1 flex items-center gap-1 ${
                    msg.labelIds?.includes("UNREAD") ? "font-semibold" : ""
                  }`}
                >
                  <span className="text-destructive font-semibold">[Draft]</span>
                  <span className="text-muted-foreground">To:</span>
                  <span className="text-muted-foreground">{msg.to || "(no recipient)"}</span>
                  {msg.hasAttachments && (
                    <Paperclip
                      className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                      aria-label="Has attachments"
                    />
                  )}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {new Date(msg.date).toLocaleString(undefined, {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
              </div>
              <div
                className={`truncate flex items-center gap-1 ${
                  msg.labelIds?.includes("UNREAD") ? "font-semibold" : "text-sm text-muted-foreground"
                }`}
              >
                <span className={msg.labelIds?.includes("UNREAD") ? "" : ""}>
                  {msg.subject || "(no subject)"}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2">
                <span
                  className={`truncate flex-1 flex items-center gap-1 ${
                    msg.labelIds?.includes("UNREAD") ? "font-semibold" : ""
                  }`}
                >
                  {msg.subject || "(no subject)"}
                  {msg.hasAttachments && (
                    <Paperclip
                      className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                      aria-label="Has attachments"
                    />
                  )}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {new Date(msg.date).toLocaleString(undefined, {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
              </div>
              <div className="text-sm text-muted-foreground truncate">From: {msg.from}</div>
            </>
          )}
          {folderLabel && (
            <span className="text-xs text-primary/80">In: {folderLabel}</span>
          )}
          {msg.snippet && <p className="text-sm line-clamp-1 text-muted-foreground">{msg.snippet}</p>}
        </div>
      </div>
    </div>
  );
}

