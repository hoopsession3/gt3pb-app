import { addRecent, topRecents, recentKey, type Recent, type RecentKind } from "@/lib/recents";

// Client wrapper around the pure recents store: localStorage persistence + a live-update event so an
// open command palette refreshes. Recording a visit is one call: recordRecent(kind, id, label).
const KEY = "gt3-recents";
export const RECENTS_EVENT = "gt3-recents";

export function readRecents(): Recent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? (arr as Recent[]) : [];
  } catch { return []; }
}

export function readTopRecents(n = 5): Recent[] {
  return topRecents(readRecents(), n);
}

export function recordRecent(kind: RecentKind, id: string, label: string): void {
  if (typeof window === "undefined" || !id || !label) return;
  try {
    const entry: Recent = { key: recentKey(kind, id), kind, id, label: label.trim(), at: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(addRecent(readRecents(), entry)));
    window.dispatchEvent(new Event(RECENTS_EVENT));
  } catch { /* ignore */ }
}
