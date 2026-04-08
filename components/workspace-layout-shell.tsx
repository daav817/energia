"use client";

import { usePathname } from "next/navigation";

/**
 * Inbox needs an overflow-hidden ancestor so its split panes manage scroll.
 * Other workspace pages should scroll on this shell.
 */
export function WorkspaceLayoutShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const isInbox = pathname === "/inbox" || pathname.startsWith("/inbox/");

  return (
    <div
      className={
        isInbox
          ? "comms-inbox flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background px-4 py-4 text-foreground"
          : "comms-inbox flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain bg-background px-4 py-4 text-foreground"
      }
    >
      {children}
    </div>
  );
}
