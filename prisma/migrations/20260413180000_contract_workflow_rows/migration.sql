-- Contract workflow tracking for broker renewal / new-business pipeline
CREATE TABLE "contract_workflow_rows" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT,
    "customer_id" TEXT,
    "energy_type" TEXT,
    "display_label" TEXT,
    "workflow_archived" BOOLEAN NOT NULL DEFAULT false,
    "workflow_archived_at" TIMESTAMP(3),
    "received_bills_at" TIMESTAMP(3),
    "rfp_quote_closed_at" TIMESTAMP(3),
    "new_contract_amended_at" TIMESTAMP(3),
    "linked_rfp_request_id" TEXT,
    "contract_outcome" TEXT NOT NULL DEFAULT '',
    "last_workflow_refresh_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_workflow_rows_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contract_workflow_rows_contract_id_key" ON "contract_workflow_rows"("contract_id");
CREATE UNIQUE INDEX "contract_workflow_rows_linked_rfp_request_id_key" ON "contract_workflow_rows"("linked_rfp_request_id");
CREATE INDEX "contract_workflow_rows_workflow_archived_idx" ON "contract_workflow_rows"("workflow_archived");

ALTER TABLE "contract_workflow_rows" ADD CONSTRAINT "contract_workflow_rows_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contract_workflow_rows" ADD CONSTRAINT "contract_workflow_rows_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contract_workflow_rows" ADD CONSTRAINT "contract_workflow_rows_linked_rfp_request_id_fkey" FOREIGN KEY ("linked_rfp_request_id") REFERENCES "rfp_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
