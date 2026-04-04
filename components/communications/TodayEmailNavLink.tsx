"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Mail } from "lucide-react";

export function TodayEmailNavLink() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/emails/status")
      .then((r) => r.json())
      .then((data) => {
        if (!data.connected || cancelled) return;
        const today = new Date();
        const q = `after:${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}`;
        return fetch("/api/emails?maxResults=100&q=" + encodeURIComponent(q));
      })
      .then((r) => (r ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const messages = data.messages ?? [];
        setCount(messages.length);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const tooltipDate = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <Link
      href="/mail"
      prefetch={true}
      className="flex gap-2 items-center text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      title={tooltipDate}
    >
      <Mail className="h-4 w-4" />
      Today&apos;s Email{count !== null ? ` (${count})` : ""}
    </Link>
  );
}
