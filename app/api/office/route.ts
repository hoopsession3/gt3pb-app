import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { userFromRequest } from "@/lib/apiAuth";
import { raiseAlert } from "@/lib/serverAlerts";
import { OFFICE, officeQuote, nextMondayKey, mondayLabel, windowHours } from "@/lib/office";
import { zipMarket } from "@/lib/delivery";
import { marketServes } from "@/lib/markets";
import { money } from "@/lib/money";
import { route } from "@/lib/apiRoute";
import { writeAcrossSkew, isMissingFunction } from "@/lib/schemaSkew";

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
  const userId = caller.id;
  const userEmail = caller.email;

  let body: {
    company?: string; contact?: string; phone?: string; headcount?: string | number;
    street?: string; city?: string; zip?: string; access?: string;
    gallons?: number; standing?: boolean; billing?: string;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }

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
  const headcount = body.headcount != null && String(body.headcount).trim() !== ""
    ? Math.max(0, Math.min(9999, parseInt(String(body.headcount), 10) || 0)) : null;

  // Authoritative price from the owner-set live values (the same source useOfficeSettings reads),
  // code constants as the fallback — read with the service role, never taken from the client.
  const { data: ls } = await supabaseAdmin.from("live_status").select("office_price_cents, office_min_gallons").eq("id", 1).maybeSingle();
  const lsRow = ls as { office_price_cents?: number; office_min_gallons?: number } | null;
  const priceCents = lsRow?.office_price_cents ?? OFFICE.pricePerGallonCents;
  const minGallons = lsRow?.office_min_gallons ?? OFFICE.minGallons;

  // Recompute the quote server-side from the requested gallons (officeQuote clamps to the min).
  const q = officeQuote(Number(body.gallons) || 0, { priceCents, minGallons });

  // Validate — this is the real enforcement point, mirroring the client's pre-check.
  if (!company || !street || !city || zip.length < 5) return NextResponse.json({ error: "Add your company and full address first." }, { status: 400 });
  // Zone check, market-aware. Instead of assuming the founding market and rejecting every other
  // city's ZIP, resolve WHICH market serves this address and require that market to actually fulfil
  // corporate delivery. Greenville ZIPs resolve exactly as they did before; an Atlanta business ZIP
  // now resolves to Atlanta rather than being turned away as "outside our route".
  const market = zipMarket(zip);
  if (!market || !marketServes(market, "corporate")) return NextResponse.json({ error: "That ZIP looks outside our delivery route — text us and we'll see what we can do." }, { status: 400 });
  if (billing === "prepaid" && !phone) return NextResponse.json({ error: "Add a phone — prepaid sends the payment link by text." }, { status: 400 });

  // THE DATE IS THE DATABASE'S, IN THE MARKET'S TIME (2026-10-07, 0356). This was nextMondayKey() in
  // the server's own zone — UTC on Vercel — so from a Sunday evening in Greenville it booked the Monday
  // after next, and nothing closed changes before a delivery. office_next_delivery answers in the
  // market's time zone: the next day the market's window falls on whose cutoff (6 PM the weekday
  // before) is still ahead, with the market's own window. Until 0356 is pasted it isn't there
  // (PGRST202) and the old answer stands.
  let dateKey = nextMondayKey();
  let windowCode: string = OFFICE.window;
  let cutoffAt: string | null = null;
  const next = await supabaseAdmin.rpc("office_next_delivery", { p_market: market });
  if (next.error && !isMissingFunction(next.error)) return NextResponse.json({ error: `Couldn't work out the delivery date — ${next.error.message}` }, { status: 500 });
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
    const acctRow: Record<string, unknown> = {
      user_id: userId, company: companyNorm, contact_name: contact || null, contact_phone: phone || null,
      contact_email: userEmail, address_street: street, address_city: city, address_zip: zip,
      headcount, billing_terms: billing, standing_active: true, standing_gallons: q.gallons, market,
      access_instructions: access || null,   // arrives-with: 0346
    };
    const { data: existing } = await supabaseAdmin.from("business_accounts").select("id")
      .eq("user_id", userId).ilike("company", companyNorm.replace(/[%_\\]/g, (c) => `\\${c}`)).maybeSingle();
    if (existing?.id) {
      const { error } = await writeAcrossSkew((row) => supabaseAdmin!.from("business_accounts").update(row).eq("id", existing.id), acctRow, ["access_instructions"]);
      if (error) return NextResponse.json({ error: `Couldn't update your standing account — ${error.message}` }, { status: 500 });
      businessId = existing.id as string;
    } else {
      let made: { id: string } | null = null;
      const { error } = await writeAcrossSkew(async (row) => {
        const r = await supabaseAdmin!.from("business_accounts").insert(row).select("id").single();
        made = (r.data as { id: string } | null) ?? null;
        return r;
      }, acctRow, ["access_instructions"]);
      if (error) return NextResponse.json({ error: `Couldn't set up your standing account — ${error.message}` }, { status: 500 });
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
    if (booked.error && !isMissingFunction(booked.error)) return NextResponse.json({ error: `Couldn't schedule your first delivery — ${booked.error.message}` }, { status: 500 });
    const first = (booked.data as { order_id: string; delivery_date: string; total_cents: number; cutoff_at: string; delivery_window: string }[] | null)?.[0];
    if (!booked.error && !first) return NextResponse.json({ error: "Couldn't schedule your first delivery — text us and we'll set it up." }, { status: 500 });
    if (first) { orderId = first.order_id; dateKey = first.delivery_date; windowCode = first.delivery_window; totalCents = first.total_cents; cutoffAt = first.cutoff_at; }
  }
  if (!orderId) {
    const { data: order, error } = await supabaseAdmin.from("business_orders").insert({
      business_id: businessId, user_id: userId, company,
      contact_name: contact || null, contact_phone: phone || null,
      address_street: street, address_city: city, address_zip: zip,
      access_instructions: access || null, delivery_date: dateKey, delivery_window: windowCode,
      gallons: q.gallons, price_per_gallon_cents: priceCents,
      subtotal_cents: q.subtotalCents, delivery_fee_cents: q.deliveryFeeCents, tax_cents: q.taxCents, total_cents: q.totalCents,
      billing_terms: billing, standing, market,
      ...(cutoffAt ? { cutoff_at: cutoffAt } : {}),   // arrives-with: 0356
    }).select("id").single();
    if (error) return NextResponse.json({ error: `Couldn't book it — ${error.message}` }, { status: 500 });
    orderId = (order as { id: string } | null)?.id;
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
