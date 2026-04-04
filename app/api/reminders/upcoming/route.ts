import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CalendarEventType, TaskStatus } from "@/generated/prisma/client";

const DEFAULT_DAYS = 14;

/** Show license reminders from 30 days before expiry through the expiry date. */
function inLicenseReminderWindow(expiry: Date, now: Date): boolean {
  if (expiry.getTime() < now.getTime()) return false;
  const threshold = new Date(expiry);
  threshold.setDate(threshold.getDate() - 30);
  return now.getTime() >= threshold.getTime();
}

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

    const [events, tasks, contracts, licenseRows, licenseExpiryEvents] = await Promise.all([
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
        where: { expirationDate: { gte: now } },
        orderBy: { expirationDate: "asc" },
        take: 80,
        select: {
          id: true,
          licenseNumber: true,
          licenseType: true,
          expirationDate: true,
        },
      }),
      prisma.calendarEvent.findMany({
        where: {
          eventType: CalendarEventType.LICENSE_EXPIRY,
          startAt: { gte: now },
        },
        orderBy: { startAt: "asc" },
        take: 40,
        select: {
          id: true,
          title: true,
          startAt: true,
          licenseId: true,
          license: {
            select: {
              id: true,
              licenseNumber: true,
              licenseType: true,
              expirationDate: true,
            },
          },
        },
      }),
    ]);

    const licensesFromDb = licenseRows
      .filter((l) => inLicenseReminderWindow(new Date(l.expirationDate), now))
      .slice(0, 18);

    const licenseIds = new Set(licensesFromDb.map((l) => l.id));
    const licensesExtra: typeof licensesFromDb = [];

    for (const ev of licenseExpiryEvents) {
      const exp = ev.license?.expirationDate
        ? new Date(ev.license.expirationDate)
        : new Date(ev.startAt);
      if (!inLicenseReminderWindow(exp, now)) continue;
      if (ev.licenseId && licenseIds.has(ev.licenseId)) continue;
      if (ev.license && licenseIds.has(ev.license.id)) continue;
      if (ev.license) {
        const row = {
          id: ev.license.id,
          licenseNumber: ev.license.licenseNumber,
          licenseType: ev.license.licenseType,
          expirationDate: ev.license.expirationDate,
        };
        if (licensesExtra.some((x) => x.id === row.id)) continue;
        licensesExtra.push(row);
      } else {
        const row = {
          id: `cal-${ev.id}`,
          licenseNumber: ev.title || "License expiry",
          licenseType: "Calendar" as unknown as (typeof licensesFromDb)[number]["licenseType"],
          expirationDate: ev.startAt,
        };
        if (licensesExtra.some((x) => x.id === row.id)) continue;
        licensesExtra.push(row);
      }
    }

    const licenses = [...licensesFromDb, ...licensesExtra].slice(0, 22);

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
