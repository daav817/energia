"use client";

import { ContractWorkflowPanel } from "@/components/contract-workflow/contract-workflow-panel";

export default function ContractWorkflowPage() {
  return (
    <div className="container max-w-[1600px] py-6 px-4 flex flex-col min-h-[calc(100vh-4rem)]">
      <ContractWorkflowPanel title="Contract Workflow" />
    </div>
  );
}
