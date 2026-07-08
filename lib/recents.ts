// RECENTS — a tiny most-recently-used list that feeds the command palette's quick-jump. Pure list
// math here (deterministic, unit-tested in smoke); the localStorage/`Date.now` wrapper lives in the
// client helper (components/recents.ts) so this stays environment-free.

export type RecentKind = "event" | "stop" | "member" | "product";
export type Recent = { key: string; kind: RecentKind; id: string; label: string; at: number };

export const recentKey = (kind: RecentKind, id: string): string => `${kind}:${id}`;

// Move `entry` to the front, drop any prior copy of the same item, cap the list length.
export function addRecent(list: Recent[], entry: Recent, max = 8): Recent[] {
  const others = list.filter((r) => r.key !== entry.key);
  return [entry, ...others].slice(0, Math.max(0, max));
}

// Most-recent first, limited to `n`. Defensive against a malformed stored blob.
export function topRecents(list: Recent[], n = 5): Recent[] {
  return [...list].filter((r) => r && typeof r.at === "number" && !!r.label).sort((a, b) => b.at - a.at).slice(0, Math.max(0, n));
}
