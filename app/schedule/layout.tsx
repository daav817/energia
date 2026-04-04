import { Suspense } from "react";

export default function ScheduleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      <Suspense fallback={<div className="py-16 text-center text-muted-foreground">Loading…</div>}>
        {children}
      </Suspense>
    </div>
  );
}
