import { NextResponse } from "next/server";
import { chargeCard, safeIdemKey } from "@/lib/squareServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { TablesInsert } from "@/lib/database.types";
import { callerFromRequest, SIGN_IN_UNCHECKED } from "@/lib/apiAuth";
import { cardTryRefusal, callerAddress } from "@/lib/cardGuard";
import { raiseAlert } from "@/lib/serverAlerts";
import { benefitsForUser, acceptedCode } from "@/lib/benefits";
import { notifyCustomer, accountEmail, whoAsked, sayTextYes } from "@/lib/notify";
import { textsOn } from "@/lib/texts";
import { mixSummary, type Mix } from "@/lib/orderAhead";
import { packPick, offeredDays, requestedDay, packCents } from "@/lib/packOrder";
import { packClosesAt, packIsOpen, pickupDayWords, PICKUP_STOPS_READ } from "@/lib/pickupDay";
import { route } from "@/lib/apiRoute";
import { errorMessage } from "@/lib/errorMessage";
import { chargeOnce, claimKey, placeOnce, seenBefore, type Answer, type Say, type Stopped } from "@/lib/chargeOnce";
import { checkoutClaims } from "@/lib/checkoutClaims";
import { money } from "@/lib/money";
import { aboveShown, shownCents } from "@/lib/shownTotal";
import { packRoad, PACK_ROAD_WORDS } from "@/lib/packRoad";
import { PAY_DIAL_UNREAD } from "@/lib/payDial";
import { etToday } from "@/lib/dates";

// ORDER-AHEAD reserve — records a one-off Saturday-drop reservation. Price + cutoff are recomputed
// SERVER-SIDE from lib/orderAhead (never trust the client), the charge is a Square ONE-TIME payment
// (no recurring), and the row is written with the service role so `paid` can't be forged. Mirrors
// /api/checkout. Member-only: a reservation always belongs to an account (guests browse; the walk-up
// window stays open to everyone).
const reply = (a: Answer) => NextResponse.json(a.body, { status: a.status });
// A minute at most (R10b — the 10/10 audit; reserves/pay's rule): a claim still "started" two minutes on is taken for a
// request that died (lib/chargeOnce IN_FLIGHT_MS), so no request may outlive it — Square is asked with a 20-second
// deadline (lib/squareServer squareDeadline) and the platform stops this at sixty.
export const maxDuration = 60;

/** Packs one member may have waiting to be paid at pickup at once (R9): a fourth is paid by card. */
const PACKS_AT_WINDOW_MAX = 3;

