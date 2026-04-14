-- Manual workflow step overrides (renewal N/A, RFP/quote sent flags)
ALTER TABLE "contract_workflow_rows" ADD COLUMN "renewal_reminder_not_applicable_at" TIMESTAMP(3);
ALTER TABLE "contract_workflow_rows" ADD COLUMN "rfp_sent_override_at" TIMESTAMP(3);
ALTER TABLE "contract_workflow_rows" ADD COLUMN "quote_summary_override_at" TIMESTAMP(3);
