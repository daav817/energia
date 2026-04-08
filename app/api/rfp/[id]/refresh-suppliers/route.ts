import { NextRequest, NextResponse } from "next/server";
import { resendStoredRfpSupplierEmails } from "@/app/api/rfp/send/route";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await resendStoredRfpSupplierEmails(id);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("RFP supplier refresh:", err);
    const message = err instanceof Error ? err.message : "Failed to refresh supplier emails";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
