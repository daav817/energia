import { NextRequest, NextResponse } from "next/server";
import { getOAuth2Client, saveTokens } from "@/lib/gmail";

/**
 * GET /api/gmail/callback
 * Handles OAuth callback, exchanges code for tokens
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001";

  if (error) {
    return NextResponse.redirect(
      `${baseUrl}/communications?error=${encodeURIComponent(error)}`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${baseUrl}/communications?error=no_code`
    );
  }

  try {
    const oauth2 = getOAuth2Client();
    const { tokens } = await oauth2.getToken(code);

    if (!tokens.refresh_token) {
      return NextResponse.redirect(
        `${baseUrl}/communications?error=no_refresh_token`
      );
    }

    saveTokens({
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token || undefined,
      expiry_date: tokens.expiry_date ?? undefined,
    });

    return NextResponse.redirect(`${baseUrl}/communications?connected=1`);
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    return NextResponse.redirect(
      `${baseUrl}/communications?error=callback_failed`
    );
  }
}
