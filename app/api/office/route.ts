import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { raiseAlert } from "@/lib/serverAlerts";
import { OFFICE, officeQuote, nextMondayKey, mondayLabel } from "@/lib/office";
import { zipInZone } from "@/lib/delivery";

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
const dollars = (c: number) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;

export async function POST(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ error: "Office delivery isn't switched on yet." }, { status: 503 });

  // Auth + email in one trusted read (email seeds the standing account's contact, so it comes from
  // the verified session, never the client body). Same token check as lib/apiAuth.userFromRequest,
  // inlined only to keep the email the standing-account path needs.
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return NextResponse.json({ error: "Sign in to set up office delivery." }, { status: 401 });
  const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !authData.user) return NextResponse.json({ error: "Sign in to set up office delivery." }, { status: 401 });
  const userId = authData.user.id;
  const userEmail = authData.user.email ?? null;

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
  if (!zipInZone(zip)) return NextResponse.json({ error: "That ZIP looks outside our delivery route — text us and we'll see what we can do." }, { status: 400 });
  if (billing === "prepaid" && !phone) return NextResponse.json({ error: "Add a phone — prepaid sends the payment link by text." }, { status: 400 });

  // Delivery day is server-derived (next Monday) — never trust a client clock.
  const dateKey = nextMondayKey();

  // Standing account create/update (service role, scoped to this user) — the same reuse-not-duplicate
  // logic the client had, now un-forgeable. The DB unique index on (user_id, lower(company)) (0242)
  // is the concurrent-double-submit backstop.
  let businessId: string | null = null;
  if (standing) {
    const companyNorm = company.replace(/\s+/g, " ");
    const acctRow = {
      user_id: userId, company: companyNorm, contact_name: contact || null, contact_phone: phone || null,
      contact_email: userEmail, address_street: street, address_city: city, address_zip: zip,
      headcount, billing_terms: billing, standing_active: true, standing_gallons: q.gallons,
    };
    const { data: existing } = await supabaseAdmin.from("business_accounts").select("id")
      .eq("user_id", userId).ilike("company", companyNorm.replace(/[%_\\]/g, (c) => `\\${c}`)).maybeSingle();
    if (existing?.id) {
      const { error } = await supabaseAdmin.from("business_accounts").update(acctRow).eq("id", existing.id);
      if (error) return NextResponse.json({ error: `Couldn't update your standing account — ${error.message}` }, { status: 500 });
      businessId = existing.id as string;
    } else {
      const { data: acct, error } = await supabaseAdmin.from("business_accounts").insert(acctRow).select("id").single();
      if (error) return NextResponse.json({ error: `Couldn't set up your standing account — ${error.message}` }, { status: 500 });
      businessId = (acct as { id: string } | null)?.id ?? null;
    }
  }

  const { data: order, error } = await supabaseAdmin.from("business_orders").insert({
    business_id: businessId, user_id: userId, company,
    contact_name: contact || null, contact_phone: phone || null,
    address_street: street, address_city: city, address_zip: zip,
    access_instructions: access || null, delivery_date: dateKey, delivery_window: OFFICE.window,
    gallons: q.gallons, price_per_gallon_cents: priceCents,
    subtotal_cents: q.subtotalCents, delivery_fee_cents: q.deliveryFeeCents, tax_cents: q.taxCents, total_cents: q.totalCents,
    billing_terms: billing, standing,
  }).select("id").single();
  if (error) return NextResponse.json({ error: `Couldn't book it — ${error.message}` }, { status: 500 });

  const orderId = (order as { id: string } | null)?.id;

  // Tell the crew a new office order landed (same alerts spine as every other order). Best-effort by
  // contract — an order write must never fail because alerting did.
  await raiseAlert({
    severity: "important", category: "order", kind: "office_order_new", subjectId: orderId,
    title: `New office order — ${company}`,
    body: `${q.gallons} gal · ${mondayLabel(dateKey)} 5–8 AM · ${billing === "prepaid" ? "prepaid" : "invoice"}${standing ? " · standing weekly" : ""}. ${dollars(q.totalCents)}. ${phone}`.trim(),
    link: "/crew?s=now",
  });

  return NextResponse.json({ ok: true, id: orderId, gallons: q.gallons, date: dateKey, totalCents: q.totalCents });
}
