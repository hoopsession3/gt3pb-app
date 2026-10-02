import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fileError } from "@/lib/errorIntake";
import { route } from "@/lib/apiRoute";

export const runtime = "nodejs";

// public: client error intake — guests hit errors too; every field capped, fingerprinted server-side, rate-limited
// CLIENT ERROR INTAKE — the receiving end of components/ErrorReporter. Public by design (guests
// hit errors too), so it trusts nothing: caps every field, computes the fingerprint server-side,
// dedupes into one row per unique error, and rate-limits per instance. First occurrence of a new
// fingerprint raises an alert in the crew inbox (critical if it was an error-boundary/white-screen
// hit, important otherwise) — after that, repeats only bump the counter. Always 204: telemetry
// must never give an attacker a signal or a caller an error to chase.
//
// TWO THINGS THAT MADE THE DEDUP A LIE, both fixed in lib/errorIntake (where the fingerprint and
// the alert live now). First, a deploy-skew message carries the
// content-hashed chunk filename, the Vercel deployment id and an internal module number — all of
// which change on EVERY build. So the one error that recurs most often minted a brand-new
// fingerprint each deploy and alerted every single time; the fingerprint is computed from a
// normalised key now. Second, a skew crash that the client is about to heal was arriving as FATAL
// and paging the owners about a screen that fixed itself. It files as an FYI now. A skew that ran
// out of reload attempts still arrives fatal, because at that point the reload did not fix it.

// Best-effort per-instance rate limit (serverless instances each get their own bucket — fine:
// the goal is flood damping, not accounting).
let windowStart = 0;
let windowCount = 0;
const WINDOW_MS = 60_000;
const WINDOW_MAX = 60;

const s = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

async function post(req: Request) {
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
    const skew = b.skew === true;

    // Fingerprint, dedupe, first-sight alert: lib/errorIntake.ts — the same path a server route
    // that throws takes (lib/apiRoute.ts), so one bug is one row whichever side of the wire hit it.
    await fileError({ message, stack, url, ua, fatal, skew });
  } catch { /* telemetry never throws */ }
  return done;
}

export const POST = route("errors/report", post);
