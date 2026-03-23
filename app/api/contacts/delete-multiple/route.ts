import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/contacts/delete-multiple
 * Delete selected contacts by ID. Body: { ids: string[] }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const ids = Array.isArray(body.ids) ? body.ids.filter((id: unknown) => typeof id === "string") : [];
    if (ids.length === 0) {
      return NextResponse.json({ deleted: 0 });
    }
    const result = await prisma.contact.deleteMany({
      where: { id: { in: ids } },
    });
    return NextResponse.json({ deleted: result.count });
  } catch (error) {
    console.error("Delete multiple contacts error:", error);
    return NextResponse.json(
      { error: "Failed to delete contacts" },
      { status: 500 }
    );
  }
}
