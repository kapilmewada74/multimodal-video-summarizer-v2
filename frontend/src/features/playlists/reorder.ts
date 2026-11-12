/**
 * After dragging an item from `from` to `to`, which items are its new neighbours?
 * The server needs these two ids to place the item (it only rewrites that one row).
 */
export function neighboursAfterMove(ids: string[], from: number, to: number): { after: string | null; before: string | null } {
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return { after: next[to - 1] ?? null, before: next[to + 1] ?? null };
}

export function arrayMove<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
