import { getGoogleDriveClient } from "@/lib/gmail";

/** Removes all `anyone`-type permissions so the file is no longer open to "anyone with the link". */
export async function removeAnyoneLinkSharing(fileId: string): Promise<void> {
  const drive = await getGoogleDriveClient();
  const listed = await drive.permissions.list({
    fileId,
    supportsAllDrives: true,
    fields: "permissions(id,type)",
  });
  const anyoneIds =
    listed.data.permissions
      ?.filter((p) => p.type === "anyone" && p.id)
      .map((p) => p.id as string) ?? [];
  for (const permissionId of anyoneIds) {
    await drive.permissions.delete({
      fileId,
      permissionId,
      supportsAllDrives: true,
    });
  }
}