async function post(req: Request) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID;
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Reservations aren't switched on yet." }, { status: 503 });
  }

  let body: { sourceId?: string; idempotencyKey?: string; name?: string; phone?: string; size?: number; glass?: string; mix?: Partial<Mix>; dropDate?: string; stopId?: string; expectedCents?: number; textOptIn?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Bad request" }, { status: 400 });   // a literal null is valid JSON (R10b): a 400, not a TypeError's 500

  // Order-ahead is member-only: the reservation needs an owner (drop_orders.user_id) so it lives
  // in the member's account. Checked FIRST — before validation and long before any charge.
  // "Sign in" only to someone who isn't (R15, API F13): a sign-in the auth service couldn't check is a 503.
  const who = await callerFromRequest(req);
  if (who.kind === "unavailable") return NextResponse.json({ error: SIGN_IN_UNCHECKED }, { status: 503 });
  const user = who.kind === "user" ? { id: who.id, email: who.email } : null;
  if (!user) return NextResponse.json({ error: "Order-ahead is for members — sign in to reserve." }, { status: 401 });

  // ONE KEY, ONE RESERVATION — asked first, on both paths (2026-10-11). The funnel keeps one key per
  // pack checkout, for the card and the pay-later button alike, so a key that already holds a
  // reservation is a retry of it: a card answer lost on venue WiFi, a reload that dropped the card
  // token, a pay-later tap after the card's answer went missing. It is answered with that reservation
  // — before the drop's cutoff is checked again, and before any card is charged. 0244's unique index
  // on idempotency_key backs it. Scoped to the caller's own rows: the key is theirs.
  const idemKey = safeIdemKey(body.idempotencyKey);
  {
    const { data: held } = await supabaseAdmin.from("drop_orders").select("id, paid, total_cents").eq("idempotency_key", idemKey).eq("user_id", user.id).maybeSingle();
    if (held) return NextResponse.json({ ok: true, id: held.id, paid: held.paid === true, recorded: true, totalCents: held.total_cents ?? null });
  }

  // A card token means "charge now"; no token means a pre-order (reserve now, pay at pickup). The
  // charge path needs Square configured; the pre-order path just needs the DB — so the reserve flow
  // is never a dead end.
  const wantsCharge = !!body.sourceId;
  if (wantsCharge && (!token || !locationId)) return NextResponse.json({ error: "Card checkout isn't switched on yet." }, { status: 503 });

  // A key the claims have seen (lib/chargeOnce, R5) is answered now, with what its first request said — before the drop's
  // cutoff or the price is asked again. The pack's own words for "paid, not saved" and "couldn't confirm": it is picked
  // up at the truck, so that is where it is sorted out.
  const now = () => Date.now();
  const say: Say = {
    paidNotRecorded: (c) => {
      const ref = (c.payment_id || "").slice(-6).toUpperCase();
      return { status: 200, body: { ok: true, paid: true, recorded: false, ref, totalCents: c.amount_cents, warn: `Paid${ref ? ` — ref ${ref}` : ""}. We've alerted the crew to add your pack; show this at pickup.` } };
    },
    couldNotConfirm: (card) => ({ status: 409, body: { pending: true, error: card
      ? "We couldn't confirm your payment, and the crew has been told. Don't pay again — check My packs in a few minutes, or show this at pickup."
      : "We couldn't confirm your pack went in, and the crew has been told. Check My packs before reserving again." } }),
  };
  const stopped = async ({ key, claim }: Stopped) => {
    // Who, for the crew to reach (the retry carries the same order): the name and phone it gave, and the account's email —
    // the customer is told the crew will confirm it, and a charge Square never made leaves no other trace of them.
    const who = await whoAsked(body, user.id);
    if (claim.card && claim.state === "charged") {
      await raiseAlert({ severity: "critical", category: "money", kind: "ops_incident", title: "Paid pack may not have recorded — check the drop", body: `A card payment went through (${claim.payment_id ?? "no payment id"}, ${money(claim.amount_cents ?? 0)}) and the pack checkout stopped before the reservation was saved. ${who}. If it isn't on the drop, add it or refund it.` });
    } else if (claim.card) {
      await raiseAlert({ severity: "critical", category: "money", kind: "ops_incident", title: "Pack charge status unknown — check Square", body: `A pack checkout stopped while Square was being asked to charge ${money(claim.amount_cents ?? 0)} (${who}). A payment, if there is one, carries the reference ${key}.` });
    } else {
      await raiseAlert({ severity: "important", category: "order", kind: "ops_incident", title: "A pay-at-pickup pack may not have saved — check the drop", body: `A pay-at-pickup reservation (${money(claim.amount_cents ?? 0)}, ${who}) stopped while it was being saved. Check the drop for it.` });
    }
  };
  const seen = await seenBefore(checkoutClaims(supabaseAdmin), idemKey, wantsCharge, now, stopped, say);
  if ("answer" in seen) return reply(seen.answer);
  // The pack itself — name, phone, size, glass, and the mix rebuilt from trusted flavor keys only, totaling the pack
  // size. Read in lib/packOrder, which /api/reserve/change reads the same way.
  const asked = packPick(body);
  if ("error" in asked) return NextResponse.json({ error: asked.error }, { status: asked.status });
  const { name, phone, size, glass, mix } = asked.pick;

  // Pickup day is the customer's CHOICE — among the truck's real upcoming stops (server-
  // authoritative; the Saturday cadence is the fallback when the route is empty). The client's
  // dropDate must match one of them, and its drop must still be open, or we reject — regardless
  // of what the client clock or a stale page said.
  const { data: nextStops, error: stopsError } = await supabaseAdmin.from("stops").select("id, starts_at, market")
    .is("archived_at", null).is("canceled_at", null).neq("status", "done").not("starts_at", "is", null)
    .gte("starts_at", new Date().toISOString()).order("starts_at", { ascending: true }).limit(PICKUP_STOPS_READ);
  // A READ THAT FAILED IS NO SCHEDULE (R39 — the fresh audit's API11-06). Its error went unread: an empty list, and the
  // Saturday cadence offered in its place — a pack charged for a day the truck isn't scheduled, at no stop. It waits.
  if (stopsError) return NextResponse.json({ error: PACK_ROAD_WORDS.unread, charged: false }, { status: 503 });
  // A city held closed, or not open yet, takes no pack at its stops (0412, R7b re-audit — lib/packRoad): before any claim.
  const road = await packRoad(supabaseAdmin, (nextStops ?? []) as { id: string; starts_at: string; market?: string | null }[]);
  if (road.error !== null) return NextResponse.json({ error: PACK_ROAD_WORDS.unread, charged: false }, { status: 503 });
  const named = ((nextStops ?? []) as { id: string; market?: string | null }[]).find((st) => st.id === body.stopId);
  if (named && road.heldCity(named)) return NextResponse.json({ error: PACK_ROAD_WORDS.heldStop }, { status: 409 });
  if (!road.taking.length && road.foundingHeld) return NextResponse.json({ error: PACK_ROAD_WORDS.none }, { status: 409 });
  const offered = offeredDays(road.taking); // dropDate key → its order cutoff
  // Accept a plain day key or a full ISO instant; an instant resolves through the same ET
  // day-key rule the offered map uses (post-8pm-ET stops are otherwise off by one UTC day).
  const requested = requestedDay(body.dropDate);
  // The stop the customer picked on that day (R5, 0397: a pack is picked up at a stop); none named — an app from before
  // R5 sends none — the day's first stop still taking packs, then its first. Its drop closes by the one rule
  // (lib/pickupDay) — the map above holds one cutoff per DAY, the last stop's when there are two.
  const onDay = road.taking.filter((st) => requestedDay(st.starts_at) === requested);
  const atStop = onDay.find((st) => st.id === body.stopId) ?? onDay.find((st) => packIsOpen(requested, st)) ?? onDay[0] ?? null;
  const cutoff = atStop ? packClosesAt(requested, atStop) : offered.get(requested);
  if (!cutoff) {
    return NextResponse.json({ error: "That pickup day just changed — refresh to see the current stops." }, { status: 409 });
  }
  if (Date.now() > cutoff.getTime()) {
    return NextResponse.json({ error: "That drop has closed — pick the next pickup day." }, { status: 400 });
  }
  const dropDate = requested;

  // Authoritative total — recomputed from the pricing grid, never the client amount.
  // Member benefits (0176): the caller's tier perks plus any code they present, resolved server-side
  // (the client can't forge them). A founding member bringing bottles back gets straight-brew refills
  // free (order-ahead packs are always straight brew, so the refill benefit zeroes a return pack); a
  // percent-off code discounts the whole order (new or return). Best benefit wins (lib/packOrder.packCents:
  // deepest percent, then amount-off (0268), floored at 0).
  const benefits = await benefitsForUser(user.id, (body as { code?: string }).code);
  const amount = packCents(size, glass, benefits);
  // Never more than the page showed (R5, lib/shownTotal): refused before any charge or reservation, with the total it
  // would be. Less goes through — a member's perk the page cannot see — and the confirmation says the amount charged.
  const raised = aboveShown(amount, shownCents(body.expectedCents));
  if (raised) return NextResponse.json(raised, { status: 409 });
  // ON US (R7b): a pack the caller's perks price at $0 — a founding member's bring-back refill (0176) — is never sent to
  // Square, which refuses a $0 charge (the founding refill failed at Pay). It is reserved as nothing charged — not as
  // paid, which every cancel path reads as a card to refund ("refund needed — $0.00") — and nothing is due at the window
  // (lib/collect canCollect: nothing to collect on $0).
  const free = amount === 0;
  const charging = wantsCharge && !free;
  // Pay at pickup is the owner's dial for packs as for cups (live_status.pay_at_pickup, 0147). The funnel offers it only
  // while the dial is on; the server holds the same line (R7b) — a page left open across the switch still reserved packs
  // to be paid at the truck. Read before the key is claimed, so a refusal leaves nothing behind.
  if (!charging && !free) {
    const { data: dial, error: dialError } = await supabaseAdmin.from("live_status").select("pay_at_pickup").maybeSingle();
    // The switch unread is not the switch on (R39 — API11-06): it waits, nothing reserved.
    if (dialError) return NextResponse.json({ error: PAY_DIAL_UNREAD, charged: false }, { status: 503 });
    if ((dial as { pay_at_pickup?: boolean } | null)?.pay_at_pickup === false) {
      return NextResponse.json({ error: "Pay at pickup isn't available right now — pay by card instead." }, { status: 409 });
    }
  }

  // ONE KEY, ONE CHARGE (R5, 2026-10-13 — lib/chargeOnce, 0371, as the cup checkout). The key is claimed before Square is
  // asked, or before a pay-at-pickup pack is written: a second tap while the first is still out hears "still confirming",
  // and an answer Square never gave stays "we couldn't confirm" — the crew told, nothing under that key sent to Square
  // again. It was a bare 502, "Reservation service unavailable", with nobody told, whether Square's answer was lost or
  // the pack failed to save after the card was charged.
  // COUNTED (R9 — the abuse audit's fourth and fifth). A card try, at every card door (lib/cardGuard). A pack to pay at
  // pickup — charged nothing, and each an alert on the crew's phones and an email to every admin — four an hour a member,
  // and no more than three still to be paid at the window at once. After a seen key is answered, before it is claimed.
  if (charging) {
    const payer = { userId: user.id, ip: callerAddress(req) };   // their tries, and a card Square refuses them (R32)
    const cardRefusal = await cardTryRefusal(supabaseAdmin, payer);
    if (cardRefusal) return NextResponse.json({ error: cardRefusal, charged: false }, { status: 429 });
  } else {
    const fits = await supabaseAdmin.rpc("rate_limit_hit", { p_bucket: `reserve-later:u:${user.id}`, p_window_ms: 3_600_000, p_max: 4 });
    if (fits.data === false) return NextResponse.json({ error: "That's a lot of packs in one go — pay for this one by card, or give it a while.", charged: false }, { status: 429 });
    if (!free) {
      // scoped-by: user_id = the caller's own id, from their verified bearer.
      // Packs still to come only: one from a drop gone by, never picked up (nothing closes those), isn't waiting.
      const waiting = await supabaseAdmin.from("drop_orders").select("id", { count: "exact", head: true })
        .eq("user_id", user.id).eq("paid", false).is("collected_at", null).is("canceled_at", null).eq("picked_up", false).gt("total_cents", 0)
        .gte("drop_date", etToday());
      if (!waiting.error && (waiting.count ?? 0) >= PACKS_AT_WINDOW_MAX) {
        return NextResponse.json({ error: `You have ${waiting.count} packs waiting to be paid at pickup — pick those up first, or pay for this one by card.`, charged: false }, { status: 409 });
      }
    }
  }
  const held = await claimKey(seen.claims, idemKey, { channel: "packs", card: charging, amountCents: amount }, now, stopped, say);
  if ("answer" in held) return reply(held.answer);

  // The pack, written once the money is settled — charged (paid) or due at pickup. Its answer is kept on the claim and
  // said again to every retry of this key. It cannot throw: with a card the money is taken by now, so a failure here is
  // told to the crew and answered as "reserved, being added" — never as a checkout that failed.
  const db = supabaseAdmin;   // checked at the top; the closure below runs after the charge
  const recordPack = async (paymentId: string | null, paid: boolean): Promise<Answer> => {
    try {
      // Idempotency at the ORDER row, the line behind the claim: Square
      // answers a repeated key with the SAME paymentId, and a pay-at-pickup retry carries the same key. Unique indexes
      // on drop_orders.payment_id and idempotency_key back both.
      // scoped-by: payment_id and idempotency_key each carry a UNIQUE index (verified in production); payment_id is issued
      // by Square and the key is this caller's own — at most one row in the whole table, a stricter key than tenant_id.
      const { data: already } = paymentId
        ? await db.from("drop_orders").select("id").eq("payment_id", paymentId).maybeSingle()
        : await db.from("drop_orders").select("id").eq("idempotency_key", idemKey).maybeSingle();
      if (already) return { status: 200, body: { ok: true, id: already.id, paid, recorded: true, totalCents: amount } };

      // Canonical customer link (0151) — member-only route, so user.id is the strong key; phone folds
      // any prior guest orders on the same number into this record.
      const customerId = (await db.rpc("resolve_customer", { p_user_id: user.id, p_phone: phone || null, p_email: null, p_name: name })).data as string | null;
      // The VALIDATED code rides the order row (0268) — coupon redemptions become a query, not a tally. The stop rides it
      // too (0397); none named, the database links the day's first.
      const row = { user_id: user.id, customer_id: customerId, name, phone, size, glass, mix, total_cents: amount, paid, payment_id: paymentId, idempotency_key: idemKey, drop_date: dropDate, stop_id: atStop?.id ?? null, benefit_code: acceptedCode(benefits, (body as { code?: string }).code) };
      let made: { id: string } | null = null;
      const insertPack = async (r: TablesInsert<"drop_orders">) => {
        const res = await db.from("drop_orders").insert(r).select("id").single();
        made = (res.data as { id: string } | null) ?? null;
        return res;
      };
      let { error: insErr } = await insertPack(row);
      if (insErr) ({ error: insErr } = await insertPack(row)); // retry once
      const inserted = made as { id: string } | null;
      if (insErr) {
        // A concurrent request can still lose this exact race (both can pass the check above before either insert
        // commits) — the unique indexes are the backstop. Confirm the other request's row is there before raising a
        // false "didn't record" alert, which would have staff double-add a reservation already on the drop.
        if ((insErr as { code?: string }).code === "23505") {
          // scoped-by: as above — unique payment_id / idempotency_key, one row at most.
          const dupe = paymentId
            ? await db.from("drop_orders").select("id").eq("payment_id", paymentId).maybeSingle()
            : await db.from("drop_orders").select("id").eq("idempotency_key", idemKey).maybeSingle();
          if (dupe.data) return { status: 200, body: { ok: true, id: dupe.data.id, paid, recorded: true, totalCents: amount } };
        }
        const ref = (paymentId || "").slice(-6).toUpperCase();
        const title = paid ? "Paid reservation didn't record — add it" : "Reservation didn't record — add it";
        await raiseAlert({ severity: "critical", category: paid ? "money" : "order", kind: "ops_incident", title, body: `${paid && paymentId ? `A card payment succeeded (${paymentId}, ${money(amount)}) but the` : paid ? "A paid" : amount === 0 ? "A pack on us (nothing charged): the" : "A pre-order"} reservation didn't save. ${name} · ${size}-pack ${glass} · ${mixSummary(mix)} · pickup ${pickupDayWords(dropDate)}.${paid ? " Add it and confirm in Square." : " Add it to the drop."}` });
        return { status: 200, body: { ok: true, paid, recorded: false, ref, warn: `Reserved${ref ? ` — ref ${ref}` : ""}. We've alerted the crew; show this at pickup.` } };
      }

      // The yes to texts, kept with the pack (R5, 0398): only when they ticked it (components/TextYes), for the number on
      // this pack, and only while texts are switched on. Best-effort — a yes that could not be kept is no yes. A new yes is
      // confirmed by text before the pack's own (R6, lib/notify sayTextYes), so the first text they get says what comes.
      if (body.textOptIn === true && textsOn()) await sayTextYes(phone, "pack_checkout", user.id);

      // Confirmation to the customer — email, and a text to a number that said yes (lib/notify: 0398, never at night).
      // Best-effort: a provider hiccup never fails the reservation.
      await notifyCustomer({
        phone,
        email: await accountEmail(user.id),
        // What it costs is what was charged or is due (R5): `amount`, with the member's perks and code — it said the pack's
        // list price, so a founding member whose refills are free read "$40 at pickup" for a pack that was $0. The day is
        // a day ("Sat, Oct 17"), not the key the row keeps.
        subject: `GT3 — ${size}-pack reserved for ${pickupDayWords(dropDate)}`,
        message: `GT3: your ${size}-pack (${mixSummary(mix)}) is reserved for pickup ${pickupDayWords(dropDate)}${amount === 0 ? " — on us ✓" : paid ? ` — ${money(amount)} paid ✓` : ` — ${money(amount)} at pickup`}. We brew it fresh for pickup day.${glass === "return" ? " Rinse your empties and bring them along." : ""}`,
      });

      // 'important' (2026-10-11): an fyi reaches the inbox only now (supabase/functions/push/policy.ts), and this is the
      // one line a new reservation gets — the push function's own alert for it was refused by 0232 (category 'drop').
      await raiseAlert({ severity: "important", category: "order", kind: "reservation_new", subjectId: inserted?.id ?? undefined, title: "New reservation 🎉", body: `${name} reserved a ${size}-pack (${mixSummary(mix)}) for ${pickupDayWords(dropDate)} — ${money(amount)}, ${glass === "return" ? "bringing bottles back" : "new glass"}${paid ? "" : " · pay at pickup"}.` });
      return { status: 200, body: { ok: true, id: inserted?.id ?? null, paid, recorded: true, totalCents: amount } };
    } catch (e) {
      const ref = (paymentId || "").slice(-6).toUpperCase();
      await raiseAlert({ severity: "critical", category: paid ? "money" : "order", kind: "ops_incident", title: paid ? "Paid reservation didn't finish saving — check it" : "A reservation didn't finish saving — check it", body: `${paid ? `A card payment succeeded (${paymentId ?? "no payment id"}, ${money(amount)}) and saving` : "Saving"} ${name}'s ${size}-pack for ${pickupDayWords(dropDate)} broke (${errorMessage(e, 160)}). Check the drop; add what is missing${paid ? " or refund it" : ""}.` });
      return { status: 200, body: { ok: true, paid, recorded: false, ref, warn: `Reserved${ref ? ` — ref ${ref}` : ""}. We've alerted the crew to finish it; show this at pickup.` } };
    }
  };

  // Pay at pickup, or a pack on us: nothing is charged; the claim makes a retry hear this pack's answer instead of writing
  // a second one, and a pack that was not written gives the key back.
  if (!charging) return reply(await placeOnce({ claims: held.claims, key: idemKey, now, place: () => recordPack(null, false) }));

  // buyerEmail → Square emails the customer a receipt (enterprise round P3). Read before the charge, so a failure
  // reading it is a failure before anything was charged.
  const buyerEmail = await accountEmail(user.id);
  return reply(await chargeOnce({
    claims: held.claims, key: idemKey, now,
    charge: () => chargeCard({ token: token!, locationId: locationId!, sourceId: body.sourceId!, amountCents: amount, note: `GT3PB order-ahead · ${size}-pack · ${glass} · pickup ${dropDate}`, idempotencyKey: idemKey, buyerEmail, who: { userId: user.id, ip: callerAddress(req) } }),
    record: (paymentId) => recordPack(paymentId, true),
    // chargeCard threw: Square's answer never came or did not say whether the card was charged. The claim is 'unknown'
    // from here; this answer and every retry's are the same words, and the payment, if there is one, carries the key.
    unknown: async (e) => {
      await raiseAlert({ severity: "critical", category: "money", kind: "ops_incident", title: "Pack charge status unknown — check Square", body: `A card charge of ${money(amount)} for ${name}'s ${size}-pack (pickup ${pickupDayWords(dropDate)}) may or may not have gone through (${errorMessage(e, 160)}). A payment, if there is one, carries the reference ${idemKey}.` });
      return say.couldNotConfirm!(true);
    },
  }));
}

export const POST = route("reserve", post);
