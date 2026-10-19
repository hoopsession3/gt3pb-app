import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Content-Security-Policy baked in now (runbook §1/§4): Square Web Payments SDK
// requires HTTPS + a CSP from Oct 2025, even though in-app checkout is deferred.
// Allowances cover what the app will load when commerce + push are switched on:
//   - Square Web Payments SDK + Connect API
//   - Supabase realtime (wss)
// R10b (2026-10-16, the 10/10 audit): OneSignal (never wired — web push is the app's own, public/sw.js) and Resend (the
// server's alone, lib/notify) are out of the list — an origin allowed and unused is an origin a script could reach.
// In dev we relax script-src ('unsafe-eval') because Next's dev runtime needs it.
// Square Web Payments SDK is finicky about CSP: it loads square.js, fetches config from
// web.squarecdn.com, spawns a blob: worker for tokenization, renders the card as an iframe, and
// reports to its own Sentry. Missing any of these silently kills the card form (window.Square never
// appears). The full squarecdn wildcard + worker/child blob: cover it.
const SQ = "https://web.squarecdn.com https://sandbox.web.squarecdn.com https://*.squarecdn.com https://js.squareup.com";
// THE APP'S OWN DATABASE, AND NO OTHER (R31 — the 10/10 audit, security F4). The pages talk to one Supabase project —
// its rest, auth, realtime, storage and functions all at that project's own address — but connect-src let a page reach
// any *.supabase.co project: a script slipped into a page could post what it read to a stranger's project as easily as
// to this one. Read from the build's own NEXT_PUBLIC_SUPABASE_URL (the web's and the iPhone app's builds both have it);
// a build without it — CI's, which has no database — keeps the wildcard it had.
const DB_HOST = (() => { try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host; } catch { return ""; } })();
const DB = DB_HOST ? `https://${DB_HOST} wss://${DB_HOST}` : "https://*.supabase.co wss://*.supabase.co";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"} ${SQ}`,
  "style-src 'self' 'unsafe-inline' https://web.squarecdn.com https://*.squarecdn.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://*.squarecdn.com",
  `connect-src 'self' https://connect.squareup.com https://connect.squareupsandbox.com https://pci-connect.squareup.com https://pci-connect.squareupsandbox.com https://web.squarecdn.com https://*.squarecdn.com https://o160250.ingest.sentry.io ${DB} https://nominatim.openstreetmap.org`,
  `frame-src 'self' ${SQ} https://connect.squareup.com https://connect.squareupsandbox.com`,
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "manifest-src 'self'",
  // No plugins (R31 — security F4): default-src 'self' let an <object> or <embed> load from this origin; nothing here uses one.
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Content-Security-Policy", value: csp },
  // R10b (2026-10-16, the 10/10 audit). HTTPS remembered for two years (this host and anything under it; not preloaded —
  // that is a list to join on purpose, not a header). What the pages may ask of the device: the crew's live location
  // (components/crew/LiveControl) and dictation's microphone (components/useDictation), the card form's payments — no
  // camera, nothing else. A window this app opens keeps talking to it (a payment or sign-in window may); a window of
  // another site that opens this app does not get a handle on it.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Permissions-Policy", value: 'camera=(), microphone=(self), geolocation=(self), payment=(self "https://web.squarecdn.com" "https://sandbox.web.squarecdn.com"), usb=(), serial=(), hid=(), bluetooth=()' },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

// THE IPHONE APP CALLS THE API FROM ANOTHER ORIGIN (2026-10-06, the iPhone round). The app's pages
// are served by the phone itself — capacitor://localhost on iOS, https://localhost on Android — so
// every /api call it makes is cross-origin, and the page may read the answer only if the route says
// that origin may. This rule says so for exactly those two origins: matched whole (Next anchors the
// pattern, so capacitor://localhost.evil.com is not it), echoed back, never a wildcard. A preflight
// gets the same headers — Next answers OPTIONS for every route by itself. Nothing changes for the
// web: its requests are same-origin and carry neither Origin. The routes keep checking the session
// token as before; there are no cookies for another origin to ride on.
const APP_ORIGINS = ["capacitor://localhost", "https://localhost"] as const;
const appCors = {
  source: "/api/:path*",
  has: [{ type: "header" as const, key: "origin", value: `(?<origin>${APP_ORIGINS.join("|")})` }],
  headers: [
    { key: "Access-Control-Allow-Origin", value: ":origin" },
    { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
    { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization" },
    { key: "Access-Control-Max-Age", value: "600" },
    { key: "Vary", value: "Origin" },
  ],
};

const nextConfig: NextConfig = {
  // The web build says it is the web (2026-10-06, the iPhone round), so lib/native APP_BUILD is decided
  // when the bundle is made and every app-only branch — components/NativeBridge and the Capacitor
  // plugins behind it — is dropped from the web's bundle rather than shipped and skipped.
  // The web build knows its own commit (2026-10-10), so an open tab can tell when a newer one is live
  // (components/FreshTab). Vercel's system variable at build time; empty locally, and then it never asks.
  env: { NEXT_PUBLIC_GT3_TARGET: "web", NEXT_PUBLIC_BUILD_COMMIT: process.env.VERCEL_GIT_COMMIT_SHA ?? "" },
  // The crew console moved from /admin to /crew (it was never "admin" — it's where the crew
  // works). Permanent redirect keeps every old link alive: PWA shortcuts, bookmarks, and the
  // /admin?s=… links stored inside historical alerts (query strings are preserved).
  async redirects() {
    return [{ source: "/admin", destination: "/crew", permanent: true }];
  },
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
      // AN ANSWER IS NOT A PAGE (R42 — the standards' "Search and sharing"). A search engine may read the API (app/robots:
      // a page's words arrive from it, and one that draws the page must see them), but never lists what it reads there.
      { source: "/api/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex" }] },
      appCors,
    ];
  },
};

// THE APP BUILD (2026-10-06, the iPhone round). `npm run build:app` (scripts/build.app.mjs) builds the
// same screens as a static export for the iPhone app, with NEXT_PUBLIC_GT3_TARGET=app (lib/native
// APP_BUILD). An export has no server, so headers() and redirects() do not exist in it: its CSP rides
// in a <meta> tag instead (app/layout.tsx) — the same policy, plus the web's own address, where the
// app's API calls go, and without frame-ancestors, which a <meta> tag cannot carry. Images are served
// as they are (there is no image server either; the one next/image is already unoptimized).
const appCsp = csp
  .replace("connect-src 'self'", "connect-src 'self' https://app.gt3pb.com")
  .split("; ").filter((d) => !d.startsWith("frame-ancestors")).join("; ");
const appConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  // The commit the iPhone build is (R40 — OPS11-12): ios.yml sets GT3_BUILD_COMMIT to the commit it archives; a crash
  // report from a phone carries it (components/ErrorReporter). Empty in a build made anywhere else.
  env: { NEXT_PUBLIC_GT3_APP_CSP: appCsp, NEXT_PUBLIC_BUILD_COMMIT: (process.env.GT3_BUILD_COMMIT ?? "").slice(0, 40) },
};

export default process.env.NEXT_PUBLIC_GT3_TARGET === "app" ? appConfig : nextConfig;
