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

// ── WHO CAME IN THROUGH THE FRONT DOOR (2026-10-04) ───────────────────────────────────────────
// The welcome splash (components/MarketingSplash.tsx) is for the front door: someone who opened
// app.gt3pb.com or launched the app. A guest never stays on "/" — proxy.ts or app/page.tsx sends
// them on to /truck — so the splash treated /truck itself as a door, and that made every other way
// onto /truck one too: a QR sticker on the truck, a shared link, the Find Us tab tapped mid-visit by
// someone who came in through the menu. Each got "Own your week · Build my pack →" for up to 17
// seconds. The two redirects now say where they came from, in a cookie that lives two minutes;
// /truck without it is not the front door. Like the viewer hint, it grants nothing.
//
// It is cleared when the splash SHOWS, not when it is read. Read-once was the first draft, and a
// reload lost it: traced, "/" → /truck → a second document of /truck half a second later (the
// service worker's first claim, which no longer reloads — components/ServiceWorkerRegister — but
// any reload does the same: an update, a pull to refresh). The first document read the mark and the
// one a person actually saw found it gone. Left until it is used, a mark that is never used is
// harmless: the splash's own seven-day stamp stops a second showing, and the mark is gone in two minutes.
export const DOOR_COOKIE = "gt3-door";
export const DOOR_MAX_AGE_S = 120;

/** Mark this arrival as the front door — app/page.tsx's slow redirect (proxy.ts sets the same cookie on its own). */
export function markFrontDoor(): void {
  if (typeof document === "undefined") return;
  try { document.cookie = `${DOOR_COOKIE}=1; path=/; max-age=${DOOR_MAX_AGE_S}; samesite=lax`; } catch { /* cookies may be blocked */ }
}

/** Did this arrival come through the front door? */
export function cameThroughFrontDoor(): boolean {
  if (typeof document === "undefined") return false;
  try { return document.cookie.split(/;\s*/).includes(`${DOOR_COOKIE}=1`); } catch { return false; }
}

/** The welcome has been shown: the door is used. */
export function clearFrontDoor(): void {
  if (typeof document === "undefined") return;
  try { document.cookie = `${DOOR_COOKIE}=; path=/; max-age=0; samesite=lax`; } catch { /* cookies may be blocked */ }
}
