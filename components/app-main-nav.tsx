"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

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

export function AppMainNav() {
  const pathname = usePathname();

  return (
    <nav
      className="shrink-0 z-40 border-b border-border/60 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80"
      aria-label="Main"
    >
      <div className="container flex flex-wrap items-center gap-x-1 gap-y-1 px-3 py-2">
        <Link
          href="/dashboard"
          className="mr-2 shrink-0 text-sm font-semibold text-primary hover:opacity-90"
        >
          Energia Power
        </Link>
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
    </nav>
  );
}
