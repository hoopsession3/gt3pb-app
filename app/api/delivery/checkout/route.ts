import { NextResponse } from "next/server";
import { chargeCard, safeIdemKey } from "@/lib/squareServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { userFromRequest } from "@/lib/apiAuth";
import { raiseAlert } from "@/lib/serverAlerts";
import { notifyCustomer, accountEmail, whoAsked, sayTextYes } from "@/lib/notify";
import { textsOn } from "@/lib/texts";
import { money } from "@/lib/money";
import { route } from "@/lib/apiRoute";
import { aboveShown, shownCents } from "@/lib/shownTotal";
import { errorMessage } from "@/lib/errorMessage";
import { chargeOnce, claimKey, seenBefore, type Answer, type Say, type Stopped } from "@/lib/chargeOnce";
import { checkoutClaims } from "@/lib/checkoutClaims";
import {
  quoteDelivery, deliverySlotChoices, pickedSlot, SUNDAY_CLOSED, zipInZone, perfTotal, maxRefills,
  DELIVERY_PACKS, type PerfMix,
} from "@/lib/delivery";

// SUNDAY DELIVERY CHARGE — payment on order, no COD (the debrief's rule). The server is the only
// authority: it re-derives the quote from lib/delivery (never trusts a client amount), re-validates
// the zone, the counts, the refill constraint and the empties acknowledgment, computes the delivery
// date from ITS clock, charges Square, and only then records the order with the service role.
// Same fail-safes as /api/checkout: recording retries once, then alerts the crew with the payment id.

type Body = {
  sourceId?: string;
  idempotencyKey?: string; // stable per checkout attempt — see squareServer.safeIdemKey
  retry?: boolean;        // the same key and card token again, after an answer that never came (components/useIdemKey)
  name?: string; phone?: string;
  addressStreet?: string; addressCity?: string; addressZip?: string; accessInstructions?: string;
  packSize?: number;
  riseCount?: number; flowCount?: number; duskCount?: number;
  perfMix?: PerfMix;
  refillCount?: number;
  emptiesAck?: boolean;
  expectedCents?: number; // the total on the page's Pay button (lib/shownTotal)
  deliveryDate?: string; // which Sunday — one of the two offered keys
  textOptIn?: boolean;   // they ticked the yes to texts (components/TextYes, 0398)
};

const reply = (a: Answer) => NextResponse.json(a.body, { status: a.status });

