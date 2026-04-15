import { getGoogleDriveClient } from "@/lib/gmail";

/**
 * Ensures a Drive file can be opened by anyone who has the link (viewer).
 * Used when attaching bill/summary links to supplier-facing RFP emails.
 *
 * Idempotent: if an `anyone` permission already exists with reader-or-better access, succeeds.
 */
export async function ensureAnyoneWithLinkCanViewFile(fileId: string): Promise<void> {
  const drive = await getGoogleDriveClient();

  try {
    await drive.permissions.create({
      fileId,
      supportsAllDrives: true,
      requestBody: {
        type: "anyone",
        role: "reader",
        allowFileDiscovery: false,
      },
    });
    return;
  } catch (first: unknown) {
    let listed: { data: { permissions?: Array<{ type?: string | null; role?: string | null }> } };
    try {
      listed = await drive.permissions.list({
        fileId,
        supportsAllDrives: true,
        fields: "permissions(type,role)",
      });
    } catch {
      throw first instanceof Error ? first : new Error(String(first));
    }

    const perms = listed.data.permissions || [];
    const hasLinkAccess = perms.some(
      (p: { type?: string | null; role?: string | null }) =>
        p.type === "anyone" &&
        (p.role === "reader" || p.role === "commenter" || p.role === "writer" || p.role === "fileOrganizer")
    );
    if (hasLinkAccess) return;

    const hint =
      " If your Google Workspace blocks “anyone with the link,” an admin must allow link sharing, or share the file manually in Drive.";
    if (first instanceof Error) {
      throw new Error(first.message + hint);
    }
    throw new Error("Google Drive did not allow link sharing for this file." + hint);
  }
}
