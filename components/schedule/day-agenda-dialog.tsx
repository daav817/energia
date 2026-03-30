"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type AgendaCalendarEvent = {
  id: string;
  title: string;
  startAt: string;
  taskId: string | null;
};

type TaskDto = {
  id: string;
  title: string;
};

type ContractMini = { id: string; label: string };
type LicenseMini = { id: string; label: string };

export type DayAgendaDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dayLabel: string;
  events: AgendaCalendarEvent[];
  tasks: TaskDto[];
  contracts: ContractMini[];
  licenses: LicenseMini[];
  onAddEvent: () => void;
  onEditEvent: (id: string) => void;
  onEditTask: (id: string) => void;
  onOpenContract: (id: string) => void;
};

export function DayAgendaDialog({
  open,
  onOpenChange,
  dayLabel,
  events,
  tasks,
  contracts,
  licenses,
  onAddEvent,
  onEditEvent,
  onEditTask,
  onOpenContract,
}: DayAgendaDialogProps) {
  const hasAnything =
    events.length > 0 || tasks.length > 0 || contracts.length > 0 || licenses.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{dayLabel}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          {!hasAnything && (
            <p className="text-muted-foreground">Nothing scheduled on this day.</p>
          )}
          {contracts.length > 0 && (
            <div>
              <p className="font-semibold text-amber-800 dark:text-amber-200 mb-2">
                Contract expirations
              </p>
              <ul className="space-y-2">
                {contracts.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="text-primary font-medium hover:underline text-left"
                      onClick={() => {
                        onOpenContract(c.id);
                        onOpenChange(false);
                      }}
                    >
                      {c.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {licenses.length > 0 && (
            <div>
              <p className="font-semibold text-violet-800 dark:text-violet-200 mb-2">
                License expirations
              </p>
              <ul className="space-y-1 text-muted-foreground">
                {licenses.map((l) => (
                  <li key={l.id}>{l.label}</li>
                ))}
              </ul>
            </div>
          )}
          {tasks.length > 0 && (
            <div>
              <p className="font-semibold mb-2">Tasks</p>
              <ul className="space-y-1">
                {tasks.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      className="text-left text-primary hover:underline font-medium"
                      onClick={() => {
                        onEditTask(t.id);
                        onOpenChange(false);
                      }}
                    >
                      {t.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {events.length > 0 && (
            <div>
              <p className="font-semibold mb-2">Calendar events</p>
              <ul className="space-y-1">
                {events.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      className="text-left text-primary hover:underline font-medium"
                      onClick={() => {
                        onEditEvent(e.id);
                        onOpenChange(false);
                      }}
                    >
                      {e.title}
                      {e.taskId ? " (linked task)" : ""}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={onAddEvent}>Add event</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
