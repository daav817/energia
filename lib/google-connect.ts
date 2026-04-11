/**
 * Browser-safe helpers for linking users to the Google OAuth flow (`/api/gmail/connect`).
 */

export function googleOAuthConnectUrl(loginHint?: string | null): string {
  const h = (loginHint ?? "").trim();
  return h ? `/api/gmail/connect?email=${encodeURIComponent(h)}` : "/api/gmail/connect";
}

/** Heuristic: error text where reconnecting Google may resolve the issue. */
export function isGoogleReconnectSuggestedMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("insufficient permission") ||
    m.includes("insufficient permissions") ||
    m.includes("google drive access") ||
    m.includes("failed to grant google drive") ||
    m.includes("gmail not connected") ||
    m.includes("google account not connected") ||
    m.includes("complete oauth") ||
    m.includes("oauth flow") ||
    m.includes("invalid_grant") ||
    m.includes("access denied")
  );
}
