import { NextResponse, type NextRequest } from "next/server";
import { VIEWER_COOKIE, DOOR_COOKIE, DOOR_MAX_AGE_S } from "@/lib/viewerHint";

// THE FRONT DOOR (2026-10-03).
//
// The PWA's start_url is "/" (app/manifest.ts), and "/" is Today — a member's home. A guest who
// launches the app lands on "/", downloads it, hydrates it, paints a four-row skeleton, waits for
// the session to resolve to nobody, and is then sent to /truck by router.replace (app/page.tsx).
// Measured on production at phone width: the largest paint on that path came at 800–1036ms,
// against 376–868ms on /truck opened directly, plus a skeleton nobody asked for and the only
// layout shift left on the route (0.012). That is the most common guest entry in the app, every
// launch.
//
// This runs on "/" and nowhere else, reads one cookie, and does one thing: a request that says it
// is a guest is sent to /truck before a byte of "/" is served — the same destination the page
// would have chosen, a few hundred milliseconds and one skeleton earlier. The query string rides
// along (a /?ref=… referral still lands in lib/track's hands on /truck; AuthProvider captures it
// on every route).
//
// It also leaves one mark: the two-minute front-door cookie (lib/viewerHint DOOR_COOKIE), so the
// welcome splash on /truck knows this hop was the front door and a QR sticker is not.
//
// What it does NOT do: it never decides for a member (a cookie that says member, or no cookie at
// all — a first visit, a cleared browser — passes straight through to the page that asks the
// session, exactly as before), and it grants nothing: the cookie is a hint written by
// components/AuthProvider.tsx from the session's own answer (lib/viewerHint.ts), and a wrong one
// costs a guest one extra hop, once. Held by scripts/smoke.ui.mjs (three requests: guest, member,
// nobody) and by verify:prod's ANSWERS on the live site.
export function proxy(req: NextRequest) {
  if (req.cookies.get(VIEWER_COOKIE)?.value === "guest") {
    const url = req.nextUrl.clone();
    url.pathname = "/truck";
    const res = NextResponse.redirect(url, 307);
    res.headers.set("cache-control", "private, no-store");
    // This hop IS the front door, and /truck cannot tell it from a QR sticker or a tab tap without
    // being told: a two-minute, read-once mark for the welcome splash (lib/viewerHint, 2026-10-04).
    res.cookies.set(DOOR_COOKIE, "1", { path: "/", maxAge: DOOR_MAX_AGE_S, sameSite: "lax" });
    return res;
  }
  return NextResponse.next();
}

// "/" exactly. Not /api, not /_next, not /truck itself — one door, one decision.
export const config = { matcher: "/" };
