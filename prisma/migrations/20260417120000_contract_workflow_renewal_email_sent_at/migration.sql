-- Per–workflow-row renewal email completion (avoids showing one contract’s reminder on another row for the same customer).

ALTER TABLE "contract_workflow_rows" ADD COLUMN "renewal_reminder_email_sent_at" TIMESTAMP(3);

UPDATE "contract_workflow_rows" AS w
SET "renewal_reminder_email_sent_at" = c."renewal_reminder_sent_at"
FROM "contracts" AS c
WHERE w."contract_id" = c."id"
  AND c."renewal_reminder_sent_at" IS NOT NULL
  AND w."renewal_reminder_email_sent_at" IS NULL;
