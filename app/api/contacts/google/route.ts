import { NextResponse } from "next/server";
import { google } from "googleapis";
import { getOAuth2Client, loadTokens } from "@/lib/gmail";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/contacts/google
 * Fetch contacts from Google People API
 */
export async function GET() {
  try {
    const tokens = loadTokens();
    if (!tokens?.refresh_token) {
      return NextResponse.json(
        { error: "Gmail not connected. Complete OAuth flow first." },
        { status: 401 }
      );
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
      pageSize: 500,
      personFields: "names,emailAddresses,phoneNumbers,organizations",
    });

    const connections = res.data.connections || [];
    const contacts = connections
      .map((p) => {
        const name = p.names?.[0]?.displayName || p.names?.[0]?.givenName || "Unknown";
        const email = p.emailAddresses?.[0]?.value;
        const phone = p.phoneNumbers?.[0]?.value;
        const company = p.organizations?.[0]?.name;
        return { name, email, phone, company, resourceName: p.resourceName };
      })
      .filter((c) => c.email || c.name);

    return NextResponse.json(contacts);
  } catch (err) {
    console.error("Google contacts fetch error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch Google contacts" },
      { status: 500 }
    );
  }
}
