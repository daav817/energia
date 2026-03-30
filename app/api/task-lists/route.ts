import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TaskStatus } from "@/generated/prisma/client";

export async function GET() {
  try {
    let lists = await prisma.taskList.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        _count: {
          select: {
            tasks: { where: { status: { not: TaskStatus.COMPLETED } } },
          },
        },
      },
    });
    if (lists.length === 0) {
      await prisma.taskList.create({
        data: { name: "My Tasks", sortOrder: 0 },
      });
      lists = await prisma.taskList.findMany({
        orderBy: { sortOrder: "asc" },
        include: {
          _count: {
            select: {
              tasks: { where: { status: { not: TaskStatus.COMPLETED } } },
            },
          },
        },
      });
    }
    return NextResponse.json(lists);
  } catch (error) {
    console.error("Task lists fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch task lists" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const name = body.name != null ? String(body.name).trim() : "";
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const maxSort = await prisma.taskList.aggregate({ _max: { sortOrder: true } });
    const sortOrder = (maxSort._max.sortOrder ?? -1) + 1;
    const list = await prisma.taskList.create({
      data: { name, sortOrder },
      include: {
        _count: {
          select: {
            tasks: { where: { status: { not: TaskStatus.COMPLETED } } },
          },
        },
      },
    });
    return NextResponse.json(list);
  } catch (error) {
    console.error("Task list create error:", error);
    return NextResponse.json(
      { error: "Failed to create task list" },
      { status: 500 }
    );
  }
}
