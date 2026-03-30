import { NextRequest, NextResponse } from "next/server";
import { syncGoogleCalendarPrimary } from "@/lib/google-calendar-sync";

/**
 * POST /api/calendar/google-sync
 * Pull from Google primary calendar into DB, then push Energia events (no googleEventId yet) in range.
 * Optional JSON body: { "from": ISO string, "to": ISO string }
 */
export async function POST(request: NextRequest) {
  try {
    let timeMin: Date;
    let timeMax: Date;

    const raw = await request.json().catch(() => null);
    const fromRaw = raw && typeof raw === "object" && raw !== null && "from" in raw ? String((raw as { from: unknown }).from) : null;
    const toRaw = raw && typeof raw === "object" && raw !== null && "to" in raw ? String((raw as { to: unknown }).to) : null;

    if (fromRaw && toRaw) {
      timeMin = new Date(fromRaw);
      timeMax = new Date(toRaw);
      if (Number.isNaN(timeMin.getTime()) || Number.isNaN(timeMax.getTime()) || timeMin > timeMax) {
        return NextResponse.json({ error: "Invalid from or to date range" }, { status: 400 });
      }
    } else {
      const now = new Date();
      timeMin = new Date(now.getFullYear(), now.getMonth() - 3, 1, 0, 0, 0, 0);
      timeMax = new Date(now.getFullYear() + 2, 11, 31, 23, 59, 59, 999);
    }

    const result = await syncGoogleCalendarPrimary({ timeMin, timeMax });
    return NextResponse.json({
      ok: true,
      ...result,
      message: `Synced Google Calendar: ${result.pulled} updated from Google, ${result.pushed} sent to Google${result.deletedCancelled ? `, ${result.deletedCancelled} cancelled removed` : ""}.`,
    });
  } catch (error) {
    console.error("Google Calendar sync error:", error);
    const msg = error instanceof Error ? error.message : "Sync failed";
    if (msg.includes("not connected")) {
      return NextResponse.json(
        {
          error: msg,
          hint: "Connect Google under Communications, then run sync again (Calendar scope is required).",
        },
        { status: 401 }
      );
    }
    const gErr = error as { code?: number; response?: { status?: number } };
    const st = gErr.response?.status ?? gErr.code;
    if (st === 403) {
      return NextResponse.json(
        {
          error: "Google Calendar API denied access.",
          hint: "Reconnect Google at /api/gmail/connect so the new Calendar permission is granted.",
        },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
