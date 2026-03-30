/**
 * Google Tasks API using the same OAuth tokens as Gmail (data/gmail-tokens.json).
 * Requires `tasks` scope — reconnect Gmail/Google if import fails with 403.
 */

import { google } from "googleapis";
import { loadTokens, saveTokens, getOAuth2Client } from "@/lib/gmail";

export async function getTasksAuthorizedClient() {
  const tokens = loadTokens();
  if (!tokens?.refresh_token) {
    throw new Error("Google not connected. Connect Gmail / Google from Communications first.");
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

  return google.tasks({ version: "v1", auth: oauth2 });
}
