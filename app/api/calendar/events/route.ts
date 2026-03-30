import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CalendarEventType, TaskStatus, TaskType } from "@/generated/prisma/client";

function coerceEventType(raw: unknown): CalendarEventType {
  if (raw == null || raw === "") return CalendarEventType.OTHER;
  const key = String(raw).toUpperCase().replace(/\s+/g, "_");
  if (key in CalendarEventType) {
    return CalendarEventType[key as keyof typeof CalendarEventType];
  }
  return CalendarEventType.OTHER;
}

const eventInclude = {
  customer: { select: { id: true, name: true, company: true } },
  contact: { select: { id: true, name: true } },
  contract: {
    select: {
      id: true,
      energyType: true,
      expirationDate: true,
      customer: { select: { name: true } },
      supplier: { select: { name: true } },
    },
  },
  task: {
    select: {
      id: true,
      title: true,
      status: true,
      taskList: { select: { id: true, name: true } },
    },
  },
  license:        { select: { id: true, licenseNumber: true, licenseType: true, expirationDate: true } },
  rfpRequest: {
    select: {
      id: true,
      status: true,
      energyType: true,
      customer: { select: { name: true } },
    },
  },
} as const;

function parseRange(searchParams: URLSearchParams): { from: Date; to: Date } | { error: string } {
  const fromRaw = searchParams.get("from");
  const toRaw = searchParams.get("to");
  if (!fromRaw || !toRaw) {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { from, to };
  }
  const from = new Date(fromRaw);
  const to = new Date(toRaw);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { error: "Invalid from or to date" };
  }
  if (from > to) {
    return { error: "from must be before or equal to to" };
  }
  return { from, to };
}

export async function GET(request: NextRequest) {
  try {
    const range = parseRange(new URL(request.url).searchParams);
    if ("error" in range) {
      return NextResponse.json({ error: range.error }, { status: 400 });
    }
    const { from, to } = range;

    const events = await prisma.calendarEvent.findMany({
      where: {
        AND: [
          { startAt: { lte: to } },
          {
            OR: [{ endAt: null }, { endAt: { gte: from } }],
          },
        ],
      },
      orderBy: { startAt: "asc" },
      include: eventInclude,
    });

    return NextResponse.json(events);
  } catch (error) {
    console.error("Calendar events fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch calendar events" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      title,
      description,
      startAt,
      endAt,
      allDay,
      eventType,
      customerId,
      contactId,
      contractId,
      taskId,
      licenseId,
      rfpRequestId,
      taskListId,
      repeatRule,
    } = body;

    if (!title || typeof title !== "string" || !startAt) {
      return NextResponse.json(
        { error: "title and startAt are required" },
        { status: 400 }
      );
    }

    const start = new Date(startAt);
    if (Number.isNaN(start.getTime())) {
      return NextResponse.json({ error: "Invalid startAt" }, { status: 400 });
    }

    let end: Date | null = null;
    if (endAt != null && endAt !== "") {
      end = new Date(endAt);
      if (Number.isNaN(end.getTime())) {
        return NextResponse.json({ error: "Invalid endAt" }, { status: 400 });
      }
    }

    const et = coerceEventType(eventType);

    if (et === CalendarEventType.TASK) {
      if (!taskListId || typeof taskListId !== "string") {
        return NextResponse.json(
          { error: "taskListId is required when event type is Task" },
          { status: 400 }
        );
      }
      const list = await prisma.taskList.findUnique({ where: { id: taskListId } });
      if (!list) {
        return NextResponse.json({ error: "Task list not found" }, { status: 400 });
      }
    }

    const allDayB = Boolean(allDay);
    const desc =
      description != null && String(description).trim() !== ""
        ? String(description).trim()
        : null;

    const event = await prisma.$transaction(async (tx) => {
      let resolvedTaskId: string | null = taskId || null;
      if (et === CalendarEventType.TASK) {
        const dueDateOnly = allDayB
          ? new Date(start.getFullYear(), start.getMonth(), start.getDate(), 12, 0, 0, 0)
          : null;
        const task = await tx.task.create({
          data: {
            title: title.trim(),
            description: desc,
            taskListId: taskListId as string,
            type: TaskType.TASK,
            status: TaskStatus.PENDING,
            dueDate: allDayB ? dueDateOnly : null,
            dueAt: allDayB ? null : start,
            allDay: allDayB,
            repeatRule:
              repeatRule != null && String(repeatRule).trim() !== ""
                ? String(repeatRule).trim()
                : null,
          },
        });
        resolvedTaskId = task.id;
      }

      return tx.calendarEvent.create({
        data: {
          title: title.trim(),
          description: desc,
          startAt: start,
          endAt: end,
          allDay: allDayB,
          eventType: et,
          customerId: et === CalendarEventType.TASK ? null : customerId || null,
          contactId: contactId || null,
          contractId: contractId || null,
          taskId: resolvedTaskId,
          licenseId: licenseId || null,
          rfpRequestId: rfpRequestId || null,
        },
        include: eventInclude,
      });
    });

    return NextResponse.json(event);
  } catch (error) {
    console.error("Calendar event create error:", error);
    return NextResponse.json(
      { error: "Failed to create calendar event" },
      { status: 500 }
    );
  }
}
