import { createHash } from "node:crypto";
import { supabaseAdmin } from "./supabaseAdmin";
import { raiseAlert, raiseAlertOnce } from "./serverAlerts";
import { stableErrorKey } from "./deploySkew";
import { etToday } from "./dates";

// ERROR INTAKE — the one place "the app broke" is written down.
//
// Lifted out of app/api/errors/report on 2026-10-02 so that a server route that throws files its
// error through the SAME fingerprint, the same dedupe and the same first-sight alert as a browser
// that white-screens (lib/apiRoute.ts wraps every handler and calls this). Before that, a route
// that threw was a 500 with an HTML body the client could not parse, logged nowhere the crew can
// see. The table is still called client_errors — it was named for its first tenant; a server
// error files here with ua = "server" and the route's path as its url, and the console reads
// them the same way. One row per unique error no matter how many times it happens; the first
// occurrence is one alert in the crew inbox, after that repeats only bump the counter.
//
// ── THE FLOOD THAT HAD NOT HAPPENED YET (2026-10-02) ───────────────────────────────────────────
// Every alert row fans out as a push to every owner's phone and a Teams message (0157). The one
// producer the public can drive is /api/errors/report, and its only cap was 60 reports a minute
// PER SERVERLESS INSTANCE — the same "30/min per warm instance, not a global cap" that 0154 closed
// for the waitlist. So anyone with curl could mint a brand-new "important" alert per request, for
// as long as they liked, and the first flagship sale would arrive under a thousand of them. This
// repo has already paid for three floods it wrote itself (0123, 0327, 0333); this is the one it
// did not write, bounded before it happened, in the shared store those migrations left behind:
//
//   NEW_ROWS   — at most 30 never-seen fingerprints an hour land as rows. A bad deploy breaks a
//                handful of things, not thirty; past that the intake drops, and the table stays
//                the size of a bug list instead of a log of someone's loop.
//   NEW_ALERTS — at most 5 first-sight alerts in 10 minutes. The sixth error still files (the
//                Errors screen shows it), but instead of a sixth push the inbox gets ONE "storm"
//                line a day (raiseAlertOnce keyed on the date — the 0329 contract, one open row
//                per kind and subject). Repeats of a known error never touch either budget.
//
// The caps are counted in Postgres (rate_limit_hit, 0154) so every instance shares them; if the
// counter itself cannot be reached the intake fails open, because telemetry that refuses to file
// when the database is struggling is telemetry that goes quiet exactly when it matters.
//
// Best-effort by contract: nothing in here throws. Telemetry must never give an attacker a
// signal or a caller a second error to chase.

export type ErrorReport = {
  message: string;        // capped by the caller
  stack?: string;         // first frames only, capped by the caller
  url?: string;           // page path (browser) or route path (server)
  ua?: string;            // user agent family, or "server"
  fatal?: boolean;        // true = error-boundary hit (white-screen class)
  skew?: boolean;         // true = a stale-build crash the client is about to heal
};

export const NEW_ROWS = { bucket: "client-errors:new", windowMs: 3_600_000, max: 30 } as const;
export const NEW_ALERTS = { bucket: "client-errors:alert", windowMs: 600_000, max: 5 } as const;
/** Where the crew reads what was filed: Settings › Advanced › Errors (components/ErrorLog.tsx). */
export const ERRORS_LINK = "/crew?s=settings&a=set-errors";

/** Fingerprint: normalised message + top stack frame + path — stable across users, sessions and
 *  deploys, so one bug is one row no matter how many phones (or instances) hit it. Pure. */
export function fingerprintOf(message: string, stack: string, path: string): string {
  const topFrame = stack.split("\n").slice(0, 2).join(" ");
  return createHash("sha256").update(`${stableErrorKey(message)}|${topFrame}|${path}`).digest("hex");
}

/** The path part of a URL, or the string as given when it is not a URL. Pure. */
export function pathOf(url: string): string {
  try { return new URL(url).pathname; } catch { return url; }
}

