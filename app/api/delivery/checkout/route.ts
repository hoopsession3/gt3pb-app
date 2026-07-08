import { NextResponse } from "next/server";
import { SQUARE_BASE, SQUARE_VERSION } from "@/lib/squareServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { userFromRequest } from "@/lib/apiAuth";
import { raiseAlert } from "@/lib/serverAlerts";
import { notifyCustomer } from "@/lib/notify";
import {
  quoteDelivery, deliverySlotChoices, zipInZone, perfTotal, maxRefills,
  DELIVERY_PACKS, SALTED_LATTE, type PerfMix,
} from "@/lib/delivery";

// SUNDAY DELIVERY CHARGE — payment on order, no COD (the debrief's rule). The server is the only
// authority: it re-derives the quote from lib/delivery (never trusts a client amount), re-validates
// the zone, the counts, the refill constraint and the empties acknowledgment, computes the delivery
// date from ITS clock, charges Square, and only then records the order with the service role.
// Same fail-safes as /api/checkout: recording retries once, then alerts the crew with the payment id.

type Body = {
  sourceId?: string;
  name?: string; phone?: string;
  addressStreet?: string; addressCity?: string; addressZip?: string; accessInstructions?: string;
  packSize?: number;
  riseCount?: number; flowCount?: number; duskCount?: number;
  perfMix?: PerfMix;
  refillCount?: number;
  emptiesAck?: boolean;
  deliveryDate?: string; // which Sunday — one of the two offered keys
};

export async function POST(req: Request) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID;
  if (!token || !locationId || !supabaseAdmin) {
    return NextResponse.json({ error: "Checkout isn't switched on yet." }, { status: 503 });
  }

  // Delivery is a member surface — the order needs an owner for self-service + notifications.
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Sign in to order delivery." }, { status: 401 });

  let b: Body;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }

  const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

  const name = s(b.name, 80);
  const street = s(b.addressStreet, 160);
  const city = s(b.addressCity, 80);
  const zip = s(b.addressZip, 10);
  if (!b.sourceId || !name || !street || !city || !zip) return NextResponse.json({ error: "Missing delivery details" }, { status: 400 });
  if (!zipInZone(zip)) return NextResponse.json({ error: "That ZIP isn't in the delivery zone." }, { status: 400 });

  const packSize = n(b.packSize);
  if (!(DELIVERY_PACKS as readonly number[]).includes(packSize)) return NextResponse.json({ error: "Pick a pack size" }, { status: 400 });

  // The $14 premium bottle — Salted Latte. One count; the DB column stays performance_count.
  const saltedCount = n((b.perfMix as Record<string, unknown> | undefined)?.[SALTED_LATTE.key]);
  const perfMix: PerfMix = saltedCount > 0 ? { [SALTED_LATTE.key]: saltedCount } : {};
  const perf = perfTotal(perfMix);
  const rise = n(b.riseCount), flow = n(b.flowCount), dusk = n(b.duskCount);
  if (rise + flow + dusk + perf !== packSize) {
    return NextResponse.json({ error: `Your picks don't add up to ${packSize} bottles.` }, { status: 400 });
  }

  const refills = n(b.refillCount);
  if (refills > maxRefills(packSize, perf)) return NextResponse.json({ error: "Too many refills for this pack." }, { status: 400 });
  if (refills > 0 && b.emptiesAck !== true) {
    return NextResponse.json({ error: "Please confirm you'll have your empties out by 5 AM Sunday." }, { status: 400 });
  }

  // Server-authoritative money + date.
  const quote = quoteDelivery(packSize, perf, refills, "direct");
  // The customer picks which Sunday (this one or next); anything else falls back to the coming slot.
  const choices = deliverySlotChoices(Date.now());
  const slot = choices.find((c) => c.deliveryDateKey === b.deliveryDate) ?? choices[0];

  try {
    const res = await fetch(`${SQUARE_BASE}/v2/payments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Square-Version": SQUARE_VERSION },
      body: JSON.stringify({
        source_id: b.sourceId,
        idempotency_key: crypto.randomUUID(),
        amount_money: { amount: quote.totalCents, currency: "USD" },
        location_id: locationId,
        note: `GT3 Sunday delivery ${slot.deliveryDateKey}`,
      }),
    });
    const data = await res.json();
    if (!res.ok) return NextResponse.json({ error: data?.errors?.[0]?.detail || "Payment declined" }, { status: 400 });
    const paymentId = data?.payment?.id ?? null;

    const row = {
      user_id: user.id, channel: "direct", delivery_date: slot.deliveryDateKey, delivery_window: "5–8 AM",
      name, phone: s(b.phone, 30) || null,
      address_street: street, address_city: city, address_zip: zip,
      access_instructions: s(b.accessInstructions, 400) || null,
      pack_size: packSize, rise_count: rise, flow_count: flow, dusk_count: dusk,
      performance_count: perf, performance_mix: perfMix,
      refill_count: quote.refillCount, new_count: quote.newCount,
      bottle_subtotal_cents: quote.bottleSubtotalCents, delivery_fee_cents: quote.deliveryFeeCents,
      tax_cents: 0, total_cents: quote.totalCents,
      empty_ack_at: refills > 0 ? new Date().toISOString() : null,
      payment_method: "square", payment_status: "paid", status: "received",
      empties_expected: quote.refillCount,
    };
    let { error: insErr } = await supabaseAdmin.from("delivery_orders").insert(row);
    if (insErr) ({ error: insErr } = await supabaseAdmin.from("delivery_orders").insert(row));
    if (insErr) {
      const ref = (paymentId || "").slice(-6).toUpperCase();
      await raiseAlert({ severity: "critical", category: "money", title: "Paid DELIVERY didn't record — add it", body: `Card payment ${paymentId} succeeded but the delivery order didn't save. ${name}, ${packSize} bottles for ${slot.deliveryLabel}, ${street}, ${city} ${zip}. Add it by hand and confirm in Square.` });
      return NextResponse.json({ ok: true, paymentId, recorded: false, ref, deliveryLabel: slot.deliveryLabel, warn: `Payment received — ref ${ref}. We've alerted the crew to add your order.` });
    }

    // Confirmation to the customer — the delivery phone + account email. Best-effort.
    const { data: au } = await supabaseAdmin.auth.admin.getUserById(user.id);
    await notifyCustomer({
      phone: row.phone,
      email: au?.user?.email ?? null,
      subject: `GT3 — Sunday delivery confirmed (${slot.deliveryLabel})`,
      message: `GT3: your ${packSize}-bottle delivery is set for ${slot.deliveryLabel} — $${(quote.totalCents / 100).toFixed(2)} paid.${quote.refillCount > 0 ? ` Set your ${quote.refillCount} rinsed empties out by 5 AM — no empties, no swap.` : ""} Fresh 7 days from delivery.`,
    });

    await raiseAlert({
      severity: "fyi", category: "orders", title: "New Sunday delivery 🚚",
      body: `${name} — ${packSize} bottles (${quote.refillCount} refill · ${quote.newCount} new${perf ? ` · ${perf} performance` : ""}) · $${(quote.totalCents / 100).toFixed(2)} paid · ${slot.deliveryLabel} · ${city} ${zip}.`,
      link: "/admin?s=now",
    });
    return NextResponse.json({ ok: true, paymentId, recorded: true, deliveryLabel: slot.deliveryLabel, deliveryDateKey: slot.deliveryDateKey, totalCents: quote.totalCents });
  } catch {
    return NextResponse.json({ error: "Payment service unavailable" }, { status: 502 });
  }
}
