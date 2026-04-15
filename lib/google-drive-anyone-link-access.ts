type GoogleDriveClient = Awaited<
  ReturnType<(typeof import("@/lib/gmail"))["getGoogleDriveClient"]>
>;

/** True if the file has an `anyone` permission with reader-or-better access (link sharing on). */
export function permissionsIndicateAnyoneLink(
  permissions: Array<{ type?: string | null; role?: string | null }> | undefined
): boolean {
  const perms = permissions || [];
  return perms.some(
    (p) =>
      p.type === "anyone" &&
      (p.role === "reader" ||
        p.role === "commenter" ||
        p.role === "writer" ||
        p.role === "fileOrganizer")
  );
}

export async function fileHasAnyoneLinkAccess(
  drive: GoogleDriveClient,
  fileId: string
): Promise<boolean> {
  const listed = await drive.permissions.list({
    fileId,
    supportsAllDrives: true,
    fields: "permissions(type,role)",
  });
  return permissionsIndicateAnyoneLink(listed.data.permissions);
}
