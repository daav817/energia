import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { setPrimaryLabelToken } from "@/lib/contact-labels";

/**
 * PATCH /api/contacts/[id]/priority
 * Sets isPriority and merges the `primary` token on Contact.label (other tokens preserved).
 * Body: { isPriority: boolean }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const isPriority = !!body.isPriority;
    const existing = await prisma.contact.findUnique({
      where: { id },
      select: { label: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }
    const label = setPrimaryLabelToken(existing.label, isPriority);
    const contact = await prisma.contact.update({
      where: { id },
      data: { isPriority, label: label || null },
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
