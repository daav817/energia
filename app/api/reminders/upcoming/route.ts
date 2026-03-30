import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TaskStatus } from "@/generated/prisma/client";

const DEFAULT_DAYS = 14;

export async function GET(request: NextRequest) {
  try {
    const daysRaw = new URL(request.url).searchParams.get("days");
    const days = Math.min(
      60,
      Math.max(1, daysRaw ? parseInt(daysRaw, 10) || DEFAULT_DAYS : DEFAULT_DAYS)
    );
    const now = new Date();
    const end = new Date(now);
    end.setDate(end.getDate() + days);
    end.setHours(23, 59, 59, 999);

    const [events, tasks, contracts, licenses] = await Promise.all([
      prisma.calendarEvent.findMany({
        where: {
          startAt: { gte: now, lte: end },
        },
        orderBy: { startAt: "asc" },
        take: 25,
        select: {
          id: true,
          title: true,
          startAt: true,
          eventType: true,
        },
      }),
      prisma.task.findMany({
        where: {
          taskListId: { not: null },
          status: { notIn: [TaskStatus.COMPLETED, TaskStatus.CANCELLED] },
          OR: [
            { dueAt: { gte: now, lte: end } },
            {
              AND: [{ dueDate: { not: null } }, { dueDate: { gte: now, lte: end } }],
            },
          ],
        },
        orderBy: [{ dueAt: "asc" }, { dueDate: "asc" }],
        take: 25,
        select: {
          id: true,
          title: true,
          dueAt: true,
          dueDate: true,
          allDay: true,
        },
      }),
      prisma.contract.findMany({
        where: {
          status: { not: "archived" },
          expirationDate: { gte: now, lte: end },
        },
        orderBy: { expirationDate: "asc" },
        take: 20,
        select: {
          id: true,
          expirationDate: true,
          customer: { select: { name: true } },
          supplier: { select: { name: true } },
        },
      }),
      prisma.license.findMany({
        where: {
          expirationDate: { gte: now, lte: end },
        },
        orderBy: { expirationDate: "asc" },
        take: 15,
        select: {
          id: true,
          licenseNumber: true,
          licenseType: true,
          expirationDate: true,
        },
      }),
    ]);

    return NextResponse.json({
      events,
      tasks,
      contracts,
      licenses,
      until: end.toISOString(),
    });
  } catch (error) {
    console.error("Reminders upcoming error:", error);
    return NextResponse.json(
      { error: "Failed to load reminders" },
      { status: 500 }
    );
  }
}
