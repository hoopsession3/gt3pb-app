import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// OUT-OF-ZONE WAITLIST — capture only, fail-silent-ish, tightly bounded. No client table access
// (service role writes). Rate limit lives in Postgres (rate_limit_hit, 0154) — a per-lambda
// in-memory counter used to live here, which on Vercel serverless is really "30/min per warm
// instance," not a global cap; a shared store closes that.
const WINDOW_MS = 60_000, WINDOW_MAX = 30;

export async function POST(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ ok: true }); // capture is best-effort by design
  const { data: underCap } = await supabaseAdmin.rpc("rate_limit_hit", { p_bucket: "delivery-waitlist", p_window_ms: WINDOW_MS, p_max: WINDOW_MAX });
  // Was `{ ok: true }` — same shape as a genuine success. The client (OrderFunnel.joinWaitlist) reads
  // `r.ok` and shows "You're on the list" on ANY 2xx, so a burst past the cap (a plausible spike from
  // a social/marketing post) silently confirmed signups that were never written, and those people
  // never get contacted when their ZIP opens up. A non-2xx here makes the client fall into its
  // existing "Enter a ZIP and a real email" retry path instead — not perfectly worded for this exact
  // cause, but it correctly does NOT tell them they're on the list when they aren't.
  if (underCap === false) return NextResponse.json({ ok: false, error: "Too many requests — try again in a moment." }, { status: 429 });

  let b: { zip?: string; email?: string };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
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
