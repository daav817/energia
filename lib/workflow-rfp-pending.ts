export const WORKFLOW_RFP_PENDING_KEY = "energia-workflow-rfp-pending";

export type WorkflowRfpPendingPayload = {
  workflowRowId?: string;
  contractId?: string;
};

export function setWorkflowRfpPending(payload: WorkflowRfpPendingPayload) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(WORKFLOW_RFP_PENDING_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export function clearWorkflowRfpPending() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(WORKFLOW_RFP_PENDING_KEY);
  } catch {
    /* ignore */
  }
}

export function peekWorkflowRfpPending(): WorkflowRfpPendingPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(WORKFLOW_RFP_PENDING_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as WorkflowRfpPendingPayload;
    if (!j || typeof j !== "object") return null;
    return {
      workflowRowId: typeof j.workflowRowId === "string" ? j.workflowRowId : undefined,
      contractId: typeof j.contractId === "string" ? j.contractId : undefined,
    };
  } catch {
    return null;
  }
}

export async function linkPendingWorkflowRowToRfp(rfpRequestId: string): Promise<void> {
  const pending = peekWorkflowRfpPending();
  if (!pending?.workflowRowId && !pending?.contractId) return;
  try {
    await fetch("/api/contract-workflow/link-rfp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rfpRequestId,
        ...(pending.workflowRowId ? { workflowRowId: pending.workflowRowId } : {}),
        ...(pending.contractId ? { contractId: pending.contractId } : {}),
      }),
    });
  } catch {
    /* ignore */
  } finally {
    clearWorkflowRfpPending();
  }
}
