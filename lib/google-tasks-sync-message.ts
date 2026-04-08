/** Human-readable summary after POST /api/google-tasks/sync */

export function formatGoogleTasksSyncMessage(data: {
  pulled?: unknown;
  pulledTasks?: unknown;
  pulledTasksNew?: unknown;
  pulledTasksUpdated?: unknown;
  pulledLists?: unknown;
  pushed?: unknown;
  pushErrors?: unknown;
}): string {
  const pulledNew = typeof data.pulledTasksNew === "number" ? data.pulledTasksNew : null;
  const pulledUpdated = typeof data.pulledTasksUpdated === "number" ? data.pulledTasksUpdated : null;
  const pulledLegacy =
    typeof data.pulledTasks === "number"
      ? data.pulledTasks
      : typeof data.pulled === "number"
        ? data.pulled
        : null;
  const listsN = typeof data.pulledLists === "number" ? data.pulledLists : null;
  const pushedN = typeof data.pushed === "number" ? data.pushed : null;
  const pe = Array.isArray(data.pushErrors)
    ? (data.pushErrors as unknown[]).map(String).filter(Boolean)
    : [];

  const listHint =
    listsN != null && listsN > 0 ? ` (${listsN} Google task list${listsN === 1 ? "" : "s"} examined).` : "";

  let peNote = "";
  if (pe.length) {
    peNote = ` Note — ${pe.slice(0, 3).join("; ")}`;
    if (pe.length > 3) peNote += "…";
  }

  const hasBreakdown = pulledNew !== null && pulledUpdated !== null;

  if (hasBreakdown) {
    const pulledParts: string[] = [];
    if (pulledNew > 0) {
      pulledParts.push(
        `${pulledNew} new task${pulledNew === 1 ? "" : "s"} imported from Google Tasks into Energia`
      );
    } else {
      pulledParts.push("no new tasks imported from Google (already in Energia)");
    }
    if (pulledUpdated > 0) {
      pulledParts.push(
        `${pulledUpdated} existing Energia task${pulledUpdated === 1 ? "" : "s"} updated from Google`
      );
    } else {
      pulledParts.push("no existing Energia tasks needed updates from Google");
    }

    let pushPart: string;
    if (pushedN === null) {
      pushPart = "Push to Google Tasks was not reported.";
    } else if (pushedN > 0) {
      pushPart = `${pushedN} local task${pushedN === 1 ? "" : "s"} created or linked in Google Tasks.`;
    } else {
      pushPart = "no local tasks needed uploading to Google Tasks.";
    }

    const core = `Pull: ${pulledParts.join("; ")}.${listHint} Push: ${pushPart}`;

    if (pulledNew === 0 && pulledUpdated === 0 && pushedN === 0) {
      return `Sync finished. Nothing changed — no new tasks from Google, no rows to refresh from Google, and nothing to upload to Google.${peNote}`;
    }

    return `${core}${peNote}`;
  }

  const parts: string[] = [];
  if (pulledLegacy != null) {
    parts.push(`Pulled ${pulledLegacy} task update(s) from Google${listsN != null ? ` (${listsN} list(s))` : ""}`);
  }
  if (pushedN != null) {
    parts.push(`Uploaded ${pushedN} local task(s) to Google Tasks`);
  }
  if (pe.length) {
    parts.push(`Note: ${pe.slice(0, 3).join("; ")}`);
  }
  const fallback = parts.length ? `${parts.join(". ")}.` : "Google Tasks sync finished.";
  return peNote && !fallback.includes(String(pe[0] ?? "")) ? `${fallback}${peNote}` : `${fallback}${peNote}`;
}
