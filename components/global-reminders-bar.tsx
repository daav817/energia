"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Bell, X, ChevronRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ScheduleContractModal } from "@/components/schedule/schedule-contract-modal";

const STORAGE_HIDDEN = "energia-reminders-bar-hidden";

type Payload = {
  events: { id: string; title: string; startAt: string; eventType: string }[];
  tasks: { id: string; title: string; dueAt: string | null; dueDate: string | null }[];
  contracts: {
    id: string;
    expirationDate: string;
    customer: { name: string } | null;
    supplier: { name: string } | null;
  }[];
  licenses: {
    id: string;
    licenseNumber: string;
    licenseType: string;
    expirationDate: string;
  }[];
};

type ReminderLine =
  | { kind: "link"; label: string; href: string }
  | { kind: "contract"; label: string; contractId: string };

export function GlobalRemindersBar() {
  const [data, setData] = useState<Payload | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [barHidden, setBarHidden] = useState(false);
  const [contractModalOpen, setContractModalOpen] = useState(false);
  const [contractModalId, setContractModalId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/reminders/upcoming?days=14");
      if (!res.ok) return;
      const json = (await res.json()) as Payload;
      const n =
        (json.events?.length ?? 0) +
        (json.tasks?.length ?? 0) +
        (json.contracts?.length ?? 0) +
        (json.licenses?.length ?? 0);
      setData(n > 0 ? json : null);
    } catch {
      setData(null);
    }
  }, []);

  useEffect(() => {
    try {
      setBarHidden(localStorage.getItem(STORAGE_HIDDEN) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, [load]);

  const hideBar = () => {
    setBarHidden(true);
    setExpanded(false);
    try {
      localStorage.setItem(STORAGE_HIDDEN, "1");
    } catch {
      /* ignore */
    }
  };

  const showBar = () => {
    setBarHidden(false);
    try {
      localStorage.removeItem(STORAGE_HIDDEN);
    } catch {
      /* ignore */
    }
  };

  if (!data) return null;

  const total =
    (data.events?.length ?? 0) +
    (data.tasks?.length ?? 0) +
    (data.contracts?.length ?? 0) +
    (data.licenses?.length ?? 0);

  const lines: ReminderLine[] = [];
  for (const e of data.events.slice(0, 4)) {
    lines.push({
      kind: "link",
      label: `Event: ${e.title}`,
      href: "/schedule",
    });
  }
  for (const t of data.tasks.slice(0, 4)) {
    lines.push({ kind: "link", label: `Task: ${t.title}`, href: "/tasks" });
  }
  for (const c of data.contracts.slice(0, 3)) {
    lines.push({
      kind: "contract",
      label: `Contract ends: ${c.customer?.name ?? "?"} → ${c.supplier?.name ?? "?"}`,
      contractId: c.id,
    });
  }
  for (const l of data.licenses.slice(0, 2)) {
    lines.push({
      kind: "link",
      label: `License ${l.licenseType} ${l.licenseNumber} expires`,
      href: "/schedule",
    });
  }

  const summary = lines.slice(0, 5);

  const contractModal = (
    <ScheduleContractModal
      contractId={contractModalId}
      open={contractModalOpen}
      onOpenChange={(o) => {
        setContractModalOpen(o);
        if (!o) setContractModalId(null);
      }}
    />
  );

  if (barHidden) {
    return (
      <>
        <button
          type="button"
          className={cn(
            "fixed top-2 right-2 z-[60] flex h-9 w-9 items-center justify-center rounded-full",
            "border border-amber-300 bg-amber-50 text-amber-950 shadow-md",
            "hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50 dark:hover:bg-amber-900"
          )}
          onClick={showBar}
          aria-label="Show reminders bar"
        >
          <Bell className="h-4 w-4" />
        </button>
        {contractModal}
      </>
    );
  }

  return (
    <>
      <div
        className="sticky top-0 z-50 border-b border-amber-200/80 bg-amber-50/95 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/85 dark:text-amber-50"
        role="region"
        aria-label="Upcoming reminders"
      >
        <div
          className={cn(
            "container flex items-center gap-2 px-3",
            expanded ? "py-1.5" : "py-0 min-h-8"
          )}
        >
          <Bell className="h-3.5 w-3.5 shrink-0 opacity-80" />
          <button
            type="button"
            className="min-w-0 flex-1 flex items-center gap-1.5 text-left text-xs leading-tight hover:opacity-90"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
          >
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 shrink-0 transition-transform",
                expanded && "rotate-180"
              )}
            />
            <span className="truncate">
              <span className="font-semibold">Reminders</span>
              <span className="text-amber-800/90 dark:text-amber-200/90 font-normal">
                {" "}
                · {total} in the next 14 days
              </span>
              {!expanded && summary[0] && (
                <span className="text-muted-foreground font-normal hidden sm:inline">
                  {" "}
                  — {summary[0].label}
                </span>
              )}
            </span>
          </button>
          <Link
            href="/schedule"
            className="text-[11px] text-primary hover:underline inline-flex items-center gap-0.5 shrink-0"
          >
            Schedule <ChevronRight className="h-3 w-3" />
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-label="Hide reminders bar"
            onClick={hideBar}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        {expanded && (
          <div className="container px-3 pb-2 pt-0 max-h-[40vh] overflow-y-auto border-t border-amber-200/50 dark:border-amber-900/40">
            <ul className="text-xs space-y-0.5 py-1">
              {summary.map((line, i) => (
                <li key={i} className="truncate">
                  {line.kind === "contract" ? (
                    <button
                      type="button"
                      className="max-w-full truncate text-left hover:underline text-amber-950 dark:text-amber-50"
                      onClick={() => {
                        setContractModalId(line.contractId);
                        setContractModalOpen(true);
                      }}
                    >
                      {line.label}
                    </button>
                  ) : (
                    <Link href={line.href} className="hover:underline">
                      {line.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {contractModal}
    </>
  );
}
