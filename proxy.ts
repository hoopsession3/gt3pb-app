import { NextResponse, type NextRequest } from "next/server";

// EDGE GUEST ROUTING — decide `/` → `/truck` for signed-OUT visitors on the SERVER, before any JS
// loads, instead of the old post-hydration client redirect (app/page.tsx). That redirect fired only
// after the auth layer hydrated, so a guest paid a full second page-load — Lighthouse reported it as
// ~5s of "redirect" on a fresh mobile visit.
//
// It reads a lightweight, NON-SENSITIVE session SIGNAL cookie (`gt3_auth=1`) that AuthProvider sets on
// sign-in and clears on sign-out — NOT the token. This is routing UX only; the real security boundary
// is unchanged (RLS on every query + the client/route gates). We deliberately did NOT move the whole
// session into cookies: the current primary sign-in is a free-tier magic LINK with an iOS-PWA
// cross-browser paste flow, and a full PKCE/cookie migration there needs a real-email QA pass (see
// docs/ssr-auth-migration.md). This gets the perf win with zero auth-flow risk.
//
// Edge case: a signed-in user whose signal cookie isn't written yet (their first load right after this
// ships) is routed to /truck once; the client then sets the cookie and it's correct thereafter. The
// client redirect in app/page.tsx stays as the belt-and-suspenders for in-app (SPA) navigation, which
// never reaches middleware.
export function proxy(req: NextRequest) {
  // Match the old client condition: only when Supabase is actually configured (else it's demo mode,
  // no guest/user distinction). NEXT_PUBLIC_ vars are inlined at build and readable here.
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const signedIn = req.cookies.get("gt3_auth")?.value === "1";
  if (configured && !signedIn && req.nextUrl.pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/truck";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

// Only the home route needs this decision — keep middleware off every other request.
export const config = { matcher: ["/"] };
