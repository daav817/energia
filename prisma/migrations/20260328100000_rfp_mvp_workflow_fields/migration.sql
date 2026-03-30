-- DTH for gas quotes on some utility statements (schema already referenced DTH in app code)
DO $$ BEGIN
  ALTER TYPE "PriceUnit" ADD VALUE 'DTH';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "rfp_requests" ADD COLUMN "google_drive_folder_url" TEXT;
ALTER TABLE "rfp_requests" ADD COLUMN "summary_spreadsheet_url" TEXT;
ALTER TABLE "rfp_requests" ADD COLUMN "quote_due_date" DATE;
ALTER TABLE "rfp_requests" ADD COLUMN "contract_start_month" INTEGER;
ALTER TABLE "rfp_requests" ADD COLUMN "contract_start_year" INTEGER;
ALTER TABLE "rfp_requests" ADD COLUMN "broker_margin" DECIMAL(10,6);
ALTER TABLE "rfp_requests" ADD COLUMN "broker_margin_unit" "PriceUnit";
ALTER TABLE "rfp_requests" ADD COLUMN "ldc_utility" TEXT;
ALTER TABLE "rfp_requests" ADD COLUMN "requested_terms" JSONB;
ALTER TABLE "rfp_requests" ADD COLUMN "customer_contact_id" TEXT;

-- AddForeignKey
ALTER TABLE "rfp_requests" ADD CONSTRAINT "rfp_requests_customer_contact_id_fkey" FOREIGN KEY ("customer_contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "rfp_account_lines" (
    "id" TEXT NOT NULL,
    "rfp_request_id" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "service_address" TEXT,
    "annual_usage" DECIMAL(14,2) NOT NULL,
    "avg_monthly_usage" DECIMAL(14,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfp_account_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rfp_account_lines_rfp_request_id_idx" ON "rfp_account_lines"("rfp_request_id");

-- AddForeignKey
ALTER TABLE "rfp_account_lines" ADD CONSTRAINT "rfp_account_lines_rfp_request_id_fkey" FOREIGN KEY ("rfp_request_id") REFERENCES "rfp_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
