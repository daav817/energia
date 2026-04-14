-- Optional phone extension per contact phone row
ALTER TABLE "contact_phones" ADD COLUMN IF NOT EXISTS "extension" TEXT;

-- Tasks: optional link to Contact and Contract
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "contact_id" TEXT;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "contract_id" TEXT;

CREATE INDEX IF NOT EXISTS "tasks_contact_id_idx" ON "tasks"("contact_id");
CREATE INDEX IF NOT EXISTS "tasks_contract_id_idx" ON "tasks"("contract_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_contact_id_fkey'
  ) THEN
    ALTER TABLE "tasks"
      ADD CONSTRAINT "tasks_contact_id_fkey"
      FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_contract_id_fkey'
  ) THEN
    ALTER TABLE "tasks"
      ADD CONSTRAINT "tasks_contract_id_fkey"
      FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
