"use client";

import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { GlobalRemindersBar } from "@/components/global-reminders-bar";
import { AppMainNav } from "@/components/app-main-nav";

function ShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const embed =
    pathname.startsWith("/inbox/email/") &&
    (searchParams.get("embed") === "1" || searchParams.get("embed") === "true");

  if (embed) {
    return (
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background text-foreground">
        {children}
      </main>
    );
  }

  return (
    <>
      <GlobalRemindersBar />
      <AppMainNav />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">{children}</main>
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">{children}</main>
      }
    >
      <ShellInner>{children}</ShellInner>
    </Suspense>
  );
}
