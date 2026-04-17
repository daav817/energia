"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { rememberWorkspacePathForEmailTemplates } from "@/lib/email-templates-return";
import { GlobalRemindersBar } from "@/components/global-reminders-bar";
import { AppMainNav } from "@/components/app-main-nav";
import { AppToastProvider } from "@/components/app-toast-provider";
import { UnsavedNavigationProvider } from "@/components/unsaved-navigation-guard";
import { WorkspaceDocumentTitle } from "@/components/workspace-document-title";

/** Keeps sessionStorage in sync so closing Email templates can return to the prior page. */
function RememberWorkspacePathForEmailTemplates() {
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  useEffect(() => {
    const qs = searchParams.toString();
    const full = `${pathname}${qs ? `?${qs}` : ""}`;
    rememberWorkspacePathForEmailTemplates(full);
  }, [pathname, searchParams]);
  return null;
}

function ShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const embed =
    pathname.startsWith("/inbox/email/") &&
    (searchParams.get("embed") === "1" || searchParams.get("embed") === "true");

  if (embed) {
    return (
      <AppToastProvider>
        <RememberWorkspacePathForEmailTemplates />
        <WorkspaceDocumentTitle pathname={pathname ?? ""} />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background text-foreground">
          {children}
        </main>
      </AppToastProvider>
    );
  }

  const inboxListLayout = pathname === "/inbox";

  return (
    <AppToastProvider>
    <UnsavedNavigationProvider>
      <RememberWorkspacePathForEmailTemplates />
      <WorkspaceDocumentTitle pathname={pathname ?? ""} />
      {/* Single flex column so main reliably gets a bounded height (flex-1 min-h-0) for nested scroll panes. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <GlobalRemindersBar />
        <AppMainNav />
        <main
          className={
            inboxListLayout
              ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
              : "flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto"
          }
        >
          {children}
        </main>
      </div>
    </UnsavedNavigationProvider>
    </AppToastProvider>
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
