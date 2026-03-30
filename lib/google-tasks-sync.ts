import { prisma } from "@/lib/prisma";
import { TaskStatus, TaskType } from "@/generated/prisma/client";
import { getTasksAuthorizedClient } from "@/lib/google-tasks-api";

function parseGoogleDue(due: string | null | undefined): {
  dueDate: Date | null;
  dueAt: Date | null;
  allDay: boolean;
} {
  if (!due) return { dueDate: null, dueAt: null, allDay: true };
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return { dueDate: null, dueAt: null, allDay: true };
  const utcH = d.getUTCHours();
  const utcM = d.getUTCMinutes();
  const utcS = d.getUTCSeconds();
  const utcMs = d.getUTCMilliseconds();
  const isMidnight =
    utcH === 0 && utcM === 0 && utcS === 0 && utcMs === 0;
  if (isMidnight) {
    const dueDate = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0, 0)
    );
    return { dueDate, dueAt: null, allDay: true };
  }
  return { dueDate: null, dueAt: d, allDay: false };
}

export async function pullGoogleTasksIntoDb(): Promise<{
  listsSynced: number;
  tasksUpserted: number;
}> {
  const client = await getTasksAuthorizedClient();
  let listsSynced = 0;
  let tasksUpserted = 0;

  const listRes = await client.tasklists.list({ maxResults: 100 });
  const googleLists = listRes.data.items ?? [];

  const maxSort = await prisma.taskList.aggregate({ _max: { sortOrder: true } });
  let nextSort = (maxSort._max.sortOrder ?? -1) + 1;

  for (const gl of googleLists) {
    const googleListId = gl.id;
    if (!googleListId) continue;

    let tl = await prisma.taskList.findFirst({
      where: { googleListId },
    });
    if (!tl) {
      tl = await prisma.taskList.create({
        data: {
          name: (gl.title ?? "Google Tasks").trim() || "Google Tasks",
          googleListId,
          sortOrder: nextSort++,
        },
      });
    } else if (gl.title && gl.title.trim() && gl.title !== tl.name) {
      await prisma.taskList.update({
        where: { id: tl.id },
        data: { name: gl.title.trim() },
      });
    }
    listsSynced++;

    let pageToken: string | undefined;
    do {
      const tr = await client.tasks.list({
        tasklist: googleListId,
        maxResults: 100,
        pageToken,
        showCompleted: true,
        showHidden: true,
      });
      const data = tr.data;
      const items = data.items ?? [];
      for (const gt of items) {
        const googleTaskId = gt.id;
        if (!googleTaskId) continue;
        if (gt.parent) continue;

        const title = (gt.title ?? "").trim() || "(no title)";
        const status =
          gt.status === "completed" ? TaskStatus.COMPLETED : TaskStatus.PENDING;
        const { dueDate, dueAt, allDay } = parseGoogleDue(gt.due ?? undefined);
        const notes =
          gt.notes != null && String(gt.notes).trim() !== ""
            ? String(gt.notes).trim()
            : null;

        const existing = await prisma.task.findFirst({
          where: { googleTaskId },
        });

        const completedAt =
          status === TaskStatus.COMPLETED
            ? (existing?.completedAt ?? new Date())
            : null;

        if (existing) {
          await prisma.task.update({
            where: { id: existing.id },
            data: {
              title,
              description: notes,
              status,
              completedAt: status === TaskStatus.COMPLETED ? completedAt : null,
              dueDate,
              dueAt,
              allDay,
              taskListId: tl.id,
            },
          });
        } else {
          await prisma.task.create({
            data: {
              title,
              description: notes,
              type: TaskType.TASK,
              status,
              completedAt: status === TaskStatus.COMPLETED ? completedAt : null,
              dueDate,
              dueAt,
              allDay,
              taskListId: tl.id,
              googleTaskId,
            },
          });
        }
        tasksUpserted++;
      }
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  return { listsSynced, tasksUpserted };
}

export async function pushLocalTasksToGoogle(): Promise<{
  pushed: number;
  errors: string[];
}> {
  const client = await getTasksAuthorizedClient();
  const errors: string[] = [];
  let pushed = 0;

  const lists = await prisma.taskList.findMany({
    where: { googleListId: { not: null } },
    select: { id: true, googleListId: true },
  });

  for (const list of lists) {
    if (!list.googleListId) continue;
    const orphans = await prisma.task.findMany({
      where: {
        taskListId: list.id,
        googleTaskId: null,
        status: TaskStatus.PENDING,
      },
    });

    for (const task of orphans) {
      try {
        const due =
          task.allDay && task.dueDate
            ? new Date(
                Date.UTC(
                  task.dueDate.getUTCFullYear(),
                  task.dueDate.getUTCMonth(),
                  task.dueDate.getUTCDate(),
                  0,
                  0,
                  0,
                  0
                )
              ).toISOString()
            : task.dueAt
              ? task.dueAt.toISOString()
              : undefined;

        const ins = await client.tasks.insert({
          tasklist: list.googleListId,
          requestBody: {
            title: task.title,
            notes: task.description ?? undefined,
            due: due,
            status: "needsAction",
          },
        });
        const gid = ins.data.id;
        if (gid) {
          await prisma.task.update({
            where: { id: task.id },
            data: { googleTaskId: gid },
          });
          pushed++;
        }
      } catch (e) {
        errors.push(
          `${task.title}: ${e instanceof Error ? e.message : "push failed"}`
        );
      }
    }
  }

  return { pushed, errors };
}
