// THE PAGE YOU STARTED ON (2026-10-09, round 2 — Ryan: "Link returns you", approved). The emailed sign-in
// link lands on the app's front door: Supabase sends every link to one address (lib/native publicOrigin),
// so someone who asked for it on /office or /offer opened it to the home screen and had to find their way
// back. The page is written down when a link is sent and read once when the sign-in completes — the same
// app, the same browser, within the hour, and only ever a path of this app (never a whole address, so no
// link can send anyone elsewhere). Pure functions first, so the smoke suite can hold them to it.

const KEY = "gt3-return-to";
/** A sign-in finished more than this long after its link was sent does not go back. */
export const RETURN_TTL_MS = 60 * 60 * 1000;

/** A path of this app, or null: it starts with one slash, and carries no line breaks. */
export function safePath(p: unknown): string | null {
  if (typeof p !== "string" || p.length > 2048) return null;
  if (!p.startsWith("/") || p.startsWith("//") || p.startsWith("/\\") || /[\r\n\t]/.test(p)) return null;
  return p;
}

/** What is stored, or null when the path is not one to return to (the front door itself is not). */
export function encodeReturn(path: string, now: number): string | null {
  const p = safePath(path);
  return p && p !== "/" ? JSON.stringify({ path: p, at: now }) : null;
}

/** The path to return to, or null: unreadable, not a path of this app, or older than the hour. */
export function decodeReturn(raw: string | null, now: number): string | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { path?: unknown; at?: unknown };
    const p = safePath(v.path);
    if (!p || typeof v.at !== "number" || !Number.isFinite(v.at)) return null;
    if (now - v.at > RETURN_TTL_MS || v.at - now > 60_000) return null;
    return p;
  } catch {
    return null;
  }
}

/** Written when a sign-in link is sent: the page it was asked for on. */
export function rememberReturn(path: string): void {
  try {
    const v = encodeReturn(path, Date.now());
    if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY);
  } catch { /* storage refused: the link lands on the front door, as before */ }
}

/** Read once, when a sign-in completes, and forgotten either way. */
export function takeReturn(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) localStorage.removeItem(KEY);
    return decodeReturn(raw, Date.now());
  } catch {
    return null;
  }
}
