import { createHash } from "node:crypto";
import { supabaseAdmin } from "./supabaseAdmin";
import { raiseAlert } from "./serverAlerts";
import { stableErrorKey } from "./deploySkew";

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

/** Dedupe into one row per fingerprint; alert once on first sight. Resolves false on a repeat,
 *  true when a new row (and alert) was written. Never rejects. */
export async function fileError(r: ErrorReport): Promise<boolean> {
  try {
    if (!supabaseAdmin) return false;
    const message = r.message.trim();
    if (!message) return false;
    const stack = r.stack ?? "";
    const url = r.url ?? "";
    const fatal = r.fatal === true;
    const skew = r.skew === true;
    const path = pathOf(url);
    const fingerprint = fingerprintOf(message, stack, path);

    // Dedup: bump the counter if we've seen it; insert (and alert) if we haven't.
    const { data: bumped } = await supabaseAdmin.rpc("bump_client_error", { p_fingerprint: fingerprint });
    if (bumped === true) return false;

    const { error } = await supabaseAdmin.from("client_errors")
      .insert({ fingerprint, message, stack: stack || null, url: url || null, ua: r.ua || null, fatal, skew });
    if (error) {
      // Unique-violation race (two instances, same new error): bump instead.
      await supabaseAdmin.rpc("bump_client_error", { p_fingerprint: fingerprint });
      return false;
    }
    // New, never-seen error → one alert into the existing inbox/push ladder. raiseAlert is
    // best-effort by contract, so a failure here can't break the report path.
    // A screen that healed itself is news, not an emergency. Anything the client could not heal —
    // including a skew that exhausted its reloads — is still the critical it always was. A server
    // route that threw is important: the caller got a 500, but nothing crashed on their screen.
    const healed = skew && !fatal;
    const server = r.ua === "server";
    await raiseAlert({
      severity: healed ? "fyi" : fatal ? "critical" : "important",
      category: "system",
      title: healed
        ? "App recovered from a stale build"
        : fatal ? "App error — a screen crashed" : server ? "Server error — a route threw" : "App error (new)",
      body: healed
        ? `A tab was one deploy behind and reloaded itself${path ? ` · ${path}` : ""}. Nothing was lost; no action needed.`
        : `${message.slice(0, 200)}${path ? ` · ${path}` : ""}`,
      link: "/crew",
    });
    return true;
  } catch { return false; /* telemetry never throws */ }
}
