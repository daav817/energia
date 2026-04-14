import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma, TaskStatus } from "@/generated/prisma/client";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const task = await prisma.task.findUnique({
      where: { id },
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
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(task);
  } catch (error) {
    console.error("Task get error:", error);
    return NextResponse.json({ error: "Failed to load task" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const {
      title,
      description,
      dueDate,
      dueAt,
      allDay,
      repeatRule,
      starred,
      status,
      taskListId,
      listSortOrder,
      contactId,
      contractId,
    } = body;

    const data: Prisma.TaskUncheckedUpdateInput = {};

    if (title != null) {
      if (typeof title !== "string" || !title.trim()) {
        return NextResponse.json({ error: "title invalid" }, { status: 400 });
      }
      data.title = title.trim();
    }
    if (description !== undefined) {
      data.description =
        description != null && String(description).trim() !== ""
          ? String(description).trim()
          : null;
    }
    if (dueDate !== undefined) {
      if (dueDate === null || dueDate === "") data.dueDate = null;
      else {
        const d = new Date(String(dueDate) + "T12:00:00");
        if (Number.isNaN(d.getTime())) {
          return NextResponse.json({ error: "Invalid dueDate" }, { status: 400 });
        }
        data.dueDate = d;
      }
    }
    if (dueAt !== undefined) {
      if (dueAt === null || dueAt === "") data.dueAt = null;
      else {
        const d = new Date(dueAt);
        if (Number.isNaN(d.getTime())) {
          return NextResponse.json({ error: "Invalid dueAt" }, { status: 400 });
        }
        data.dueAt = d;
      }
    }
    if (allDay != null) data.allDay = Boolean(allDay);
    if (repeatRule !== undefined) {
      data.repeatRule =
        repeatRule != null && String(repeatRule).trim() !== ""
          ? String(repeatRule).trim()
          : null;
    }
    if (starred != null) data.starred = Boolean(starred);
    if (status != null) {
      const s = String(status).toUpperCase();
      if (!Object.values(TaskStatus).includes(s as TaskStatus)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }
      data.status = s as TaskStatus;
      if (data.status === TaskStatus.COMPLETED) {
        data.completedAt = new Date();
      } else if (data.status === TaskStatus.PENDING) {
        data.completedAt = null;
      }
    }
    if (taskListId !== undefined) {
      data.taskListId = taskListId === null || taskListId === "" ? null : taskListId;
    }
    if (listSortOrder != null) data.listSortOrder = Number(listSortOrder);
    if (contactId !== undefined) {
      data.contactId =
        contactId === null || contactId === "" ? null : String(contactId).trim() || null;
    }
    if (contractId !== undefined) {
      data.contractId =
        contractId === null || contractId === "" ? null : String(contractId).trim() || null;
    }

    const task = await prisma.task.update({
      where: { id },
      data,
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
    console.error("Task patch error:", error);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    await prisma.calendarEvent.deleteMany({ where: { taskId: id } });
    await prisma.task.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Task delete error:", error);
    return NextResponse.json({ error: "Failed to delete task" }, { status: 500 });
  }
}
