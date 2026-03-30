import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CalendarEventType } from "@/generated/prisma/client";
import {
  deleteGoogleCalendarEvent,
  patchGoogleCalendarEvent,
} from "@/lib/google-calendar-sync";

function parseEventTypeStrict(raw: unknown): CalendarEventType | null {
  if (raw == null || raw === "") return null;
  const key = String(raw).toUpperCase().replace(/\s+/g, "_");
  if (key in CalendarEventType) {
    return CalendarEventType[key as keyof typeof CalendarEventType];
  }
  return null;
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

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const event = await prisma.calendarEvent.findUnique({
      where: { id },
      include: eventInclude,
    });
    if (!event) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(event);
  } catch (error) {
    console.error("Calendar event fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch calendar event" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const existing = await prisma.calendarEvent.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

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
    } = body;

    const data: Record<string, unknown> = {};

    if (title != null) {
      if (typeof title !== "string" || title.trim() === "") {
        return NextResponse.json({ error: "title must be a non-empty string" }, { status: 400 });
      }
      data.title = title.trim();
    }
    if (description !== undefined) {
      data.description =
        description != null && String(description).trim() !== ""
          ? String(description).trim()
          : null;
    }
    if (startAt != null) {
      const start = new Date(startAt);
      if (Number.isNaN(start.getTime())) {
        return NextResponse.json({ error: "Invalid startAt" }, { status: 400 });
      }
      data.startAt = start;
    }
    if (endAt !== undefined) {
      if (endAt === null || endAt === "") {
        data.endAt = null;
      } else {
        const end = new Date(endAt);
        if (Number.isNaN(end.getTime())) {
          return NextResponse.json({ error: "Invalid endAt" }, { status: 400 });
        }
        data.endAt = end;
      }
    }
    if (allDay != null) {
      data.allDay = Boolean(allDay);
    }
    if (eventType != null) {
      const parsed = parseEventTypeStrict(eventType);
      if (parsed === null) {
        return NextResponse.json({ error: "Invalid eventType" }, { status: 400 });
      }
      data.eventType = parsed;
    }

    const optionalFk = (
      key: string,
      value: unknown
    ) => {
      if (value === undefined) return;
      data[key] = value === null || value === "" ? null : value;
    };
    optionalFk("customerId", customerId);
    optionalFk("contactId", contactId);
    optionalFk("contractId", contractId);
    optionalFk("taskId", taskId);
    optionalFk("licenseId", licenseId);
    optionalFk("rfpRequestId", rfpRequestId);

    const event = await prisma.calendarEvent.update({
      where: { id },
      data,
      include: eventInclude,
    });

    if (event.googleEventId) {
      try {
        await patchGoogleCalendarEvent(event.googleEventId, {
          title: event.title,
          description: event.description,
          startAt: event.startAt,
          endAt: event.endAt,
          allDay: event.allDay,
        });
      } catch (syncErr) {
        console.error("Google Calendar patch error:", syncErr);
      }
    }

    return NextResponse.json(event);
  } catch (error) {
    console.error("Calendar event update error:", error);
    return NextResponse.json(
      { error: "Failed to update calendar event" },
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
    const existing = await prisma.calendarEvent.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (existing.googleEventId) {
      try {
        await deleteGoogleCalendarEvent(existing.googleEventId);
      } catch (syncErr) {
        console.error("Google Calendar delete error:", syncErr);
      }
    }
    await prisma.calendarEvent.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Calendar event delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete calendar event" },
      { status: 500 }
    );
  }
}
