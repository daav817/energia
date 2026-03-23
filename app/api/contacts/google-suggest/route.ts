import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getOAuth2Client, loadTokens } from "@/lib/gmail";

/**
 * GET /api/contacts/google-suggest?q=...
 * Returns email suggestions from Google Contacts (People API)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") || "").trim().toLowerCase();
    const limit = Math.min(parseInt(searchParams.get("limit") || "10", 10), 20);

    if (!q || q.length < 2) {
      return NextResponse.json([]);
    }

    const tokens = loadTokens();
    if (!tokens?.refresh_token) {
      return NextResponse.json([]);
    }

    const oauth2 = getOAuth2Client();
    oauth2.setCredentials({
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      expiry_date: tokens.expiry_date,
    });

    const people = google.people({ version: "v1", auth: oauth2 });
    const res = await people.people.connections.list({
      resourceName: "people/me",
      pageSize: 100,
      personFields: "names,emailAddresses",
    });

    const connections = res.data.connections || [];
    const results: { name: string; email: string; source: string }[] = [];

    for (const p of connections) {
      const name = p.names?.[0]?.displayName || p.names?.[0]?.givenName || "";
      const email = p.emailAddresses?.[0]?.value;
      if (!email) continue;
      if (
        name.toLowerCase().includes(q) ||
        email.toLowerCase().includes(q)
      ) {
        results.push({ name: name || email, email, source: "Google" });
        if (results.length >= limit) break;
      }
    }

    return NextResponse.json(results);
  } catch {
    return NextResponse.json([]);
  }
}
