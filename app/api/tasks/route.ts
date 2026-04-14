import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TaskStatus, TaskType } from "@/generated/prisma/client";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const listId = searchParams.get("listId") || undefined;
    const includeCompleted = searchParams.get("includeCompleted") === "true";

    const where: {
      taskListId?: string;
      status?: { not: TaskStatus } | TaskStatus;
    } = {};
    if (listId) where.taskListId = listId;
    if (!includeCompleted) {
      where.status = { not: TaskStatus.COMPLETED };
    }

    const tasks = await prisma.task.findMany({
      where,
      orderBy: [{ listSortOrder: "asc" }, { createdAt: "asc" }],
      include: {
        taskList: { select: { id: true, name: true } },
        contact: { select: { id: true, name: true, company: true } },
        linkedContract: {
          select: {
            id: true,
            energyType: true,
            customer: { select: { name: true, company: true } },
            supplier: { select: { name: true } },
          },
        },
      },
    });
    return NextResponse.json(tasks);
  } catch (error) {
    console.error("Tasks fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      taskListId,
      title,
      description,
      dueDate,
      dueAt,
      allDay,
      repeatRule,
      starred,
      listSortOrder,
      contactId,
      contractId,
    } = body;

    if (!taskListId || typeof taskListId !== "string") {
      return NextResponse.json({ error: "taskListId is required" }, { status: 400 });
    }
    if (!title || typeof title !== "string" || !title.trim()) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    const list = await prisma.taskList.findUnique({ where: { id: taskListId } });
    if (!list) {
      return NextResponse.json({ error: "Task list not found" }, { status: 400 });
    }

    let dueDateVal: Date | null = null;
    let dueAtVal: Date | null = null;
    const allDayB = Boolean(allDay);

    if (allDayB) {
      if (dueDate != null && dueDate !== "") {
        const raw = String(dueDate).slice(0, 10);
        const d = new Date(raw + "T12:00:00");
        if (Number.isNaN(d.getTime())) {
          return NextResponse.json({ error: "Invalid dueDate" }, { status: 400 });
        }
        dueDateVal = d;
      }
    } else if (dueAt != null && dueAt !== "") {
      dueAtVal = new Date(dueAt);
      if (Number.isNaN(dueAtVal.getTime())) {
        return NextResponse.json({ error: "Invalid dueAt" }, { status: 400 });
      }
    }

    const contactIdVal =
      contactId != null && String(contactId).trim() !== "" ? String(contactId).trim() : null;
    const contractIdVal =
      contractId != null && String(contractId).trim() !== "" ? String(contractId).trim() : null;

    const task = await prisma.task.create({
      data: {
        title: title.trim(),
        description:
          description != null && String(description).trim() !== ""
            ? String(description).trim()
            : null,
        taskListId,
        type: TaskType.TASK,
        status: TaskStatus.PENDING,
        dueDate: dueDateVal,
        dueAt: dueAtVal,
        allDay: allDayB,
        repeatRule:
          repeatRule != null && String(repeatRule).trim() !== ""
            ? String(repeatRule).trim()
            : null,
        starred: Boolean(starred),
        listSortOrder:
          listSortOrder != null ? Number(listSortOrder) : 0,
        contactId: contactIdVal,
        contractId: contractIdVal,
      },
      include: {
        taskList: { select: { id: true, name: true } },
        contact: { select: { id: true, name: true, company: true } },
        linkedContract: {
          select: {
            id: true,
            energyType: true,
            customer: { select: { name: true, company: true } },
            supplier: { select: { name: true } },
          },
        },
      },
    });

    return NextResponse.json(task);
  } catch (error) {
    console.error("Task create error:", error);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}
