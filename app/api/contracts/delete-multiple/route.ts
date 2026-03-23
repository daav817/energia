import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/contracts/delete-multiple
 * Delete multiple contracts by ID.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ids } = body as { ids: string[] };

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: "ids array is required" },
        { status: 400 }
      );
    }

    await prisma.contract.deleteMany({
      where: { id: { in: ids } },
    });

    return NextResponse.json({ success: true, deleted: ids.length });
  } catch (error) {
    console.error("Contract delete-multiple error:", error);
    return NextResponse.json(
      { error: "Failed to delete contracts" },
      { status: 500 }
    );
  }
}
