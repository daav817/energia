-- AlterTable
ALTER TABLE "rfp_requests" ADD COLUMN IF NOT EXISTS "quote_summary_contact_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
