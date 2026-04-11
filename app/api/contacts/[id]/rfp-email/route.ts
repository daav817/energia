import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { setRfpEmailPreferenceInLabel } from "@/lib/contact-labels";

/**
 * PATCH /api/contacts/[id]/rfp-email
 * Merges `rfp:<email>` on Contact.label (does not use full contact PATCH — avoids directory link side effects).
 * Body: { email: string, preferForRfp: boolean }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const email = typeof body.email === "string" ? body.email : "";
    const preferForRfp = !!body.preferForRfp;
    if (!email.trim()) {
      return NextResponse.json({ error: "email is required" }, { status: 400 });
    }
    const existing = await prisma.contact.findUnique({
      where: { id },
      select: { label: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }
    const label = setRfpEmailPreferenceInLabel(existing.label, email, preferForRfp);
    const contact = await prisma.contact.update({
      where: { id },
      data: { label: label.trim() ? label : null },
      select: { id: true, label: true },
    });
    return NextResponse.json(contact);
  } catch (error) {
    console.error("RFP email preference error:", error);
    return NextResponse.json({ error: "Failed to update RFP email preference" }, { status: 500 });
  }
}
