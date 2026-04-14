-- Queued Google People deletions (local contact deleted; sync removes from Google)
CREATE TABLE "google_contact_deletion_queue" (
    "id" TEXT NOT NULL,
    "google_resource_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "google_contact_deletion_queue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "google_contact_deletion_queue_google_resource_name_key" ON "google_contact_deletion_queue"("google_resource_name");
