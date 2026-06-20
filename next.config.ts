import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Content-Security-Policy baked in now (runbook §1/§4): Square Web Payments SDK
// requires HTTPS + a CSP from Oct 2025, even though in-app checkout is deferred.
// Allowances cover what the app will load when commerce + push are switched on:
//   - Square Web Payments SDK + Connect API
//   - OneSignal web push
//   - Supabase realtime (wss)
// In dev we relax script-src ('unsafe-eval') because Next's dev runtime needs it.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"} https://web.squarecdn.com https://sandbox.web.squarecdn.com https://js.squareup.com https://cdn.onesignal.com https://onesignal.com https://*.onesignal.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // OneSignal hits the apex onesignal.com too — a *.onesignal.com wildcard does NOT match the apex.
  "connect-src 'self' https://connect.squareup.com https://connect.squareupsandbox.com https://pci-connect.squareup.com https://pci-connect.squareupsandbox.com https://*.supabase.co wss://*.supabase.co https://onesignal.com https://*.onesignal.com wss://*.onesignal.com https://api.resend.com",
  "frame-src 'self' https://web.squarecdn.com https://sandbox.web.squarecdn.com https://connect.squareup.com https://connect.squareupsandbox.com",
  "worker-src 'self'",
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
