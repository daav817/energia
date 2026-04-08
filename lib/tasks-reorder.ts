/**
 * Persist visual task order as listSortOrder (stride 10) for PATCH /api/tasks/[id].
 */
export async function persistTasksOrder(orderedIds: string[]): Promise<boolean> {
  try {
    const results = await Promise.all(
      orderedIds.map((id, index) =>
        fetch(`/api/tasks/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listSortOrder: index * 10 }),
        })
      )
    );
    return results.every((r) => r.ok);
  } catch {
    return false;
  }
}

export function reorderIdList(ids: string[], draggedId: string, targetId: string): string[] | null {
  if (draggedId === targetId) return null;
  const from = ids.indexOf(draggedId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0) return null;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, draggedId);
  return next;
}
