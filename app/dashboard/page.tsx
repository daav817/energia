"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ExternalLink,
  Search,
} from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScheduleContractModal } from "@/components/schedule/schedule-contract-modal";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const DASH_CAL_STORAGE_KEY = "energia-dashboard-cal";

const SCHEDULE_NEON_DOT = {
  contract:
    "bg-amber-300 shadow-[0_0_14px_rgba(253,224,71,0.98),0_0_5px_rgba(250,204,21,1)] ring-1 ring-amber-200/90 dark:bg-amber-400",
  license:
    "bg-fuchsia-400 shadow-[0_0_14px_rgba(232,121,249,0.95),0_0_5px_rgba(217,70,239,1)] ring-1 ring-fuchsia-200/85 dark:bg-fuchsia-500",
  task:
    "bg-cyan-300 shadow-[0_0_14px_rgba(103,232,249,0.98),0_0_5px_rgba(34,211,238,1)] ring-1 ring-cyan-200/85 dark:bg-cyan-400",
  event:
    "bg-lime-400 shadow-[0_0_14px_rgba(190,242,100,0.98),0_0_5px_rgba(163,230,53,1)] ring-1 ring-lime-200/85 dark:bg-lime-400",
  rfpSupplierQuote:
    "bg-orange-400 shadow-[0_0_18px_rgba(251,146,60,0.98)] ring-2 ring-orange-200/95 dark:bg-orange-500",
} as const;

const CELL_MARKER = "h-2.5 w-2.5 mt-0.5 shrink-0 rounded-full";

/** @deprecated use SCHEDULE_NEON_DOT — kept for legend labels */
const DOT = SCHEDULE_NEON_DOT;

function calendarEventMarkerClass(eventType: string): string {
  const t = String(eventType).toUpperCase().replace(/\s+/g, "_");
  switch (t) {
    case "CONTRACT_RENEWAL":
      return SCHEDULE_NEON_DOT.contract;
    case "LICENSE_EXPIRY":
      return SCHEDULE_NEON_DOT.license;
    case "RFP_DEADLINE":
      return "bg-rose-400 shadow-[0_0_14px_rgba(251,113,133,0.95)] ring-1 ring-rose-200/85 dark:bg-rose-500";
    case "SUPPLIER_QUOTE_DUE_RFP":
      return SCHEDULE_NEON_DOT.rfpSupplierQuote;
    case "FOLLOW_UP":
      return "bg-sky-300 shadow-[0_0_14px_rgba(125,211,252,0.98)] ring-1 ring-sky-200/85 dark:bg-sky-400";
    case "MEETING":
      return "bg-blue-400 shadow-[0_0_14px_rgba(147,197,253,0.98)] ring-1 ring-blue-200/85 dark:bg-blue-400";
    case "TASK":
      return SCHEDULE_NEON_DOT.task;
    default:
      return SCHEDULE_NEON_DOT.event;
  }
}

function addMonths(year: number, month: number, delta: number): { y: number; m: number } {
  const d = new Date(year, month + delta, 1);
  return { y: d.getFullYear(), m: d.getMonth() };
}

function addYears(year: number, delta: number): number {
  return year + delta;
}

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

function calendarCells(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const startOffset = first.getDay();
  const gridStart = new Date(year, month, 1 - startOffset);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push(d);
  }
  return cells;
}

function monthVisibleGridRange(year: number, month: number): { from: Date; to: Date } {
  const cells = calendarCells(year, month);
  const first = cells[0];
  const last = cells[41];
  const from = new Date(first.getFullYear(), first.getMonth(), first.getDate(), 0, 0, 0, 0);
  const to = new Date(last.getFullYear(), last.getMonth(), last.getDate(), 23, 59, 59, 999);
  return { from, to };
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
  licenseId?: string | null;
  license?: {
    id: string;
    licenseNumber: string;
    licenseType: string;
    expirationDate: string | null;
  } | null;
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

type DashCalView = "week" | "month" | "year";

type DashCalPersist = {
  view: DashCalView;
  weekStart: string;
  month: number;
  year: number;
};

function readDashCal(): DashCalPersist | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(DASH_CAL_STORAGE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as Partial<DashCalPersist>;
    if (j.view !== "week" && j.view !== "month" && j.view !== "year") return null;
    return {
      view: j.view,
      weekStart: typeof j.weekStart === "string" ? j.weekStart : new Date().toISOString(),
      month: Number.isFinite(j.month) ? Number(j.month) : new Date().getMonth(),
      year: Number.isFinite(j.year) ? Number(j.year) : new Date().getFullYear(),
    };
  } catch {
    return null;
  }
}

type PendingRfpQuoteRow = {
  kind: "rfp" | "quote";
  id: string;
  label: string;
  sub: string;
  at: string;
};

