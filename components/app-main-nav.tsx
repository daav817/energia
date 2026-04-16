"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  BROKER_PROFILE_STORAGE_KEY,
  BROKER_PROFILE_UPDATED_EVENT,
  EMPTY_BROKER_PROFILE,
  loadBrokerProfile,
  type BrokerProfile,
} from "@/lib/broker-profile";
import { BrokerOverviewModal } from "@/components/broker-overview-modal";

const MAIN_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/inbox", label: "Emails" },
  { href: "/drive", label: "Drive" },
  { href: "/contacts", label: "Contacts" },
  { href: "/schedule", label: "Calendar" },
  { href: "/tasks", label: "Tasks" },
  /** Insert `Contracts` flyout before this entry in the nav markup. */
  { href: "/rfp", label: "RFP Generator" },
  { href: "/quotes", label: "Quotes" },
  { href: "/news", label: "News" },
] as const;

const CONTRACTS_SUBLINKS = [
  { href: "/directory/contracts", label: "Management" },
  { href: "/directory/contracts/workflow", label: "Workflow" },
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
              const contractsFlyout =
                href === "/rfp" ? (
                  <div key="contracts-flyout" className="relative group">
                    <span
                      className={cn(
                        LINK_CLASS,
                        "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors inline-block cursor-default select-none",
                        pathname.startsWith("/directory/contracts")
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      Contracts
                    </span>
                    <div
                      className={cn(
                        "pointer-events-none absolute left-0 top-full z-50 pt-1 opacity-0 transition-opacity",
                        "group-hover:opacity-100 group-hover:pointer-events-auto",
                        "group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
                      )}
                    >
                      <div className="min-w-[11rem] rounded-md border border-border/80 bg-popover py-1 shadow-md">
                        {CONTRACTS_SUBLINKS.map(({ href: subHref, label: subLabel }) => {
                          const subActive =
                            pathname === subHref || pathname.startsWith(subHref + "/");
                          return (
                            <Link
                              key={subHref}
                              href={subHref}
                              className={cn(
                                LINK_CLASS,
                                "block px-3 py-2 text-sm transition-colors",
                                subActive
                                  ? "bg-primary/15 text-foreground font-medium"
                                  : "text-popover-foreground hover:bg-muted"
                              )}
                            >
                              {subLabel}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : null;

              const active =
                href === "/dashboard"
                  ? pathname === "/dashboard" || pathname === "/"
                  : pathname === href || pathname.startsWith(href + "/");
              return (
                <Fragment key={href}>
                  {contractsFlyout}
                  <Link
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
                </Fragment>
              );
            })}
          </div>
        </div>
      </nav>
      <BrokerOverviewModal open={overviewOpen} onOpenChange={setOverviewOpen} profile={brokerProfile} />
    </>
  );
}
