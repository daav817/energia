DO $$ BEGIN
  ALTER TYPE "CalendarEventType" ADD VALUE 'TASK';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE "task_lists" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "google_list_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_lists_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "tasks" ADD COLUMN "due_at" TIMESTAMP(3);
ALTER TABLE "tasks" ADD COLUMN "all_day" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tasks" ADD COLUMN "starred" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tasks" ADD COLUMN "repeat_rule" TEXT;
ALTER TABLE "tasks" ADD COLUMN "google_task_id" TEXT;
ALTER TABLE "tasks" ADD COLUMN "list_sort_order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tasks" ADD COLUMN "task_list_id" TEXT;

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_task_list_id_fkey" FOREIGN KEY ("task_list_id") REFERENCES "task_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "tasks_task_list_id_idx" ON "tasks"("task_list_id");
CREATE INDEX "tasks_due_date_idx" ON "tasks"("due_date");
CREATE INDEX "tasks_due_at_idx" ON "tasks"("due_at");
