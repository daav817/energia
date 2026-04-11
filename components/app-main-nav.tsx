"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  BROKER_PROFILE_STORAGE_KEY,
  BROKER_PROFILE_UPDATED_EVENT,
  EMPTY_BROKER_PROFILE,
  loadBrokerProfile,
  type BrokerProfile,
} from "@/lib/broker-profile";
import { BrokerOverviewModal } from "@/components/broker-overview-modal";
import { AppNavAccountMenu } from "@/components/app-nav-account-menu";

const MAIN_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/inbox", label: "Emails" },
  { href: "/drive", label: "Drive" },
  { href: "/contacts", label: "Contacts" },
  { href: "/schedule", label: "Calendar" },
  { href: "/tasks", label: "Tasks" },
  { href: "/directory/contracts", label: "Contracts" },
  { href: "/rfp", label: "RFP Generator" },
  { href: "/quotes", label: "Quotes" },
  { href: "/news", label: "News" },
] as const;

const LINK_CLASS =
  "no-underline decoration-transparent underline-offset-0 visited:no-underline hover:no-underline focus-visible:no-underline";

export function AppMainNav() {
  const pathname = usePathname();
  /** Empty until `useEffect` — avoids SSR/client mismatch from `localStorage` on first paint. */
  const [brokerProfile, setBrokerProfile] = useState<BrokerProfile>(() => ({ ...EMPTY_BROKER_PROFILE }));
  const [overviewOpen, setOverviewOpen] = useState(false);

  const refreshBroker = useCallback(() => {
    setBrokerProfile(loadBrokerProfile());
  }, []);

  useEffect(() => {
    refreshBroker();
    const onStorage = (e: StorageEvent) => {
      if (e.key === BROKER_PROFILE_STORAGE_KEY) refreshBroker();
    };
    const onUpdated = () => refreshBroker();
    window.addEventListener("storage", onStorage);
    window.addEventListener(BROKER_PROFILE_UPDATED_EVENT, onUpdated);
    const onFocus = () => refreshBroker();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(BROKER_PROFILE_UPDATED_EVENT, onUpdated);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshBroker]);

  const brandLabel = brokerProfile.companyName?.trim() || "Energia Power";

  return (
    <>
      <nav
        className="shrink-0 z-40 min-h-0 border-b border-border/60 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80"
        aria-label="Main"
      >
        <div className="container flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-3 py-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1">
            <button
              type="button"
              onClick={() => setOverviewOpen(true)}
              className={cn(
                LINK_CLASS,
                "mr-2 shrink-0 rounded-md text-left text-sm font-semibold text-primary hover:opacity-90 px-1 -mx-1"
              )}
            >
              {brandLabel}
            </button>
            {MAIN_LINKS.map(({ href, label }) => {
              const active =
                href === "/dashboard"
                  ? pathname === "/dashboard" || pathname === "/"
                  : pathname === href || pathname.startsWith(href + "/");
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    LINK_CLASS,
                    "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {label}
                </Link>
              );
            })}
          </div>
          <AppNavAccountMenu />
        </div>
      </nav>
      <BrokerOverviewModal open={overviewOpen} onOpenChange={setOverviewOpen} profile={brokerProfile} />
    </>
  );
}
