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
  browser?: boolean;      // true = sent by a browser (/api/errors/report): anyone can send one (R9) — see below
};

/** What a browser's report may put in an alert (R9 — the abuse audit's seventh). Anyone can post one, and the alert's body
 *  goes into the admins' email and Teams: a "message" carrying a link was a phishing note sent from our own address. Its
 *  words are kept, with any link taken out; the row under Settings › Errors keeps all of it. Pure. */
export function reportWords(message: string): string {
  return message.replace(/\b(?:https?:\/\/|www\.)\S+/gi, "[link]").replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|app|xyz|info|biz|ru|cn|top|link|click|me|us)\b\S*/gi, "[link]").slice(0, 160);
}

export const NEW_ROWS = { bucket: "client-errors:new", windowMs: 3_600_000, max: 30 } as const;
export const NEW_ALERTS = { bucket: "client-errors:alert", windowMs: 600_000, max: 5 } as const;
// THE SERVER'S OWN BUDGET (R10b, 2026-10-16 — the 10/10 audit). A route that threw shared the hour's thirty with every
// browser report — and anyone can post one: thirty made-up messages from one address in ten minutes, and a real crash
// in the checkout was neither filed nor alerted for the rest of the hour. A route's own throw (ua "server", never sent
// by a browser) counts against these; a browser's report never does.
export const SERVER_ROWS = { bucket: "server-errors:new", windowMs: 3_600_000, max: 30 } as const;
export const SERVER_ALERTS = { bucket: "server-errors:alert", windowMs: 600_000, max: 5 } as const;
/** Whose budget a report spends: a route's own throw the server's, anything a browser could have sent the browsers'. Pure. */
export function budgetsFor(r: Pick<ErrorReport, "ua" | "browser">): { rows: typeof NEW_ROWS | typeof SERVER_ROWS; alerts: typeof NEW_ALERTS | typeof SERVER_ALERTS } {
  return r.browser !== true && r.ua === "server" ? { rows: SERVER_ROWS, alerts: SERVER_ALERTS } : { rows: NEW_ROWS, alerts: NEW_ALERTS };
}
/** Where the crew reads what was filed: Settings › Advanced › Errors (components/ErrorLog.tsx). */
export const ERRORS_LINK = "/crew?s=settings&a=set-errors";

/** Where a bug was thrown, without what moves on every build (R11, 2026-10-16 — the 10/10 audit). The fingerprint took
 *  the stack's first two lines as they came: V8's first line repeats the message (ids and all), and a frame names a
 *  content-hashed chunk, a line and column, and a minified name — all different whenever the file is rebuilt. So one bug
 *  was a new row, a new alert and a split count after every deploy that touched its file; the test that said otherwise
 *  held the stack the same on both deploys. What is kept is the top frame's file, unhashed: a server route's own path, or
 *  "a chunk" in the browser. V8 ("at name (file:1:2)"), Safari and Firefox ("name@file:1:2"). Pure. */
export function stableFrame(stack: string): string {
  const lines = String(stack ?? "").split("\n").map((l) => l.trim());
  const v8 = lines.find((l) => /^at\s/.test(l));
  let where = "";
  if (v8) where = /\(([^()]*)\)$/.exec(v8)?.[1] ?? v8.replace(/^at\s+(?:async\s+)?/, "");
  else {
    const other = lines.find((l) => /^[^@]*@\S+:\d+(?::\d+)?$/.test(l));
    where = other ? other.slice(other.indexOf("@") + 1) : "";
  }
  // A build's hash in a server chunk's name ("[root-of-the-server]__a1b2c3d4._.js") is not a word stableErrorKey can see.
  return stableErrorKey(where.replace(/:\d+(?::\d+)?$/, "").replace(/[?#].*$/, "").replace(/(?<![0-9a-z])(?=[0-9a-f]*\d)[0-9a-f]{6,}(?![0-9a-z])/gi, "<h>"));
}

/** Fingerprint: normalised message + where it was thrown + path — stable across users, sessions and
 *  deploys, so one bug is one row no matter how many phones (or instances) hit it. Pure. */
export function fingerprintOf(message: string, stack: string, path: string): string {
  return createHash("sha256").update(`${stableErrorKey(message)}|${stableFrame(stack)}|${path}`).digest("hex");
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
    const budget = budgetsFor(r);
    const { data: rowFits } = await admin.rpc("rate_limit_hit", { p_bucket: budget.rows.bucket, p_window_ms: budget.rows.windowMs, p_max: budget.rows.max });
    if (rowFits === false) return false;

    // The id comes back so the alert can NAME this row (kind client_error, subject = the row). Until
    // 2026-10-04 it carried no key at all, so the only way to find the alerts this intake had written
    // was to match their message — which is how 0340 had to retire two from July and September.
    const { data: filed, error } = await admin.from("client_errors")
      .insert({ fingerprint, message, stack: stack || null, url: url || null, ua: r.ua || null, fatal, skew })
      .select("id").single();
    if (error) {
      // Unique-violation race (two instances, same new error): bump instead.
      const bumped = await admin.rpc("bump_client_error", { p_fingerprint: fingerprint });
      if (bumped.error) console.warn(`errors: couldn't file or count a client error — ${error.message}; ${bumped.error.message}`);   // R12b
      return false;
    }

    // New, never-seen error → one alert into the existing inbox/push ladder, if the inbox has
    // room for it. raiseAlert is best-effort by contract, so a failure here can't break the
    // report path.
    const { data: alertFits } = await admin.rpc("rate_limit_hit", { p_bucket: budget.alerts.bucket, p_window_ms: budget.alerts.windowMs, p_max: budget.alerts.max });
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
    // A screen that healed itself is news, not an emergency. A server route that threw is important: the caller got a
    // 500, but nothing crashed on their screen. A browser's crash is important too since R9: anyone can post one, and a
    // critical rings every owner, emails and posts to Teams, and rings again ten minutes on — thirty an hour, in words
    // the sender chose. The crew at a crashed screen sees it; the inbox and the Errors list say it, important.
    const healed = skew && !fatal;
    const server = r.ua === "server";
    const browser = r.browser === true;
    await deps.raiseAlert({
      severity: healed ? "fyi" : fatal && !browser ? "critical" : "important",
      category: "system",
      kind: "client_error",
      subjectId: (filed as { id?: string } | null)?.id,
      title: healed
        ? "App recovered from a stale build"
        : fatal ? "App error — a screen crashed" : server ? "Server error — a route threw" : "App error (new)",
      body: healed
        ? `A tab was one deploy behind and reloaded itself${path ? ` · ${path}` : ""}. Nothing was lost; no action needed.`
        : `${browser ? reportWords(message) : message.slice(0, 200)}${path ? ` · ${(browser ? path.replace(/[^\w/.-]/g, "") : path).slice(0, 80)}` : ""}`,
      link: ERRORS_LINK,
    });
    return true;
  } catch { return false; /* telemetry never throws */ }
}
