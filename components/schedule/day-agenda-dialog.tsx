"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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

type EventDetailPayload = {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  eventType: string;
  customer?: { name: string; company: string | null } | null;
  contact?: { name: string } | null;
  contract?: {
    id: string;
    customer: { name: string };
    supplier: { name: string };
  } | null;
};

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
  /**
   * Dashboard: show fetched event detail inside this dialog instead of calling onEditEvent.
   * Schedule: omit (defaults to schedule behavior).
   */
  variant?: "schedule" | "dashboard";
  /** Linked from dashboard footer when variant is dashboard. */
  scheduleDayHref?: string;
};

function formatEventWhen(d: EventDetailPayload): string {
  const start = new Date(d.startAt);
  if (d.allDay) {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(d.startAt);
    if (m) return m[1];
    return start.toLocaleDateString();
  }
  const end = d.endAt ? new Date(d.endAt) : null;
  let s = start.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  if (end && !Number.isNaN(end.getTime())) {
    s += ` – ${end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  }
  return s;
}

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
  variant = "schedule",
  scheduleDayHref,
}: DayAgendaDialogProps) {
  const [inlineEventId, setInlineEventId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EventDetailPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setInlineEventId(null);
      setDetail(null);
    }
  }, [open]);

  useEffect(() => {
    if (!inlineEventId || variant !== "dashboard") {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    let cancelled = false;
    fetch(`/api/calendar/events/${encodeURIComponent(inlineEventId)}`)
      .then((r) => r.json())
      .then((data: EventDetailPayload & { error?: string }) => {
        if (cancelled) return;
        if (data?.error) setDetail(null);
        else setDetail(data as EventDetailPayload);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [inlineEventId, variant]);

  const hasAnything =
    events.length > 0 || tasks.length > 0 || contracts.length > 0 || licenses.length > 0;

  const showInlineEvent = variant === "dashboard" && inlineEventId;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setInlineEventId(null);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        {showInlineEvent ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2 pr-8">
                <Button type="button" variant="outline" size="sm" onClick={() => setInlineEventId(null)}>
                  Back
                </Button>
                <span className="min-w-0 flex-1 text-base font-semibold leading-tight">
                  {detail?.title ?? "Event"}
                </span>
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              {detailLoading && <p className="text-muted-foreground">Loading…</p>}
              {!detailLoading && !detail && (
                <p className="text-muted-foreground">Could not load this event.</p>
              )}
              {detail && (
                <>
                  <div>
                    <p className="text-xs font-semibold uppercase text-muted-foreground mb-0.5">When</p>
                    <p>{formatEventWhen(detail)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase text-muted-foreground mb-0.5">Type</p>
                    <p>{detail.eventType.replaceAll("_", " ")}</p>
                  </div>
                  {detail.description?.trim() ? (
                    <div>
                      <p className="text-xs font-semibold uppercase text-muted-foreground mb-0.5">
                        Description
                      </p>
                      <p className="whitespace-pre-wrap text-muted-foreground">{detail.description}</p>
                    </div>
                  ) : null}
                  {detail.customer?.name && (
                    <div>
                      <p className="text-xs font-semibold uppercase text-muted-foreground mb-0.5">
                        Customer
                      </p>
                      <p>
                        {detail.customer.name}
                        {detail.customer.company ? ` · ${detail.customer.company}` : ""}
                      </p>
                    </div>
                  )}
                  {detail.contact?.name && (
                    <div>
                      <p className="text-xs font-semibold uppercase text-muted-foreground mb-0.5">
                        Contact
                      </p>
                      <p>{detail.contact.name}</p>
                    </div>
                  )}
                  {detail.contract && (
                    <div>
                      <p className="text-xs font-semibold uppercase text-muted-foreground mb-0.5">
                        Contract
                      </p>
                      <p>
                        {detail.contract.customer.name} → {detail.contract.supplier.name}
                      </p>
                    </div>
                  )}
                  {scheduleDayHref && (
                    <Button variant="outline" size="sm" className="w-full sm:w-auto" asChild>
                      <Link href={scheduleDayHref}>Open in calendar</Link>
                    </Button>
                  )}
                </>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
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
                            if (variant === "dashboard") {
                              setInlineEventId(e.id);
                            } else {
                              onEditEvent(e.id);
                            }
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
              {variant === "dashboard" && scheduleDayHref ? (
                <Button variant="default" asChild>
                  <Link href={scheduleDayHref}>Open in calendar</Link>
                </Button>
              ) : (
                <Button onClick={onAddEvent}>Add event</Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
