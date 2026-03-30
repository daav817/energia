import { NextResponse } from "next/server";
import { loadTokens } from "@/lib/gmail";
import { getTasksAuthorizedClient } from "@/lib/google-tasks-api";

export async function GET() {
  try {
    if (!loadTokens()?.refresh_token) {
      return NextResponse.json({
        connected: false,
        message: "Google OAuth not configured or not connected.",
      });
    }
    const client = await getTasksAuthorizedClient();
    const res = await client.tasklists.list({ maxResults: 1 });
    return NextResponse.json({
      connected: true,
      listCount: res.data.items?.length ?? 0,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Tasks API error";
    return NextResponse.json(
      {
        connected: false,
        message: msg,
      },
      { status: 200 }
    );
  }
}
