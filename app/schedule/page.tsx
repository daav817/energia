"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Calendar,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  LayoutGrid,
  Plus,
  Check,
  Trash2,
  Search,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DayAgendaDialog } from "@/components/schedule/day-agenda-dialog";
import { ScheduleContractModal } from "@/components/schedule/schedule-contract-modal";
import { cn } from "@/lib/utils";

type CalendarEventDto = {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  eventType: string;
  taskId: string | null;
  customer: { id: string; name: string; company: string | null } | null;
  contact: { id: string; name: string } | null;
  contract: {
    id: string;
    customer: { name: string };
    supplier: { name: string };
  } | null;
};

type TaskDto = {
  id: string;
  title: string;
  dueDate: string | null;
  dueAt: string | null;
  allDay: boolean;
  status: string;
  taskList: { id: string; name: string } | null;
};

type ContactOption = { id: string; name: string; company: string | null; label: string | null };
type TaskListOption = { id: string; name: string };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const EVENT_TYPE_OPTIONS = [
  { value: "CONTRACT_RENEWAL", label: "Contract renewal" },
  { value: "LICENSE_EXPIRY", label: "License expiry" },
  { value: "RFP_DEADLINE", label: "RFP deadline" },
  { value: "FOLLOW_UP", label: "Follow-up" },
  { value: "MEETING", label: "Meeting" },
  { value: "TASK", label: "Task" },
  { value: "OTHER", label: "Other" },
] as const;

const DEFAULT_EVENT_TYPE = "OTHER";

/** Larger neon dots for legend + day cells (shared palette). */
const SCHEDULE_NEON_DOT = {
  contract:
    "bg-amber-300 shadow-[0_0_14px_rgba(253,224,71,0.98),0_0_5px_rgba(250,204,21,1)] ring-1 ring-amber-200/90 dark:bg-amber-400 dark:shadow-[0_0_16px_rgba(251,191,36,0.95)] dark:ring-amber-300/55",
  license:
    "bg-fuchsia-400 shadow-[0_0_14px_rgba(232,121,249,0.95),0_0_5px_rgba(217,70,239,1)] ring-1 ring-fuchsia-200/85 dark:bg-fuchsia-500 dark:shadow-[0_0_16px_rgba(232,121,249,0.9)] dark:ring-fuchsia-300/50",
  task:
    "bg-cyan-300 shadow-[0_0_14px_rgba(103,232,249,0.98),0_0_5px_rgba(34,211,238,1)] ring-1 ring-cyan-200/85 dark:bg-cyan-400 dark:shadow-[0_0_16px_rgba(34,211,238,0.92)] dark:ring-cyan-300/50",
  event:
    "bg-lime-400 shadow-[0_0_14px_rgba(190,242,100,0.98),0_0_5px_rgba(163,230,53,1)] ring-1 ring-lime-200/85 dark:bg-lime-400 dark:shadow-[0_0_16px_rgba(190,242,100,0.95)] dark:ring-lime-300/50",
} as const;

const CELL_MARKER = "h-2.5 w-2.5 mt-0.5 shrink-0 rounded-full";
const LEGEND_MARKER = "inline-block h-3.5 w-3.5 shrink-0 rounded-full";

/** Marker colors by event type; neon glow so dots stay vivid on gray cells. */
function calendarEventMarkerClass(eventType: string): string {
  const t = String(eventType).toUpperCase().replace(/\s+/g, "_");
  switch (t) {
    case "CONTRACT_RENEWAL":
      return SCHEDULE_NEON_DOT.contract;
    case "LICENSE_EXPIRY":
      return SCHEDULE_NEON_DOT.license;
    case "RFP_DEADLINE":
      return "bg-rose-400 shadow-[0_0_14px_rgba(251,113,133,0.95),0_0_5px_rgba(251,113,133,1)] ring-1 ring-rose-200/85 dark:bg-rose-500 dark:shadow-[0_0_16px_rgba(251,113,133,0.9)] dark:ring-rose-300/50";
    case "FOLLOW_UP":
      return "bg-sky-300 shadow-[0_0_14px_rgba(125,211,252,0.98),0_0_5px_rgba(56,189,248,1)] ring-1 ring-sky-200/85 dark:bg-sky-400 dark:shadow-[0_0_16px_rgba(56,189,248,0.92)] dark:ring-sky-300/50";
    case "MEETING":
      return "bg-blue-400 shadow-[0_0_14px_rgba(147,197,253,0.98),0_0_5px_rgba(96,165,250,1)] ring-1 ring-blue-200/85 dark:bg-blue-400 dark:shadow-[0_0_16px_rgba(96,165,250,0.95)] dark:ring-blue-300/50";
    case "TASK":
      return SCHEDULE_NEON_DOT.task;
    default:
      return SCHEDULE_NEON_DOT.event;
  }
}

function localDateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Calendar date key for an event (all-day uses UTC date from ISO to avoid TZ shift). */
function eventDayKey(e: CalendarEventDto): string {
  if (e.allDay) {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(e.startAt);
    if (m) return m[1];
  }
  return localDateKey(new Date(e.startAt));
}

/** YYYY-MM-DD from API date string without local-TZ shifting date-only values. */
function parseApiDateOnlyKey(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return localDateKey(new Date(s));
}

function calendarCells(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - startOffset);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push(d);
  }
  return cells;
}

/** Inclusive ISO range for the full 6-week grid (fixes events on leading/trailing days). */
function visibleGridRangeISO(year: number, month: number): { from: string; to: string } {
  const cells = calendarCells(year, month);
  const first = cells[0];
  const last = cells[41];
  const from = new Date(first.getFullYear(), first.getMonth(), first.getDate(), 0, 0, 0, 0);
  const to = new Date(last.getFullYear(), last.getMonth(), last.getDate(), 23, 59, 59, 999);
  return { from: from.toISOString(), to: to.toISOString() };
}

function addMonths(year: number, month: number, delta: number): { y: number; m: number } {
  const d = new Date(year, month + delta, 1);
  return { y: d.getFullYear(), m: d.getMonth() };
}

