import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DocumentType } from "@/generated/prisma/client";

/**
 * POST /api/documents
 * Create a document (e.g. link a signed contract to a contract record).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, type, googleDriveUrl, googleDriveId, contractId, customerId, supplierId } = body;

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const doc = await prisma.document.create({
      data: {
        name,
        type: (type || "CONTRACT") as DocumentType,
        googleDriveUrl: googleDriveUrl || null,
        googleDriveId: googleDriveId || null,
        contractId: contractId || null,
        customerId: customerId || null,
        supplierId: supplierId || null,
      },
    });
    return NextResponse.json(doc);
  } catch (error) {
    console.error("Document create error:", error);
    return NextResponse.json(
      { error: "Failed to create document" },
      { status: 500 }
    );
  }
}
