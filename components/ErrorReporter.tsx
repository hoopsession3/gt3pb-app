"use client";

import { useEffect } from "react";

// ERROR REPORTER — the sending end of /api/errors/report. Catches what the console used to eat
// (window errors + unhandled promise rejections) and what the error boundary catches (fatal), and
// ships a capped, deduped report so a breakage in the field is VISIBLE in the crew alert inbox.
// Self-disciplined: one send per unique error per session, hard cap per session, fire-and-forget
// (sendBeacon when possible) — reporting must never make the app worse.
const SESSION_MAX = 8;
let sent = 0;
const seen = new Set<string>();

export function reportClientError(input: { message?: string; stack?: string; fatal?: boolean }): void {
  try {
    if (typeof window === "undefined") return;
    const message = (input.message ?? "").slice(0, 400).trim();
    if (!message || sent >= SESSION_MAX) return;
    const localKey = `${message}|${(input.stack ?? "").split("\n")[1] ?? ""}`;
    if (seen.has(localKey)) return;
    seen.add(localKey);
    sent++;
    const body = JSON.stringify({
      message,
      stack: (input.stack ?? "").slice(0, 1500),
      url: window.location.href.slice(0, 300),
      ua: navigator.userAgent.slice(0, 200),
      fatal: input.fatal === true,
    });
    // Beacon survives page unloads (the exact moment fatal errors happen); fetch is the fallback.
    if (navigator.sendBeacon?.("/api/errors/report", new Blob([body], { type: "application/json" }))) return;
    fetch("/api/errors/report", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch { /* never throw from the reporter */ }
}

export default function ErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      // Cross-origin scripts surface as bare "Script error." with zero detail — nothing actionable.
      if (!e.message || e.message === "Script error.") return;
      reportClientError({ message: e.message, stack: e.error?.stack, fatal: false });
    };
    const onReject = (e: PromiseRejectionEvent) => {
      const r = e.reason as { message?: string; stack?: string } | string | undefined;
      const message = typeof r === "string" ? r : r?.message ?? "Unhandled promise rejection";
      // Benign, expected noise: offline fetches + user-cancelled requests aren't bugs.
      if (/Failed to fetch|NetworkError|Load failed|AbortError/i.test(message)) return;
      reportClientError({ message, stack: typeof r === "object" ? r?.stack : undefined, fatal: false });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onReject);
    return () => { window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onReject); };
  }, []);
  return null;
}
