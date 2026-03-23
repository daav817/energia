import Link from "next/link";
import { Send, FileText, LayoutDashboard, Table2, Inbox, Users } from "lucide-react";
import { TodayEmailNavLink } from "@/components/communications/TodayEmailNavLink";

const navLinks = [
  { href: "/communications/inbox", icon: Inbox, label: "Inbox", title: "Full inbox with folders, search, and filters" },
  { href: "/communications/contacts", icon: Users, label: "Contacts", title: "Manage contacts and import from Google" },
  { href: "/communications/compose", icon: Send, label: "Compose", title: undefined },
  { href: "/communications/rfp", icon: FileText, label: "RFP Generator", title: "Send Request for Pricing to matching suppliers" },
  { href: "/communications/quotes", icon: Table2, label: "Quotes", title: "Compare supplier quotes and build pricing" },
];

export default function CommunicationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background comms-inbox text-foreground">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="w-full flex h-14 items-center gap-6 px-4">
          <Link
            href="/"
            className="flex items-center gap-2 font-semibold text-primary"
          >
            <LayoutDashboard className="h-6 w-6" />
            Energia Power
          </Link>
          <nav className="flex gap-4 items-center">
            <TodayEmailNavLink />
            {navLinks.map(({ href, icon: Icon, label, title }) => (
              <Link
                key={href}
                href={href}
                prefetch={true}
                className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                title={title}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="w-full max-w-none py-6 px-4 min-h-[calc(100vh-3.5rem)]">{children}</main>
    </div>
  );
}
