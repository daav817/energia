"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Plus,
  Printer,
  Trash2,
  Settings,
  CloudDownload,
  GripVertical,
  ChevronDown,
  ChevronRight,
  Star,
  Pencil,
  CalendarDays,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { formatGoogleTasksSyncMessage } from "@/lib/google-tasks-sync-message";
import { persistTasksOrder, reorderIdList } from "@/lib/tasks-reorder";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TaskCreateDialog } from "@/components/tasks/task-create-dialog";
import {
  TaskAssociationFields,
  taskContactLine,
  taskContractLine,
} from "@/components/tasks/task-association-fields";

type TaskListRow = {
  id: string;
  name: string;
  sortOrder: number;
  _count: { tasks: number };
};

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  dueDate: string | null;
  dueAt: string | null;
  allDay: boolean;
  starred: boolean;
  repeatRule: string | null;
  listSortOrder: number;
  taskListId: string | null;
  taskList: { id: string; name: string } | null;
  contactId?: string | null;
  contractId?: string | null;
  contact?: { id: string; name: string; company: string | null } | null;
  linkedContract?: {
    id: string;
    energyType: string;
    customer: { name: string; company: string | null };
    supplier: { name: string };
  } | null;
};

const VIS_KEY = "energia-tasklist-visibility";
const TASK_SIDEBAR_WIDTH_KEY = "energia-tasks-sidebar-width";
const REPEAT_OPTIONS = [
  { value: "", label: "Does not repeat" },
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "YEARLY", label: "Yearly" },
];

type SortMode = "manual" | "date" | "deadline" | "starred" | "title";

function taskHasScheduleDate(t: TaskRow): boolean {
  return !!(t.dueDate || t.dueAt);
}

/** YYYY-MM-DD for schedule / ?flashDate= */
function taskScheduleFlashDateKey(t: TaskRow): string | null {
  if (t.dueAt) {
    const d = new Date(t.dueAt);
    if (Number.isNaN(d.getTime())) return null;
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  if (t.dueDate) {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(t.dueDate));
    return m ? m[1] : null;
  }
  return null;
}

function toDatetimeLocalValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function taskRowMatchesQuery(t: TaskRow, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  if (t.title.toLowerCase().includes(s)) return true;
  if ((t.description ?? "").toLowerCase().includes(s)) return true;
  const cl = taskContactLine(t.contact);
  if (cl?.toLowerCase().includes(s)) return true;
  const kl = taskContractLine(t.linkedContract);
  if (kl?.toLowerCase().includes(s)) return true;
  return false;
}

/** Group dated tasks by calendar day (YYYY-MM-DD); undated last. */
function groupTasksByScheduleDay(tasks: TaskRow[]): {
  undated: TaskRow[];
  groups: { dateKey: string; label: string; tasks: TaskRow[] }[];
} {
  const undated: TaskRow[] = [];
  const map = new Map<string, TaskRow[]>();
  for (const t of tasks) {
    if (!taskHasScheduleDate(t)) {
      undated.push(t);
      continue;
    }
    const k = taskScheduleFlashDateKey(t);
    if (!k) {
      undated.push(t);
      continue;
    }
    const list = map.get(k) ?? [];
    list.push(t);
    map.set(k, list);
  }
  const keys = [...map.keys()].sort((a, b) => a.localeCompare(b));
  const groups = keys.map((dateKey) => {
    const list = map.get(dateKey)!;
    list.sort((a, b) => {
      const ta = a.dueAt
        ? new Date(a.dueAt).getTime()
        : a.dueDate
          ? new Date(a.dueDate).getTime()
          : 0;
      const tb = b.dueAt
        ? new Date(b.dueAt).getTime()
        : b.dueDate
          ? new Date(b.dueDate).getTime()
          : 0;
      if (ta !== tb) return ta - tb;
      return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    });
    const d = new Date(dateKey + "T12:00:00");
    const label = Number.isNaN(d.getTime())
      ? dateKey
      : d.toLocaleDateString(undefined, {
          weekday: "short",
          year: "numeric",
          month: "short",
          day: "numeric",
        });
    return { dateKey, label, tasks: list };
  });
  undated.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  return { undated, groups };
}

