import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TaskStatus } from "@/generated/prisma/client";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const orderedIds = body.orderedIds;
    if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== "string")) {
      return NextResponse.json({ error: "orderedIds must be a string array" }, { status: 400 });
    }
    await prisma.$transaction(
      orderedIds.map((id, index) =>
        prisma.taskList.update({
          where: { id },
          data: { sortOrder: index },
        })
      )
    );
    const lists = await prisma.taskList.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        _count: {
          select: {
            tasks: { where: { status: { not: TaskStatus.COMPLETED } } },
          },
        },
      },
    });
    return NextResponse.json(lists);
  } catch (error) {
    console.error("Task lists reorder error:", error);
    return NextResponse.json(
      { error: "Failed to reorder lists" },
      { status: 500 }
    );
  }
}
