import { NextResponse } from "next/server";
import { pullGoogleTasksIntoDb } from "@/lib/google-tasks-sync";
import { formatGoogleTasksError } from "@/lib/google-tasks-errors";

export async function POST() {
  try {
    const result = await pullGoogleTasksIntoDb();
    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (e) {
    console.error("Google Tasks import:", e);
    return NextResponse.json(
      {
        ok: false,
        error: formatGoogleTasksError(e),
      },
      { status: 500 }
    );
  }
}
