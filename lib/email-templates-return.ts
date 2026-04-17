/**
 * Validates a path to navigate to after closing the email templates editor.
 * Only same-app relative URLs; blocks open redirects and the editor route itself.
 */
export function isSafeEmailTemplatesReturnPath(path: string): boolean {
  if (!path || path.length > 2048) return false;
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  if (path.includes("://")) return false;
  if (/[\x00-\x1f\x7f]/.test(path)) return false;
  const pathOnly = path.split("?")[0];
  if (pathOnly === "/email-templates") return false;
  return true;
}

/** Decode a single `returnTo` query value from `/email-templates?returnTo=...`. */
export function parseReturnToFromSearchParam(raw: string | null): string | null {
  if (raw == null || raw === "") return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return isSafeEmailTemplatesReturnPath(decoded) ? decoded : null;
}

/** sessionStorage key: last path+query visited before `/email-templates` (same tab). */
export const EMAIL_TEMPLATES_RETURN_STORAGE_KEY = "energia-email-templates-return-to";

/**
 * Remember the current URL so closing the email-templates modal can restore it when `returnTo` is missing.
 * Skips the email-templates route itself so the previous page stays recorded.
 */
export function rememberWorkspacePathForEmailTemplates(fullPath: string): void {
  if (typeof window === "undefined") return;
  if (!fullPath || !fullPath.startsWith("/")) return;
  const pathOnly = fullPath.split("?")[0];
  if (pathOnly === "/email-templates") return;
  if (!isSafeEmailTemplatesReturnPath(fullPath)) return;
  try {
    sessionStorage.setItem(EMAIL_TEMPLATES_RETURN_STORAGE_KEY, fullPath);
  } catch {
    /* private mode / blocked */
  }
}

/** Safe path to return to after closing email templates, if any was stored. */
export function readStoredEmailTemplatesReturnPath(): string | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(EMAIL_TEMPLATES_RETURN_STORAGE_KEY);
  } catch {
    return null;
  }
  return raw && isSafeEmailTemplatesReturnPath(raw) ? raw : null;
}
