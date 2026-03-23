import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const customerId = typeof body.customerId === "string" ? body.customerId : null;
    const supplierId = typeof body.supplierId === "string" ? body.supplierId : null;

    const contact = await prisma.contact.update({
      where: { id },
      data: {
        customerId,
        supplierId,
        // Helpful label hinting; user can still edit it later.
        label:
          typeof body.label === "string"
            ? body.label
            : undefined,
      },
    });

    return NextResponse.json({ success: true, contact });
  } catch (error) {
    console.error("Contact link error:", error);
    const message = error instanceof Error ? error.message : "Failed to link contact";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