export default function DashboardPage() {
  const router = useRouter();
  const [emails, setEmails] = useState<EmailMsg[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [weekTasks, setWeekTasks] = useState<TaskDto[]>([]);
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [licenses, setLicenses] = useState<LicenseRow[]>([]);
  const [taskLists, setTaskLists] = useState<TaskListRow[]>([]);
  const [tasksByList, setTasksByList] = useState<Record<string, TaskDto[]>>({});
  const [completedTasksByList, setCompletedTasksByList] = useState<Record<string, TaskDto[]>>({});
  const [openAcc, setOpenAcc] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [emailModalId, setEmailModalId] = useState<string | null>(null);
  const [weekDayModal, setWeekDayModal] = useState<{ key: string; label: string } | null>(null);
  const [dashCalView, setDashCalView] = useState<DashCalView>("week");
  const [dashWeekStart, setDashWeekStart] = useState(() => startOfWeekSunday(new Date()));
  const [dashMonth, setDashMonth] = useState(() => new Date().getMonth());
  const [dashYear, setDashYear] = useState(() => new Date().getFullYear());
  const [dashCalRestored, setDashCalRestored] = useState(false);
  const [pendingRfpQuotes, setPendingRfpQuotes] = useState<PendingRfpQuoteRow[]>([]);
  const [contractExpSearch, setContractExpSearch] = useState("");
  const [contractModalOpen, setContractModalOpen] = useState(false);
  const [contractModalId, setContractModalId] = useState<string | null>(null);
  const [wideLayout, setWideLayout] = useState(true);

  useEffect(() => {
    const p = readDashCal();
    if (p) {
      setDashCalView(p.view);
      const d = new Date(p.weekStart);
      if (!Number.isNaN(d.getTime())) setDashWeekStart(startOfWeekSunday(d));
      setDashMonth(p.month);
      setDashYear(p.year);
    }
    setDashCalRestored(true);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const upd = () => setWideLayout(mq.matches);
    upd();
    mq.addEventListener("change", upd);
    return () => mq.removeEventListener("change", upd);
  }, []);

  useEffect(() => {
    if (!dashCalRestored) return;
    const payload: DashCalPersist = {
      view: dashCalView,
      weekStart: dashWeekStart.toISOString(),
      month: dashMonth,
      year: dashYear,
    };
    localStorage.setItem(DASH_CAL_STORAGE_KEY, JSON.stringify(payload));
  }, [dashCalRestored, dashCalView, dashWeekStart, dashMonth, dashYear]);

  const goToToday = useCallback(() => {
    const now = new Date();
    if (dashCalView === "week") setDashWeekStart(startOfWeekSunday(now));
    else if (dashCalView === "month") {
      setDashMonth(now.getMonth());
      setDashYear(now.getFullYear());
    } else setDashYear(now.getFullYear());
  }, [dashCalView]);

  const goDashMonth = useCallback((delta: number) => {
    const { y, m } = addMonths(dashYear, dashMonth, delta);
    setDashYear(y);
    setDashMonth(m);
  }, [dashYear, dashMonth]);

  const goDashYear = useCallback((delta: number) => {
    setDashYear((y) => addYears(y, delta));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let fromD: Date;
      let toD: Date;
      if (dashCalView === "week") {
        fromD = new Date(dashWeekStart);
        fromD.setHours(0, 0, 0, 0);
        toD = new Date(dashWeekStart);
        toD.setDate(toD.getDate() + 6);
        toD.setHours(23, 59, 59, 999);
      } else if (dashCalView === "month") {
        const r = monthVisibleGridRange(dashYear, dashMonth);
        fromD = r.from;
        toD = r.to;
      } else {
        fromD = new Date(dashYear, 0, 1, 0, 0, 0, 0);
        toD = new Date(dashYear, 11, 31, 23, 59, 59, 999);
      }
      const fromIso = fromD.toISOString();
      const toIso = toD.toISOString();

      const [emRes, calRes, listsRes, tasksRes, cRes, lRes, rfpRes] = await Promise.all([
        fetch("/api/emails?maxResults=10&labelIds=INBOX"),
        fetch(`/api/calendar/overview?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`),
        fetch("/api/task-lists"),
        fetch("/api/tasks?includeCompleted=true"),
        fetch("/api/contracts?tab=active&sort=expirationDate&order=asc"),
        fetch("/api/licenses"),
        fetch("/api/rfp"),
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
        const mapDone: Record<string, TaskDto[]> = {};
        for (const t of all) {
          const lid = t.taskListId ?? "__none__";
          if (t.status === "COMPLETED") {
            if (!mapDone[lid]) mapDone[lid] = [];
            mapDone[lid].push(t);
          } else {
            if (!map[lid]) map[lid] = [];
            map[lid].push(t);
          }
        }
        setTasksByList(map);
        setCompletedTasksByList(mapDone);
      } else {
        setTasksByList({});
        setCompletedTasksByList({});
      }

      if (cRes.ok) {
        const j = await cRes.json();
        setContracts(Array.isArray(j) ? j : []);
      } else setContracts([]);

      if (lRes.ok) {
        const j = await lRes.json();
        const sorted = (Array.isArray(j) ? j : []).sort(
          (a: LicenseRow, b: LicenseRow) =>
            String(a.expirationDate).localeCompare(String(b.expirationDate))
        );
        setLicenses(sorted);
      } else setLicenses([]);

      let rfpList: unknown[] = [];
      if (rfpRes.ok) {
        const jr = await rfpRes.json();
        rfpList = Array.isArray(jr) ? jr : [];
      }
      const pending: PendingRfpQuoteRow[] = [];
      for (const raw of rfpList as Array<{
        id: string;
        status: string;
        sentAt?: string | null;
        quoteSummarySentAt?: string | null;
        refreshSequence?: number;
        energyType?: string;
        customer?: { name?: string };
      }>) {
        const st = raw.status;
        if (raw.sentAt && st !== "completed" && st !== "cancelled") {
          const energy = raw.energyType === "ELECTRIC" ? "Electric" : "Natural gas";
          const refresh =
            (raw.refreshSequence ?? 0) > 0 ? ` · Supplier refresh ×${raw.refreshSequence}` : "";
          pending.push({
            kind: "rfp",
            id: raw.id,
            label: raw.customer?.name ?? "Customer",
            sub: `${energy} · ${st}${refresh}`,
            at: String(raw.sentAt),
          });
        }
        if (raw.quoteSummarySentAt) {
          const energy = raw.energyType === "ELECTRIC" ? "Electric" : "Natural gas";
          pending.push({
            kind: "quote",
            id: raw.id,
            label: raw.customer?.name ?? "Customer",
            sub: `${energy} · Quote summary emailed`,
            at: String(raw.quoteSummarySentAt),
          });
        }
      }
      pending.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
      setPendingRfpQuotes(pending.slice(0, 14));
    } finally {
      setLoading(false);
    }
  }, [dashCalView, dashWeekStart, dashMonth, dashYear]);

  useEffect(() => {
    load();
  }, [load]);

  const monthCells = useMemo(() => {
    if (dashCalView !== "month") return [] as Date[];
    return calendarCells(dashYear, dashMonth);
  }, [dashCalView, dashYear, dashMonth]);

  const dayKeys = useMemo(() => {
    if (dashCalView === "week") {
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(dashWeekStart);
        d.setDate(dashWeekStart.getDate() + i);
        return localDateKey(d);
      });
    }
    if (dashCalView === "month") {
      return monthCells.map((d) => localDateKey(d));
    }
    return [];
  }, [dashCalView, dashWeekStart, monthCells]);

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
    for (const [, list] of m) {
      list.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    }
    return m;
  }, [events]);

  const licensesForSchedule = useMemo(() => {
    const fromApi = [...licenses];
    const seen = new Set(fromApi.map((l) => l.id));
    const extras: LicenseRow[] = [];

    for (const ev of events) {
      const isLicenseExpiry =
        String(ev.eventType).toUpperCase().replace(/\s+/g, "_") === "LICENSE_EXPIRY";
      if (!isLicenseExpiry) continue;
      if (ev.licenseId && seen.has(ev.licenseId)) continue;
      if (ev.license) {
        const lid = ev.license.id;
        if (seen.has(lid)) continue;
        seen.add(lid);
        extras.push({
          id: lid,
          licenseNumber: ev.license.licenseNumber,
          licenseType: ev.license.licenseType,
          expirationDate: ev.license.expirationDate || ev.startAt,
        });
        continue;
      }
      const syntheticId = `calendar-license-${ev.id}`;
      if (seen.has(syntheticId)) continue;
      seen.add(syntheticId);
      extras.push({
        id: syntheticId,
        licenseNumber: ev.title || "License expiry",
        licenseType: "Calendar",
        expirationDate: ev.startAt,
      });
    }
    return [...fromApi, ...extras];
  }, [licenses, events]);

  const contractsByExpirationDay = useMemo(() => {
    const map = new Map<string, ContractRow[]>();
    for (const c of contracts) {
      const key = parseApiDateOnlyKey(String(c.expirationDate));
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(c);
      map.set(key, list);
    }
    return map;
  }, [contracts]);

  const licensesByExpirationDay = useMemo(() => {
    const map = new Map<string, LicenseRow[]>();
    for (const lic of licensesForSchedule) {
      const key = parseApiDateOnlyKey(String(lic.expirationDate));
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(lic);
      map.set(key, list);
    }
    return map;
  }, [licensesForSchedule]);

  const contractsGroupedByMonthYear = useMemo(() => {
    const sorted = [...contracts].sort(
      (a, b) =>
        parseApiDateOnlyKey(String(a.expirationDate)).localeCompare(
          parseApiDateOnlyKey(String(b.expirationDate))
        ) || (a.customer?.name ?? "").localeCompare(b.customer?.name ?? "")
    );
    const groups = new Map<string, { label: string; items: ContractRow[] }>();
    for (const c of sorted) {
      const key = parseApiDateOnlyKey(String(c.expirationDate));
      if (!key) continue;
      const ym = key.slice(0, 7);
      if (!groups.has(ym)) {
        const [y, m] = ym.split("-").map(Number);
        groups.set(ym, {
          label: new Date(y, m - 1, 1).toLocaleString("en-US", {
            month: "long",
            year: "numeric",
          }),
          items: [],
        });
      }
      groups.get(ym)!.items.push(c);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [contracts]);

  const contractsGroupedByMonthYearFiltered = useMemo(() => {
    const q = contractExpSearch.trim().toLowerCase();
    if (!q) return contractsGroupedByMonthYear;
    const tokens = q.split(/\s+/).filter(Boolean);
    return contractsGroupedByMonthYear
      .map(([ym, group]) => {
        const items = group.items.filter((c) => {
          const exp = parseApiDateOnlyKey(String(c.expirationDate));
          const expD = exp
            ? new Date(exp + "T12:00:00").toLocaleDateString().toLowerCase()
            : "";
          const hay = [
            c.customer?.name,
            c.supplier?.name,
            (c.energyType ?? "").replaceAll("_", " "),
            exp,
            expD,
            group.label,
            ym,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return tokens.every((t) => hay.includes(t));
        });
        return [ym, { ...group, items }] as const;
      })
      .filter(([, g]) => g.items.length > 0);
  }, [contractsGroupedByMonthYear, contractExpSearch]);

  const licensesGroupedByMonthYear = useMemo(() => {
    const sorted = [...licensesForSchedule].sort(
      (a, b) =>
        parseApiDateOnlyKey(String(a.expirationDate)).localeCompare(
          parseApiDateOnlyKey(String(b.expirationDate))
        ) || a.licenseNumber.localeCompare(b.licenseNumber)
    );
    const groups = new Map<string, { label: string; items: LicenseRow[] }>();
    for (const lic of sorted) {
      const key = parseApiDateOnlyKey(String(lic.expirationDate));
      if (!key) continue;
      const ym = key.slice(0, 7);
      if (!groups.has(ym)) {
        const [y, m] = ym.split("-").map(Number);
        groups.set(ym, {
          label: new Date(y, m - 1, 1).toLocaleString("en-US", {
            month: "long",
            year: "numeric",
          }),
          items: [],
        });
      }
      groups.get(ym)!.items.push(lic);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [licensesForSchedule]);

  const tasksByDay = useMemo(() => {
    const m = new Map<string, TaskDto[]>();
    for (const t of weekTasks) {
      const raw = t.dueAt || t.dueDate;
      if (!raw) continue;
      const k = parseApiDateOnlyKey(String(raw));
      if (dashCalView === "year") {
        if (!k.startsWith(`${dashYear}-`)) continue;
      } else if (!dayKeys.includes(k)) continue;
      const list = m.get(k) ?? [];
      list.push(t);
      m.set(k, list);
    }
    return m;
  }, [weekTasks, dayKeys, dashCalView, dashYear]);

  const yearMonthSummary = useMemo(() => {
    if (dashCalView !== "year") return [];
    const counts = Array.from({ length: 12 }, (_, mo) => {
      const prefix = `${dashYear}-${String(mo + 1).padStart(2, "0")}`;
      let n = 0;
      for (const [key, evs] of eventsByDay) {
        if (!key.startsWith(prefix)) continue;
        n += evs.length;
      }
      for (const [key, tks] of tasksByDay) {
        if (!key.startsWith(prefix)) continue;
        n += tks.length;
      }
      for (const c of contracts) {
        const k = parseApiDateOnlyKey(String(c.expirationDate));
        if (k.startsWith(prefix)) n += 1;
      }
      for (const lic of licensesForSchedule) {
        const k = parseApiDateOnlyKey(String(lic.expirationDate));
        if (k.startsWith(prefix)) n += 1;
      }
      return { month: mo, count: n };
    });
    return counts;
  }, [dashCalView, dashYear, eventsByDay, tasksByDay, contracts, licensesForSchedule]);

  const dashWeekEnd = useMemo(() => {
    const e = new Date(dashWeekStart);
    e.setDate(e.getDate() + 6);
    return e;
  }, [dashWeekStart]);

  const toggleDashboardTask = async (task: TaskDto) => {
    const next = task.status === "COMPLETED" ? "PENDING" : "COMPLETED";
    const res = await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (res.ok) load();
  };

  const dashMonthLabel = useMemo(
    () =>
      new Date(dashYear, dashMonth, 1).toLocaleString("en-US", {
        month: "long",
        year: "numeric",
      }),
    [dashYear, dashMonth]
  );

  const flashDayOnCalendar = useCallback(
    (dateKey: string) => {
      router.push(`/schedule?flashDate=${encodeURIComponent(dateKey)}`);
    },
    [router]
  );

  const resizeHandleClass =
    "relative w-1.5 mx-0.5 rounded-sm bg-border/80 hover:bg-primary/40 data-[panel-group-direction=vertical]:h-1.5 data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:my-0.5 outline-none";

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 p-3 overflow-hidden bg-muted/20">
      {loading && (
        <p className="text-xs text-muted-foreground shrink-0">Refreshing dashboard…</p>
      )}
      <div className="flex flex-1 min-h-0 flex-col gap-2 lg:min-h-0">
        <PanelGroup
          direction={wideLayout ? "horizontal" : "vertical"}
          autoSaveId="energia-dashboard-cols"
          className="flex-1 min-h-[280px] lg:min-h-0"
        >
          <Panel defaultSize={wideLayout ? 48 : 100} minSize={wideLayout ? 22 : 10}>
            <PanelGroup
              direction="vertical"
              autoSaveId="energia-dashboard-left-stack"
              className="flex h-full min-h-0 flex-col gap-2"
            >
              <Panel defaultSize={50} minSize={18} className="min-h-0">
                <Card className="flex h-full min-h-0 flex-col overflow-hidden border-border/60 shadow-sm">
            <CardHeader className="py-2 px-3 pb-1 shrink-0 flex flex-row items-center justify-between space-y-0 gap-2">
              <div className="min-w-0">
                <CardTitle className="text-sm font-semibold flex flex-wrap items-baseline gap-x-2 gap-y-0">
                  <span>Today&apos;s emails</span>
                  <span className="font-bold text-foreground tabular-nums">
                    {new Date().toLocaleDateString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </CardTitle>
                <CardDescription className="text-[11px]">Latest from Emails</CardDescription>
              </div>
              <Button variant="ghost" size="sm" className="h-8 text-xs shrink-0" asChild>
                <Link href="/inbox">
                  Emails <ExternalLink className="ml-1 h-3 w-3" />
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
                      <button
                        type="button"
                        className="block w-full px-2 py-1.5 rounded-md hover:bg-muted/80 text-left"
                        title={m.subject}
                        onClick={() => setEmailModalId(m.id)}
                      >
                        <p className="text-xs font-medium truncate">{m.subject || "(No subject)"}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{m.from}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
                </Card>
              </Panel>
              <PanelResizeHandle className={resizeHandleClass} />
              <Panel defaultSize={50} minSize={22} className="min-h-0">
                <Card className="flex h-full min-h-0 flex-col overflow-hidden border-border/60 shadow-sm">
            <CardHeader className="py-2 px-3 pb-2 shrink-0 space-y-2 border-b border-border/30">
              <div className="flex flex-row items-center justify-between gap-2">
                <CardTitle className="text-sm font-semibold">Calendar</CardTitle>
                <Button variant="ghost" size="sm" className="h-8 text-xs shrink-0" asChild>
                  <Link href="/schedule">Open schedule</Link>
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-0.5 sm:justify-start min-w-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label="Previous year"
                  onClick={() => goDashYear(-1)}
                >
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                {dashCalView === "week" && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    aria-label="Previous week"
                    onClick={() => {
                      const n = new Date(dashWeekStart);
                      n.setDate(n.getDate() - 7);
                      setDashWeekStart(startOfWeekSunday(n));
                    }}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                )}
                {dashCalView === "month" && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    aria-label="Previous month"
                    onClick={() => goDashMonth(-1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                )}
                <h2 className="min-w-[8rem] flex-1 text-center text-base font-bold tracking-tight tabular-nums sm:text-lg md:text-xl px-1 leading-tight">
                  {dashCalView === "year"
                    ? String(dashYear)
                    : dashCalView === "week"
                      ? `${dashWeekStart.toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })} – ${dashWeekEnd.toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}`
                      : dashMonthLabel}
                </h2>
                {dashCalView === "week" && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    aria-label="Next week"
                    onClick={() => {
                      const n = new Date(dashWeekStart);
                      n.setDate(n.getDate() + 7);
                      setDashWeekStart(startOfWeekSunday(n));
                    }}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                )}
                {dashCalView === "month" && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    aria-label="Next month"
                    onClick={() => goDashMonth(1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label="Next year"
                  onClick={() => goDashYear(1)}
                >
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-full border border-border/60 bg-background/60 p-0.5 gap-0.5">
                  {(["week", "month", "year"] as const).map((v) => (
                    <Button
                      key={v}
                      type="button"
                      variant={dashCalView === v ? "default" : "ghost"}
                      size="sm"
                      className="rounded-full h-7 px-2.5 text-[10px] capitalize"
                      onClick={() => setDashCalView(v)}
                    >
                      {v}
                    </Button>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-7 text-[10px] px-2.5"
                  onClick={goToToday}
                >
                  Today
                </Button>
              </div>
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
              {dashCalView === "year" ? (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-1 flex-1 min-h-0 overflow-y-auto text-[10px]">
                  {yearMonthSummary.map(({ month, count }) => (
                    <button
                      key={month}
                      type="button"
                      className="rounded border border-border/50 p-2 text-left hover:bg-muted/50 transition-colors"
                      onClick={() => {
                        setDashCalView("month");
                        setDashMonth(month);
                      }}
                    >
                      <div className="font-semibold">
                        {new Date(dashYear, month, 1).toLocaleString(undefined, { month: "short" })}
                      </div>
                      <div className="text-muted-foreground">{count} items</div>
                    </button>
                  ))}
                </div>
              ) : dashCalView === "month" ? (
                <div className="flex-1 min-h-0 flex flex-col gap-0.5 overflow-hidden">
                  <div className="rounded-md border border-emerald-200/90 bg-emerald-100/90 dark:border-emerald-800/55 dark:bg-emerald-950/85 shrink-0">
                    <div className="grid grid-cols-7 gap-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-950 dark:text-emerald-100 text-center py-1.5">
                      {WEEKDAYS.map((d) => (
                        <div key={d}>{d.slice(0, 3)}</div>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-7 gap-1 flex-1 min-h-0 overflow-y-auto auto-rows-fr text-[10px] sm:text-[11px] pr-0.5">
                    {monthCells.map((d, i) => {
                      const key = localDateKey(d);
                      const inMonth = d.getMonth() === dashMonth;
                      const dayEvents = eventsByDay.get(key) ?? [];
                      const dayTasks = tasksByDay.get(key) ?? [];
                      const dayContracts = contractsByExpirationDay.get(key) ?? [];
                      const dayLicenses = licensesByExpirationDay.get(key) ?? [];
                      const isToday = key === localDateKey(new Date());
                      const openDayModal = () =>
                        setWeekDayModal({
                          key,
                          label: d.toLocaleDateString(undefined, {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          }),
                        });
                      return (
                        <div
                          key={`${key}-${i}`}
                          role="button"
                          tabIndex={0}
                          onClick={openDayModal}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter" || ev.key === " ") {
                              ev.preventDefault();
                              openDayModal();
                            }
                          }}
                          className={cn(
                            "relative min-h-[5.75rem] overflow-hidden rounded-lg border-2 p-1.5 text-left outline-none transition-colors cursor-pointer",
                            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                            inMonth
                              ? "border-zinc-400/80 bg-background/95 shadow-sm dark:border-zinc-500/70"
                              : "border-zinc-500/60 bg-zinc-400/90 text-zinc-900 dark:border-zinc-600/70 dark:bg-zinc-800/98 dark:text-zinc-100",
                            isToday && "ring-2 ring-primary/35 ring-offset-1 ring-offset-background"
                          )}
                        >
                          {!inMonth && (
                            <div className="mb-0.5 text-[9px] font-bold tracking-wide leading-none text-zinc-800 dark:text-zinc-200">
                              {d.toLocaleString("en-US", { month: "short" })}
                            </div>
                          )}
                          <div
                            className={cn(
                              "mb-1 text-xs font-semibold tabular-nums",
                              inMonth ? "text-foreground" : "text-zinc-950 dark:text-zinc-50"
                            )}
                          >
                            {d.getDate()}
                          </div>
                          {dayContracts.length > 0 && (
                            <div className="mb-1 space-y-0.5">
                              {dayContracts.slice(0, 2).map((c) => (
                                <button
                                  key={c.id}
                                  type="button"
                                  onClick={(evt) => {
                                    evt.stopPropagation();
                                    setContractModalId(c.id);
                                    setContractModalOpen(true);
                                  }}
                                  className={cn(
                                    "flex w-full min-w-0 items-start gap-1 rounded-md px-0.5 py-0.5 text-left font-medium hover:bg-muted/50",
                                    inMonth
                                      ? "text-amber-900 dark:text-amber-100"
                                      : "text-amber-950 dark:text-amber-100"
                                  )}
                                >
                                  <span className={cn(CELL_MARKER, SCHEDULE_NEON_DOT.contract)} aria-hidden />
                                  <span className="min-w-0 flex-1 truncate">
                                    Contract · {c.customer?.name ?? "—"}
                                  </span>
                                </button>
                              ))}
                              {dayContracts.length > 2 && (
                                <span
                                  className={cn(
                                    "pl-2 text-[10px]",
                                    inMonth ? "text-muted-foreground" : "text-zinc-900 dark:text-zinc-200"
                                  )}
                                >
                                  +{dayContracts.length - 2}
                                </span>
                              )}
                            </div>
                          )}
                          {dayLicenses.length > 0 && (
                            <div className="mb-1 space-y-0.5">
                              <div
                                className={cn(
                                  "flex min-w-0 items-start gap-1 font-medium",
                                  inMonth
                                    ? "text-violet-900 dark:text-violet-100"
                                    : "text-violet-950 dark:text-violet-100"
                                )}
                              >
                                <span className={cn(CELL_MARKER, SCHEDULE_NEON_DOT.license)} aria-hidden />
                                <span className="min-w-0 flex-1 truncate">
                                  License · {dayLicenses[0].licenseType} {dayLicenses[0].licenseNumber}
                                  {dayLicenses.length > 1 ? ` +${dayLicenses.length - 1}` : ""}
                                </span>
                              </div>
                            </div>
                          )}
                          <ul className="space-y-0.5">
                            {dayTasks.slice(0, 2).map((t) => (
                              <li key={t.id}>
                                <Link
                                  href={`/tasks?taskId=${encodeURIComponent(t.id)}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className={cn(
                                    "flex w-full min-w-0 items-start gap-1 rounded-md px-0.5 py-0.5 text-left font-medium hover:bg-muted/50",
                                    inMonth
                                      ? "text-teal-700 dark:text-teal-300"
                                      : "text-teal-950 dark:text-teal-200"
                                  )}
                                >
                                  <span className={cn(CELL_MARKER, SCHEDULE_NEON_DOT.task)} aria-hidden />
                                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                                </Link>
                              </li>
                            ))}
                            {dayEvents.slice(0, 2).map((ev) => (
                              <li key={ev.id} className="flex min-w-0 items-start gap-1 px-0.5 py-0.5">
                                <span
                                  className={cn(
                                    CELL_MARKER,
                                    calendarEventMarkerClass(ev.eventType),
                                    !inMonth &&
                                      "outline outline-1 outline-offset-1 outline-zinc-950/35 dark:outline-white/45"
                                  )}
                                  aria-hidden
                                />
                                <span className="min-w-0 flex-1 truncate">{ev.title}</span>
                              </li>
                            ))}
                            {dayEvents.length + dayTasks.length > 4 && (
                              <li
                                className={cn(
                                  "pl-1 text-[10px]",
                                  inMonth ? "text-muted-foreground" : "text-zinc-900 dark:text-zinc-200"
                                )}
                              >
                                +{dayEvents.length + dayTasks.length - 4} more
                              </li>
                            )}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-7 gap-1 flex-1 min-h-0 text-[10px] sm:text-[11px]">
                  {dayKeys.map((key, idx) => {
                    const d = new Date(key + "T12:00:00");
                    const evs = eventsByDay.get(key) ?? [];
                    const tks = tasksByDay.get(key) ?? [];
                    const dayContracts = contractsByExpirationDay.get(key) ?? [];
                    const dayLicenses = licensesByExpirationDay.get(key) ?? [];
                    const isToday = key === localDateKey(new Date());
                    const openDayModal = () =>
                      setWeekDayModal({
                        key,
                        label: `${WEEKDAYS[idx]} ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
                      });
                    return (
                      <div
                        key={key}
                        role="button"
                        tabIndex={0}
                        onClick={openDayModal}
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter" || ev.key === " ") {
                            ev.preventDefault();
                            openDayModal();
                          }
                        }}
                        className={cn(
                          "flex min-h-0 flex-col rounded-lg border-2 p-1.5 overflow-hidden text-left outline-none transition-colors cursor-pointer",
                          "focus-visible:ring-2 focus-visible:ring-ring",
                          "border-zinc-400/80 bg-background/95 shadow-sm dark:border-zinc-500/70",
                          isToday && "ring-2 ring-primary/35 ring-offset-1 ring-offset-background"
                        )}
                      >
                        <div className="font-semibold text-center border-b border-border/30 pb-0.5 mb-0.5 shrink-0 text-xs">
                          {WEEKDAYS[idx]} <span className="text-muted-foreground">{d.getDate()}</span>
                        </div>
                        {dayContracts.length > 0 && (
                          <div className="mb-1 space-y-0.5">
                            {dayContracts.slice(0, 2).map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                onClick={(evt) => {
                                  evt.stopPropagation();
                                  setContractModalId(c.id);
                                  setContractModalOpen(true);
                                }}
                                className="flex w-full min-w-0 items-start gap-1 rounded-md px-0.5 py-0.5 text-left text-amber-900 dark:text-amber-100 font-medium hover:bg-muted/50"
                              >
                                <span className={cn(CELL_MARKER, SCHEDULE_NEON_DOT.contract)} aria-hidden />
                                <span className="truncate">{c.customer?.name ?? "—"}</span>
                              </button>
                            ))}
                          </div>
                        )}
                        {dayLicenses.length > 0 && (
                          <div className="mb-1 flex min-w-0 items-start gap-1 text-violet-900 dark:text-violet-100 font-medium">
                            <span className={cn(CELL_MARKER, SCHEDULE_NEON_DOT.license)} aria-hidden />
                            <span className="min-w-0 flex-1 truncate">
                              {dayLicenses[0].licenseType} {dayLicenses[0].licenseNumber}
                              {dayLicenses.length > 1 ? ` +${dayLicenses.length - 1}` : ""}
                            </span>
                          </div>
                        )}
                        <ul className="space-y-0.5 overflow-y-auto min-h-0 flex-1">
                          {tks.slice(0, 3).map((t) => (
                            <li key={t.id}>
                              <Link
                                href={`/tasks?taskId=${encodeURIComponent(t.id)}`}
                                onClick={(e) => e.stopPropagation()}
                                className="flex items-start gap-0.5 min-w-0 font-medium text-teal-700 dark:text-teal-300 hover:underline"
                              >
                                <span className={cn(CELL_MARKER, SCHEDULE_NEON_DOT.task)} aria-hidden />
                                <span className="truncate leading-tight">{t.title}</span>
                              </Link>
                            </li>
                          ))}
                          {evs.slice(0, 4).map((ev) => (
                            <li key={ev.id} className="flex items-start gap-0.5 min-w-0">
                              <span
                                className={cn(CELL_MARKER, calendarEventMarkerClass(ev.eventType))}
                                aria-hidden
                              />
                              <span className="truncate leading-tight">{ev.title}</span>
                            </li>
                          ))}
                          {evs.length + tks.length > 5 && (
                            <li className="text-[10px] text-muted-foreground pl-0.5">
                              +{evs.length + tks.length - 5} more
                            </li>
                          )}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
                </Card>
              </Panel>
            </PanelGroup>
          </Panel>
          <PanelResizeHandle className={resizeHandleClass} />
          <Panel defaultSize={wideLayout ? 26 : 38} minSize={15} className="min-h-0">
            <PanelGroup
              direction="vertical"
              autoSaveId="energia-dashboard-mid-stack"
              className="flex h-full min-h-0 flex-col gap-2"
            >
              <Panel defaultSize={55} minSize={22} className="min-h-0">
                <Card className="flex h-full min-h-0 w-full flex-col overflow-hidden border-border/60 shadow-sm">
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
                        <span className="text-muted-foreground text-[10px]">
                          ({items.length}
                          {(completedTasksByList[list.id]?.length ?? 0) > 0
                            ? ` · ${completedTasksByList[list.id]?.length} done`
                            : ""}
                          )
                        </span>
                      </button>
                      {open && (
                        <div className="border-t border-border/40 px-2 py-1 space-y-2">
                          <ul className="space-y-1">
                            {items.length === 0 ? (
                              <li className="text-[10px] text-muted-foreground">No open tasks</li>
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
                          {(completedTasksByList[list.id]?.length ?? 0) > 0 && (
                            <div className="pt-1 border-t border-border/30">
                              <p className="text-[10px] font-medium text-muted-foreground mb-1">Completed</p>
                              <ul className="space-y-1">
                                {(completedTasksByList[list.id] ?? []).slice(0, 8).map((t) => (
                                  <li key={t.id} className="flex items-start gap-2 text-[11px]">
                                    <button
                                      type="button"
                                      className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-primary bg-primary"
                                      aria-label="Toggle done"
                                      onClick={() => toggleDashboardTask(t)}
                                    />
                                    <span className="line-through opacity-70">{t.title}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </CardContent>
                </Card>
              </Panel>
              <PanelResizeHandle className={resizeHandleClass} />
              <Panel defaultSize={45} minSize={18} className="min-h-0">
                <Card className="flex h-full min-h-0 w-full flex-col overflow-hidden border-border/60 shadow-sm">
            <CardHeader className="py-2 px-3 pb-1 shrink-0">
              <CardTitle className="text-sm font-semibold">Pending RFPs and quotes</CardTitle>
              <CardDescription className="text-[11px]">
                Open supplier sends and logged customer quote-summary emails.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 overflow-y-auto px-2 py-1">
              {pendingRfpQuotes.length === 0 ? (
                <p className="text-xs text-muted-foreground px-1 py-2">Nothing pending in this category.</p>
              ) : (
                <ul className="space-y-1.5">
                  {pendingRfpQuotes.map((row) => (
                    <li
                      key={`${row.kind}-${row.id}-${row.at}`}
                      className="rounded-md border border-border/50 bg-background/60 px-2 py-1.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[11px] font-medium leading-tight">
                          {row.kind === "rfp" ? "RFP sent" : "Quote summary"}{" "}
                          <span className="text-foreground">— {row.label}</span>
                        </p>
                        <span className="text-[9px] text-muted-foreground tabular-nums shrink-0">
                          {new Date(row.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{row.sub}</p>
                      <div className="mt-1.5">
                        <Link
                          href={`/quotes?rfpRequestId=${encodeURIComponent(row.id)}`}
                          className="text-[10px] font-medium text-primary hover:underline"
                        >
                          Open quotes
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
                </Card>
              </Panel>
            </PanelGroup>
          </Panel>
          <PanelResizeHandle className={resizeHandleClass} />
          <Panel defaultSize={wideLayout ? 26 : 32} minSize={14} className="min-h-0">
            <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
              <Card className="flex min-h-0 flex-1 flex-col overflow-hidden border-border/50 shadow-sm rounded-xl">
            <CardHeader className="shrink-0 pb-2 border-b border-border/40 space-y-3">
              <div className="flex flex-row items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold leading-none">Contract expirations</h3>
                  <CardDescription className="text-[11px] mt-1">
                    All active contracts, grouped by expiration month.
                  </CardDescription>
                </div>
                <Button variant="ghost" size="sm" className="h-8 text-xs shrink-0" asChild>
                  <Link href="/schedule">Schedule</Link>
                </Button>
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" aria-hidden />
                <Input
                  type="search"
                  placeholder="Search customer, supplier, energy, date…"
                  className="h-9 pl-9 text-sm"
                  value={contractExpSearch}
                  onChange={(e) => setContractExpSearch(e.target.value)}
                  aria-label="Filter contract expirations"
                />
              </div>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-3 space-y-6 text-sm">
              {contractsGroupedByMonthYear.length === 0 ? (
                <p className="text-muted-foreground text-xs">No active contracts.</p>
              ) : contractsGroupedByMonthYearFiltered.length === 0 ? (
                <p className="text-muted-foreground text-xs">No contracts match your search.</p>
              ) : (
                contractsGroupedByMonthYearFiltered.map(([ym, group]) => (
                  <section key={ym} className="space-y-2">
                    <h4 className="sticky top-0 z-[1] -mx-1 bg-card/95 px-1 py-1 text-xs font-bold uppercase tracking-wide text-primary backdrop-blur">
                      {group.label}
                    </h4>
                    <ul className="space-y-2 pl-0">
                      {group.items.map((c) => {
                        const exp = parseApiDateOnlyKey(String(c.expirationDate));
                        const expD = exp ? new Date(exp + "T12:00:00") : null;
                        return (
                          <li
                            key={c.id}
                            className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2 transition-colors hover:bg-muted/35 space-y-2"
                          >
                            <p className="font-medium leading-snug text-sm">
                              {c.customer?.name ?? "Customer"} → {c.supplier?.name ?? "Supplier"}
                            </p>
                            <p className="text-muted-foreground text-xs">
                              {(c.energyType ?? "").replaceAll("_", " ")} ·{" "}
                              {expD ? expD.toLocaleDateString() : "—"}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 text-xs"
                                onClick={() => {
                                  const k = parseApiDateOnlyKey(String(c.expirationDate));
                                  if (k) flashDayOnCalendar(k);
                                }}
                              >
                                Show on calendar
                              </Button>
                              <Button
                                variant="default"
                                size="sm"
                                className="h-8 text-xs"
                                type="button"
                                onClick={() => {
                                  setContractModalId(c.id);
                                  setContractModalOpen(true);
                                }}
                              >
                                Open contract
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))
              )}
            </CardContent>
              </Card>

              <Card className="flex min-h-[120px] shrink-0 flex-col overflow-hidden border-violet-200/60 dark:border-violet-900/40 border-border/50 shadow-sm rounded-xl max-h-[40%]">
            <CardHeader className="pb-2 border-b border-border/40 shrink-0">
              <h3 className="text-base font-semibold leading-none text-violet-900 dark:text-violet-100">
                License expirations
              </h3>
              <CardDescription className="text-[11px]">
                All licenses, grouped by expiration. Also shown on the calendar (violet).
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 overflow-y-auto pt-3 space-y-6 text-sm">
              {licensesGroupedByMonthYear.length === 0 ? (
                <p className="text-muted-foreground text-xs">No licenses.</p>
              ) : (
                licensesGroupedByMonthYear.map(([ym, group]) => (
                  <section key={ym} className="space-y-2">
                    <h4 className="sticky top-0 z-[1] -mx-1 bg-card/95 px-1 py-1 text-xs font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300 backdrop-blur">
                      {group.label}
                    </h4>
                    <ul className="space-y-2">
                      {group.items.map((l) => {
                        const exp = parseApiDateOnlyKey(String(l.expirationDate));
                        const expD = exp ? new Date(exp + "T12:00:00") : null;
                        return (
                          <li
                            key={l.id}
                            className="rounded-lg border border-violet-200/50 bg-violet-50/50 dark:bg-violet-950/30 px-3 py-2 space-y-2"
                          >
                            <p className="font-medium text-sm">
                              {l.licenseType} {l.licenseNumber}
                            </p>
                            <p className="text-muted-foreground text-xs">
                              {expD ? expD.toLocaleDateString() : "—"}
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs"
                              onClick={() => {
                                const k = parseApiDateOnlyKey(String(l.expirationDate));
                                if (k) flashDayOnCalendar(k);
                              }}
                            >
                              Show on calendar
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))
              )}
            </CardContent>
              </Card>
            </div>
          </Panel>
        </PanelGroup>

        <ScheduleContractModal
          contractId={contractModalId}
          open={contractModalOpen}
          onOpenChange={(o) => {
            setContractModalOpen(o);
            if (!o) setContractModalId(null);
          }}
        />

        <Dialog open={emailModalId != null} onOpenChange={(o) => !o && setEmailModalId(null)}>
          <DialogContent className="max-w-4xl h-[min(90vh,820px)] flex flex-col">
            <DialogHeader>
              <DialogTitle>Email</DialogTitle>
            </DialogHeader>
            {emailModalId ? (
              <iframe
                title="Email message"
                className="flex-1 min-h-[480px] w-full rounded border bg-background"
                src={`/inbox/email/${encodeURIComponent(emailModalId)}?embed=1`}
              />
            ) : null}
            <DialogFooter className="sm:justify-end">
              <Button variant="outline" asChild>
                <Link
                  href={emailModalId ? `/inbox/email/${encodeURIComponent(emailModalId)}` : "/inbox"}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open in new tab
                </Link>
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={weekDayModal != null} onOpenChange={(o) => !o && setWeekDayModal(null)}>
          <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{weekDayModal?.label ?? "Day"}</DialogTitle>
            </DialogHeader>
            {weekDayModal ? (
              <div className="space-y-4 text-sm">
                {(() => {
                  const key = weekDayModal.key;
                  const evs = events.filter(
                    (e) =>
                      eventDayKey(e) === key &&
                      !e.taskId &&
                      String(e.eventType).toUpperCase() !== "LICENSE_EXPIRY"
                  );
                  const tks = weekTasks.filter((t) => {
                    const raw = t.dueAt || t.dueDate;
                    if (!raw) return false;
                    return parseApiDateOnlyKey(String(raw)) === key;
                  });
                  return (
                    <>
                      <section>
                        <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1">Events</h4>
                        {evs.length === 0 ? (
                          <p className="text-muted-foreground text-xs">None this week.</p>
                        ) : (
                          <ul className="space-y-1">
                            {evs.map((ev) => (
                              <li key={ev.id} className="rounded border px-2 py-1">
                                <p className="font-medium">{ev.title}</p>
                                <p className="text-[10px] text-muted-foreground">{ev.eventType}</p>
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                      <section>
                        <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1">Tasks</h4>
                        {tks.length === 0 ? (
                          <p className="text-muted-foreground text-xs">None due this day.</p>
                        ) : (
                          <ul className="space-y-1">
                            {tks.map((t) => (
                              <li key={t.id}>
                                <Link
                                  href={`/tasks?taskId=${encodeURIComponent(t.id)}`}
                                  className="block rounded border px-2 py-1 hover:bg-muted/60"
                                >
                                  {t.title}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/schedule?flashDate=${encodeURIComponent(key)}`}>Open in calendar</Link>
                      </Button>
                    </>
                  );
                })()}
              </div>
            ) : null}
          </DialogContent>
        </Dialog>

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
