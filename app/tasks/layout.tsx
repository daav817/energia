import Link from "next/link";
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  Building2,
  FileText,
  Mail,
  ListTodo,
} from "lucide-react";

export default function TasksLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-[#f8f9fa] text-[#202124]">
      <header className="sticky top-0 z-40 shrink-0 border-b border-[#dadce0] bg-white/95 backdrop-blur">
        <div className="flex h-14 items-center gap-6 px-4 w-full">
          <Link href="/" className="flex items-center gap-2 font-semibold text-[#1a73e8] shrink-0">
            <LayoutDashboard className="h-6 w-6" />
            Energia
          </Link>
          <nav className="flex flex-wrap gap-4 text-sm font-medium text-[#5f6368]">
            <Link href="/tasks" className="flex items-center gap-2 text-[#202124]">
              <ListTodo className="h-4 w-4" />
              Tasks
            </Link>
            <Link href="/schedule" className="flex items-center gap-2 hover:text-[#202124]">
              <CalendarDays className="h-4 w-4" />
              Schedule
            </Link>
            <Link href="/directory/customers" className="flex items-center gap-2 hover:text-[#202124]">
              <Users className="h-4 w-4" />
              Customers
            </Link>
            <Link href="/directory/contracts" className="flex items-center gap-2 hover:text-[#202124]">
              <FileText className="h-4 w-4" />
              Contracts
            </Link>
            <Link href="/communications" className="flex items-center gap-2 hover:text-[#202124]">
              <Mail className="h-4 w-4" />
              Mail
            </Link>
            <Link href="/directory/suppliers" className="flex items-center gap-2 hover:text-[#202124]">
              <Building2 className="h-4 w-4" />
              Suppliers
            </Link>
          </nav>
        </div>
      </header>
      <div className="flex flex-1 min-h-0 w-full flex-col">{children}</div>
    </div>
  );
}
