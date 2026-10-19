import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { TablesInsert } from "@/lib/database.types";
import { userFromRequest } from "@/lib/apiAuth";
import { raiseAlert } from "@/lib/serverAlerts";
import { OFFICE, officeQuote, nextMondayKey, mondayLabel, windowHours } from "@/lib/office";
import { zipMarket } from "@/lib/delivery";
import { marketServes } from "@/lib/markets";
import { money } from "@/lib/money";
import { route } from "@/lib/apiRoute";

export const runtime = "nodejs";

// OFFICE ORDER — the authoritative write path for a B2B office delivery (the one order type that
// still inserted straight from the browser). The client draws a quote for display, but the price is
// NEVER trusted from it: this route recomputes gallons + per-gallon + total from the live owner-set
// price (live_status, 0189) server-side, re-checks the delivery zone, and writes business_orders with
// the service role. That closes the gap where a tampered total_cents / gallons / price_per_gallon_cents
// from dev tools would drive the prepaid Square payment-link amount (/api/office/paylink reads
// total_cents off the row) or the net-terms invoice. Mirrors the "server recomputes, service role
// writes" hardening the cup/pack/delivery order types already have (/api/checkout, /api/reserve,
// /api/delivery). Member-gated — an office order always belongs to an account.

async function post(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ error: "Office delivery isn't switched on yet." }, { status: 503 });

  // Auth + email in one trusted read: the email seeds the standing account's contact, so it comes
  // from the verified session (lib/apiAuth.userFromRequest), never the client body.
  const caller = await userFromRequest(req);
  if (!caller) return NextResponse.json({ error: "Sign in to set up office delivery." }, { status: 401 });
  // Counted (R9 — the abuse audit's fourth): every booking is an alert on the crew's phones, and a weekly one sets up a
  // standing program. Five an hour a member — an office books once — in the store every instance shares. Fails open.
  const fits = await supabaseAdmin.rpc("rate_limit_hit", { p_bucket: `office:u:${caller.id}`, p_window_ms: 3_600_000, p_max: 5 });
  if (fits.data === false) return NextResponse.json({ error: "That's a lot of bookings in one go — give it a while, or text us." }, { status: 429 });
  const userId = caller.id;
  const userEmail = caller.email;

  let body: {
    company?: string; contact?: string; phone?: string; headcount?: string | number;
    street?: string; city?: string; zip?: string; access?: string;
    gallons?: number; standing?: boolean; billing?: string; key?: string;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Bad request" }, { status: 400 });   // a literal null is valid JSON (R10b): a 400, not a TypeError's 500

  // Trim + bound every field server-side (the client maxLengths are a convenience, not a guarantee).
  const company = String(body.company ?? "").trim().slice(0, 80);
  const contact = String(body.contact ?? "").trim().slice(0, 60);
  const phone = String(body.phone ?? "").trim().slice(0, 40);
  const street = String(body.street ?? "").trim().slice(0, 120);
  const city = String(body.city ?? "").trim().slice(0, 60);
  const zip = String(body.zip ?? "").replace(/\D/g, "").slice(0, 5);
  const access = String(body.access ?? "").trim().slice(0, 200);
  const billing: "prepaid" | "net15" = body.billing === "net15" ? "net15" : "prepaid";
  const standing = body.standing === true;
  // The booking's own key (R15, 0422 — the 10/10 audit, API F25), made by the form when it opens. Anything else is no
  // key: the booking is made as it was before keys.
  const key = typeof body.key === "string" && /^[A-Za-z0-9-]{8,80}$/.test(body.key) ? body.key : null;
  const headcount = body.headcount != null && String(body.headcount).trim() !== ""
    ? Math.max(0, Math.min(9999, parseInt(String(body.headcount), 10) || 0)) : null;

  // Authoritative price from the owner-set live values (the same source useOfficeSettings reads),
  // code constants as the fallback — read with the service role, never taken from the client.
  // The fallback is for a price never set, never for a read that failed (R39 — the fresh audit's API11-06): a booking during
  // a blip was priced at the code's per gallon, not the owner's, and its pay link asked for that. It waits.
  const { data: ls, error: priceError } = await supabaseAdmin.from("live_status").select("office_price_cents, office_min_gallons").eq("id", 1).maybeSingle();
  if (priceError) return NextResponse.json({ error: "We couldn't read the price just now — try again in a moment. Nothing was booked." }, { status: 503 });
  const lsRow = ls as { office_price_cents?: number; office_min_gallons?: number } | null;
  const priceCents = lsRow?.office_price_cents ?? OFFICE.pricePerGallonCents;
  const minGallons = lsRow?.office_min_gallons ?? OFFICE.minGallons;

  // Recompute the quote server-side from the requested gallons (officeQuote clamps to the min).
  // A ceiling too (R10b, 2026-10-16 — the 10/10 audit): the floor was the only bound, so a booking could ask for a billion
  // gallons a week (Infinity went into the row as null). A hundred, the client's own change door's ceiling (0360).
  if (Number(body.gallons) > 100) return NextResponse.json({ error: "More than 100 gallons a week? Text us and we'll set it up with you." }, { status: 400 });
  const q = officeQuote(Number(body.gallons) || 0, { priceCents, minGallons });

  // Validate — this is the real enforcement point, mirroring the client's pre-check.
  if (!company || !street || !city || zip.length < 5) return NextResponse.json({ error: "Add your company and full address first." }, { status: 400 });
  // Zone check, market-aware. Instead of assuming the founding market and rejecting every other
  // city's ZIP, resolve WHICH market serves this address and require that market to actually fulfil
  // corporate delivery. Greenville ZIPs resolve exactly as they did before; an Atlanta business ZIP
  // now resolves to Atlanta rather than being turned away as "outside our route".
  const market = zipMarket(zip);
  if (!market || !marketServes(market, "corporate")) return NextResponse.json({ error: "That ZIP looks outside our delivery route — text us and we'll see what we can do." }, { status: 400 });
  if (billing === "prepaid" && !phone) return NextResponse.json({ error: "Add a phone — the crew sends the payment link to it." }, { status: 400 });

  // THE DATE IS THE DATABASE'S, IN THE MARKET'S TIME (2026-10-07, 0356). This was nextMondayKey() in
  // the server's own zone — UTC on Vercel — so from a Sunday evening in Greenville it booked the Monday
  // after next, and nothing closed changes before a delivery. office_next_delivery answers in the
  // market's time zone: the next day the market's window falls on whose cutoff (6 PM the weekday
  // before) is still ahead, with the market's own window.
  let dateKey = nextMondayKey();
  let windowCode: string = OFFICE.window;
  let cutoffAt: string | null = null;
  const next = await supabaseAdmin.rpc("office_next_delivery", { p_market: market });
  // The database's own words stay in the logs (R9 — the abuse audit's twelfth): a member is told what didn't happen, and
  // how to get it done — never a table's or a function's name.
  if (next.error) { console.warn(`[office] office_next_delivery: ${next.error.message}`); return NextResponse.json({ error: "Couldn't work out the delivery date — try again in a moment, or text us." }, { status: 500 }); }
  const slot = (next.data as { delivery_date: string; cutoff_at: string; delivery_window: string }[] | null)?.[0];
  if (slot) { dateKey = slot.delivery_date; windowCode = slot.delivery_window; cutoffAt = slot.cutoff_at; }

  // Standing account create/update (service role, scoped to this user) — the same reuse-not-duplicate
  // logic the client had, now un-forgeable. The DB unique index on (user_id, lower(company)) (0242)
  // is the concurrent-double-submit backstop.
  //
  // THE ACCOUNT KEEPS ITS CITY AND ITS DOOR (2026-10-04, the form audit). `market` went in as the
  // column's default — 'greenville' — for every office, so Atlanta's corporate accounts (the market's
  // whole opening plan, lib/markets) were filed under Greenville, and generate_office_route (0282),
  // which prices and schedules a standing account by ITS market, read Greenville's terms for them.
  // And the access notes ("suite 300, badge at the desk") went on the first order only: the account
  // had no column for them (0346 adds it), so every order the generator made afterwards reached the
  // door without them.
  let businessId: string | null = null;
  if (standing) {
    const companyNorm = company.replace(/\s+/g, " ");
    const acctRow: TablesInsert<"business_accounts"> = {
      user_id: userId, company: companyNorm, contact_name: contact || null, contact_phone: phone || null,
      contact_email: userEmail, address_street: street, address_city: city, address_zip: zip,
      headcount, billing_terms: billing, standing_active: true, standing_gallons: q.gallons, market,
      access_instructions: access || null,
    };
    const { data: existing, error: existingError } = await supabaseAdmin.from("business_accounts").select("id")
      .eq("user_id", userId).ilike("company", companyNorm.replace(/[%_\\]/g, (c) => `\\${c}`)).maybeSingle();
    // Unread is not "none yet" (R39 — API11-06): a blip set up a second standing account for the same company.
    if (existingError) return NextResponse.json({ error: "Couldn't set up your standing account — try again in a moment, or text us." }, { status: 503 });
    if (existing?.id) {
      const { error } = await supabaseAdmin.from("business_accounts").update(acctRow).eq("id", existing.id);
      if (error) { console.warn(`[office] account update: ${error.message}`); return NextResponse.json({ error: "Couldn't update your standing account — try again in a moment, or text us." }, { status: 500 }); }
      businessId = existing.id as string;
    } else {
      const { data: made, error } = await supabaseAdmin.from("business_accounts").insert(acctRow).select("id").single();
      if (error) { console.warn(`[office] account insert: ${error.message}`); return NextResponse.json({ error: "Couldn't set up your standing account — try again in a moment, or text us." }, { status: 500 }); }
      businessId = (made as { id: string } | null)?.id ?? null;
    }
  }

  // A WEEKLY ORDER'S DELIVERIES COME FROM ITS PROGRAM (2026-10-07, 0356). The account above is the
  // program (0355); book_office_standing makes its deliveries and hands back the first one this booking
  // can still change — the same one if the account was already booked for that day, so booking twice
  // never sends two deliveries for one Monday (the old insert here did). A one-off has no program, and
  // is written here as before, with the database's date, window and cutoff.
  let orderId: string | undefined;
  let totalCents = q.totalCents;
  if (standing && businessId) {
    const booked = await supabaseAdmin.rpc("book_office_standing", { p_account: businessId });
    if (booked.error) { console.warn(`[office] book_office_standing: ${booked.error.message}`); return NextResponse.json({ error: "Couldn't schedule your first delivery — try again in a moment, or text us." }, { status: 500 }); }
    const first = (booked.data as { order_id: string; delivery_date: string; total_cents: number; cutoff_at: string; delivery_window: string }[] | null)?.[0];
    if (!first) return NextResponse.json({ error: "Couldn't schedule your first delivery — text us and we'll set it up." }, { status: 500 });
    orderId = first.order_id; dateKey = first.delivery_date; windowCode = first.delivery_window; totalCents = first.total_cents; cutoffAt = first.cutoff_at;
  }
  if (!orderId) {
    const row: TablesInsert<"business_orders"> = {
      business_id: businessId, user_id: userId, company,
      contact_name: contact || null, contact_phone: phone || null,
      address_street: street, address_city: city, address_zip: zip,
      access_instructions: access || null, delivery_date: dateKey, delivery_window: windowCode,
      gallons: q.gallons, price_per_gallon_cents: priceCents,
      subtotal_cents: q.subtotalCents, delivery_fee_cents: q.deliveryFeeCents, tax_cents: q.taxCents, total_cents: q.totalCents,
      billing_terms: billing, standing, market,
      ...(cutoffAt ? { cutoff_at: cutoffAt } : {}),
    };
    // ONE BOOKING PER KEY (R15, 0422 — the 10/10 audit, API F25). An answer lost on the way back and tapped again made a
    // second office order: two alerts, two pay links or invoices. The form's key goes in with the booking; the same
    // person and key again is refused by the database (23505), and this answers with the first booking — no second
    // alert. 0422 is applied (2026-10-17), so a booking without its column is gone: a refusal here is said, never retried
    // without the key that makes it one booking.
    const made = await supabaseAdmin.from("business_orders").insert(key ? { ...row, idempotency_key: key } : row).select("id").single();
    if (made.error && key && made.error.code === "23505") {
      const { data: first, error: firstErr } = await supabaseAdmin.from("business_orders")
        .select("id, gallons, delivery_date, total_cents").eq("user_id", userId).eq("idempotency_key", key).maybeSingle();
      const f = first as { id: string; gallons: number | string; delivery_date: string; total_cents: number } | null;
      if (!firstErr && f) return NextResponse.json({ ok: true, id: f.id, gallons: Number(f.gallons), date: f.delivery_date, totalCents: f.total_cents, again: true });
    }
    if (made.error) { console.warn(`[office] order insert: ${made.error.message}`); return NextResponse.json({ error: "Couldn't book it — try again in a moment, or text us." }, { status: 500 }); }
    orderId = (made.data as { id: string } | null)?.id;
  }

  // Tell the crew a new office order landed (same alerts spine as every other order). Best-effort by
  // contract — an order write must never fail because alerting did.
  await raiseAlert({
    severity: "important", category: "order", kind: "office_order_new", subjectId: orderId,
    title: `New office order — ${company}`,
    body: `${q.gallons} gal · ${mondayLabel(dateKey)} ${windowHours(windowCode)} · ${billing === "prepaid" ? "prepaid" : "invoice"}${standing ? " · standing weekly" : ""}. ${money(totalCents)}. ${phone}`.trim(),
    link: "/crew?s=now",
  });

  return NextResponse.json({ ok: true, id: orderId, gallons: q.gallons, date: dateKey, totalCents });
}

export const POST = route("office", post);