function sortTasks(tasks: TaskRow[], mode: SortMode): TaskRow[] {
  const t = [...tasks];
  if (mode === "manual") {
    return t.sort(
      (a, b) =>
        (a.listSortOrder ?? 0) - (b.listSortOrder ?? 0) ||
        a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
    );
  }
  if (mode === "title") {
    return t.sort((a, b) => a.title.localeCompare(b.title));
  }
  if (mode === "starred") {
    return t.sort((a, b) => {
      if (a.starred !== b.starred) return a.starred ? -1 : 1;
      return a.title.localeCompare(b.title);
    });
  }
  if (mode === "deadline" || mode === "date") {
    return t.sort((a, b) => {
      const ta = a.dueAt ? new Date(a.dueAt).getTime() : a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const tb = b.dueAt ? new Date(b.dueAt).getTime() : b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      if (ta !== tb) return ta - tb;
      return a.title.localeCompare(b.title);
    });
  }
  return t;
}

export function TasksApp() {
  const searchParams = useSearchParams();
  const [lists, setLists] = useState<TaskListRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("manual");
  const [loading, setLoading] = useState(true);
  const [expandedDone, setExpandedDone] = useState(false);
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const [graceCompletingIds, setGraceCompletingIds] = useState<string[]>([]);
  const graceTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [listNameQuery, setListNameQuery] = useState("");
  const [taskQuery, setTaskQuery] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [createListIdOverride, setCreateListIdOverride] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editTaskId, setEditTaskId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    title: "",
    description: "",
    allDay: true,
    dueDate: "",
    dueAt: "",
    repeat: "",
    starred: false,
    contactId: "",
    contractId: "",
  });
  const [collapsedTaskDateGroups, setCollapsedTaskDateGroups] = useState<Set<string>>(
    () => new Set()
  );

  const loadLists = useCallback(async () => {
    const res = await fetch("/api/task-lists");
    const data = res.ok ? await res.json() : [];
    const arr = Array.isArray(data) ? data : [];
    setLists(arr);
    setSelectedId((current) => {
      if (current && arr.some((l: TaskListRow) => l.id === current)) return current;
      return arr[0]?.id ?? null;
    });
  }, []);

  const loadTasks = useCallback(async (listId: string) => {
    const res = await fetch(`/api/tasks?listId=${encodeURIComponent(listId)}&includeCompleted=true`);
    const data = res.ok ? await res.json() : [];
    setTasks(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => {
    let v: Record<string, boolean> = {};
    try {
      const raw = localStorage.getItem(VIS_KEY);
      if (raw) v = JSON.parse(raw) as Record<string, boolean>;
    } catch {
      v = {};
    }
    setVisible(v);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadLists();
      setLoading(false);
    })();
  }, [loadLists]);

  useEffect(() => {
    if (selectedId) loadTasks(selectedId);
  }, [selectedId, loadTasks]);

  useEffect(() => {
    graceTimeoutsRef.current.forEach(clearTimeout);
    graceTimeoutsRef.current.clear();
    setGraceCompletingIds([]);
  }, [selectedId]);

  useEffect(() => {
    try {
      const w = localStorage.getItem(TASK_SIDEBAR_WIDTH_KEY);
      if (w) {
        const n = parseInt(w, 10);
        if (!Number.isNaN(n)) setSidebarWidth(Math.max(200, Math.min(520, n)));
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    return () => {
      graceTimeoutsRef.current.forEach(clearTimeout);
      graceTimeoutsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const tid = searchParams.get("taskId");
    if (!tid) return;
    (async () => {
      try {
        const res = await fetch(`/api/tasks/${encodeURIComponent(tid)}`);
        const t = await res.json();
        if (res.ok && t.taskListId) {
          setSelectedId(t.taskListId);
          setTimeout(() => {
            document.getElementById(`task-row-${tid}`)?.scrollIntoView({ block: "center" });
          }, 400);
        }
      } catch {
        /* ignore */
      }
    })();
  }, [searchParams]);

  const handledCreateFromUrl = useRef<string | null>(null);
  useEffect(() => {
    if (loading) return;
    const create = searchParams.get("create");
    const listId = searchParams.get("listId");
    if (create !== "1" || !listId) return;
    if (!lists.some((l) => l.id === listId)) return;
    const key = `create:${listId}`;
    if (handledCreateFromUrl.current === key) return;
    handledCreateFromUrl.current = key;
    setSelectedId(listId);
    setCreateListIdOverride(listId);
    setCreateOpen(true);
  }, [searchParams, loading, lists]);

  const persistVis = (next: Record<string, boolean>) => {
    setVisible(next);
    localStorage.setItem(VIS_KEY, JSON.stringify(next));
  };

  const selectedList = lists.find((l) => l.id === selectedId);
  const graceSet = useMemo(() => new Set(graceCompletingIds), [graceCompletingIds]);
  const openTasks = useMemo(
    () =>
      sortTasks(
        tasks.filter(
          (t) =>
            (t.status !== "COMPLETED" || graceSet.has(t.id)) && taskRowMatchesQuery(t, taskQuery)
        ),
        sortMode
      ),
    [tasks, sortMode, graceSet, taskQuery]
  );
  const useDateGrouping = sortMode === "date" || sortMode === "deadline";
  const groupedOpenTasks = useMemo(
    () => (useDateGrouping ? groupTasksByScheduleDay(openTasks) : null),
    [openTasks, useDateGrouping]
  );
  const doneTasks = useMemo(
    () =>
      sortTasks(
        tasks.filter(
          (t) =>
            t.status === "COMPLETED" &&
            !graceSet.has(t.id) &&
            taskRowMatchesQuery(t, taskQuery)
        ),
        sortMode
      ),
    [tasks, sortMode, graceSet, taskQuery]
  );

  const filteredLists = useMemo(() => {
    const q = listNameQuery.trim().toLowerCase();
    if (!q) return lists;
    return lists.filter((l) => l.name.toLowerCase().includes(q));
  }, [lists, listNameQuery]);

  const onTaskRowDrop = useCallback(
    async (e: React.DragEvent, targetTask: TaskRow) => {
      e.preventDefault();
      if (sortMode !== "manual") return;
      const draggedId = e.dataTransfer.getData("text/task-id");
      if (!draggedId || draggedId === targetTask.id) return;
      const ids = sortTasks(
        tasks.filter((t) => t.status !== "COMPLETED" || graceSet.has(t.id)),
        "manual"
      ).map((t) => t.id);
      const next = reorderIdList(ids, draggedId, targetTask.id);
      if (!next) return;
      const ok = await persistTasksOrder(next);
      if (ok && selectedId) await loadTasks(selectedId);
    },
    [sortMode, tasks, graceSet, selectedId, loadTasks]
  );

  const onDragStart = (e: React.DragEvent, listId: string) => {
    e.dataTransfer.setData("text/list-id", listId);
    e.dataTransfer.effectAllowed = "move";
  };

  const onDropReorder = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const fromId = e.dataTransfer.getData("text/list-id");
    if (!fromId || fromId === targetId) return;
    const idx = lists.findIndex((l) => l.id === fromId);
    const tidx = lists.findIndex((l) => l.id === targetId);
    if (idx < 0 || tidx < 0) return;
    const next = [...lists];
    const [removed] = next.splice(idx, 1);
    next.splice(tidx, 0, removed);
    const orderedIds = next.map((l) => l.id);
    const res = await fetch("/api/task-lists/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds }),
    });
    if (res.ok) {
      const data = await res.json();
      setLists(Array.isArray(data) ? data : next);
    }
  };

  const toggleComplete = async (task: TaskRow) => {
    if (task.status === "COMPLETED") {
      const existing = graceTimeoutsRef.current.get(task.id);
      if (existing) {
        clearTimeout(existing);
        graceTimeoutsRef.current.delete(task.id);
      }
      setGraceCompletingIds((p) => p.filter((x) => x !== task.id));
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "PENDING" }),
      });
      if (res.ok && selectedId) loadTasks(selectedId);
      return;
    }
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "COMPLETED" }),
    });
    if (!res.ok || !selectedId) return;
    await loadTasks(selectedId);
    setGraceCompletingIds((p) => (p.includes(task.id) ? p : [...p, task.id]));
    const prev = graceTimeoutsRef.current.get(task.id);
    if (prev) clearTimeout(prev);
    graceTimeoutsRef.current.set(
      task.id,
      setTimeout(() => {
        graceTimeoutsRef.current.delete(task.id);
        setGraceCompletingIds((p) => p.filter((x) => x !== task.id));
        loadTasks(selectedId);
      }, 2000)
    );
  };

  const startResizeSidebar = (startX: number) => {
    const startW = sidebarWidth;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - startX;
      const nw = Math.max(200, Math.min(520, startW + dx));
      setSidebarWidth(nw);
      try {
        localStorage.setItem(TASK_SIDEBAR_WIDTH_KEY, String(nw));
      } catch {
        /* ignore */
      }
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

  const openCreate = () => {
    setCreateListIdOverride(null);
    setCreateOpen(true);
  };

  const openEditTask = (task: TaskRow) => {
    const dm = task.dueDate ? /^(\d{4}-\d{2}-\d{2})/.exec(String(task.dueDate)) : null;
    const dueDateStr = dm ? dm[1] : "";
    const dueAtStr =
      task.dueAt && !task.allDay ? toDatetimeLocalValue(new Date(task.dueAt)) : "";
    setEditForm({
      title: task.title,
      description: task.description ?? "",
      allDay: task.allDay,
      dueDate: dueDateStr,
      dueAt: dueAtStr,
      repeat: task.repeatRule ?? "",
      starred: task.starred,
      contactId: task.contactId ?? task.contact?.id ?? "",
      contractId: task.contractId ?? task.linkedContract?.id ?? "",
    });
    setEditTaskId(task.id);
    setEditOpen(true);
  };

  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTaskId || !editForm.title.trim()) return;
    const payload: Record<string, unknown> = {
      title: editForm.title.trim(),
      description: editForm.description.trim() ? editForm.description.trim() : null,
      allDay: editForm.allDay,
      repeatRule: editForm.repeat || null,
      starred: editForm.starred,
    };
    if (editForm.allDay) {
      payload.dueDate = editForm.dueDate || null;
      payload.dueAt = null;
    } else {
      payload.dueDate = null;
      payload.dueAt = editForm.dueAt || null;
    }
    payload.contactId = editForm.contactId.trim() || null;
    payload.contractId = editForm.contractId.trim() || null;
    const res = await fetch(`/api/tasks/${encodeURIComponent(editTaskId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      setEditOpen(false);
      setEditTaskId(null);
      if (selectedId) await loadTasks(selectedId);
      await loadLists();
    }
  };

  const [googleMsg, setGoogleMsg] = useState<string | null>(null);
  const [deleteListOpen, setDeleteListOpen] = useState(false);
  const [deleteListTarget, setDeleteListTarget] = useState<TaskListRow | null>(null);

  const renderOpenTaskRow = (task: TaskRow) => {
    const canDragReorder = sortMode === "manual" && !taskQuery.trim();
    const cLine = taskContactLine(task.contact);
    const kLine = taskContractLine(task.linkedContract);
    return (
      <li
        key={task.id}
        id={`task-row-${task.id}`}
        className="flex items-start gap-3 border-b border-[#f1f3f4] py-3 px-1 hover:bg-[#f8f9fa]"
        onDragOver={
          canDragReorder
            ? (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }
            : undefined
        }
        onDrop={canDragReorder ? (e) => void onTaskRowDrop(e, task) : undefined}
      >
        {canDragReorder ? (
          <span
            role="button"
            tabIndex={0}
            aria-label="Drag to reorder task"
            draggable
            className="mt-0.5 shrink-0 cursor-grab text-[#9aa0a6] hover:text-[#5f6368] active:cursor-grabbing print:hidden"
            onDragStart={(e) => {
              e.dataTransfer.setData("text/task-id", task.id);
              e.dataTransfer.effectAllowed = "move";
            }}
          >
            <GripVertical className="h-5 w-5" />
          </span>
        ) : null}
        <button
          type="button"
          role="checkbox"
          aria-checked={task.status === "COMPLETED"}
          className={cn(
            "mt-1 h-5 w-5 shrink-0 rounded-full border-2 border-[#5f6368] hover:border-[#1a73e8]",
            task.status === "COMPLETED" && "bg-[#1a73e8] border-[#1a73e8] hover:border-[#1a73e8]"
          )}
          onClick={() => toggleComplete(task)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {task.starred && <Star className="h-4 w-4 fill-amber-400 text-amber-400 shrink-0" />}
            <span
              className={cn(
                "text-[#202124]",
                task.status === "COMPLETED" && "line-through text-[#80868b]"
              )}
            >
              {task.title}
            </span>
          </div>
          {(task.dueDate || task.dueAt) && !useDateGrouping && (
            <p className="text-xs text-[#5f6368] mt-0.5">
              {task.allDay && task.dueDate
                ? new Date(task.dueDate).toLocaleDateString()
                : task.dueAt
                  ? new Date(task.dueAt).toLocaleString()
                  : task.dueDate
                    ? new Date(task.dueDate).toLocaleDateString()
                    : null}
            </p>
          )}
          {(task.dueDate || task.dueAt) && useDateGrouping && (
            <p className="text-xs text-[#5f6368] mt-0.5">
              {task.allDay && task.dueDate
                ? "All day"
                : task.dueAt
                  ? new Date(task.dueAt).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : null}
            </p>
          )}
          {task.description && (
            <p className="text-sm text-[#5f6368] mt-1 whitespace-pre-wrap">{task.description}</p>
          )}
          {(cLine || kLine) && (
            <div className="mt-1.5 flex flex-col gap-0.5 text-[11px] text-[#80868b]">
              {cLine ? <span>Contact: {cLine}</span> : null}
              {kLine ? (
                <span>
                  Contract:{" "}
                  <Link className="text-[#1a73e8] hover:underline" href={`/directory/contracts?contractId=${encodeURIComponent(task.linkedContract?.id ?? "")}`}>
                    {kLine}
                  </Link>
                </span>
              ) : null}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 print:hidden">
          {(() => {
            const flashKey = taskScheduleFlashDateKey(task);
            if (!flashKey) return null;
            return (
              <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                <Link
                  href={`/schedule?flashDate=${encodeURIComponent(flashKey)}`}
                  title="View on Schedule"
                >
                  <CalendarDays className="h-4 w-4 text-[#5f6368]" />
                </Link>
              </Button>
            );
          })()}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="Edit task"
            onClick={() => openEditTask(task)}
          >
            <Pencil className="h-4 w-4 text-[#5f6368]" />
          </Button>
        </div>
      </li>
    );
  };

  const runGoogleTasks = async (mode: "import" | "sync") => {
    setGoogleMsg(null);
    try {
      const res = await fetch(`/api/google-tasks/${mode}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setGoogleMsg((data.error as string) || "Request failed");
        return;
      }
      if (mode === "import") {
        setGoogleMsg(
          `Imported: ${data.tasksUpserted ?? 0} tasks across ${data.listsSynced ?? 0} lists.`
        );
      } else {
        setGoogleMsg(formatGoogleTasksSyncMessage(data));
      }
      await loadLists();
      if (selectedId) await loadTasks(selectedId);
    } catch (e) {
      setGoogleMsg(e instanceof Error ? e.message : "Failed");
    }
  };

  if (loading && lists.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-[#5f6368]">Loading…</div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 w-full flex-row print:block relative">
      <aside
        className="flex shrink-0 flex-col border-r border-[#dadce0] bg-white p-3 min-h-0 overflow-y-auto print:hidden relative"
        style={{ width: sidebarWidth }}
      >
        <Button className="w-full mb-3 rounded-full bg-[#1a73e8] hover:bg-[#1557b0]" onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Create
        </Button>
        <Button
          variant="outline"
          className="w-full mb-4 text-sm"
          onClick={async () => {
            const name = window.prompt("New list name");
            if (!name?.trim()) return;
            const res = await fetch("/api/task-lists", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: name.trim() }),
            });
            if (res.ok) {
              const list = await res.json();
              await loadLists();
              setSelectedId(list.id);
            }
          }}
        >
          New list
        </Button>
        <div className="relative mb-3">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[#80868b]" />
          <Input
            value={listNameQuery}
            onChange={(e) => setListNameQuery(e.target.value)}
            placeholder="Search lists…"
            className="h-9 pl-8 text-sm border-[#dadce0]"
            aria-label="Search task lists"
          />
        </div>
        <ul className="space-y-1">
          {filteredLists.map((list) => (
            <li
              key={list.id}
              draggable
              onDragStart={(e) => onDragStart(e, list.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDropReorder(e, list.id)}
              className={cn(
                "flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm cursor-pointer",
                selectedId === list.id ? "bg-[#e8f0fe] text-[#1a73e8]" : "hover:bg-[#f1f3f4]"
              )}
              onClick={() => setSelectedId(list.id)}
            >
              <GripVertical className="h-4 w-4 text-[#80868b] shrink-0 cursor-grab" />
              <input
                type="checkbox"
                className="rounded border-[#dadce0]"
                checked={visible[list.id] !== false}
                onChange={(e) => {
                  e.stopPropagation();
                  persistVis({ ...visible, [list.id]: e.target.checked });
                }}
                onClick={(e) => e.stopPropagation()}
              />
              <span className="truncate flex-1">{list.name}</span>
              <span className="text-xs text-[#80868b]">{list._count.tasks}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-[#80868b] hover:text-destructive"
                aria-label={`Delete list ${list.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteListTarget(list);
                  setDeleteListOpen(true);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      </aside>
      <div
        className="w-2 shrink-0 cursor-col-resize hover:bg-primary/30 bg-[#dadce0]/40 transition-colors print:hidden"
        onMouseDown={(e) => {
          e.preventDefault();
          startResizeSidebar(e.clientX);
        }}
        title="Drag to resize list"
        role="separator"
        aria-orientation="vertical"
      />

      <main
        id="tasks-print-area"
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-white p-4 md:p-6"
      >
        {googleMsg && (
          <p className="mb-3 rounded-md border border-[#dadce0] bg-[#f8f9fa] px-3 py-2 text-sm text-[#202124]">
            {googleMsg}
            {/Insufficient permission|Google Tasks/i.test(googleMsg) && (
              <>
                {" "}
                <a
                  href="/api/gmail/connect"
                  className="font-medium text-[#1a73e8] underline underline-offset-2"
                >
                  Reconnect Google
                </a>
                {" "}
                (enable the Tasks API in Google Cloud first, then use the same Google account).
              </>
            )}
          </p>
        )}
        {selectedList && visible[selectedList.id] !== false ? (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
              <h2 className="text-2xl font-normal text-[#202124]">{selectedList.name}</h2>
              <div className="flex flex-wrap items-center gap-2 print:hidden">
                <div className="relative w-full min-w-[180px] sm:w-48">
                  <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[#80868b]" />
                  <Input
                    value={taskQuery}
                    onChange={(e) => setTaskQuery(e.target.value)}
                    placeholder="Search tasks…"
                    className="h-9 pl-8 text-sm"
                    aria-label="Search tasks in this list"
                  />
                </div>
                <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
                  <SelectTrigger className="w-[160px] h-9">
                    <SelectValue placeholder="Sort" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Sort: Manual (drag)</SelectItem>
                    <SelectItem value="date">Sort: Date</SelectItem>
                    <SelectItem value="deadline">Sort: Deadline</SelectItem>
                    <SelectItem value="starred">Sort: Starred</SelectItem>
                    <SelectItem value="title">Sort: Title</SelectItem>
                  </SelectContent>
                </Select>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" className="h-9 w-9" aria-label="List menu">
                      <Settings className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[14rem]">
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        onSelect={() => {
                          const n = window.prompt("Rename list", selectedList.name);
                          if (!n?.trim()) return;
                          fetch(`/api/task-lists/${selectedList.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ name: n.trim() }),
                          }).then(() => loadLists());
                        }}
                      >
                        Rename list
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => window.print()}>
                        <Printer className="mr-2 h-4 w-4" />
                        Print list
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={async () => {
                          if (!window.confirm("Delete all completed tasks in this list?")) return;
                          await fetch(`/api/task-lists/${selectedList.id}/purge-completed`, {
                            method: "POST",
                          });
                          loadTasks(selectedList.id);
                          loadLists();
                        }}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete completed
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <div
                        className="px-2 py-1.5 text-xs font-semibold text-muted-foreground"
                        role="presentation"
                      >
                        Google Tasks
                      </div>
                      <DropdownMenuItem onSelect={() => void runGoogleTasks("sync")}>
                        Sync with Google Tasks
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void runGoogleTasks("import")}>
                        <CloudDownload className="mr-2 h-4 w-4" />
                        Import Google Tasks
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <a href="/api/gmail/connect">Reconnect Google (Tasks access)</a>
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/schedule">Schedule</Link>
                </Button>
              </div>
            </div>
            {sortMode === "manual" && (
              <p className="mb-4 text-xs text-[#5f6368] print:hidden">
                {taskQuery.trim()
                  ? "Clear the task search box to drag and reorder."
                  : "Drag order is saved for this list. Use the grip beside each open task."}
              </p>
            )}
            {(sortMode === "date" || sortMode === "deadline") && (
              <p className="mb-3 text-xs text-[#5f6368] print:hidden">
                Tasks with dates are grouped by day (earliest days first). Use the chevron to collapse a day.
              </p>
            )}

            {useDateGrouping && groupedOpenTasks ? (
              <div className="space-y-1">
                {groupedOpenTasks.groups.map((g) => {
                  const collapsed = collapsedTaskDateGroups.has(g.dateKey);
                  return (
                    <div key={g.dateKey} className="rounded-lg border border-[#e8eaed] overflow-hidden">
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 bg-[#f8f9fa] px-3 py-2 text-left text-sm font-medium text-[#202124] hover:bg-[#f1f3f4]"
                        onClick={() =>
                          setCollapsedTaskDateGroups((prev) => {
                            const next = new Set(prev);
                            if (next.has(g.dateKey)) next.delete(g.dateKey);
                            else next.add(g.dateKey);
                            return next;
                          })
                        }
                        aria-expanded={!collapsed}
                      >
                        {collapsed ? (
                          <ChevronRight className="h-4 w-4 shrink-0 text-[#5f6368]" />
                        ) : (
                          <ChevronDown className="h-4 w-4 shrink-0 text-[#5f6368]" />
                        )}
                        <span>
                          {g.label}
                          <span className="ml-2 font-normal text-[#5f6368]">({g.tasks.length})</span>
                        </span>
                      </button>
                      {!collapsed && (
                        <ul className="space-y-0 bg-white">{g.tasks.map((task) => renderOpenTaskRow(task))}</ul>
                      )}
                    </div>
                  );
                })}
                {groupedOpenTasks.undated.length > 0 && (
                  <div className="rounded-lg border border-[#e8eaed] overflow-hidden">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 bg-[#f8f9fa] px-3 py-2 text-left text-sm font-medium text-[#202124] hover:bg-[#f1f3f4]"
                      onClick={() =>
                        setCollapsedTaskDateGroups((prev) => {
                          const next = new Set(prev);
                          const k = "__undated__";
                          if (next.has(k)) next.delete(k);
                          else next.add(k);
                          return next;
                        })
                      }
                      aria-expanded={!collapsedTaskDateGroups.has("__undated__")}
                    >
                      {collapsedTaskDateGroups.has("__undated__") ? (
                        <ChevronRight className="h-4 w-4 shrink-0 text-[#5f6368]" />
                      ) : (
                        <ChevronDown className="h-4 w-4 shrink-0 text-[#5f6368]" />
                      )}
                      <span>
                        No date
                        <span className="ml-2 font-normal text-[#5f6368]">
                          ({groupedOpenTasks.undated.length})
                        </span>
                      </span>
                    </button>
                    {!collapsedTaskDateGroups.has("__undated__") && (
                      <ul className="space-y-0 bg-white">
                        {groupedOpenTasks.undated.map((task) => renderOpenTaskRow(task))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <ul className="space-y-0">{openTasks.map((task) => renderOpenTaskRow(task))}</ul>
            )}

            <button
              type="button"
              className="mt-4 flex items-center gap-2 text-sm text-[#5f6368] hover:text-[#202124] print:hidden"
              onClick={() => setExpandedDone(!expandedDone)}
            >
              {expandedDone ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              Completed ({doneTasks.length})
            </button>
            {expandedDone && (
              <ul className="mt-2 space-y-1 opacity-75">
                {doneTasks.map((task) => (
                  <li
                    key={`done-${task.id}`}
                    className="flex items-center gap-2 py-2 line-through text-[#80868b]"
                  >
                    <button
                      type="button"
                      className="h-5 w-5 shrink-0 rounded-full bg-[#1a73e8] border-2 border-[#1a73e8]"
                      onClick={() => toggleComplete(task)}
                    />
                    {task.title}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-[#5f6368]">Select a list or show hidden lists using the checkboxes.</p>
        )}
      </main>

      <ConfirmDialog
        open={deleteListOpen}
        onOpenChange={(o) => {
          setDeleteListOpen(o);
          if (!o) setDeleteListTarget(null);
        }}
        title="Delete task list"
        message={
          deleteListTarget
            ? `Delete “${deleteListTarget.name}” and all tasks in it? This cannot be undone.`
            : "Delete this list and all tasks in it? This cannot be undone."
        }
        confirmLabel="Delete list"
        onConfirm={async () => {
          if (!deleteListTarget) return;
          const id = deleteListTarget.id;
          const res = await fetch(`/api/task-lists/${encodeURIComponent(id)}`, {
            method: "DELETE",
          });
          if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            setGoogleMsg((j as { error?: string }).error || "Could not delete list.");
            return;
          }
          setTasks([]);
          setDeleteListTarget(null);
          await loadLists();
        }}
      />

      <Dialog
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o);
          if (!o) setEditTaskId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit task</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitEdit} className="space-y-3">
            <div className="grid gap-2">
              <Label>Title</Label>
              <Input
                value={editForm.title}
                onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label>Description</Label>
              <textarea
                className="min-h-[72px] w-full rounded-md border px-3 py-2 text-sm"
                value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editForm.allDay}
                onChange={(e) => setEditForm((f) => ({ ...f, allDay: e.target.checked }))}
              />
              All day
            </label>
            {editForm.allDay ? (
              <div className="grid gap-2">
                <Label>Due date</Label>
                <Input
                  type="date"
                  value={editForm.dueDate}
                  onChange={(e) => setEditForm((f) => ({ ...f, dueDate: e.target.value }))}
                />
                <p className="text-xs text-[#5f6368]">
                  Leave empty so the task does not appear on the Schedule until you add a date.
                </p>
              </div>
            ) : (
              <div className="grid gap-2">
                <Label>Due date &amp; time</Label>
                <Input
                  type="datetime-local"
                  value={editForm.dueAt}
                  onChange={(e) => setEditForm((f) => ({ ...f, dueAt: e.target.value }))}
                />
              </div>
            )}
            <div className="grid gap-2">
              <Label>Repeat</Label>
              <Select
                value={editForm.repeat || "__none__"}
                onValueChange={(v) => setEditForm((f) => ({ ...f, repeat: v === "__none__" ? "" : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Does not repeat" />
                </SelectTrigger>
                <SelectContent>
                  {REPEAT_OPTIONS.map((o) => (
                    <SelectItem key={o.value || "nr"} value={o.value || "__none__"}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editForm.starred}
                onChange={(e) => setEditForm((f) => ({ ...f, starred: e.target.checked }))}
              />
              Starred
            </label>
            <TaskAssociationFields
              contactId={editForm.contactId}
              contractId={editForm.contractId}
              onContactId={(id) => setEditForm((f) => ({ ...f, contactId: id }))}
              onContractId={(id) => setEditForm((f) => ({ ...f, contractId: id }))}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <TaskCreateDialog
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o) setCreateListIdOverride(null);
        }}
        lists={lists}
        defaultListId={createListIdOverride ?? selectedId ?? ""}
        onCreated={(listId) => {
          loadTasks(listId);
          void loadLists();
        }}
      />
    </div>
  );
}
