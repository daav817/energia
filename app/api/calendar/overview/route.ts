import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TaskStatus } from "@/generated/prisma/client";

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
  license: { select: { id: true, licenseNumber: true, licenseType: true, expirationDate: true } },
  rfpRequest: {
    select: {
      id: true,
      status: true,
      energyType: true,
      customer: { select: { name: true } },
    },
  },
} as const;

function parseRange(
  searchParams: URLSearchParams
): { from: Date; to: Date } | { error: string } {
  const fromRaw = searchParams.get("from");
  const toRaw = searchParams.get("to");
  if (!fromRaw || !toRaw) {
    return { error: "from and to are required (ISO strings)" };
  }
  const from = new Date(fromRaw);
  const to = new Date(toRaw);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { error: "Invalid from or to" };
  }
  if (from > to) return { error: "from must be <= to" };
  return { from, to };
}

export async function GET(request: NextRequest) {
  try {
    const range = parseRange(new URL(request.url).searchParams);
    if ("error" in range) {
      return NextResponse.json({ error: range.error }, { status: 400 });
    }
    const { from, to } = range;

    const [events, tasks] = await Promise.all([
      prisma.calendarEvent.findMany({
        where: {
          AND: [
            { startAt: { lte: to } },
            { OR: [{ endAt: null }, { endAt: { gte: from } }] },
          ],
        },
        orderBy: { startAt: "asc" },
        include: eventInclude,
      }),
      prisma.task.findMany({
        where: {
          taskListId: { not: null },
          status: { notIn: [TaskStatus.COMPLETED, TaskStatus.CANCELLED] },
          OR: [
            {
              dueAt: {
                gte: from,
                lte: to,
              },
            },
            {
              AND: [
                { dueDate: { not: null } },
                { dueDate: { gte: from, lte: to } },
              ],
            },
          ],
        },
        orderBy: [{ dueAt: "asc" }, { dueDate: "asc" }],
        include: {
          taskList: { select: { id: true, name: true } },
        },
      }),
    ]);

    return NextResponse.json({ events, tasks });
  } catch (error) {
    console.error("Calendar overview error:", error);
    return NextResponse.json(
      { error: "Failed to load calendar overview" },
      { status: 500 }
    );
  }
}
