-- AlterTable
ALTER TABLE "calendar_events" ADD COLUMN "google_event_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "calendar_events_google_event_id_key" ON "calendar_events"("google_event_id");
