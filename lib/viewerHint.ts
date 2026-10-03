// WHO IS READING — the server-readable copy (2026-10-03).
//
// The session lives in the browser (supabase-js keeps it in localStorage), so the server never
// knows who a request is from until the page has loaded, hydrated and asked. Two things want to
// know sooner:
//
//   the first paint   — app/layout.tsx reads the session's own storage in an inline script and
//                       marks <html data-viewer>, so the nav paints the right shape (THE NAV THAT
//                       MOVED UNDER YOUR THUMB, components/BottomNav.tsx). Storage is the faithful
//                       source there: supabase-js writes and clears it itself.
//   the front door    — proxy.ts, on "/" alone, sends a known guest to /truck before any HTML is
//                       served. A server cannot read localStorage; it can read a cookie. This is
//                       that cookie: written HERE, by the one component that owns the session
//                       (components/AuthProvider.tsx), on every answer the session gives.
//
// It is a hint, never auth. Nothing is granted by it, nothing is hidden by it; the page it lands
// on still asks the session, and app/page.tsx still redirects a guest the slow way when the cookie
// is missing or wrong. A stale value costs one extra hop, once, and the next answer rewrites it.
export const VIEWER_COOKIE = "gt3-viewer";
export type Viewer = "guest" | "member";

/** Write the hint from the session's answer. Browser only; silent where cookies are blocked. */
export function writeViewerHint(signedIn: boolean): void {
  if (typeof document === "undefined") return;
  const v: Viewer = signedIn ? "member" : "guest";
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; secure" : "";
  try { document.cookie = `${VIEWER_COOKIE}=${v}; path=/; max-age=31536000; samesite=lax${secure}`; } catch { /* cookies may be blocked */ }
}
