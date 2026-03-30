/**
 * Gmail API client for Energia Power LLC
 * Uses OAuth2 with refresh token
 */

import { google } from "googleapis";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const TOKENS_PATH = join(process.cwd(), "data", "gmail-tokens.json");

export type GmailTokens = {
  refresh_token: string;
  access_token?: string;
  expiry_date?: number;
};

function getClientId(): string {
  return process.env.GOOGLE_CLIENT_ID || "";
}

function getClientSecret(): string {
  return process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_ID_SECRET || "";
}

export function getOAuth2Client() {
  return new google.auth.OAuth2(
    getClientId(),
    getClientSecret(),
    process.env.GOOGLE_REDIRECT_URI || "http://localhost:3001/api/gmail/callback"
  );
}

export function getAuthUrl(loginHint?: string): string {
  const oauth2 = getOAuth2Client();
  return oauth2.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.labels",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/contacts.readonly",
      "https://www.googleapis.com/auth/contacts",
      "https://www.googleapis.com/auth/tasks",
    ],
    prompt: "select_account consent",
    ...(loginHint && { login_hint: loginHint }),
  });
}

export function loadTokens(): GmailTokens | null {
  try {
    if (existsSync(TOKENS_PATH)) {
      const data = readFileSync(TOKENS_PATH, "utf-8");
      return JSON.parse(data) as GmailTokens;
    }
  } catch {
    // ignore
  }
  return null;
}

export function saveTokens(tokens: GmailTokens): void {
  const dir = join(process.cwd(), "data");
  if (!existsSync(dir)) {
    const fs = require("fs");
    fs.mkdirSync(dir, { recursive: true });
  }
  writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
}

export async function getGmailClient() {
  const tokens = loadTokens();
  if (!tokens?.refresh_token) {
    throw new Error("Gmail not connected. Complete OAuth flow first.");
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

  const gmail = google.gmail({ version: "v1", auth: oauth2 });
  return gmail;
}

export function isGmailConnected(): boolean {
  return !!loadTokens()?.refresh_token;
}
