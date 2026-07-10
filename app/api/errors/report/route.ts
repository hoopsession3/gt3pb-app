import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { raiseAlert } from "@/lib/serverAlerts";

export const runtime = "nodejs";

// CLIENT ERROR INTAKE — the receiving end of components/ErrorReporter. Public by design (guests
// hit errors too), so it trusts nothing: caps every field, computes the fingerprint server-side,
// dedupes into one row per unique error, and rate-limits per instance. First occurrence of a new
// fingerprint raises an alert in the crew inbox (critical if it was an error-boundary/white-screen
// hit, important otherwise) — after that, repeats only bump the counter. Always 204: telemetry
// must never give an attacker a signal or a caller an error to chase.

// Best-effort per-instance rate limit (serverless instances each get their own bucket — fine:
// the goal is flood damping, not accounting).
let windowStart = 0;
let windowCount = 0;
const WINDOW_MS = 60_000;
const WINDOW_MAX = 60;

const s = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

export async function POST(req: Request) {
  const done = new NextResponse(null, { status: 204 });
  try {
    const now = Date.now();
    if (now - windowStart > WINDOW_MS) { windowStart = now; windowCount = 0; }
    if (++windowCount > WINDOW_MAX) return done;
    if (!supabaseAdmin) return done;

    const raw = await req.text();
    if (!raw || raw.length > 8_000) return done;
    const b = JSON.parse(raw) as Record<string, unknown>;
    const message = s(b.message, 400).trim();
    if (!message) return done;
    const stack = s(b.stack, 1_500);
    const url = s(b.url, 300);
    const ua = s(b.ua, 200);
    const fatal = b.fatal === true;

    // Fingerprint: message + top stack frame + path — stable across users/sessions, so one bug
    // is one row no matter how many phones hit it.
    const topFrame = stack.split("\n").slice(0, 2).join(" ");
    let path = url;
    try { path = new URL(url).pathname; } catch { /* keep as-is */ }
    const fingerprint = createHash("sha256").update(`${message}|${topFrame}|${path}`).digest("hex");

    // Dedup: bump the counter if we've seen it; insert (and alert) if we haven't.
    const { data: bumped } = await supabaseAdmin.rpc("bump_client_error", { p_fingerprint: fingerprint });
    if (bumped === true) return done;

    const { error } = await supabaseAdmin.from("client_errors")
      .insert({ fingerprint, message, stack: stack || null, url: url || null, ua: ua || null, fatal });
    if (error) {
      // Unique-violation race (two instances, same new error): bump instead.
      await supabaseAdmin.rpc("bump_client_error", { p_fingerprint: fingerprint });
      return done;
    }
    // New, never-seen error → one alert into the existing inbox/push ladder. raiseAlert is
    // best-effort by contract, so a failure here can't break the report path.
    await raiseAlert({
      severity: fatal ? "critical" : "important",
      category: "system",
      title: fatal ? "App error — a screen crashed" : "App error (new)",
      body: `${message.slice(0, 200)}${path ? ` · ${path}` : ""}`,
      link: "/crew",
    });
  } catch { /* telemetry never throws */ }
  return done;
}
