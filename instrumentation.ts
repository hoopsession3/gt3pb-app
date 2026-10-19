// SERVER ERROR SELF-REPORTING (2026-07-30 — the "crash/error/outage email" round, part 1).
// Next.js calls onRequestError for every error that escapes a route handler or a server-drawn page — the 500s nobody sees
// because the requester just got a broken response and moved on. route() (lib/apiRoute) catches its handlers' throws and
// files them through lib/errorIntake, so what arrives here is what escaped every wrapper. It is filed the intake's way:
// one client_errors row per unique error, a repeat only bumps its counter, and the first sighting raises one alert.
//
// THE SAME RECIPE, NOT A COPY OF IT (R18, 2026-10-17 — the 10/10 audit, operations F3). This file had drifted from the
// intake: the raw message and the raw top of the stack were hashed (a new row and a new alert after every deploy), every
// first sighting rang as a critical, the alert's answer was never read and the alert named no row. It now takes the
// fingerprint recipe, the server's budgets and the alert itself from lib/errorKey — the intake takes them from there too —
// and says in the platform's log when the row or the alert could not be written.
//
// Still self-contained where it matters: raw PostgREST fetches + WebCrypto (no supabase-js, no node:crypto), so it runs
// the same on the nodejs and edge runtimes; its imports (lib/envSchema, lib/errorKey) are pure. Telemetry never throws.

import { notSet } from "./lib/envSchema";
import { errorKey, escapedErrorAlert, SERVER_ALERTS, SERVER_ROWS } from "./lib/errorKey";
import { DB_DEADLINE_MS } from "./lib/dbDeadline";

// WHAT THIS SERVER STARTED WITHOUT (R14, 2026-10-16 — the 10/10 audit's operations pass, F14). A secret missing in
// production turned its feature off without a word: no service-role key, and no order saved, no alert raised, no error
// filed — said nowhere but /api/health's 503. Next calls register() once as each server instance starts: the core and
// feature settings it has no value for are named in the platform's log, one line, names only (lib/envSchema says what
// each is for). Never a value.
export function register() {
  try {
    const missing = notSet(process.env);
    if (missing.length) console.warn(`[env] not set: ${missing.map((e) => `${e.name}${e.need === "core" ? " (core)" : ""}`).join(", ")} — lib/envSchema says what each is for`);
  } catch { /* telemetry never throws */ }
}

type ReqInfo = { path?: string; method?: string };
type ErrCtx = { routerKind?: string; routeType?: string };

export async function onRequestError(err: unknown, request: ReqInfo, context: ErrCtx) {
  try {
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!base || !key) return;

    const e = err as { message?: unknown; stack?: unknown } | null;
    const message = String(e?.message ?? err ?? "Unknown server error").slice(0, 400).trim();
    if (!message) return;
    const stack = String(e?.stack ?? "").slice(0, 1500);
    const path = String(request?.path ?? "").split("?")[0].slice(0, 300);
    const routeType = context?.routeType;

    // The intake's recipe (lib/errorKey), "api|"-prefixed so an escaped error never counts into a row of the intake's.
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`api|${errorKey(message, stack, path)}`));
    const fingerprint = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");

    const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" };
    // A deadline on each (R39 — the fresh audit's API11-10): an error being filed never hangs the request that threw it.
    const soon = () => AbortSignal.timeout(DB_DEADLINE_MS);
    const bump = () => fetch(`${base}/rest/v1/rpc/bump_client_error`, { method: "POST", headers, body: JSON.stringify({ p_fingerprint: fingerprint }), signal: soon() })
      .then((r) => r.json()).then((v) => v === true).catch(() => false);

    // Seen before → bump the counter, no alert (the dedup that keeps this from flooding).
    if (await bump()) return;

    // THE SERVER'S BUDGET (R10b) — lib/errorKey's SERVER_ROWS and SERVER_ALERTS, the buckets route()'s throws spend too.
    // Fails open when the limiter can't be asked, as the intake does.
    const fits = (b: { bucket: string; windowMs: number; max: number }) =>
      fetch(`${base}/rest/v1/rpc/rate_limit_hit`, { method: "POST", headers, body: JSON.stringify({ p_bucket: b.bucket, p_window_ms: b.windowMs, p_max: b.max }), signal: soon() })
        .then((r) => r.json()).then((v) => v !== false).catch(() => true);
    if (!(await fits(SERVER_ROWS))) return;

    // First sighting → file it, and keep its id: the alert names the row it is about, as the intake's do.
    const ins = await fetch(`${base}/rest/v1/client_errors?select=id`, {
      method: "POST", headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({ fingerprint, message, stack: stack || null, url: path || null, ua: `server · ${request?.method ?? "?"} · ${routeType ?? context?.routerKind ?? "unknown"}`, fatal: routeType === "render" }),
      signal: soon(),
    }).catch(() => null);
    if (!ins?.ok) {
      // Unique-violation race (two instances, same brand-new error): the other one filed it, and this counts. Neither
      // answered → said in the platform's log, the intake's line (lib/errorIntake).
      if (!(await bump())) console.warn(`errors: couldn't file or count a server error — ${ins ? `the database answered ${ins.status}` : "the database didn't answer"}; ${message.slice(0, 120)}`);
      return;
    }
    const filed = await ins.json().catch(() => null) as { id?: string }[] | null;

    // …and raise the ONE alert, if the ten minutes' five have room. Past it the row is still filed (Settings › Errors).
    if (!(await fits(SERVER_ALERTS))) return;
    const alert = escapedErrorAlert(message, path, routeType, Array.isArray(filed) ? filed[0]?.id : null);
    // THE ANSWER IS READ (lib/serverAlerts' rule): asked twice; still refused, said in the platform's log in its words.
    let why = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await fetch(`${base}/rest/v1/alerts`, { method: "POST", headers, body: JSON.stringify(alert), signal: soon() }).catch(() => null);
      if (r?.ok) return;
      why = r ? `the database answered ${r.status}` : "the database didn't answer";
    }
    console.error(`[alert-not-written] ${JSON.stringify({ severity: alert.severity, category: alert.category, kind: alert.kind, title: alert.title, why })}`);
  } catch { /* telemetry never throws */ }
}
