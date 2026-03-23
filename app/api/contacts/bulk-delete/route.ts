import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * DELETE /api/contacts/bulk-delete
 * Remove all contacts from local database only (does not affect Google Contacts)
 */
export async function DELETE() {
  try {
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
