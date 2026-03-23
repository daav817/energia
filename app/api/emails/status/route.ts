import { NextResponse } from "next/server";
import { isGmailConnected } from "@/lib/gmail";

/**
 * GET /api/emails/status
 * Check if Gmail is connected
 */
export async function GET() {
  return NextResponse.json({ connected: isGmailConnected() });
}
