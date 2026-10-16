import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { route } from "@/lib/apiRoute";
import { callerIp, limitsFit } from "@/lib/rateLimit";

// public: out-of-zone waitlist capture, write-only and bounded — rate-limited in Postgres, no client table access
// OUT-OF-ZONE WAITLIST — capture only, fail-silent-ish, tightly bounded. No client table access
// (service role writes). Rate limit lives in Postgres (rate_limit_hit, 0154) — a per-lambda
// in-memory counter used to live here, which on Vercel serverless is really "30/min per warm
// instance," not a global cap; a shared store closes that.
// ONE ADDRESS BEFORE EVERYONE (R10, 2026-10-16 — the 10/10 audit). The cap was one bucket for everybody, so one script
// posting thirty a minute closed the waitlist to every customer out of the zone — each of them told "too many requests"
// while it ran. Now an address has its own six in ten minutes (a person joins once, maybe for a second ZIP), asked
// first, and the shared thirty a minute last: a script over its own six never spends what customers share.
const WINDOW_MS = 60_000, WINDOW_MAX = 30;
const PER_ADDRESS = { windowMs: 600_000, max: 6 };

async function post(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ ok: true }); // capture is best-effort by design
  const underCap = await limitsFit(supabaseAdmin, [
    { bucket: `delivery-waitlist:${callerIp(req)}`, ...PER_ADDRESS },
    { bucket: "delivery-waitlist", windowMs: WINDOW_MS, max: WINDOW_MAX },
  ]);
  // Was `{ ok: true }` — same shape as a genuine success. The client (OrderFunnel.joinWaitlist) reads
  // `r.ok` and shows "You're on the list" on ANY 2xx, so a burst past the cap (a plausible spike from
  // a social/marketing post) silently confirmed signups that were never written, and those people
  // never get contacted when their ZIP opens up. A non-2xx here makes the client fall into its
  // existing "Enter a ZIP and a real email" retry path instead — not perfectly worded for this exact
  // cause, but it correctly does NOT tell them they're on the list when they aren't.
  if (!underCap) return NextResponse.json({ ok: false, error: "Too many requests — try again in a moment." }, { status: 429 });

  let b: { zip?: string; email?: string };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  // A literal null is valid JSON: refused as the bad request it is, not read into a 500.
  if (!b || typeof b !== "object") return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const zip = typeof b.zip === "string" ? b.zip.trim().slice(0, 10) : "";
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase().slice(0, 120) : "";
  if (!/^\d{5}/.test(zip) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a ZIP and a real email." }, { status: 400 });
  }
  // The upsert's result was never checked — a genuine DB failure also silently returned ok:true.
  // The (zip,email) unique constraint means this can't duplicate on the happy path, so surfacing an
  // error here only ever fires on a real write failure, never a false alarm.
  const { error } = await supabaseAdmin.from("delivery_waitlist").upsert({ zip: zip.slice(0, 5), email }, { onConflict: "zip,email", ignoreDuplicates: true });
  if (error) return NextResponse.json({ ok: false, error: "That didn't save — try again." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export const POST = route("delivery/waitlist", post);
