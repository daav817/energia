"use client";

import { useSearchParams } from "next/navigation";
import { ComposeEmailForm } from "@/components/communications/compose-email-form";

export default function ComposePage() {
  const searchParams = useSearchParams();
  const replyId = searchParams.get("reply");
  const forwardId = searchParams.get("forward");
  const toParam = searchParams.get("to");

  return (
    <ComposeEmailForm
      layout="page"
      replyId={replyId}
      forwardId={forwardId}
      initialTo={toParam}
      navigateToInboxAfterSend
    />
  );
}
