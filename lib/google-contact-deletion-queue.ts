import { prisma } from "@/lib/prisma";

/** Queue a Google People resource for deletion on the next contacts sync (after local contact removed). */
export async function enqueueGoogleContactDeletion(googleResourceName: string | null | undefined): Promise<void> {
  const rn = (googleResourceName ?? "").trim();
  if (!rn || !rn.startsWith("people/")) return;
  await prisma.googleContactDeletionQueue.upsert({
    where: { googleResourceName: rn },
    create: { googleResourceName: rn },
    update: {},
  });
}
