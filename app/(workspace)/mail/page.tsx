"use client";

import { useEffect, useState } from "react";
import { Mail, RefreshCw, ExternalLink, ChevronDown, ChevronRight, Search, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { EmailDetailPanel } from "@/components/communications/EmailDetailPanel";

const FOLDER_PRIORITY = ["INBOX", "SENT", "DRAFT", "TRASH", "SPAM", "STARRED"];

function getDisplayFolder(labelIds: string[] = [], labelMap: Map<string, string>): string {
  const systemFirst = FOLDER_PRIORITY.find((id) => labelIds.includes(id));
  if (systemFirst) return systemFirst;
  const userLabels = labelIds
    .filter((id) => !["INBOX", "SENT", "DRAFT", "TRASH", "SPAM", "STARRED", "UNREAD"].includes(id))
    .map((id) => formatFolderName(labelMap.get(id) || id))
    .filter(Boolean);
  return userLabels[0] || "Other";
}

function formatFolderName(name: string): string {
  return name.replace(/^\[Gmail\]\/?/i, "").trim() || name;
}

type Label = { id: string; name: string };

type EmailMessage = {
  id: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  labelIds?: string[];
  hasAttachments?: boolean;
};

export default function CommunicationsPage() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlParams, setUrlParams] = useState<Record<string, string>>({});
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
  const [detailLoading, setDetailLoading] = useState(false);
  const [labels, setLabels] = useState<Label[]>([]);
  const [connectEmail, setConnectEmail] = useState("");
  const [todaySearch, setTodaySearch] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const TODAY_LIST_WIDTH_KEY = "communications-today-list-width";
  const [listWidth, setListWidth] = useState(380);

  const todayFilteredEmails = todaySearch.trim()
    ? emails.filter(
        (msg) =>
          (msg.subject || "").toLowerCase().includes(todaySearch.trim().toLowerCase()) ||
          (msg.from || "").toLowerCase().includes(todaySearch.trim().toLowerCase()) ||
          (msg.to || "").toLowerCase().includes(todaySearch.trim().toLowerCase()) ||
          (msg.snippet || "").toLowerCase().includes(todaySearch.trim().toLowerCase())
      )
    : emails;
  const todayDisplayCount = todayFilteredEmails.length;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setUrlParams({
      connected: params.get("connected") || "",
      error: params.get("error") || "",
    });
    if (params.get("connected")) {
      window.history.replaceState({}, "", "/mail");
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, []);

  useEffect(() => {
    try {
      const w = parseInt(localStorage.getItem(TODAY_LIST_WIDTH_KEY) || "380", 10);
      if (w >= 160 && w <= 960) setListWidth(w);
    } catch {}
  }, []);

  useEffect(() => {
    if (!connected) return;
    const interval = setInterval(() => fetch("/api/emails/poll?sync=1").catch(() => {}), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [connected]);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/emails/status");
      const data = await res.json();
      setConnected(data.connected);
      if (data.connected) {
        fetchEmails();
        fetchLabels();
      }
    } catch {
      setConnected(false);
    }
  };

  const fetchLabels = async () => {
    try {
      const res = await fetch("/api/emails/labels");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setLabels(data);
    } catch {
      setLabels([]);
    }
  };

  const fetchEmails = async () => {
    setLoading(true);
    setError(null);
    try {
      const today = new Date();
      const q = "after:" + today.getFullYear() + "/" + String(today.getMonth() + 1).padStart(2, "0") + "/" + String(today.getDate()).padStart(2, "0");
      const res = await fetch("/api/emails?maxResults=100&q=" + encodeURIComponent(q));
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setEmails(data.messages || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load emails");
      setEmails([]);
    } finally {
      setLoading(false);
    }
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
        setSelectedEmail(null);
      } else {
        const nextLabelIds = data.labelIds ?? (() => {
          const e = emails.find((x) => x.id === id);
          if (!e) return undefined;
          let ids = [...(e.labelIds || [])];
          if (opts.addLabelIds) ids = [...ids, ...opts.addLabelIds];
          if (opts.removeLabelIds) ids = ids.filter((l) => !opts.removeLabelIds!.includes(l));
          return ids;
        })();
        if (nextLabelIds) {
          setEmails((prev) => prev.map((e) => (e.id === id ? { ...e, labelIds: nextLabelIds } : e)));
          if (selectedEmail?.id === id) {
            setSelectedEmail((prev) => (prev ? { ...prev, labelIds: nextLabelIds } : null));
            setEmailDetail((d) => (d ? { ...d, labelIds: nextLabelIds } : null));
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to modify");
    }
  };

  const handleSelectEmail = (msg: EmailMessage) => {
    setSelectedEmail(msg);
    fetchEmailDetail(msg.id);
    if (msg.labelIds?.includes("UNREAD")) {
      modifyEmail(msg.id, { removeLabelIds: ["UNREAD"] });
    }
  };

  const handleCheckEmail = async () => {
    setChecking(true);
    try {
      await fetch("/api/emails/poll?sync=1");
      fetchEmails();
    } finally {
      setChecking(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/emails/sync", { method: "POST" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      fetchEmails();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync");
    } finally {
      setSyncing(false);
    }
  };

  const connectGmail = () => {
    const url = connectEmail.trim()
      ? `/api/gmail/connect?email=${encodeURIComponent(connectEmail.trim())}`
      : "/api/gmail/connect";
    window.location.href = url;
  };

  const openInNewWindow = (msg: { id: string }) => {
    window.open(`/inbox/email/${msg.id}`, "_blank", "width=800,height=600");
  };

  const startResizeListDetail = (startX: number) => {
    const startW = listWidth;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - startX;
      const w = Math.max(160, Math.min(960, startW + dx));
      setListWidth(w);
      localStorage.setItem(TODAY_LIST_WIDTH_KEY, String(w));
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

  const handleReply = (msg: { id: string }) => {
    window.location.href = `/compose?reply=${msg.id}`;
  };

  const handleForward = (msg: { id: string }) => {
    window.location.href = `/compose?forward=${msg.id}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Communication Hub</h1>
          <p className="text-muted-foreground">
            Send and receive emails via your energy brokerage Gmail account.
          </p>
        </div>
        {connected && (
          <div className="flex gap-2">
            <Tooltip content="Fetch new emails from Gmail now (in addition to 5-min auto-check)">
              <Button variant="outline" onClick={handleCheckEmail} disabled={checking}>
                <RefreshCw className={`mr-2 h-4 w-4 ${checking ? "animate-spin" : ""}`} />
                {checking ? "Checking..." : "Check for incoming email"}
              </Button>
            </Tooltip>
            <Tooltip content="Save emails to database and link to customers/suppliers by matching email addresses">
              <Button variant="outline" onClick={handleSync} disabled={syncing}>
                {syncing ? "Syncing..." : "Sync to DB"}
              </Button>
            </Tooltip>
            <Button variant="outline" onClick={fetchEmails} disabled={loading}>
              Refresh
            </Button>
          </div>
        )}
      </div>

      {urlParams.connected && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          Gmail connected successfully.
        </div>
      )}
      {urlParams.error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
          Connection error: {urlParams.error}
        </div>
      )}

      {connected === false && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Connect Gmail
            </CardTitle>
            <CardDescription>
              Connect your energy brokerage Gmail account to send and receive emails.
              You will be redirected to Google to authorize access.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label htmlFor="connect-email" className="mb-1 block text-sm font-medium">
                Gmail address (optional)
              </label>
              <input
                id="connect-email"
                type="email"
                placeholder="you@gmail.com"
                value={connectEmail}
                onChange={(e) => setConnectEmail(e.target.value)}
                className="w-full max-w-sm rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                If the wrong account is pre-selected, enter the correct Gmail address here.
              </p>
            </div>
            <Button onClick={connectGmail}>
              <ExternalLink className="mr-2 h-4 w-4" />
              Connect Gmail
            </Button>
            <p className="text-sm text-muted-foreground">
              Ensure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set in .env. Add
              http://localhost:3001/api/gmail/callback to your Google Cloud
              OAuth redirect URIs.
            </p>
          </CardContent>
        </Card>
      )}

      {connected && (
        <div className="flex h-[calc(100vh-12rem)] gap-0 min-h-[400px] w-full">
          <Card
            className="flex flex-col min-w-0 shrink-0"
            style={{
              width: selectedEmail ? listWidth : undefined,
              flex: selectedEmail ? "0 0 auto" : 1,
            }}
          >
            <CardHeader>
              <Tooltip content={new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}>
                <CardTitle className="inline-block">
                  Today&apos;s Email (
                  {todaySearch.trim() ? todayDisplayCount + " of " + emails.length : todayDisplayCount}
                  )
                </CardTitle>
              </Tooltip>
              <CardDescription>
                All new emails from today across Inbox and all folders. Click an email to view. Go to Inbox for full folder control, search, and filters.
              </CardDescription>
              {emails.length > 0 && (
                <div className="pt-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Filter emails by subject, from, to..."
                      value={todaySearch}
                      onChange={(e) => setTodaySearch(e.target.value)}
                      className="pl-9 max-w-sm"
                    />
                  </div>
                </div>
              )}
            </CardHeader>
            <CardContent className="flex-1 overflow-auto p-0">
              {error && (
                <div className="mx-4 mb-4 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
              {loading ? (
                <p className="py-8 text-center text-muted-foreground">Connecting to Gmail...</p>
              ) : emails.length === 0 ? (
                <p className="py-8 text-center text-muted-foreground">
                  No emails from today. Go to Inbox for full access.
                </p>
              ) : (() => {
                if (todayDisplayCount === 0) {
                  return (
                    <p className="py-8 text-center text-muted-foreground">
                      No emails match your search. Try a different filter.
                    </p>
                  );
                }
                return (
                <div className="divide-y">
                  <a href="/inbox" className="block border-b px-4 py-3 text-center text-sm text-muted-foreground hover:bg-muted/50">
                    Open full Inbox with folders, search, and email controls ΓåÆ
                  </a>
                  {(() => {
                    const labelMap = new Map(labels.map((l) => [l.id, l.name]));
                    const byFolder = new Map<string, EmailMessage[]>();
                    for (const msg of todayFilteredEmails) {
                      const folder = getDisplayFolder(msg.labelIds || [], labelMap);
                      if (!byFolder.has(folder)) byFolder.set(folder, []);
                      byFolder.get(folder)!.push(msg);
                    }
                    const entries = Array.from(byFolder.entries()).sort((a, b) => a[0].localeCompare(b[0]));
                    return entries.map(([folder, folderEmails]) => {
                      const isExpanded = expandedFolders.has(folder);
                      return (
                      <div key={folder}>
                        <button
                          type="button"
                          onClick={() => {
                            setExpandedFolders((prev) => {
                              const next = new Set(prev);
                              if (next.has(folder)) next.delete(folder);
                              else next.add(folder);
                              return next;
                            });
                          }}
                          className="sticky top-0 z-10 flex w-full items-center gap-2 bg-muted/80 px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider backdrop-blur-sm hover:bg-muted"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 shrink-0" />
                          ) : (
                            <ChevronRight className="h-4 w-4 shrink-0" />
                          )}
                          {folder} ({folderEmails.length})
                        </button>
                        {isExpanded && folderEmails.map((msg) => (
                          <div
                            key={msg.id}
                            onClick={() => handleSelectEmail(msg)}
                            className={`flex cursor-pointer flex-col gap-1 px-4 py-3 transition-colors hover:bg-muted ${
                              selectedEmail?.id === msg.id ? "bg-primary/20" : ""
                            } ${msg.labelIds?.includes("UNREAD") ? "font-semibold" : ""}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="truncate flex-1 flex items-center gap-1">
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
                            <div className="text-sm truncate">
                              <span className="text-muted-foreground">From: </span>
                              <span className="font-semibold text-foreground">{msg.from}</span>
                            </div>
                            {msg.snippet && <p className="text-sm line-clamp-2 text-muted-foreground">{msg.snippet}</p>}
                          </div>
                        ))}
                      </div>
                    );
                    });
                  })()}
                </div>
                );
              })()}
            </CardContent>
          </Card>

          {selectedEmail && (
            <>
              <div
                className="w-2 shrink-0 cursor-col-resize rounded bg-muted/50 transition-colors hover:bg-primary/40"
                onMouseDown={(e) => {
                  e.preventDefault();
                  startResizeListDetail(e.clientX);
                }}
                title="Drag to resize panels"
              />
              <Card
                className="flex-1 min-w-[280px] flex flex-col overflow-hidden"
                style={{ minWidth: 280 }}
              >
                <EmailDetailPanel
                email={selectedEmail}
                detail={emailDetail}
                detailLoading={detailLoading}
                selectedLabel="INBOX"
                onModify={modifyEmail}
                onClose={() => setSelectedEmail(null)}
                onOpenInNewWindow={openInNewWindow}
                onReply={handleReply}
                onForward={handleForward}
              />
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  );
}
