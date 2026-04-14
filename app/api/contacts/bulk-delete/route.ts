import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enqueueGoogleContactDeletion } from "@/lib/google-contact-deletion-queue";

/**
 * DELETE /api/contacts/bulk-delete
 * Remove all contacts from the local database. Contacts linked to Google are queued for removal from Google on the next sync.
 */
export async function DELETE() {
  try {
    const linked = await prisma.contact.findMany({
      where: { googleResourceName: { not: null } },
      select: { googleResourceName: true },
    });
    for (const row of linked) {
      await enqueueGoogleContactDeletion(row.googleResourceName);
    }
    const result = await prisma.contact.deleteMany({});
    return NextResponse.json({ deleted: result.count });
  } catch (error) {
    console.error("Bulk delete contacts error:", error);
    return NextResponse.json(
      { error: "Failed to delete contacts" },
      { status: 500 }
    );
  }
}
