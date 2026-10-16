// THE LAST PROFILE THIS PHONE SAW, KEPT FOR A COLD START WITH NO SIGNAL (R11, 2026-10-16 — the 10/10 audit).
//
// A relaunch with no bars — iOS ends a backgrounded app at a festival, a crash reload — read the profile again before
// anything else, failed, and the crew console said "Couldn't load your account": the Pass's last-known board and its
// queued taps (components/pass/usePassBoard, components/offline) were never reached. The last good profile for the
// signed-in person is kept on the phone and answers when the read fails for want of a network; the next read that
// works replaces it. The server still decides every write (row security reads the row, not this copy). It is that
// person's data, and leaves the phone with them (lib/accountWipe, the gt3-profile: prefix).
export const KEPT_PREFIX = "gt3-profile:";

export function keepProfile(uid: string, profile: unknown): void {
  try { if (profile && typeof profile === "object") localStorage.setItem(KEPT_PREFIX + uid, JSON.stringify({ at: Date.now(), profile })); } catch { /* storage refused */ }
}

/** The kept profile for this person, if the phone has one from the last two weeks. */
export function keptProfile<T>(uid: string, now: number = Date.now()): T | null {
  try {
    const raw = localStorage.getItem(KEPT_PREFIX + uid);
    if (!raw) return null;
    const v = JSON.parse(raw) as { at?: unknown; profile?: unknown };
    if (typeof v?.at !== "number" || now - v.at > 14 * 86_400_000 || !v.profile || typeof v.profile !== "object") return null;
    const p = v.profile as { id?: unknown };
    return p.id === uid ? (v.profile as T) : null;
  } catch {
    return null;
  }
}

/** A read that failed for want of a network, not because it was refused. */
export function offlineFailure(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return /fetch|network|load failed|timed? ?out|connection/i.test(String(error.message ?? "")) && !error.code;
}

/** The person a session kept on this phone belongs to — supabase-js keeps it under sb-<project>-auth-token, and keeps it
 *  when a renewal fails for want of a network. The user it was for, never its tokens (only that one is there to renew
 *  with); null when there is none. */
export function storedSessionUser(): { id: string; email?: string } | null {
  try {
    const key = Object.keys(localStorage).find((k) => /^sb-.+-auth-token$/.test(k));
    if (!key) return null;
    const v = JSON.parse(localStorage.getItem(key) ?? "null") as { refresh_token?: unknown; user?: { id?: unknown } } | null;
    const u = v?.user;
    return v && typeof v.refresh_token === "string" && v.refresh_token && u && typeof u.id === "string" ? (u as { id: string; email?: string }) : null;
  } catch {
    return null;
  }
}
