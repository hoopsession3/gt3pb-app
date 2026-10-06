// THE APP AND THE WEB, ONE CODEBASE (2026-10-06, the iPhone round).
//
// The same screens run two ways: on the web (app.gt3pb.com, served by Vercel, as always) and inside
// the iPhone app, where they are a static export bundled into a Capacitor shell (scripts/build.app.mjs
// makes it; capacitor.config.ts and ios/ hold the shell). This file is the one place the code asks
// which of the two it is, and the one place an address is made for the app.
//
// TWO QUESTIONS, TWO ANSWERS.
//   · APP_BUILD — was this bundle BUILT for the app? Fixed when the bundle is made (the build sets
//     NEXT_PUBLIC_GT3_TARGET=app), so it is the same on the build machine's prerender and on the
//     phone, and a page's markup never disagrees with itself between the two. Addresses and routes
//     ask this. On the web it is false and every branch it guards is dropped from the web bundle.
//   · isNativeApp() — is a native shell RUNNING this page right now? Capacitor puts its bridge on
//     window before the page's own scripts run. Native features (haptics, the status bar, the
//     keyboard) ask this: the app bundle opened in a plain browser — a test run — has no shell.
//
// WHERE THE APP'S PAGES LIVE. In the app a page's own address is capacitor://localhost, which means
// nothing to anyone else: a link shared from the app, a QR made in it, or a sign-in email it asks for
// must point at the web. publicOrigin() is that address — the web's own origin on the web (a preview
// deployment stays itself), app.gt3pb.com in the app.
//
// WHERE ITS API LIVES. The /api routes run on Vercel; the app has no server. apiUrl() makes the
// address absolute in the app and leaves it as it was on the web, and next.config.ts lets the app's
// origin call those routes (CORS, for exactly capacitor://localhost and https://localhost). The
// routes keep checking the session token as they always have.

import { CONNECT_APP } from "./connect";

/** This bundle was built for the iPhone app (static export). False on the web — fixed at build time. */
export const APP_BUILD = process.env.NEXT_PUBLIC_GT3_TARGET === "app";

/** The web's own address — what a link, a QR or a sign-in email made in the app points at. */
export const WEB_ORIGIN = CONNECT_APP;

/** The address an /api route is called at: unchanged on the web, absolute in the app. */
export function apiUrl(path: string): string {
  return APP_BUILD && path.startsWith("/") ? `${WEB_ORIGIN}${path}` : path;
}

/** The origin a shared link, a QR or a sign-in redirect should carry. */
export function publicOrigin(): string {
  if (APP_BUILD) return WEB_ORIGIN;
  return typeof window !== "undefined" ? window.location.origin : WEB_ORIGIN;
}

type CapacitorGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string };

/** A native shell is running this page (Capacitor's bridge is on window). False on the server. */
export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

/** "ios" | "android" inside the app, "web" everywhere else. */
export function nativePlatform(): "ios" | "android" | "web" {
  if (!isNativeApp()) return "web";
  const p = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor?.getPlatform?.();
  return p === "ios" || p === "android" ? p : "web";
}

// PAGES AN EXPORT CANNOT MAKE AHEAD OF TIME. A static export renders every page at build time, so a
// page whose address carries an id from the database (/primal/l/<slug>) cannot be in it — the ids are
// not known until someone publishes a lesson. The app has the same screen at one fixed address with
// the id in the query instead (native/routes/primal/lesson, added to the app build only, by
// scripts/build.app.mjs). A link asks here which address to use; the web's is unchanged.
export function lessonHref(slug: string): string {
  return APP_BUILD ? `/primal/lesson?slug=${encodeURIComponent(slug)}` : `/primal/l/${slug}`;
}
