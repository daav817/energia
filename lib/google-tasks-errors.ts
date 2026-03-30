/**
 * Maps Google API / Gaxios errors from Tasks to actionable user-facing text.
 */

type GaxiosLike = {
  message?: string;
  response?: {
    status?: number;
    data?: {
      error?: {
        message?: string;
        errors?: Array<{ reason?: string; message?: string }>;
      };
    };
  };
};

export function formatGoogleTasksError(err: unknown): string {
  const g = err as GaxiosLike;
  const status = g.response?.status;
  const apiMsg =
    g.response?.data?.error?.message ||
    g.response?.data?.error?.errors?.[0]?.message ||
    (err instanceof Error ? err.message : null) ||
    String(err);

  const lower = apiMsg.toLowerCase();
  const insufficient =
    status === 403 ||
    lower.includes("insufficient") ||
    lower.includes("access not configured") ||
    g.response?.data?.error?.errors?.some(
      (e) => e.reason === "insufficientPermissions" || e.reason === "forbidden"
    );

  if (insufficient) {
    return (
      "Insufficient permission for Google Tasks. " +
      "In Google Cloud Console, enable the Google Tasks API for this project. " +
      "Then reconnect Google from Communications (complete OAuth again) so the token includes the Tasks scope."
    );
  }

  return apiMsg || "Google Tasks request failed.";
}
