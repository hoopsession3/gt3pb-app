import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Content-Security-Policy baked in now (runbook §1/§4): Square Web Payments SDK
// requires HTTPS + a CSP from Oct 2025, even though in-app checkout is deferred.
// Allowances cover what the app will load when commerce + push are switched on:
//   - Square Web Payments SDK + Connect API
//   - OneSignal web push
//   - Supabase realtime (wss)
// In dev we relax script-src ('unsafe-eval') because Next's dev runtime needs it.
// Square Web Payments SDK is finicky about CSP: it loads square.js, fetches config from
// web.squarecdn.com, spawns a blob: worker for tokenization, renders the card as an iframe, and
// reports to its own Sentry. Missing any of these silently kills the card form (window.Square never
// appears). The full squarecdn wildcard + worker/child blob: cover it.
const SQ = "https://web.squarecdn.com https://sandbox.web.squarecdn.com https://*.squarecdn.com https://js.squareup.com";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"} ${SQ} https://cdn.onesignal.com https://onesignal.com https://*.onesignal.com`,
  "style-src 'self' 'unsafe-inline' https://web.squarecdn.com https://*.squarecdn.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://*.squarecdn.com",
  // OneSignal hits the apex onesignal.com too — a *.onesignal.com wildcard does NOT match the apex.
  "connect-src 'self' https://connect.squareup.com https://connect.squareupsandbox.com https://pci-connect.squareup.com https://pci-connect.squareupsandbox.com https://web.squarecdn.com https://*.squarecdn.com https://o160250.ingest.sentry.io https://*.supabase.co wss://*.supabase.co https://onesignal.com https://*.onesignal.com wss://*.onesignal.com https://api.resend.com https://nominatim.openstreetmap.org",
  `frame-src 'self' ${SQ} https://connect.squareup.com https://connect.squareupsandbox.com`,
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "manifest-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Content-Security-Policy", value: csp },
];

const nextConfig: NextConfig = {
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
    ];
  },
};

export default nextConfig;
