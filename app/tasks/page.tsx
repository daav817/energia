import { Suspense } from "react";
import { TasksApp } from "@/components/tasks/tasks-app";

export default function TasksPage() {
  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center p-8 text-[#5f6368]">Loading…</div>
        }
      >
        <TasksApp />
      </Suspense>
    </div>
  );
}
