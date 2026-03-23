import { NextRequest, NextResponse } from "next/server";
import { getAuthUrl } from "@/lib/gmail";

/**
 * GET /api/gmail/connect
 * Redirects to Google OAuth consent screen
 * Query param: email - hint which Google account to use (e.g. ?email=you@gmail.com)
 */
export async function GET(request: NextRequest) {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return NextResponse.json(
        { error: "GOOGLE_CLIENT_ID not configured. Add it to .env" },
        { status: 500 }
      );
    }
    const email = request.nextUrl.searchParams.get("email");
    const authUrl = getAuthUrl(email || undefined);
    return NextResponse.redirect(authUrl);
  } catch (err) {
    console.error("Google auth error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Auth failed" },
      { status: 500 }
    );
  }
}
