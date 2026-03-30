/**
 * Google Calendar API using the same OAuth tokens as Gmail (data/gmail-tokens.json).
 * Requires `calendar.events` scope — reconnect Google from Communications if sync returns 403.
 */

import { google } from "googleapis";
import { loadTokens, saveTokens, getOAuth2Client } from "@/lib/gmail";

export async function getCalendarAuthorizedClient() {
  const tokens = loadTokens();
  if (!tokens?.refresh_token) {
    throw new Error(
      "Google not connected. Open Communications and connect your Google account first."
    );
  }

  const oauth2 = getOAuth2Client();
  oauth2.setCredentials({
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    expiry_date: tokens.expiry_date,
  });

  const { token } = await oauth2.getAccessToken();
  if (token) {
    const creds = oauth2.credentials;
    saveTokens({
      refresh_token: tokens.refresh_token,
      access_token: creds.access_token || undefined,
      expiry_date: creds.expiry_date ?? undefined,
    });
  }

  return google.calendar({ version: "v3", auth: oauth2 });
}
