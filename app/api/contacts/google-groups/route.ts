import { NextResponse } from "next/server";
import { google } from "googleapis";
import { getOAuth2Client, loadTokens } from "@/lib/gmail";

/**
 * GET /api/contacts/google-groups
 * Returns Google People "contact groups" as label suggestions.
 */
export async function GET() {
  try {
    const tokens = loadTokens();
    if (!tokens?.refresh_token) {
      return NextResponse.json({ error: "Gmail not connected. Complete OAuth flow first." }, { status: 401 });
    }

    const oauth2 = getOAuth2Client();
    oauth2.setCredentials({
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      expiry_date: tokens.expiry_date,
    });

    const people = google.people({ version: "v1", auth: oauth2 });

    const groups: { displayName: string; resourceName: string }[] = [];
    let pageToken: string | undefined;
    do {
      const res = await people.contactGroups.list({
        pageSize: 200,
        pageToken,
        groupFields: "name",
      });

      const contactGroups = res.data.contactGroups || [];
      for (const g of contactGroups) {
        // People API "groupFields" supports "name" (not "displayName").
        if (!g.resourceName || !g.name) continue;
        groups.push({ displayName: String(g.name), resourceName: String(g.resourceName) });
      }

      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    // Dedup by displayName.
    const seen = new Set<string>();
    const deduped = groups.filter((g) => {
      const key = g.displayName.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return NextResponse.json({ groups: deduped });
  } catch (err) {
    console.error("Google groups fetch error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch Google contact groups" },
      { status: 500 }
    );
  }
}

