import type { calendar_v3 } from "googleapis";
import { prisma } from "@/lib/prisma";
import { CalendarEventType } from "@/generated/prisma/client";
import { getCalendarAuthorizedClient } from "@/lib/google-calendar-api";

const PRIMARY = "primary";

function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function localNoonFromYmd(ymd: string): Date {
  const [y, mo, d] = ymd.split("-").map(Number);
  return new Date(y, mo - 1, d, 12, 0, 0, 0);
}

/** Google all-day end date is exclusive; return YMD of last included day, or null when same as start only. */
function exclusiveEndToLastInclusiveYmd(startYmd: string, endExclusiveYmd: string): string | null {
  const start = localNoonFromYmd(startYmd);
  const endEx = localNoonFromYmd(endExclusiveYmd);
  endEx.setDate(endEx.getDate() - 1);
  if (endEx.getTime() < start.getTime()) return null;
  if (
    endEx.getFullYear() === start.getFullYear() &&
    endEx.getMonth() === start.getMonth() &&
    endEx.getDate() === start.getDate()
  ) {
    return null;
  }
  return formatLocalYmd(endEx);
}

function mapGoogleEventToFields(
  ge: calendar_v3.Schema$Event
): {
  title: string;
  description: string | null;
  allDay: boolean;
  startAt: Date;
  endAt: Date | null;
} | null {
  if (!ge.id) return null;
  const summary = (ge.summary ?? "").trim() || "(No title)";
  const description =
    ge.description != null && String(ge.description).trim() !== ""
      ? String(ge.description).trim()
      : null;

  const st = ge.start;
  if (st?.date) {
    const startAt = localNoonFromYmd(st.date);
    let endAt: Date | null = null;
    if (ge.end?.date) {
      const lastYmd = exclusiveEndToLastInclusiveYmd(st.date, ge.end.date);
      if (lastYmd) endAt = localNoonFromYmd(lastYmd);
    }
    return { title: summary, description, allDay: true, startAt, endAt };
  }
  if (st?.dateTime) {
    const startAt = new Date(st.dateTime);
    const endAt = ge.end?.dateTime ? new Date(ge.end.dateTime) : null;
    return { title: summary, description, allDay: false, startAt, endAt };
  }
  return null;
}

export function energiaToGoogleBody(ev: {
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date | null;
  allDay: boolean;
}): calendar_v3.Schema$Event {
  if (ev.allDay) {
    const sd = formatLocalYmd(ev.startAt);
    let endExclusive: string;
    if (ev.endAt) {
      const d = new Date(ev.endAt);
      d.setDate(d.getDate() + 1);
      endExclusive = formatLocalYmd(d);
    } else {
      const d = new Date(ev.startAt);
      d.setDate(d.getDate() + 1);
      endExclusive = formatLocalYmd(d);
    }
    return {
      summary: ev.title,
      description: ev.description ?? undefined,
      start: { date: sd },
      end: { date: endExclusive },
    };
  }
  const endDt = ev.endAt ?? new Date(ev.startAt.getTime() + 60 * 60 * 1000);
  return {
    summary: ev.title,
    description: ev.description ?? undefined,
    start: { dateTime: ev.startAt.toISOString() },
    end: { dateTime: endDt.toISOString() },
  };
}

/**
 * Two-way sync with Google primary calendar: pull remote changes, then push local events without a link.
 */
export async function syncGoogleCalendarPrimary(opts: {
  timeMin: Date;
  timeMax: Date;
}): Promise<{ pulled: number; pushed: number; deletedCancelled: number }> {
  const cal = await getCalendarAuthorizedClient();
  const { timeMin, timeMax } = opts;

  let pulled = 0;
  let deletedCancelled = 0;
  let pageToken: string | undefined;

  do {
    const res = await cal.events.list({
      calendarId: PRIMARY,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
      pageToken,
      showDeleted: true,
    });

    const items = res.data.items ?? [];
    for (const ge of items) {
      if (!ge.id) continue;

      if (ge.status === "cancelled") {
        const del = await prisma.calendarEvent.deleteMany({
          where: { googleEventId: ge.id },
        });
        deletedCancelled += del.count;
        continue;
      }

      const fields = mapGoogleEventToFields(ge);
      if (!fields) continue;

      await prisma.calendarEvent.upsert({
        where: { googleEventId: ge.id },
        create: {
          title: fields.title,
          description: fields.description,
          startAt: fields.startAt,
          endAt: fields.endAt,
          allDay: fields.allDay,
          eventType: CalendarEventType.OTHER,
          googleEventId: ge.id,
        },
        update: {
          title: fields.title,
          description: fields.description,
          startAt: fields.startAt,
          endAt: fields.endAt,
          allDay: fields.allDay,
        },
      });
      pulled++;
    }

    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  let pushed = 0;
  const locals = await prisma.calendarEvent.findMany({
    where: {
      googleEventId: null,
      startAt: { gte: timeMin, lte: timeMax },
    },
    select: {
      id: true,
      title: true,
      description: true,
      startAt: true,
      endAt: true,
      allDay: true,
    },
  });

  for (const ev of locals) {
    try {
      const body = energiaToGoogleBody(ev);
      const ins = await cal.events.insert({
        calendarId: PRIMARY,
        requestBody: body,
      });
      const gid = ins.data.id;
      if (gid) {
        await prisma.calendarEvent.update({
          where: { id: ev.id },
          data: { googleEventId: gid },
        });
        pushed++;
      }
    } catch (err) {
      console.error("Google Calendar push failed for event", ev.id, err);
    }
  }

  return { pulled, pushed, deletedCancelled };
}

export async function patchGoogleCalendarEvent(
  googleEventId: string,
  ev: {
    title: string;
    description: string | null;
    startAt: Date;
    endAt: Date | null;
    allDay: boolean;
  }
): Promise<void> {
  const cal = await getCalendarAuthorizedClient();
  await cal.events.patch({
    calendarId: PRIMARY,
    eventId: googleEventId,
    requestBody: energiaToGoogleBody(ev),
  });
}

export async function deleteGoogleCalendarEvent(googleEventId: string): Promise<void> {
  const cal = await getCalendarAuthorizedClient();
  try {
    await cal.events.delete({ calendarId: PRIMARY, eventId: googleEventId });
  } catch (e: unknown) {
    const err = e as { code?: number };
    if (err?.code === 404 || err?.code === 410) return;
    throw e;
  }
}
