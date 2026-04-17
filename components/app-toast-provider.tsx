"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type ToastVariant = "success" | "error" | "default" | "info";

type ToastItem = {
  id: number;
  message: string;
  variant: ToastVariant;
};

export type PushAppToast = (opts: { message: string; variant?: ToastVariant }) => void;

const ToastContext = createContext<PushAppToast | null>(null);

export function useAppToast(): PushAppToast {
  const fn = useContext(ToastContext);
  return useMemo(() => fn ?? (() => {}), [fn]);
}

export function AppToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const push = useCallback<PushAppToast>((opts) => {
    const id = ++idRef.current;
    const variant = opts.variant ?? "default";
    setItems((s) => [...s, { id, message: opts.message, variant }]);
    const ms = variant === "error" ? 6500 : variant === "info" ? 9000 : 4200;
    window.setTimeout(() => {
      setItems((s) => s.filter((t) => t.id !== id));
    }, ms);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[520] flex w-[min(100vw-2rem,420px)] flex-col gap-2"
        aria-live="polite"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto rounded-md border px-4 py-3 text-sm shadow-lg",
              t.variant === "success" &&
                "border-emerald-500/35 bg-emerald-50 text-emerald-950 dark:border-emerald-500/40 dark:bg-emerald-950/90 dark:text-emerald-50",
              t.variant === "error" &&
                "border-destructive/45 bg-destructive/15 text-destructive dark:bg-destructive/25 dark:text-destructive-foreground",
              t.variant === "default" && "border-border bg-card text-card-foreground",
              t.variant === "info" &&
                "border-sky-500/40 bg-sky-50 text-sky-950 shadow-md dark:border-sky-400/45 dark:bg-sky-950/90 dark:text-sky-50"
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
