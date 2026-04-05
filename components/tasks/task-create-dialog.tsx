"use client";

import { useEffect, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type TaskCreateListOption = { id: string; name: string };

const REPEAT_OPTIONS = [
  { value: "", label: "Does not repeat" },
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "YEARLY", label: "Yearly" },
] as const;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lists: TaskCreateListOption[];
  defaultListId: string;
  onCreated?: (listId: string) => void;
};

export function TaskCreateDialog({
  open,
  onOpenChange,
  lists,
  defaultListId,
  onCreated,
}: Props) {
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

  useEffect(() => {
    if (!open) return;
    setForm({
      title: "",
      description: "",
      allDay: true,
      dueDate: "",
      dueAt: "",
      repeat: "",
      starred: false,
      taskListId:
        defaultListId && lists.some((l) => l.id === defaultListId) ? defaultListId : lists[0]?.id ?? "",
    });
  }, [open, defaultListId, lists]);

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
      onOpenChange(false);
      onCreated?.(form.taskListId);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