// What the intake needs from the outside world, named so a test can hand it doubles. Production
// never passes this; the defaults are the real client and the real alert ladder.
export type IntakeDeps = {
  admin: typeof supabaseAdmin;
  raiseAlert: typeof raiseAlert;
  raiseAlertOnce: typeof raiseAlertOnce;
};

/** Dedupe into one row per fingerprint; alert once on first sight, within the budgets above.
 *  Resolves true when a new row was written (alerted or not), false on a repeat, a drop, or any
 *  failure. Never rejects. */
export async function fileError(r: ErrorReport, deps: IntakeDeps = { admin: supabaseAdmin, raiseAlert, raiseAlertOnce }): Promise<boolean> {
  try {
    const admin = deps.admin;
    if (!admin) return false;
    const message = r.message.trim();
    if (!message) return false;
    const stack = r.stack ?? "";
    const url = r.url ?? "";
    const fatal = r.fatal === true;
    const skew = r.skew === true;
    const path = pathOf(url);
    const fingerprint = fingerprintOf(message, stack, path);

    // Dedup: bump the counter if we've seen it; insert (and alert) if we haven't.
    const { data: bumped } = await admin.rpc("bump_client_error", { p_fingerprint: fingerprint });
    if (bumped === true) return false;

    // Never seen — does a new row fit in this hour's budget? `false` is the limiter's answer;
    // anything else (null, an error) is the limiter not answering, and the intake fails open.
    const { data: rowFits } = await admin.rpc("rate_limit_hit", { p_bucket: NEW_ROWS.bucket, p_window_ms: NEW_ROWS.windowMs, p_max: NEW_ROWS.max });
    if (rowFits === false) return false;

    const { error } = await admin.from("client_errors")
      .insert({ fingerprint, message, stack: stack || null, url: url || null, ua: r.ua || null, fatal, skew });
    if (error) {
      // Unique-violation race (two instances, same new error): bump instead.
      await admin.rpc("bump_client_error", { p_fingerprint: fingerprint });
      return false;
    }

    // New, never-seen error → one alert into the existing inbox/push ladder, if the inbox has
    // room for it. raiseAlert is best-effort by contract, so a failure here can't break the
    // report path.
    const { data: alertFits } = await admin.rpc("rate_limit_hit", { p_bucket: NEW_ALERTS.bucket, p_window_ms: NEW_ALERTS.windowMs, p_max: NEW_ALERTS.max });
    if (alertFits === false) {
      // The row is filed; the push is not. One storm line a day stands for all of them: the
      // subject is the business day (etToday — the house rule: nobody asks UTC what day it is),
      // so a storm that runs for hours is one line, and one that comes back next week is news
      // again. (A broadcast's "Got it" is per person and never sets ack_at —
      // 0157 — so keying on "until acknowledged" alone would mean one line per three weeks.)
      await deps.raiseAlertOnce({
        severity: "important", category: "system", kind: "error_storm", subjectId: etToday(),
        title: "Error storm — new-error alerts paused",
        body: `More than ${NEW_ALERTS.max} new errors in ${NEW_ALERTS.windowMs / 60_000} minutes. Each one is still filed under Settings › Errors; the inbox gets this one line instead of one per error.`,
        link: ERRORS_LINK,
      });
      return true;
    }
    // A screen that healed itself is news, not an emergency. Anything the client could not heal —
    // including a skew that exhausted its reloads — is still the critical it always was. A server
    // route that threw is important: the caller got a 500, but nothing crashed on their screen.
    const healed = skew && !fatal;
    const server = r.ua === "server";
    await deps.raiseAlert({
      severity: healed ? "fyi" : fatal ? "critical" : "important",
      category: "system",
      title: healed
        ? "App recovered from a stale build"
        : fatal ? "App error — a screen crashed" : server ? "Server error — a route threw" : "App error (new)",
      body: healed
        ? `A tab was one deploy behind and reloaded itself${path ? ` · ${path}` : ""}. Nothing was lost; no action needed.`
        : `${message.slice(0, 200)}${path ? ` · ${path}` : ""}`,
      link: ERRORS_LINK,
    });
    return true;
  } catch { return false; /* telemetry never throws */ }
}
