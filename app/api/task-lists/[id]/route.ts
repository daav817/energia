import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TaskStatus } from "@/generated/prisma/client";

const includeCount = {
  _count: {
    select: {
      tasks: { where: { status: { not: TaskStatus.COMPLETED } } },
    },
  },
} as const;

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const name = body.name != null ? String(body.name).trim() : undefined;
    const data: { name?: string } = {};
    if (name !== undefined) {
      if (!name) {
        return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
      }
      data.name = name;
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No updates" }, { status: 400 });
    }
    const list = await prisma.taskList.update({
      where: { id },
      data,
      include: includeCount,
    });
    return NextResponse.json(list);
  } catch (error) {
    console.error("Task list update error:", error);
    return NextResponse.json(
      { error: "Failed to update task list" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    await prisma.task.deleteMany({ where: { taskListId: id } });
    await prisma.taskList.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Task list delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete task list" },
      { status: 500 }
    );
  }
}
