"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const DOT = {
  contract:
    "bg-amber-300 shadow-[0_0_10px_rgba(253,224,71,0.9)] ring-1 ring-amber-200/90 dark:bg-amber-400",
  license:
    "bg-fuchsia-400 shadow-[0_0_10px_rgba(232,121,249,0.85)] ring-1 ring-fuchsia-200/85 dark:bg-fuchsia-500",
  task: "bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.9)] ring-1 ring-cyan-200/85 dark:bg-cyan-400",
  event:
    "bg-lime-400 shadow-[0_0_10px_rgba(190,242,100,0.9)] ring-1 ring-lime-200/85 dark:bg-lime-400",
} as const;

function localDateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function startOfWeekSunday(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

function parseApiDateOnlyKey(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return localDateKey(new Date(s));
}

function eventDayKey(e: { startAt: string; allDay: boolean }): string {
  if (e.allDay) {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(e.startAt);
    if (m) return m[1];
  }
  return localDateKey(new Date(e.startAt));
}

type CalendarEvent = {
  id: string;
  title: string;
  startAt: string;
  allDay: boolean;
  eventType: string;
  taskId: string | null;
};

type TaskDto = {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  dueAt: string | null;
  taskListId: string | null;
  taskList: { id: string; name: string } | null;
};

type EmailMsg = { id: string; subject: string; from: string; snippet: string; date: string };

type ContractRow = {
  id: string;
  expirationDate: string;
  energyType?: string | null;
  customer?: { name: string } | null;
  supplier?: { name: string } | null;
};

type LicenseRow = {
  id: string;
  licenseNumber: string;
  licenseType: string;
  expirationDate: string;
};

type TaskListRow = { id: string; name: string };

export default function DashboardPage() {
  const [emails, setEmails] = useState<EmailMsg[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [weekTasks, setWeekTasks] = useState<TaskDto[]>([]);
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [licenses, setLicenses] = useState<LicenseRow[]>([]);
  const [taskLists, setTaskLists] = useState<TaskListRow[]>([]);
  const [tasksByList, setTasksByList] = useState<Record<string, TaskDto[]>>({});
  const [openAcc, setOpenAcc] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const weekStart = useMemo(() => startOfWeekSunday(new Date()), []);
  const weekEnd = useMemo(() => {
    const e = new Date(weekStart);
    e.setDate(e.getDate() + 6);
    e.setHours(23, 59, 59, 999);
    return e;
  }, [weekStart]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fromIso = weekStart.toISOString();
      const toIso = weekEnd.toISOString();

      const [emRes, calRes, listsRes, tasksRes, cRes, lRes] = await Promise.all([
        fetch("/api/emails?maxResults=10&labelIds=INBOX"),
        fetch(`/api/calendar/overview?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`),
        fetch("/api/task-lists"),
        fetch("/api/tasks?includeCompleted=false"),
        fetch("/api/contracts?tab=active&sort=expirationDate&order=asc"),
        fetch("/api/licenses"),
      ]);

      if (emRes.ok) {
        const j = await emRes.json();
        setEmails(Array.isArray(j.messages) ? j.messages : []);
      } else setEmails([]);

      if (calRes.ok) {
        const j = await calRes.json();
        setEvents(Array.isArray(j.events) ? j.events : []);
        setWeekTasks(Array.isArray(j.tasks) ? j.tasks : []);
      } else {
        setEvents([]);
        setWeekTasks([]);
      }

      if (listsRes.ok) {
        const j = await listsRes.json();
        setTaskLists(Array.isArray(j) ? j : []);
      } else setTaskLists([]);

      if (tasksRes.ok) {
        const j = await tasksRes.json();
        const all = Array.isArray(j) ? (j as TaskDto[]) : [];
        const map: Record<string, TaskDto[]> = {};
        for (const t of all) {
          const lid = t.taskListId ?? "__none__";
          if (!map[lid]) map[lid] = [];
          map[lid].push(t);
        }
        setTasksByList(map);
      } else setTasksByList({});

      if (cRes.ok) {
        const j = await cRes.json();
        setContracts((Array.isArray(j) ? j : []).slice(0, 8));
      } else setContracts([]);

      if (lRes.ok) {
        const j = await lRes.json();
        const sorted = (Array.isArray(j) ? j : []).sort(
          (a: LicenseRow, b: LicenseRow) =>
            String(a.expirationDate).localeCompare(String(b.expirationDate))
        );
        setLicenses(sorted.slice(0, 8));
      } else setLicenses([]);
    } finally {
      setLoading(false);
    }
  }, [weekStart, weekEnd]);

  useEffect(() => {
    load();
  }, [load]);

  const dayKeys = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      return localDateKey(d);
    });
  }, [weekStart]);

  const eventsByDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      if (e.taskId) continue;
      if (String(e.eventType).toUpperCase() === "LICENSE_EXPIRY") continue;
      const k = eventDayKey(e);
      const list = m.get(k) ?? [];
      list.push(e);
      m.set(k, list);
    }
    return m;
  }, [events]);

  const tasksByDay = useMemo(() => {
    const m = new Map<string, TaskDto[]>();
    for (const t of weekTasks) {
      const raw = t.dueAt || t.dueDate;
      if (!raw) continue;
      const k = parseApiDateOnlyKey(String(raw));
      if (!dayKeys.includes(k)) continue;
      const list = m.get(k) ?? [];
      list.push(t);
      m.set(k, list);
    }
    return m;
  }, [weekTasks, dayKeys]);

  const toggleDashboardTask = async (task: TaskDto) => {
    const next = task.status === "COMPLETED" ? "PENDING" : "COMPLETED";
    const res = await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (res.ok) load();
  };

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 p-3 overflow-hidden bg-muted/20">
      {loading && (
        <p className="text-xs text-muted-foreground shrink-0">Refreshing dashboard…</p>
      )}
      <div className="flex flex-1 min-h-0 flex-col gap-2 lg:min-h-0">
        <div className="grid flex-1 min-h-0 grid-cols-12 gap-2">
        {/* Left column: emails + week (stacked) */}
        <div className="col-span-12 lg:col-span-5 flex flex-col min-h-0 gap-2 lg:min-h-0">
          <Card className="flex flex-[0.45] min-h-0 flex-col overflow-hidden border-border/60 shadow-sm">
            <CardHeader className="py-2 px-3 pb-1 shrink-0 flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-sm font-semibold">Today&apos;s emails</CardTitle>
                <CardDescription className="text-[11px]">Latest from Inbox</CardDescription>
              </div>
              <Button variant="ghost" size="sm" className="h-8 text-xs" asChild>
                <Link href="/communications/inbox">
                  Inbox <ExternalLink className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 overflow-y-auto px-2 py-1">
              {emails.length === 0 ? (
                <p className="text-xs text-muted-foreground px-2 py-4">No messages.</p>
              ) : (
                <ul className="space-y-0 divide-y divide-border/50">
                  {emails.map((m) => (
                    <li key={m.id}>
                      <Link
                        href={`/communications/inbox/email/${encodeURIComponent(m.id)}`}
                        className="block px-2 py-1.5 rounded-md hover:bg-muted/80 text-left"
                        title={m.subject}
                      >
                        <p className="text-xs font-medium truncate">{m.subject || "(No subject)"}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{m.from}</p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="flex flex-[0.55] min-h-0 flex-col overflow-hidden border-border/60 shadow-sm">
            <CardHeader className="py-2 px-3 pb-1 shrink-0 flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-sm font-semibold">Weekly calendar</CardTitle>
                <CardDescription className="text-[11px]">
                  Sun–Sat ·{" "}
                  {weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} –{" "}
                  {weekEnd.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" className="h-8 text-xs" asChild>
                <Link href="/schedule">Open</Link>
              </Button>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 overflow-hidden px-2 pb-2 flex flex-col gap-1">
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground shrink-0 px-1">
                <span className="inline-flex items-center gap-1">
                  <span className={cn("inline-block h-2 w-2 rounded-full", DOT.event)} /> Event
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className={cn("inline-block h-2 w-2 rounded-full", DOT.task)} /> Task
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className={cn("inline-block h-2 w-2 rounded-full", DOT.contract)} /> Contract
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className={cn("inline-block h-2 w-2 rounded-full", DOT.license)} /> License
                </span>
              </div>
              <div className="grid grid-cols-7 gap-0.5 flex-1 min-h-0 text-[10px]">
                {dayKeys.map((key, idx) => {
                  const d = new Date(key + "T12:00:00");
                  const evs = eventsByDay.get(key) ?? [];
                  const tks = tasksByDay.get(key) ?? [];
                  return (
                    <div
                      key={key}
                      className="flex min-h-0 flex-col rounded-md border border-border/40 bg-background/80 p-1 overflow-hidden"
                    >
                      <div className="font-semibold text-center border-b border-border/30 pb-0.5 mb-0.5 shrink-0">
                        {WEEKDAYS[idx]} <span className="text-muted-foreground">{d.getDate()}</span>
                      </div>
                      <ul className="space-y-0.5 overflow-y-auto min-h-0 flex-1">
                        {evs.slice(0, 4).map((ev) => (
                          <li key={ev.id} className="flex items-start gap-0.5 min-w-0">
                            <span className={cn("mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full", DOT.event)} />
                            <span className="truncate leading-tight">{ev.title}</span>
                          </li>
                        ))}
                        {tks.slice(0, 3).map((t) => (
                          <li key={t.id} className="flex items-start gap-0.5 min-w-0">
                            <span className={cn("mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full", DOT.task)} />
                            <span className="truncate leading-tight">{t.title}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tasks column */}
        <Card className="col-span-12 lg:col-span-3 flex min-h-[200px] lg:min-h-0 flex-col overflow-hidden border-border/60 shadow-sm">
          <CardHeader className="py-2 px-3 pb-1 shrink-0 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-semibold">Tasks</CardTitle>
            <Button variant="ghost" size="sm" className="h-8 text-xs" asChild>
              <Link href="/tasks">All tasks</Link>
            </Button>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 overflow-y-auto px-2 py-1 space-y-1">
            {taskLists.length === 0 ? (
              <p className="text-xs text-muted-foreground px-2">No lists.</p>
            ) : (
              taskLists.map((list) => {
                const open = openAcc[list.id] ?? false;
                const items = tasksByList[list.id] ?? [];
                return (
                  <div key={list.id} className="rounded-md border border-border/50 bg-background/60">
                    <button
                      type="button"
                      className="flex w-full items-center gap-1 px-2 py-1.5 text-left text-xs font-medium hover:bg-muted/50"
                      onClick={() => setOpenAcc((s) => ({ ...s, [list.id]: !open }))}
                    >
                      {open ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <span className="truncate">{list.name}</span>
                      <span className="text-muted-foreground text-[10px]">({items.length})</span>
                    </button>
                    {open && (
                      <ul className="border-t border-border/40 px-2 py-1 space-y-1">
                        {items.length === 0 ? (
                          <li className="text-[10px] text-muted-foreground">Empty</li>
                        ) : (
                          items.slice(0, 12).map((t) => (
                            <li key={t.id} className="flex items-start gap-2 text-[11px]">
                              <button
                                type="button"
                                className={cn(
                                  "mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-muted-foreground",
                                  t.status === "COMPLETED" && "bg-primary border-primary"
                                )}
                                aria-label="Toggle done"
                                onClick={() => toggleDashboardTask(t)}
                              />
                              <span className={cn(t.status === "COMPLETED" && "line-through opacity-70")}>
                                {t.title}
                              </span>
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Contract + license expirations */}
        <Card className="col-span-12 lg:col-span-4 flex min-h-[200px] lg:min-h-0 flex-col overflow-hidden border-border/60 shadow-sm">
          <CardHeader className="py-2 px-3 pb-1 shrink-0 flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-sm font-semibold">Contract expirations</CardTitle>
              <CardDescription className="text-[11px]">Upcoming contracts &amp; licenses</CardDescription>
            </div>
            <Button variant="ghost" size="sm" className="h-8 text-xs" asChild>
              <Link href="/schedule">Schedule</Link>
            </Button>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 overflow-y-auto px-2 py-1 space-y-3 text-xs">
            <section>
              <h4 className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">
                Contracts
              </h4>
              <ul className="space-y-1">
                {contracts.length === 0 ? (
                  <li className="text-muted-foreground">None listed.</li>
                ) : (
                  contracts.map((c) => (
                    <li key={c.id} className="rounded border border-border/40 px-2 py-1">
                      <p className="font-medium truncate">
                        {c.customer?.name ?? "—"} → {c.supplier?.name ?? "—"}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {(c.energyType ?? "").replaceAll("_", " ")} ·{" "}
                        {c.expirationDate
                          ? new Date(c.expirationDate).toLocaleDateString()
                          : "—"}
                      </p>
                    </li>
                  ))
                )}
              </ul>
            </section>
            <section>
              <h4 className="text-[10px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300 mb-1">
                Licenses
              </h4>
              <ul className="space-y-1">
                {licenses.length === 0 ? (
                  <li className="text-muted-foreground">None listed.</li>
                ) : (
                  licenses.map((l) => (
                    <li
                      key={l.id}
                      className="rounded border border-violet-200/50 bg-violet-50/40 dark:bg-violet-950/25 px-2 py-1"
                    >
                      <p className="font-medium truncate">
                        {l.licenseType} {l.licenseNumber}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {l.expirationDate
                          ? new Date(l.expirationDate).toLocaleDateString()
                          : "—"}
                      </p>
                    </li>
                  ))
                )}
              </ul>
            </section>
          </CardContent>
        </Card>
        </div>

        {/* News — thin strip so the page does not scroll on typical viewports */}
        <Card className="shrink-0 flex flex-col border-border/60 shadow-sm">
          <CardHeader className="py-2 px-3 pb-1 flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-sm font-semibold">News</CardTitle>
              <CardDescription className="text-[11px]">Energy &amp; macro headlines</CardDescription>
            </div>
            <Button variant="ghost" size="sm" className="h-8 text-xs" asChild>
              <Link href="/news">Open news</Link>
            </Button>
          </CardHeader>
          <CardContent className="px-3 pb-2 text-xs text-muted-foreground">
            Use the News page for feeds and market context. This panel links there so the dashboard stays
            compact.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
