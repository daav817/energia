"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

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
};

const VIS_KEY = "energia-tasklist-visibility";
const REPEAT_OPTIONS = [
  { value: "", label: "Does not repeat" },
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "YEARLY", label: "Yearly" },
];

type SortMode = "date" | "deadline" | "starred" | "title";

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

function sortTasks(tasks: TaskRow[], mode: SortMode): TaskRow[] {
  const t = [...tasks];
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
  const [sortMode, setSortMode] = useState<SortMode>("date");
  const [loading, setLoading] = useState(true);
  const [expandedDone, setExpandedDone] = useState(false);
  const [visible, setVisible] = useState<Record<string, boolean>>({});

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTaskId, setEditTaskId] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    allDay: true,
    dueDate: "",
    dueAt: "",
    repeat: "",
    starred: false,
    taskListId: "",
  });
  const [editForm, setEditForm] = useState({
    title: "",
    description: "",
    allDay: true,
    dueDate: "",
    dueAt: "",
    repeat: "",
    starred: false,
  });

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

  const persistVis = (next: Record<string, boolean>) => {
    setVisible(next);
    localStorage.setItem(VIS_KEY, JSON.stringify(next));
  };

  const selectedList = lists.find((l) => l.id === selectedId);
  const openTasks = useMemo(
    () => sortTasks(tasks.filter((t) => t.status !== "COMPLETED"), sortMode),
    [tasks, sortMode]
  );
  const doneTasks = useMemo(
    () => sortTasks(tasks.filter((t) => t.status === "COMPLETED"), sortMode),
    [tasks, sortMode]
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
    const nextStatus = task.status === "COMPLETED" ? "PENDING" : "COMPLETED";
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (res.ok && selectedId) loadTasks(selectedId);
  };

  const openCreate = () => {
    setForm({
      title: "",
      description: "",
      allDay: true,
      dueDate: "",
      dueAt: "",
      repeat: "",
      starred: false,
      taskListId: selectedId ?? "",
    });
    setCreateOpen(true);
  };

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.taskListId || !form.title.trim()) return;
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskListId: form.taskListId,
        title: form.title.trim(),
        description: form.description.trim() || null,
        allDay: form.allDay,
        dueDate: form.allDay ? form.dueDate || null : null,
        dueAt: !form.allDay && form.dueAt ? form.dueAt : null,
        repeatRule: form.repeat || null,
        starred: form.starred,
      }),
    });
    if (res.ok) {
      setCreateOpen(false);
      loadTasks(form.taskListId);
      loadLists();
    }
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
        const pe = (data.pushErrors as string[] | undefined)?.filter(Boolean) ?? [];
        setGoogleMsg(
          `Synced: pulled ${data.pulled?.tasksUpserted ?? 0} tasks, pushed ${data.pushed ?? 0} to Google.${pe.length ? ` Warnings: ${pe.slice(0, 2).join("; ")}` : ""}`
        );
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
    <div className="flex flex-1 min-h-0 w-full flex-row print:block">
      <aside className="flex w-64 shrink-0 flex-col border-r border-[#dadce0] bg-white p-3 min-h-0 overflow-y-auto print:hidden">
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
        <ul className="space-y-1">
          {lists.map((list) => (
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
              <div className="flex flex-wrap gap-2 print:hidden">
                <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
                  <SelectTrigger className="w-[160px] h-9">
                    <SelectValue placeholder="Sort" />
                  </SelectTrigger>
                  <SelectContent>
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
                  <DropdownMenuContent align="end">
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
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => {
                        setDeleteListTarget(selectedList);
                        setDeleteListOpen(true);
                      }}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete list…
                    </DropdownMenuItem>
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
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/schedule">Schedule</Link>
                </Button>
              </div>
            </div>

            <ul className="space-y-0">
              {openTasks.map((task) => (
                <li
                  key={task.id}
                  id={`task-row-${task.id}`}
                  className="flex items-start gap-3 border-b border-[#f1f3f4] py-3 px-1 hover:bg-[#f8f9fa]"
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked="false"
                    className="mt-1 h-5 w-5 shrink-0 rounded-full border-2 border-[#5f6368] hover:border-[#1a73e8]"
                    onClick={() => toggleComplete(task)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {task.starred && <Star className="h-4 w-4 fill-amber-400 text-amber-400 shrink-0" />}
                      <span className="text-[#202124]">{task.title}</span>
                    </div>
                    {(task.dueDate || task.dueAt) && (
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
                    {task.description && (
                      <p className="text-sm text-[#5f6368] mt-1 whitespace-pre-wrap">{task.description}</p>
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
              ))}
            </ul>

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
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New task</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitCreate} className="space-y-3">
            <div className="grid gap-2">
              <Label>List</Label>
              <Select
                value={form.taskListId}
                onValueChange={(v) => setForm((f) => ({ ...f, taskListId: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select list" />
                </SelectTrigger>
                <SelectContent>
                  {lists.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Title</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label>Description</Label>
              <textarea
                className="min-h-[72px] w-full rounded-md border px-3 py-2 text-sm"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.allDay}
                onChange={(e) => setForm((f) => ({ ...f, allDay: e.target.checked }))}
              />
              All day
            </label>
            {form.allDay ? (
              <div className="grid gap-2">
                <Label>Due date</Label>
                <Input
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                />
              </div>
            ) : (
              <div className="grid gap-2">
                <Label>Due date &amp; time</Label>
                <Input
                  type="datetime-local"
                  value={form.dueAt}
                  onChange={(e) => setForm((f) => ({ ...f, dueAt: e.target.value }))}
                />
              </div>
            )}
            <div className="grid gap-2">
              <Label>Repeat</Label>
              <Select
                value={form.repeat || "__none__"}
                onValueChange={(v) => setForm((f) => ({ ...f, repeat: v === "__none__" ? "" : v }))}
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
                checked={form.starred}
                onChange={(e) => setForm((f) => ({ ...f, starred: e.target.checked }))}
              />
              Starred
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
