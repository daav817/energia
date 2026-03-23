import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * PATCH /api/contacts/[id]/priority
 * Toggle isPriority (star) for a contact. Body: { isPriority: boolean }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const isPriority = !!body.isPriority;
    const contact = await prisma.contact.update({
      where: { id },
      data: { isPriority },
    });
    return NextResponse.json(contact);
  } catch (error) {
    console.error("Toggle priority error:", error);
    return NextResponse.json(
      { error: "Failed to update priority" },
      { status: 500 }
    );
  }
}
