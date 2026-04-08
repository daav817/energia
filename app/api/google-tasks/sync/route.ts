import { NextResponse } from "next/server";
import { pullGoogleTasksIntoDb, pushLocalTasksToGoogle } from "@/lib/google-tasks-sync";
import { formatGoogleTasksError } from "@/lib/google-tasks-errors";

export async function POST() {
  try {
    const pulled = await pullGoogleTasksIntoDb();
    const pushed = await pushLocalTasksToGoogle();
    return NextResponse.json({
      ok: true,
      /** @deprecated use pulledTasksNew + pulledTasksUpdated */
      pulled: pulled.tasksUpserted,
      pulledTasks: pulled.tasksUpserted,
      pulledTasksNew: pulled.tasksImportedNew,
      pulledTasksUpdated: pulled.tasksUpdated,
      pulledLists: pulled.listsSynced,
      pushed: pushed.pushed,
      pushErrors: pushed.errors,
    });
  } catch (e) {
    console.error("Google Tasks sync:", e);
    return NextResponse.json(
      {
        ok: false,
        error: formatGoogleTasksError(e),
      },
      { status: 500 }
    );
  }
}
