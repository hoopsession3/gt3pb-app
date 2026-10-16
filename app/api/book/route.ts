import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { integrationTenant } from "@/lib/tenantScope";
import { toMarket } from "@/lib/markets";
import { route } from "@/lib/apiRoute";
import { callerIp, limitsFit } from "@/lib/rateLimit";

export const runtime = "nodejs";

// public: an event planner asks to book the bar, signed in or not — the form a guest fills in
// bounded in its own code: three an address in ten minutes, three an email a day, thirty an hour for everyone (rate_limit_hit, 0154), and a field only a bot fills

// BOOK THE BAR, THROUGH A DOOR THAT COUNTS (R9, 2026-10-16 — the abuse audit's second).
//
// The form wrote booking_requests straight from the browser, under a policy that let anyone insert ("anyone request",
// 0004), and every row is an important alert on the crew's phones and an email to every admin carrying what was typed
// (supabase/functions/push). Anyone with the public key could loop it: the crew's phones rung all night, the admins'
// inboxes filled with text the sender chose — sent from our own address — and the email quota spent until customers'
// receipts stopped. Now the form posts here:
//   · a field no person sees (`website`): filled in, the request is thanked and dropped — a bot learns nothing;
//   · three requests an address in ten minutes, three an email a day, thirty an hour for everyone — no event planner
//     meets those; a script does at once. In the store every instance shares (rate_limit_hit, 0154); fails open, as
//     the checkout's guard does, when the store can't be asked;
//   · the fields checked and cut to the table's own limits, the city one of ours.
// A browser from before this (the app's own build) still writes direct; 0418 holds that door to six an hour for all.
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function post(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ ok: false, error: "Booking isn't switched on yet." }, { status: 503 });
  let b: Record<string, unknown>;
  try { b = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ ok: false, error: "Bad request" }, { status: 400 }); }
  if (!b || typeof b !== "object") return NextResponse.json({ ok: false, error: "Bad request" }, { status: 400 });

  // The field no person fills in: thanked, and not kept — said in the logs, so a person caught by it can be found.
  if (str(b.website, 200)) { console.warn("[book] a request with the hidden field filled was dropped"); return NextResponse.json({ ok: true }); }

  const name = str(b.name, 200), email = str(b.email, 200).toLowerCase();
  if (!name || !EMAIL.test(email)) return NextResponse.json({ ok: false, error: "Add your name and an email we can answer." }, { status: 400 });
  const day = str(b.event_date, 10);
  const headcount = Number(b.headcount);

  // Asked in order (lib/rateLimit, R10): the address, the email, then everyone — a sender over its own three never spends
  // the thirty every event planner shares.
  const ip = callerIp(req);
  if (!(await limitsFit(supabaseAdmin, [
    { bucket: `book:${ip}`, windowMs: 600_000, max: 3 },
    // The address by a digest: the limiter's store keeps counts, not who asked.
    { bucket: `book:e:${createHash("sha256").update(email).digest("hex").slice(0, 24)}`, windowMs: 86_400_000, max: 3 },
    { bucket: "book:global", windowMs: 3_600_000, max: 30 },
  ]))) {
    return NextResponse.json({ ok: false, error: "We've had a lot of requests just now — give it a few minutes, or email hello@gt3pb.com." }, { status: 429 });
  }

  const { error } = await supabaseAdmin.from("booking_requests").insert({
    tenant_id: integrationTenant(),
    name, email,
    phone: str(b.phone, 40) || null,
    market: toMarket(b.market),
    event_date: DAY.test(day) && Number.isFinite(Date.parse(day)) ? day : null,
    headcount: Number.isInteger(headcount) && headcount >= 1 && headcount <= 100_000 ? headcount : null,
    location_text: str(b.location_text, 300) || null,
    notes: str(b.notes, 2000) || null,
  });
  if (error) return NextResponse.json({ ok: false, error: "Couldn't send — try again in a moment." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export const POST = route("book", post);
