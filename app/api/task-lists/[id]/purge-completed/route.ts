import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TaskStatus } from "@/generated/prisma/client";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const result = await prisma.task.deleteMany({
      where: {
        taskListId: id,
        status: TaskStatus.COMPLETED,
      },
    });
    return NextResponse.json({ deleted: result.count });
  } catch (error) {
    console.error("Purge completed error:", error);
    return NextResponse.json(
      { error: "Failed to purge completed tasks" },
      { status: 500 }
    );
  }
}