async function post(req: Request) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID;
  // DELIVERY IS ALWAYS PAID ON ORDER — no cash on delivery. Card + Square are required; the
  // pay-at-pickup switch does NOT apply to delivery (it's a pickup-only option).
  if (!token || !locationId || !supabaseAdmin) {
    return NextResponse.json({ error: "Checkout isn't switched on yet." }, { status: 503 });
  }

  // Delivery is a member surface — the order needs an owner for self-service + notifications.
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Sign in to order delivery." }, { status: 401 });

  let b: Body;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }

  // A key the claims have seen (lib/chargeOnce, R5) is answered now, with what its first request said — before the zone,
  // the stock or the Sunday is asked again: a retry of a delivery that went through hears "booked", not "that Sunday
  // closed" because the clock moved while its first answer was lost. A delivery is not collected at a window, so it says
  // its own "paid, not saved" and "couldn't confirm".
  // arrives-with: 0371 — before it is pasted the checkout runs without claims, as it did before them.
  const idemKey = safeIdemKey(b.idempotencyKey);
  const now = () => Date.now();
  const say: Say = {
    paidNotRecorded: (c) => {
      const ref = (c.payment_id || "").slice(-6).toUpperCase();
      return { status: 200, body: { ok: true, paymentId: c.payment_id, recorded: false, ref, warn: `Payment received${ref ? ` — ref ${ref}` : ""}. We've alerted the crew to add your delivery; they'll confirm it with you.` } };
    },
    couldNotConfirm: () => ({ status: 409, body: { pending: true, error: "We couldn't confirm your payment, and the crew has been told. Don't pay again — the crew will confirm your delivery with you." } }),
  };
  const stopped = async ({ key, claim }: Stopped) => {
    // Who, for the crew to reach (the retry carries the same order): the customer is told "we'll confirm your delivery by
    // text or email", and a charge Square never made leaves no other trace of them.
    const who = await whoAsked(b, user.id);
    if (claim.state === "charged") {
      await raiseAlert({ severity: "critical", category: "money", title: "Paid DELIVERY may not have recorded — check deliveries", body: `A card payment went through (${claim.payment_id ?? "no payment id"}, ${money(claim.amount_cents ?? 0)}) and the delivery checkout stopped before the order was saved. ${who}. If it isn't in deliveries, add it or refund it.` });
    } else {
      await raiseAlert({ severity: "critical", category: "money", title: "Delivery charge status unknown — check Square", body: `A delivery checkout stopped while Square was being asked to charge ${money(claim.amount_cents ?? 0)} (${who}). A payment, if there is one, carries the reference ${key}.` });
    }
  };
  const seen = await seenBefore(checkoutClaims(supabaseAdmin), idemKey, true, now, stopped, say);
  if ("answer" in seen) return reply(seen.answer);

  const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

  const name = s(b.name, 80);
  const phone = s(b.phone, 30);
  const street = s(b.addressStreet, 160);
  const city = s(b.addressCity, 80);
  const zip = s(b.addressZip, 10);
  // Was `!b.phone` (the RAW, untrimmed value) while every sibling field checked its trimmed
  // variable — a whitespace-only phone is truthy, so it sailed past "phone is required" straight
  // into `s(b.phone, 30)` trimming it to "", storing `null`, and silently skipping the delivery-
  // morning SMS the error message itself promises.
  if (!b.sourceId || !name || !phone || !street || !city || !zip) return NextResponse.json({ error: "Missing delivery details — a phone is required for the delivery-morning text." }, { status: 400 });
  if (!zipInZone(zip)) return NextResponse.json({ error: "That ZIP isn't in the delivery zone." }, { status: 400 });

  const packSize = n(b.packSize);
  if (!(DELIVERY_PACKS as readonly number[]).includes(packSize)) return NextResponse.json({ error: "Pick a pack size" }, { status: 400 });

  // Premium ($14) adds are dynamic — any slug the owner flagged bulk-orderable. Sum the counts;
  // the total is bounded by the packSize check below, and each is priced at the $14 tier.
  const perfMix: PerfMix = {};
  if (b.perfMix && typeof b.perfMix === "object") {
    for (const [slug, v] of Object.entries(b.perfMix as Record<string, unknown>)) {
      const c = n(v);
      if (c > 0 && /^[a-z0-9_-]{1,40}$/.test(slug)) perfMix[slug] = c;
    }
  }
  const perf = perfTotal(perfMix);
  const rise = n(b.riseCount), flow = n(b.flowCount), dusk = n(b.duskCount);
  if (rise + flow + dusk + perf !== packSize) {
    return NextResponse.json({ error: `Your picks don't add up to ${packSize} bottles.` }, { status: 400 });
  }

  // Premium add-ons are real menu items — the funnel fetches its list once on load with no realtime
  // refresh, so re-check availability here before charging, the same way the cup-order path
  // (api/checkout) already does for its items. A stale client shouldn't be able to charge for
  // something that went sold-out mid-funnel.
  if (Object.keys(perfMix).length > 0) {
    const { data: avail } = await supabaseAdmin.from("products").select("slug, sold_out, active").in("slug", Object.keys(perfMix));
    const blocked = (avail ?? []).filter((p) => (p as { sold_out: boolean | null }).sold_out || (p as { active: boolean | null }).active === false).map((p) => (p as { slug: string }).slug);
    if (blocked.length) return NextResponse.json({ error: `${blocked.join(", ")} just sold out — remove it and try again.` }, { status: 409 });
  }

  const refills = n(b.refillCount);
  if (refills > maxRefills(packSize, perf)) return NextResponse.json({ error: "Too many refills for this pack." }, { status: 400 });
  if (refills > 0 && b.emptiesAck !== true) {
    return NextResponse.json({ error: "Please confirm you'll have your empties out by 5 AM Sunday." }, { status: 400 });
  }

  // Server-authoritative money + date.
  const quote = quoteDelivery(packSize, perf, refills, "direct");
  // Never more than the page showed (R5, lib/shownTotal): refused before any charge, with the total it would be.
  const raised = aboveShown(quote.totalCents, shownCents(b.expectedCents));
  if (raised) return NextResponse.json(raised, { status: 409 });
  // The customer picks which Sunday (this one or next). A pick that is no longer on offer — its Friday
  // cutoff passed while the page was open — is refused before any charge, with the Sundays on offer now
  // (C4, 2026-10-12): it used to fall back to the coming slot and charge for a Sunday never shown. The
  // retry of a send whose answer was lost keeps its Sunday while it is ahead: that send may be charged. Only without the
  // claims (R7): with them, a send that was charged under this key has been answered from its claim above, so a "retry"
  // that reaches here was never claimed — nothing was charged — and the flag, which the phone sets, books no closed Sunday.
  const slotNow = Date.now();
  const slot = pickedSlot(b.deliveryDate, slotNow, b.retry === true && !seen.claims);
  if (!slot) return NextResponse.json({ error: SUNDAY_CLOSED, slotClosed: true, choices: deliverySlotChoices(slotNow) }, { status: 409 });

  // ONE KEY, ONE CHARGE (R5, 2026-10-13 — lib/chargeOnce, 0371): claimed before Square is asked, so a second tap while the
  // first is still out hears "still confirming", and an answer Square never gave stays "we couldn't confirm" — the crew
  // told once, nothing under that key sent to Square again.
  const held = await claimKey(seen.claims, idemKey, { channel: "delivery", card: true, amountCents: quote.totalCents }, now, stopped, say);
  if ("answer" in held) return reply(held.answer);

  // The delivery, written once the card is charged. Its answer is kept on the claim and said again to every retry of
  // this key. It cannot throw: the money is taken by now, so a failure here is told to the crew and answered as "paid,
  // being added" — never as a checkout that failed.
  const db = supabaseAdmin;   // checked at the top; the closure below runs after the charge
  const recordDelivery = async (paymentId: string | null): Promise<Answer> => {
    const paid = true;
    try {
      // Canonical customer link (0151) — member route; phone folds prior guest/pickup orders in.
      const customerId = (await db.rpc("resolve_customer", { p_user_id: user.id, p_phone: phone, p_email: null, p_name: name })).data as string | null;
      const row = {
        user_id: user.id, customer_id: customerId, channel: "direct", delivery_date: slot.deliveryDateKey, delivery_window: "5–8 AM",
        name, phone,
        address_street: street, address_city: city, address_zip: zip,
        access_instructions: s(b.accessInstructions, 400) || null,
        pack_size: packSize, rise_count: rise, flow_count: flow, dusk_count: dusk,
        performance_count: perf, performance_mix: perfMix,
        refill_count: quote.refillCount, new_count: quote.newCount,
        bottle_subtotal_cents: quote.bottleSubtotalCents, delivery_fee_cents: quote.deliveryFeeCents,
        tax_cents: 0, total_cents: quote.totalCents,
        empty_ack_at: refills > 0 ? new Date().toISOString() : null,
        payment_method: "square", payment_status: "paid", status: "received",
        payment_id: paymentId || null,   // Square charge id — links this order to its event_sales mirror (walk-up dedupe, 0216)
        empties_expected: quote.refillCount,
      };
      // Idempotency at the ORDER row, the line behind the claim (and the only dedupe while 0371 is unpasted): a retry
      // returns the SAME Square paymentId, so don't insert a second paid delivery → double fulfillment + double invoice.
      if (paymentId) {
        // scoped-by: payment_id carries a UNIQUE index (verified in production) and the value is issued by
        // Square, not chosen by the caller — at most one row in the whole table, so a tenant
        // filter would narrow nothing. A stricter key than tenant_id, not a looser one.
        const { data: already } = await db.from("delivery_orders").select("id").eq("payment_id", paymentId).maybeSingle();
        if (already) return { status: 200, body: { ok: true, paymentId, recorded: true, deliveryLabel: slot.deliveryLabel, totalCents: quote.totalCents } };
      }
      let { error: insErr } = await db.from("delivery_orders").insert(row);
      if (insErr) ({ error: insErr } = await db.from("delivery_orders").insert(row));
      if (insErr) {
        // A concurrent request can win this race even after the pre-insert check above — confirm the
        // other request's row is really there before raising a false "didn't record" alert.
        if ((insErr as { code?: string }).code === "23505" && paymentId) {
          // scoped-by: payment_id carries a UNIQUE index (verified in production) and the value is issued by
          // Square, not chosen by the caller — at most one row in the whole table, so a tenant
          // filter would narrow nothing. A stricter key than tenant_id, not a looser one.
          const { data: already2 } = await db.from("delivery_orders").select("id").eq("payment_id", paymentId).maybeSingle();
          if (already2) return { status: 200, body: { ok: true, paymentId, recorded: true, deliveryLabel: slot.deliveryLabel, totalCents: quote.totalCents } };
        }
        const ref = (paymentId || "").slice(-6).toUpperCase();
        // A paid card that didn't record is a money emergency (delivery is always paid on order; the other words are the
        // pay-on-delivery order's, kept with their producer — supabase/functions/push/policy.ts shows both on a lock screen).
        await raiseAlert({ severity: paid ? "critical" : "important", category: paid ? "money" : "order", title: paid ? "Paid DELIVERY didn't record — add it" : "DELIVERY order didn't record — add it", body: `Card payment ${paymentId} (${money(quote.totalCents)}) succeeded but the delivery order didn't save. ${name}, ${packSize} bottles for ${slot.deliveryLabel}, ${street}, ${city} ${zip}. Add it by hand and confirm in Square.` });
        return { status: 200, body: { ok: true, paymentId, recorded: false, ref, deliveryLabel: slot.deliveryLabel, warn: `Payment received — ref ${ref}. We've alerted the crew to add your order.` } };
      }

      // The yes to texts, kept with the delivery (R5, 0398): only when they ticked it, for this delivery's number, and only
      // while texts are switched on. Best-effort — a yes that could not be kept is no yes. A new yes is confirmed by text
      // first (R6, lib/notify sayTextYes).
      if (b.textOptIn === true && textsOn()) await sayTextYes(row.phone, "delivery_checkout", user.id);

      // Confirmation to the customer — the account email, and a text to a number that said yes (lib/notify). Best-effort.
      await notifyCustomer({
        phone: row.phone,
        email: await accountEmail(user.id),
        subject: `GT3 — Sunday delivery confirmed (${slot.deliveryLabel})`,
        message: `GT3: your ${packSize}-bottle delivery is set for ${slot.deliveryLabel} — ${money(quote.totalCents)}${paid ? " paid" : " due on delivery"}.${quote.refillCount > 0 ? ` Set your ${quote.refillCount} rinsed empties out by 5 AM — no empties, no swap.` : ""} Fresh 7 days from delivery.`,
      });

      // 'important' (2026-10-11): an fyi reaches the inbox only now (supabase/functions/push/policy.ts), and this is the
      // one line a new delivery gets — the push function's own alert for it was refused by 0232 (category 'delivery').
      await raiseAlert({
        severity: "important", category: "order", title: "New Sunday delivery 🚚",
        body: `${name} — ${packSize} bottles (${quote.refillCount} refill · ${quote.newCount} new${perf ? ` · ${perf} performance` : ""}) · ${money(quote.totalCents)} ${paid ? "paid" : "due on delivery"} · ${slot.deliveryLabel} · ${city} ${zip}.`,
        link: "/crew?s=now",
      });
      return { status: 200, body: { ok: true, paymentId, recorded: true, deliveryLabel: slot.deliveryLabel, deliveryDateKey: slot.deliveryDateKey, totalCents: quote.totalCents } };
    } catch (e) {
      // Charge is DONE at this point — an exception here broke while RECORDING, not while paying.
      await raiseAlert({ severity: "critical", category: "money", title: "Paid DELIVERY didn't finish saving — check it", body: `Card payment ${paymentId ?? "(no payment id)"} (${money(quote.totalCents)}) succeeded and saving the delivery broke (${errorMessage(e, 160)}). ${name}, ${packSize} bottles for ${slot.deliveryLabel}, ${street}, ${city} ${zip}. Check deliveries; add what is missing or refund it.` });
      return { status: 200, body: { ok: true, paymentId, recorded: false, deliveryLabel: slot.deliveryLabel, warn: "Payment received, but we hit a snag recording your order — we'll follow up to confirm the details." } };
    }
  };

  // buyerEmail → Square emails the customer a receipt (enterprise round P3). Read before the charge.
  const buyerEmail = await accountEmail(user.id);
  return reply(await chargeOnce({
    claims: held.claims, key: idemKey, now,
    // Delivery always charges on order — no cash on delivery.
    charge: () => chargeCard({ token, locationId, sourceId: b.sourceId!, amountCents: quote.totalCents, note: `GT3 Sunday delivery ${slot.deliveryDateKey}`, idempotencyKey: idemKey, buyerEmail }),
    record: (paymentId) => recordDelivery(paymentId),
    // chargeCard threw: a dropped connection after Square may already have taken the money, or an answer that does not
    // say whether it did. The claim is 'unknown' from here; this answer and every retry's are the same words, and the
    // payment, if there is one, carries the key as its reference.
    unknown: async (e) => {
      await raiseAlert({ severity: "critical", category: "money", title: "Delivery charge status unknown — check Square", body: `A card charge may or may not have gone through (${money(quote.totalCents)}, ${name}, ${slot.deliveryLabel}): ${errorMessage(e, 200)}. A payment, if there is one, carries the reference ${idemKey}. Check Square before assuming nothing happened.` });
      return say.couldNotConfirm!(true);
    },
  }));
}

export const POST = route("delivery/checkout", post);
