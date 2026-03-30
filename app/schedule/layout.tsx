import { Suspense } from "react";
import Link from "next/link";
import {
  LayoutDashboard,
  Users,
  Building2,
  FileText,
  Mail,
  CalendarDays,
  ListTodo,
} from "lucide-react";

export default function ScheduleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="container flex h-14 items-center gap-6 px-4">
          <Link
            href="/"
            className="flex items-center gap-2 font-semibold text-primary"
          >
            <LayoutDashboard className="h-6 w-6" />
            Energia Power
          </Link>
          <nav className="flex flex-wrap gap-4">
            <Link
              href="/schedule"
              className="flex items-center gap-2 text-sm font-medium text-foreground"
            >
              <CalendarDays className="h-4 w-4" />
              Schedule
            </Link>
            <Link
              href="/tasks"
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ListTodo className="h-4 w-4" />
              Tasks
            </Link>
            <Link
              href="/directory/customers"
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Users className="h-4 w-4" />
              Customers
            </Link>
            <Link
              href="/directory/suppliers"
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Building2 className="h-4 w-4" />
              Suppliers
            </Link>
            <Link
              href="/directory/contracts"
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <FileText className="h-4 w-4" />
              Contracts
            </Link>
            <Link
              href="/communications"
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Mail className="h-4 w-4" />
              Communications
            </Link>
          </nav>
        </div>
      </header>
      <main className="container max-w-[100%] py-6 px-4">
        <Suspense fallback={<div className="py-16 text-center text-muted-foreground">Loading…</div>}>
          {children}
        </Suspense>
      </main>
    </div>
  );
}