function addYears(year: number, month: number, delta: number): { y: number; m: number } {
  return { y: year + delta, m: month };
}

function yearRangeISO(year: number): { from: string; to: string } {
  const from = new Date(year, 0, 1, 0, 0, 0, 0);
  const to = new Date(year, 11, 31, 23, 59, 59, 999);
  return { from: from.toISOString(), to: to.toISOString() };
}

const SCHEDULE_VIEW_KEY = "energia-schedule-calendar-view";

function toDatetimeLocalValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

type ContractRow = {
  id: string;
  expirationDate: string;
  customer?: { name: string };
  supplier?: { name: string };
  energyType?: string;
};

type LicenseRow = {
  id: string;
  licenseNumber: string;
  licenseType: string;
  expirationDate: string;
};

function taskDayKey(t: TaskDto): string | null {
  if (t.dueAt) return localDateKey(new Date(t.dueAt));
  if (t.dueDate) return parseApiDateOnlyKey(t.dueDate);
  return null;
}

export default function SchedulePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [events, setEvents] = useState<CalendarEventDto[]>([]);
  const [scheduledTasks, setScheduledTasks] = useState<TaskDto[]>([]);
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [licenses, setLicenses] = useState<LicenseRow[]>([]);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [contractOptions, setContractOptions] = useState<ContractRow[]>([]);
  const [taskLists, setTaskLists] = useState<TaskListOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState<string>(DEFAULT_EVENT_TYPE);
  const [allDay, setAllDay] = useState(true);
  const [dateOnly, setDateOnly] = useState(localDateKey(now));
  const [startLocal, setStartLocal] = useState(toDatetimeLocalValue(now));
  const [endLocal, setEndLocal] = useState("");
  const [description, setDescription] = useState("");
  const [contactId, setContactId] = useState<string>("");
  const [calendarContractId, setCalendarContractId] = useState<string>("");
  const [taskListId, setTaskListId] = useState<string>("");
  const [repeatRule, setRepeatRule] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);

  const [agendaOpen, setAgendaOpen] = useState(false);
  const [agendaDate, setAgendaDate] = useState<Date | null>(null);

  const [calendarView, setCalendarView] = useState<"month" | "year">("month");
  const [pulseHighlightKeys, setPulseHighlightKeys] = useState(() => new Set<string>());
  const pulseTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pulseAnchorRef = useRef<{ y: number; mo: number } | null>(null);
  const calScrollRef = useRef<HTMLDivElement | null>(null);
  const [contractModalId, setContractModalId] = useState<string | null>(null);
  const [contractModalOpen, setContractModalOpen] = useState(false);
  const [yearDetailMonth, setYearDetailMonth] = useState<number | null>(null);
  const [contractExpSearch, setContractExpSearch] = useState("");
  const [gotoDateInput, setGotoDateInput] = useState("");
  const [yearHighlightedMonth, setYearHighlightedMonth] = useState<number | null>(null);
  const [googleCalendarSyncing, setGoogleCalendarSyncing] = useState(false);
  const yearHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const yearMonthCardRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    try {
      const v = localStorage.getItem(SCHEDULE_VIEW_KEY);
      if (v === "year" || v === "month") setCalendarView(v);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    return () => {
      pulseTimersRef.current.forEach((t) => clearTimeout(t));
      pulseTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (yearHighlightTimerRef.current) clearTimeout(yearHighlightTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (calendarView === "month") {
      if (yearHighlightTimerRef.current) {
        clearTimeout(yearHighlightTimerRef.current);
        yearHighlightTimerRef.current = null;
      }
      setYearHighlightedMonth(null);
    }
  }, [calendarView]);

  useEffect(() => {
    const el = calScrollRef.current;
    if (!el || loading) return;
    const onWheel = (e: WheelEvent) => {
      const { deltaY } = e;
      if (deltaY === 0) return;
      const canScroll = el.scrollHeight > el.clientHeight + 1;
      if (!canScroll) return;
      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      if ((deltaY < 0 && !atTop) || (deltaY > 0 && !atBottom)) {
        e.preventDefault();
        el.scrollTop += deltaY;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [calendarView, loading]);

  const persistCalendarView = (v: "month" | "year") => {
    setCalendarView(v);
    try {
      localStorage.setItem(SCHEDULE_VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };

  const clearYearMonthHighlight = useCallback(() => {
    if (yearHighlightTimerRef.current) {
      clearTimeout(yearHighlightTimerRef.current);
      yearHighlightTimerRef.current = null;
    }
    setYearHighlightedMonth(null);
  }, []);

  /** Green pulse on a day cell; `mo` is 1–12. Does not change month/year view mode. */
  const applyDayPulse = useCallback((dateKey: string, y: number, mo: number) => {
    const anchor = pulseAnchorRef.current;
    const sameMonthAsAnchor =
      anchor != null && anchor.y === y && anchor.mo === mo;

    if (anchor != null && !sameMonthAsAnchor) {
      pulseTimersRef.current.forEach((t) => clearTimeout(t));
      pulseTimersRef.current.clear();
      setPulseHighlightKeys(new Set());
      pulseAnchorRef.current = null;
    }

    setViewYear(y);
    setViewMonth(mo - 1);

    if (pulseAnchorRef.current == null || !sameMonthAsAnchor) {
      pulseAnchorRef.current = { y, mo };
    }

    setPulseHighlightKeys((prev) => {
      const next = new Set(prev);
      next.add(dateKey);
      return next;
    });

    const existing = pulseTimersRef.current.get(dateKey);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      setPulseHighlightKeys((prev) => {
        const next = new Set(prev);
        next.delete(dateKey);
        if (next.size === 0) pulseAnchorRef.current = null;
        return next;
      });
      pulseTimersRef.current.delete(dateKey);
    }, 5000);
    pulseTimersRef.current.set(dateKey, t);
  }, []);

  const flashDayOnCalendar = useCallback(
    (dateKey: string) => {
      const parts = dateKey.split("-").map(Number);
      const y = parts[0];
      const mo = parts[1];
      if (!y || !mo) return;
      persistCalendarView("month");
      applyDayPulse(dateKey, y, mo);
    },
    [applyDayPulse]
  );

  const goToScheduleDate = useCallback(
    (dateKey: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
      const parts = dateKey.split("-").map(Number);
      const y = parts[0]!;
      const mo = parts[1]!;
      const day = parts[2]!;
      if (!y || !mo || mo < 1 || mo > 12 || !day || day < 1 || day > 31) return;

      const test = new Date(y, mo - 1, day);
      if (
        test.getFullYear() !== y ||
        test.getMonth() !== mo - 1 ||
        test.getDate() !== day
      ) {
        return;
      }

      if (calendarView === "year") {
        clearYearMonthHighlight();
        pulseTimersRef.current.forEach((t) => clearTimeout(t));
        pulseTimersRef.current.clear();
        setPulseHighlightKeys(new Set());
        pulseAnchorRef.current = null;

        setViewYear(y);
        setViewMonth(mo - 1);
        setYearHighlightedMonth(mo - 1);
        yearHighlightTimerRef.current = setTimeout(() => {
          setYearHighlightedMonth(null);
          yearHighlightTimerRef.current = null;
        }, 5000);

        requestAnimationFrame(() => {
          yearMonthCardRefs.current.get(mo - 1)?.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          });
        });
      } else {
        clearYearMonthHighlight();
        applyDayPulse(dateKey, y, mo);
      }
    },
    [calendarView, applyDayPulse, clearYearMonthHighlight]
  );

  const flashFromUrl = searchParams.get("flashDate");
  useEffect(() => {
    if (!flashFromUrl || !/^\d{4}-\d{2}-\d{2}$/.test(flashFromUrl)) return;
    flashDayOnCalendar(flashFromUrl);
    router.replace("/schedule", { scroll: false });
  }, [flashFromUrl, flashDayOnCalendar, router]);

  const refresh = useCallback(async () => {
    const { from, to } =
      calendarView === "year"
        ? yearRangeISO(viewYear)
        : visibleGridRangeISO(viewYear, viewMonth);
    setLoading(true);
    try {
      const [ovRes, cRes, lRes, coRes, tlRes] = await Promise.all([
        fetch(`/api/calendar/overview?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
        fetch("/api/contracts?tab=active"),
        fetch("/api/licenses"),
        fetch("/api/contacts?labelFilter=customer"),
        fetch("/api/task-lists"),
      ]);
      const ov = ovRes.ok ? await ovRes.json() : { events: [], tasks: [] };
      const cData = cRes.ok ? await cRes.json() : [];
      const lData = lRes.ok ? await lRes.json() : [];
      const coJson = coRes.ok ? await coRes.json() : { contacts: [] };
      const tlData = tlRes.ok ? await tlRes.json() : [];
      setEvents(Array.isArray(ov.events) ? ov.events : []);
      setScheduledTasks(Array.isArray(ov.tasks) ? ov.tasks : []);
      setContracts(Array.isArray(cData) ? cData : []);
      setContractOptions(Array.isArray(cData) ? cData : []);
      setLicenses(Array.isArray(lData) ? lData : []);
      setContacts(Array.isArray(coJson.contacts) ? coJson.contacts : []);
      setTaskLists(Array.isArray(tlData) ? tlData.map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })) : []);
    } finally {
      setLoading(false);
    }
  }, [viewYear, viewMonth, calendarView]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEventDto[]>();
    for (const e of events) {
      if (e.taskId) continue;
      const key = eventDayKey(e);
      const list = map.get(key) ?? [];
      list.push(e);
      map.set(key, list);
    }
    for (const [, list] of map) {
      list.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    }
    return map;
  }, [events]);

  const tasksByDay = useMemo(() => {
    const map = new Map<string, TaskDto[]>();
    for (const t of scheduledTasks) {
      const key = taskDayKey(t);
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    for (const [, list] of map) {
      list.sort((a, b) => a.title.localeCompare(b.title));
    }
    return map;
  }, [scheduledTasks]);

  const contractsByExpirationDay = useMemo(() => {
    const map = new Map<string, ContractRow[]>();
    for (const c of contracts) {
      const key = parseApiDateOnlyKey(c.expirationDate);
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(c);
      map.set(key, list);
    }
    return map;
  }, [contracts]);

  const licensesByExpirationDay = useMemo(() => {
    const map = new Map<string, LicenseRow[]>();
    for (const lic of licenses) {
      const key = parseApiDateOnlyKey(lic.expirationDate);
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(lic);
      map.set(key, list);
    }
    return map;
  }, [licenses]);

  const contractsGroupedByMonthYear = useMemo(() => {
    const sorted = [...contracts].sort(
      (a, b) =>
        parseApiDateOnlyKey(a.expirationDate).localeCompare(parseApiDateOnlyKey(b.expirationDate)) ||
        (a.customer?.name ?? "").localeCompare(b.customer?.name ?? "")
    );
    const groups = new Map<string, { label: string; items: ContractRow[] }>();
    for (const c of sorted) {
      const key = parseApiDateOnlyKey(c.expirationDate);
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
          const exp = parseApiDateOnlyKey(c.expirationDate);
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
    const sorted = [...licenses].sort(
      (a, b) =>
        parseApiDateOnlyKey(a.expirationDate).localeCompare(parseApiDateOnlyKey(b.expirationDate)) ||
        a.licenseNumber.localeCompare(b.licenseNumber)
    );
    const groups = new Map<string, { label: string; items: LicenseRow[] }>();
    for (const lic of sorted) {
      const key = parseApiDateOnlyKey(lic.expirationDate);
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
  }, [licenses]);

  const cells = useMemo(
    () => calendarCells(viewYear, viewMonth),
    [viewYear, viewMonth]
  );

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  type YearScheduleRow = {
    day: string;
    label: string;
    kind: "Event" | "Task" | "Contract" | "License";
    sort: string;
    eventId?: string;
    taskId?: string;
    contractId?: string;
    licenseId?: string;
  };

  const yearMonthItems = useMemo(() => {
    const map = new Map<number, YearScheduleRow[]>();
    for (let m = 0; m < 12; m++) {
      const prefix = `${viewYear}-${String(m + 1).padStart(2, "0")}`;
      const rows: YearScheduleRow[] = [];

      for (const c of contracts) {
        const dk = parseApiDateOnlyKey(c.expirationDate);
        if (!dk.startsWith(prefix)) continue;
        rows.push({
          day: dk,
          label: `${c.customer?.name ?? "Customer"} → ${c.supplier?.name ?? "Supplier"}`,
          kind: "Contract",
          sort: `${dk} contract ${c.id}`,
          contractId: c.id,
        });
      }
      for (const lic of licenses) {
        const dk = parseApiDateOnlyKey(lic.expirationDate);
        if (!dk.startsWith(prefix)) continue;
        rows.push({
          day: dk,
          label: `${lic.licenseType} ${lic.licenseNumber}`,
          kind: "License",
          sort: `${dk} license ${lic.id}`,
          licenseId: lic.id,
        });
      }
      for (const e of events) {
        const dk = eventDayKey(e);
        if (!dk.startsWith(prefix)) continue;
        if (e.taskId) {
          const linked = scheduledTasks.find((t) => t.id === e.taskId);
          const tdk = linked ? taskDayKey(linked) : null;
          if (tdk && tdk === dk) continue;
        }
        rows.push({
          day: dk,
          label: e.title,
          kind: "Event",
          sort: `${dk} event ${e.id}`,
          eventId: e.id,
        });
      }
      for (const t of scheduledTasks) {
        const dk = taskDayKey(t);
        if (!dk || !dk.startsWith(prefix)) continue;
        rows.push({
          day: dk,
          label: t.title,
          kind: "Task",
          sort: `${dk} task ${t.id}`,
          taskId: t.id,
        });
      }
      rows.sort((a, b) => a.sort.localeCompare(b.sort));
      map.set(m, rows);
    }
    return map;
  }, [events, scheduledTasks, contracts, licenses, viewYear]);

  const goMonth = (delta: number) => {
    clearYearMonthHighlight();
    const { y, m } = addMonths(viewYear, viewMonth, delta);
    setViewYear(y);
    setViewMonth(m);
  };

  const goYear = (delta: number) => {
    clearYearMonthHighlight();
    const { y, m } = addYears(viewYear, viewMonth, delta);
    setViewYear(y);
    setViewMonth(m);
  };

  const openCreate = (d?: Date) => {
    setEditingId(null);
    setTitle("");
    setEventType(DEFAULT_EVENT_TYPE);
    setAllDay(true);
    const base = d ?? new Date(viewYear, viewMonth, 1);
    setDateOnly(localDateKey(base));
    setStartLocal(toDatetimeLocalValue(base));
    setEndLocal("");
    setDescription("");
    setContactId("");
    setCalendarContractId("");
    setTaskListId(taskLists[0]?.id ?? "");
    setRepeatRule("");
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (e: CalendarEventDto) => {
    setEditingId(e.id);
    setTitle(e.title);
    setEventType(e.eventType);
    setAllDay(e.allDay);
    const s = new Date(e.startAt);
    const datePrefix = e.allDay ? /^(\d{4}-\d{2}-\d{2})/.exec(e.startAt) : null;
    setDateOnly(datePrefix ? datePrefix[1] : localDateKey(s));
    setStartLocal(toDatetimeLocalValue(s));
    setEndLocal(e.endAt ? toDatetimeLocalValue(new Date(e.endAt)) : "");
    setDescription(e.description ?? "");
    setContactId(e.contact?.id ?? "");
    setCalendarContractId(e.contract?.id ?? "");
    setTaskListId("");
    setRepeatRule("");
    setFormError(null);
    setDialogOpen(true);
  };

  const handleYearRowAction = (row: YearScheduleRow) => {
    setYearDetailMonth(null);
    if (row.kind === "Event" && row.eventId) {
      const ev = events.find((x) => x.id === row.eventId);
      if (ev) openEdit(ev);
      return;
    }
    if (row.kind === "Task" && row.taskId) {
      router.push(`/tasks?taskId=${encodeURIComponent(row.taskId)}`);
      return;
    }
    if (row.kind === "Contract" && row.contractId) {
      setContractModalId(row.contractId);
      setContractModalOpen(true);
      return;
    }
    if (row.kind === "License" && row.day) {
      setAgendaDate(new Date(row.day + "T12:00:00"));
      setAgendaOpen(true);
    }
  };

  const buildPayload = () => {
    if (eventType === "TASK" && !editingId) {
      if (!taskListId.trim()) {
        throw new Error("Select a task list for Task events");
      }
    }
    let startAt: string;
    let endAt: string | null;
    if (allDay) {
      const [y, m, d] = dateOnly.split("-").map(Number);
      const start = new Date(y, m - 1, d, 12, 0, 0, 0);
      startAt = start.toISOString();
      endAt = null;
    } else {
      const start = new Date(startLocal);
      if (Number.isNaN(start.getTime())) {
        throw new Error("Invalid start time");
      }
      startAt = start.toISOString();
      if (endLocal.trim() !== "") {
        const end = new Date(endLocal);
        if (Number.isNaN(end.getTime())) {
          throw new Error("Invalid end time");
        }
        endAt = end.toISOString();
      } else {
        endAt = null;
      }
    }
    const base: Record<string, unknown> = {
      title: title.trim(),
      eventType,
      allDay,
      startAt,
      endAt,
      description: description.trim() ? description.trim() : null,
      customerId: null,
      contactId: contactId.trim() ? contactId : null,
      contractId: calendarContractId.trim() ? calendarContractId : null,
    };
    if (eventType === "TASK" && !editingId) {
      base.taskListId = taskListId;
      base.repeatRule = repeatRule.trim() ? repeatRule : null;
    }
    return base;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!title.trim()) {
      setFormError("Title is required");
      return;
    }
    let payload: ReturnType<typeof buildPayload>;
    try {
      payload = buildPayload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Invalid dates");
      return;
    }

    try {
      if (editingId) {
        const res = await fetch(`/api/calendar/events/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Update failed");
        }
      } else {
        const res = await fetch("/api/calendar/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Create failed");
        }
      }
      setDialogOpen(false);
      await refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Save failed");
    }
  };

  const handleDelete = async () => {
    if (!editingId) return;
    const res = await fetch(`/api/calendar/events/${editingId}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFormError(data.error || "Delete failed");
      return;
    }
    setConfirmOpen(false);
    setDialogOpen(false);
    await refresh();
  };

  const runGoogleCalendarSync = async () => {
    setGoogleCalendarSyncing(true);
    try {
      const res = await fetch("/api/calendar/google-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const hint = typeof data.hint === "string" ? `\n\n${data.hint}` : "";
        window.alert((data.error ?? "Sync failed") + hint);
        return;
      }
      await refresh();
      window.alert(
        typeof data.message === "string" ? data.message : "Google Calendar sync completed."
      );
    } catch {
      window.alert("Could not reach the server to sync Google Calendar.");
    } finally {
      setGoogleCalendarSyncing(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100dvh-6.5rem)] lg:max-h-[calc(100dvh-6.5rem)] lg:overflow-hidden">
      <div className="grid min-h-0 flex-1 gap-6 overflow-hidden lg:grid-cols-[1fr_minmax(280px,340px)] lg:items-stretch">
        <Card className="border-border/50 shadow-md rounded-2xl bg-card/80 backdrop-blur-sm lg:flex lg:h-full lg:min-h-0 lg:flex-col">
          <CardHeader className="shrink-0 space-y-3 border-b border-border/40 bg-muted/20 pb-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-3">
              <h1 className="text-lg font-semibold tracking-tight flex items-center gap-2 shrink-0 sm:text-xl md:text-2xl">
                <CalendarDays className="h-5 w-5 shrink-0 text-primary sm:h-6 sm:w-6" />
                Schedule
              </h1>
              <div className="flex flex-1 flex-wrap items-center justify-center gap-1 min-w-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => goYear(-1)}
                  aria-label="Previous year"
                >
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                {calendarView === "month" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={() => goMonth(-1)}
                    aria-label="Previous month"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                )}
                <h2 className="min-w-[9rem] text-center text-xl font-bold tracking-tight tabular-nums sm:min-w-[12rem] sm:text-2xl md:text-3xl">
                  {calendarView === "year" ? String(viewYear) : monthLabel}
                </h2>
                {calendarView === "month" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={() => goMonth(1)}
                    aria-label="Next month"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => goYear(1)}
                  aria-label="Next year"
                >
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 md:justify-end shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="rounded-full"
                  aria-label={
                    calendarView === "month"
                      ? "Switch to yearly calendar view"
                      : "Switch to monthly calendar view"
                  }
                  title={calendarView === "month" ? "Yearly view" : "Monthly view"}
                  onClick={() =>
                    persistCalendarView(calendarView === "month" ? "year" : "month")
                  }
                >
                  {calendarView === "month" ? (
                    <LayoutGrid className="h-4 w-4" aria-hidden />
                  ) : (
                    <Calendar className="h-4 w-4" aria-hidden />
                  )}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" className="rounded-full" aria-label="Calendar sync settings">
                      <Settings className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem
                      disabled={googleCalendarSyncing}
                      onSelect={() => {
                        void runGoogleCalendarSync();
                      }}
                    >
                      {googleCalendarSyncing ? "Syncing…" : "Sync with Google Calendar"}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button onClick={() => openCreate()} className="rounded-full shadow-sm">
                  <Plus className="mr-2 h-4 w-4" />
                  New event
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-center sm:justify-start text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className={cn(LEGEND_MARKER, SCHEDULE_NEON_DOT.contract)} aria-hidden />
                Contract expiry
              </span>
              <span className="flex items-center gap-1.5">
                <span className={cn(LEGEND_MARKER, SCHEDULE_NEON_DOT.license)} aria-hidden />
                License
              </span>
              <span className="flex items-center gap-1.5">
                <span className={cn(LEGEND_MARKER, SCHEDULE_NEON_DOT.task)} aria-hidden />
                Task
              </span>
              <span className="flex items-center gap-1.5">
                <span className={cn(LEGEND_MARKER, SCHEDULE_NEON_DOT.event)} aria-hidden />
                Event
              </span>
              <span className="text-[11px] opacity-90">
                Click a day for the agenda or to add an event.
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 justify-center sm:justify-start pt-2 border-t border-border/30">
              <Label htmlFor="schedule-goto-date" className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                Go to date
              </Label>
              <Input
                id="schedule-goto-date"
                type="date"
                className="h-9 w-auto max-w-[11rem]"
                value={gotoDateInput}
                onChange={(e) => setGotoDateInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && gotoDateInput) {
                    e.preventDefault();
                    goToScheduleDate(gotoDateInput);
                  }
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={!gotoDateInput}
                onClick={() => gotoDateInput && goToScheduleDate(gotoDateInput)}
              >
                Show
              </Button>
              <span className="text-[11px] text-muted-foreground">
                {calendarView === "year"
                  ? "Highlights that month for 5 seconds."
                  : "Highlights that day for 5 seconds."}
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
            {loading ? (
              <p className="text-center text-muted-foreground py-16">Loading…</p>
            ) : calendarView === "year" ? (
              <div
                ref={calScrollRef}
                className="max-h-[min(80vh,880px)] h-[min(80vh,880px)] overflow-y-auto overflow-x-hidden overscroll-contain select-none pr-1 space-y-3 lg:h-full lg:max-h-none lg:min-h-0 lg:flex-1"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {Array.from({ length: 12 }, (_, m) => {
                    const rows = yearMonthItems.get(m) ?? [];
                    const preview = rows.slice(0, 4);
                    const monthTitle = new Date(viewYear, m, 1).toLocaleString("en-US", {
                      month: "long",
                    });
                    const isYearMonthPulse = yearHighlightedMonth === m;
                    return (
                      <div
                        key={m}
                        ref={(el) => {
                          if (el) yearMonthCardRefs.current.set(m, el);
                          else yearMonthCardRefs.current.delete(m);
                        }}
                        className={cn(
                          "rounded-xl border bg-background/80 p-3 shadow-sm flex flex-col min-h-[140px] transition-shadow duration-200",
                          isYearMonthPulse
                            ? "z-[4] border-green-500 ring-4 ring-green-500 shadow-[0_0_24px_8px_rgba(34,197,94,0.45)] dark:shadow-[0_0_28px_10px_rgba(34,197,94,0.35)]"
                            : "border-border/50"
                        )}
                      >
                        <h3 className="text-sm font-bold mb-2 text-primary">{monthTitle}</h3>
                        {rows.length === 0 ? (
                          <p className="text-xs text-muted-foreground flex-1">No items</p>
                        ) : (
                          <ul className="space-y-1 text-xs flex-1 min-h-0">
                            {preview.map((r, idx) => (
                              <li key={`${r.sort}-${idx}`} className="truncate">
                                <button
                                  type="button"
                                  className={cn(
                                    "w-full truncate rounded px-0.5 py-0.5 text-left transition-colors hover:bg-muted/60",
                                    r.kind === "Task" && "text-teal-700 dark:text-teal-300",
                                    r.kind === "Contract" && "text-amber-900 dark:text-amber-100",
                                    r.kind === "License" && "text-violet-900 dark:text-violet-100",
                                    r.kind === "Event" && "text-foreground"
                                  )}
                                  onClick={() => handleYearRowAction(r)}
                                >
                                  <span className="tabular-nums text-[10px] mr-1 opacity-80 text-muted-foreground">
                                    {r.day.slice(8)}
                                  </span>
                                  {r.label}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                        {rows.length > 4 && (
                          <button
                            type="button"
                            className="mt-2 text-left text-xs font-medium text-primary hover:underline"
                            onClick={() => setYearDetailMonth(m)}
                          >
                            View all ({rows.length})
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div
                ref={calScrollRef}
                className="max-h-[min(72vh,760px)] h-[min(72vh,760px)] overflow-y-auto overflow-x-hidden overscroll-contain space-y-3 select-none pr-1 [scrollbar-gutter:stable] lg:h-full lg:max-h-none lg:min-h-0 lg:flex-1"
              >
                <div className="sticky top-0 z-10 rounded-lg border border-emerald-200/90 bg-emerald-100 shadow-sm dark:border-emerald-800/55 dark:bg-emerald-950/85">
                  <div className="grid grid-cols-7 gap-2 text-center text-[11px] font-semibold uppercase tracking-wider text-emerald-950 dark:text-emerald-100 sm:text-xs">
                    {WEEKDAYS.map((d) => (
                      <div key={d} className="py-2">
                        {d}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="relative">
                  <div className="relative z-[2] grid grid-cols-7 gap-2">
                    {cells.map((d, i) => {
                      const inMonth = d.getMonth() === viewMonth;
                      const key = localDateKey(d);
                      const dayEvents = eventsByDay.get(key) ?? [];
                      const dayTasks = tasksByDay.get(key) ?? [];
                      const dayContracts = contractsByExpirationDay.get(key) ?? [];
                      const dayLicenses = licensesByExpirationDay.get(key) ?? [];
                      const hasContractExpiry = dayContracts.length > 0;
                      const hasLicenseExpiry = dayLicenses.length > 0;
                      const isToday = key === localDateKey(new Date());
                      const isPulse = pulseHighlightKeys.has(key);

                      const openDay = () => {
                        const linked =
                          events.filter((ev) => eventDayKey(ev) === key && ev.taskId).length;
                        const has =
                          dayEvents.length +
                          dayTasks.length +
                          dayContracts.length +
                          dayLicenses.length +
                          linked;
                        if (has > 0) {
                          setAgendaDate(d);
                          setAgendaOpen(true);
                        } else {
                          openCreate(d);
                        }
                      };

                      return (
                        <div
                          key={i}
                          role="button"
                          tabIndex={0}
                          onClick={openDay}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter" || ev.key === " ") {
                              ev.preventDefault();
                              openDay();
                            }
                          }}
                          className={cn(
                            "group relative min-h-[5.75rem] overflow-hidden rounded-xl border-2 p-2 text-left text-xs outline-none transition-all duration-200",
                            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                            "hover:shadow-md",
                            inMonth
                              ? "border-zinc-400/80 bg-background/95 shadow-sm dark:border-zinc-500/70 hover:border-zinc-500 dark:hover:border-zinc-400"
                              : "border-zinc-500/60 bg-zinc-400/90 text-zinc-900 dark:border-zinc-600/70 dark:bg-zinc-800/98 dark:text-zinc-100 hover:border-zinc-600",
                            isToday &&
                              !isPulse &&
                              "ring-2 ring-primary/35 ring-offset-1 ring-offset-background",
                            isPulse &&
                              "z-[4] ring-4 ring-green-500 shadow-[0_0_24px_8px_rgba(34,197,94,0.45)] dark:shadow-[0_0_28px_10px_rgba(34,197,94,0.35)]"
                          )}
                        >
                          <div
                            className={cn(
                              "mb-1.5 text-sm font-semibold tabular-nums",
                              inMonth ? "text-foreground" : "text-zinc-950 dark:text-zinc-50"
                            )}
                          >
                            {d.getDate()}
                          </div>
                          {hasContractExpiry && (
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
                                    "flex w-full min-w-0 max-w-full items-start gap-1 rounded-md px-0.5 py-0.5 text-left text-[10px] font-medium hover:bg-muted/50 sm:text-[11px]",
                                    inMonth
                                      ? "text-amber-900 dark:text-amber-100"
                                      : "text-amber-950 dark:text-amber-100 hover:text-amber-950 dark:hover:text-amber-50"
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
                                    inMonth
                                      ? "text-muted-foreground"
                                      : "text-zinc-900 dark:text-zinc-200"
                                  )}
                                >
                                  +{dayContracts.length - 2}
                                </span>
                              )}
                            </div>
                          )}
                          {hasLicenseExpiry && (
                            <div className="mb-1 space-y-0.5">
                              <div
                                className={cn(
                                  "flex min-w-0 max-w-full items-start gap-1 text-[10px] font-medium sm:text-[11px]",
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
                                <button
                                  type="button"
                                  onClick={(evt) => {
                                    evt.stopPropagation();
                                    router.push(`/tasks?taskId=${encodeURIComponent(t.id)}`);
                                  }}
                                  className={cn(
                                    "flex w-full min-w-0 max-w-full items-start gap-1 rounded-md px-0.5 py-0.5 text-left text-[10px] font-medium hover:bg-muted/50 sm:text-[11px]",
                                    inMonth
                                      ? "text-teal-700 dark:text-teal-300"
                                      : "text-teal-950 dark:text-teal-200 hover:text-teal-950 dark:hover:text-teal-100"
                                  )}
                                >
                                  <span className={cn(CELL_MARKER, SCHEDULE_NEON_DOT.task)} aria-hidden />
                                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                                </button>
                              </li>
                            ))}
                            {dayEvents.slice(0, 2).map((ev) => (
                              <li key={ev.id}>
                                <button
                                  type="button"
                                  onClick={(evt) => {
                                    evt.stopPropagation();
                                    openEdit(ev);
                                  }}
                                  className={cn(
                                    "flex w-full min-w-0 max-w-full items-start gap-1 rounded-md px-0.5 py-0.5 text-left text-[10px] font-medium transition-colors hover:bg-muted/50 sm:text-[11px]",
                                    inMonth
                                      ? "text-primary hover:underline"
                                      : "text-foreground hover:underline dark:text-zinc-50"
                                  )}
                                >
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
                                </button>
                              </li>
                            ))}
                            {(dayEvents.length + dayTasks.length > 4) && (
                              <li
                                className={cn(
                                  "pl-1 text-[10px]",
                                  inMonth
                                    ? "text-muted-foreground"
                                    : "text-zinc-900 dark:text-zinc-200"
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
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex min-h-0 flex-col gap-5 overflow-hidden lg:h-full lg:min-h-0">
          <Card className="border-border/50 shadow-sm rounded-xl flex max-h-[min(70vh,520px)] flex-col overflow-hidden lg:max-h-none lg:min-h-0 lg:flex-1">
            <CardHeader className="shrink-0 pb-2 border-b border-border/40 space-y-3">
              <div>
                <h3 className="text-base font-semibold leading-none">Contract expirations</h3>
                <CardDescription>All active contracts, grouped by expiration month.</CardDescription>
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" aria-hidden />
                <Input
                  type="search"
                  placeholder="Search customer, supplier, energy, date…"
                  className="h-9 pl-9"
                  value={contractExpSearch}
                  onChange={(e) => setContractExpSearch(e.target.value)}
                  aria-label="Filter contract expirations"
                />
              </div>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-4 space-y-6 text-sm">
              {contractsGroupedByMonthYear.length === 0 ? (
                <p className="text-muted-foreground">No active contracts.</p>
              ) : contractsGroupedByMonthYearFiltered.length === 0 ? (
                <p className="text-muted-foreground">No contracts match your search.</p>
              ) : (
                contractsGroupedByMonthYearFiltered.map(([ym, group]) => (
                  <section key={ym} className="space-y-2">
                    <h4 className="sticky top-0 z-[1] -mx-1 bg-card/95 px-1 py-1 text-xs font-bold uppercase tracking-wide text-primary backdrop-blur">
                      {group.label}
                    </h4>
                    <ul className="space-y-2 pl-0">
                      {group.items.map((c) => {
                        const exp = parseApiDateOnlyKey(c.expirationDate);
                        const expD = exp ? new Date(exp + "T12:00:00") : null;
                        return (
                          <li
                            key={c.id}
                            className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2 transition-colors hover:bg-muted/35 space-y-2"
                          >
                            <p className="font-medium leading-snug">
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
                                  const k = parseApiDateOnlyKey(c.expirationDate);
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

          <Card className="border-border/50 shadow-sm rounded-xl max-h-[min(50vh,420px)] shrink-0 flex flex-col overflow-hidden border-violet-200/60 dark:border-violet-900/40">
            <CardHeader className="pb-2 border-b border-border/40">
              <h3 className="text-base font-semibold leading-none text-violet-900 dark:text-violet-100">
                License expirations
              </h3>
              <CardDescription>All licenses, grouped by expiration. Also shown on the calendar (violet).</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto pt-4 space-y-6 text-sm">
              {licensesGroupedByMonthYear.length === 0 ? (
                <p className="text-muted-foreground">No licenses.</p>
              ) : (
                licensesGroupedByMonthYear.map(([ym, group]) => (
                  <section key={ym} className="space-y-2">
                    <h4 className="sticky top-0 z-[1] -mx-1 bg-card/95 px-1 py-1 text-xs font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300 backdrop-blur">
                      {group.label}
                    </h4>
                    <ul className="space-y-2">
                      {group.items.map((l) => {
                        const exp = parseApiDateOnlyKey(l.expirationDate);
                        const expD = exp ? new Date(exp + "T12:00:00") : null;
                        return (
                          <li
                            key={l.id}
                            className="rounded-lg border border-violet-200/50 bg-violet-50/50 dark:bg-violet-950/30 px-3 py-2 space-y-2"
                          >
                            <p className="font-medium">
                              {l.licenseType} {l.licenseNumber}
                            </p>
                            <p className="text-muted-foreground text-xs">{expD ? expD.toLocaleDateString() : "—"}</p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs"
                              onClick={() => {
                                const k = parseApiDateOnlyKey(l.expirationDate);
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
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit event" : "New event"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label>Type</Label>
              <Select value={eventType} onValueChange={setEventType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_TYPE_OPTIONS.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={allDay}
                onChange={(e) => setAllDay(e.target.checked)}
              />
              All day
            </label>
            {allDay ? (
              <div className="grid gap-2">
                <Label htmlFor="dateOnly">Date</Label>
                <Input
                  id="dateOnly"
                  type="date"
                  value={dateOnly}
                  onChange={(e) => setDateOnly(e.target.value)}
                  required
                />
              </div>
            ) : (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="startLocal">Start</Label>
                  <Input
                    id="startLocal"
                    type="datetime-local"
                    value={startLocal}
                    onChange={(e) => setStartLocal(e.target.value)}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="endLocal">End (optional)</Label>
                  <Input
                    id="endLocal"
                    type="datetime-local"
                    value={endLocal}
                    onChange={(e) => setEndLocal(e.target.value)}
                  />
                </div>
              </>
            )}
            <div className="grid gap-2">
              <Label htmlFor="desc">Notes</Label>
              <textarea
                id="desc"
                className="min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Link contact (customer label)</Label>
              <Select
                value={contactId || "__none__"}
                onValueChange={(v) => setContactId(v === "__none__" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {contacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.label ? ` · ${c.label}` : ""}
                      {c.company ? ` (${c.company})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Link active contract</Label>
              <Select
                value={calendarContractId || "__none__"}
                onValueChange={(v) => setCalendarContractId(v === "__none__" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {contractOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {(c.customer?.name ?? "?") + " → " + (c.supplier?.name ?? "?")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {eventType === "TASK" && !editingId && (
              <>
                <div className="grid gap-2">
                  <Label>Task list *</Label>
                  <Select value={taskListId} onValueChange={setTaskListId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select list" />
                    </SelectTrigger>
                    <SelectContent>
                      {taskLists.map((tl) => (
                        <SelectItem key={tl.id} value={tl.id}>
                          {tl.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Repeat</Label>
                  <Select value={repeatRule || "__none__"} onValueChange={(v) => setRepeatRule(v === "__none__" ? "" : v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Does not repeat" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Does not repeat</SelectItem>
                      <SelectItem value="DAILY">Daily</SelectItem>
                      <SelectItem value="WEEKLY">Weekly</SelectItem>
                      <SelectItem value="MONTHLY">Monthly</SelectItem>
                      <SelectItem value="YEARLY">Yearly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
              {editingId ? (
                <Button
                  type="button"
                  variant="destructive"
                  className="sm:mr-auto"
                  onClick={() => setConfirmOpen(true)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">
                  <Check className="mr-2 h-4 w-4" />
                  Save
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete event"
        message="This permanently removes the calendar event."
        onConfirm={handleDelete}
      />

      <DayAgendaDialog
        open={agendaOpen}
        onOpenChange={setAgendaOpen}
        dayLabel={
          agendaDate
            ? agendaDate.toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })
            : ""
        }
        events={(() => {
          if (!agendaDate) return [];
          const key = localDateKey(agendaDate);
          return events.filter((ev) => eventDayKey(ev) === key);
        })()}
        tasks={(() => {
          if (!agendaDate) return [];
          const key = localDateKey(agendaDate);
          return scheduledTasks.filter((t) => taskDayKey(t) === key);
        })()}
        contracts={(() => {
          if (!agendaDate) return [];
          const key = localDateKey(agendaDate);
          return (contractsByExpirationDay.get(key) ?? []).map((c) => ({
            id: c.id,
            label: `${c.customer?.name ?? "Customer"} → ${c.supplier?.name ?? "Supplier"}`,
          }));
        })()}
        licenses={(() => {
          if (!agendaDate) return [];
          const key = localDateKey(agendaDate);
          return (licensesByExpirationDay.get(key) ?? []).map((l) => ({
            id: l.id,
            label: `${l.licenseType} ${l.licenseNumber}`,
          }));
        })()}
        onAddEvent={() => {
          setAgendaOpen(false);
          if (agendaDate) openCreate(agendaDate);
        }}
        onEditEvent={(id) => {
          const ev = events.find((x) => x.id === id);
          if (ev) openEdit(ev);
        }}
        onEditTask={(id) => {
          router.push(`/tasks?taskId=${encodeURIComponent(id)}`);
        }}
        onOpenContract={(id) => {
          setContractModalId(id);
          setContractModalOpen(true);
        }}
      />

      <ScheduleContractModal
        contractId={contractModalId}
        open={contractModalOpen}
        onOpenChange={(o) => {
          setContractModalOpen(o);
          if (!o) setContractModalId(null);
        }}
      />

      <Dialog
        open={yearDetailMonth !== null}
        onOpenChange={(o) => {
          if (!o) setYearDetailMonth(null);
        }}
      >
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {yearDetailMonth !== null
                ? new Date(viewYear, yearDetailMonth, 1).toLocaleString("en-US", {
                    month: "long",
                    year: "numeric",
                  })
                : ""}
            </DialogTitle>
          </DialogHeader>
          <ul className="space-y-2 text-sm max-h-[55vh] overflow-y-auto pr-1">
            {(yearDetailMonth !== null ? yearMonthItems.get(yearDetailMonth) ?? [] : []).map(
              (r, i) => (
                <li key={`${r.sort}-${i}`} className="border-b border-border/40 pb-2">
                  <button
                    type="button"
                    className={cn(
                      "flex w-full flex-wrap gap-x-2 gap-y-1 rounded-md px-1 py-1 text-left hover:bg-muted/50",
                      r.kind === "Task" && "text-teal-700 dark:text-teal-300",
                      r.kind === "Contract" && "text-amber-900 dark:text-amber-100",
                      r.kind === "License" && "text-violet-900 dark:text-violet-100"
                    )}
                    onClick={() => handleYearRowAction(r)}
                  >
                    <span className="tabular-nums text-muted-foreground shrink-0">{r.day}</span>
                    <span className="text-xs text-muted-foreground shrink-0 w-14">{r.kind}</span>
                    <span className="min-w-0">{r.label}</span>
                  </button>
                </li>
              )
            )}
          </ul>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setYearDetailMonth(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
