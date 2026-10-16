"use client";

import { useEffect } from "react";
import { classifyCrash, readSkewMemory } from "@/lib/deploySkew";
import { APP_BUILD, apiUrl } from "@/lib/native";
import { shareableUrl } from "@/lib/reportUrl";

// ERROR REPORTER — the sending end of /api/errors/report. Catches what the console used to eat
// (window errors + unhandled promise rejections) and what the error boundary catches (fatal), and
// ships a capped, deduped report so a breakage in the field is VISIBLE in the crew alert inbox.
// Self-disciplined: one send per unique error per session, hard cap per session, fire-and-forget
// (sendBeacon when possible) — reporting must never make the app worse.
const SESSION_MAX = 8;
let sent = 0;
const seen = new Set<string>();

// `skew` says this crash is the stale-build family (a tab one deploy behind). The server uses it
// to file the report as an FYI rather than paging someone about a screen that healed itself.
export function reportClientError(input: { message?: string; stack?: string; fatal?: boolean; skew?: boolean }): void {
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
      url: shareableUrl(window.location).slice(0, 300),
      ua: navigator.userAgent.slice(0, 200),
      fatal: input.fatal === true,
      skew: input.skew === true,
    });
    // Beacon survives page unloads (the exact moment fatal errors happen); fetch is the fallback.
    // Not in the iPhone app (2026-10-06): its report goes to the web, another origin, and a JSON
    // beacon there is a request the browser may drop rather than ask about — keepalive fetch, which
    // the route's CORS answers, carries it instead (lib/native).
    if (!APP_BUILD && navigator.sendBeacon?.("/api/errors/report", new Blob([body], { type: "application/json" }))) return;
    fetch(apiUrl("/api/errors/report"), { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch { /* never throw from the reporter */ }
}

// WHAT EVERY CRASH SCREEN DOES FIRST (R11, 2026-10-16 — the 10/10 audit). app/error.tsx decided what a crash was before
// saying it, and healed a tab one build behind with one reload — and it was the only place that did. A crash in the root
// layout (app/global-error.tsx) or in a piece of the chrome (components/Fence) got neither: no report, no heal. The one
// decision lives here now, for all three. `where` names the piece in the report; a piece that steps aside on its own
// (fatal: false) files a non-skew crash as an error, not a page — the screen it sat on kept working.
const SKEW_KEY = "gt3-skew";
export function recoverFromCrash(error: { message?: string; stack?: string; digest?: string } | null | undefined, opts: { where?: string; fatal?: boolean } = {}): { reloading: boolean } {
  try {
    if (typeof window === "undefined") return { reloading: false };
    let raw: string | null = null;
    try { raw = sessionStorage.getItem(SKEW_KEY); } catch { /* private mode */ }
    const message = String(error?.message ?? error ?? "");
    const plan = classifyCrash(message, readSkewMemory(raw), Date.now());
    reportClientError({
      message: `${opts.where ? `[${opts.where}] ` : ""}${message}${error?.digest ? ` [${error.digest}]` : ""}`,
      stack: error?.stack,
      fatal: plan.fatal && opts.fatal !== false,
      skew: plan.skew,
    });
    if (!plan.reload) return { reloading: false };
    try { sessionStorage.setItem(SKEW_KEY, JSON.stringify(plan.mem)); } catch { /* ignore */ }
    window.location.reload();
    return { reloading: true };
  } catch { return { reloading: false }; }
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
