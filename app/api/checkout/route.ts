import { NextResponse } from "next/server";
import { nameFrom } from "@/lib/drinks";
import { readCityOut, readMenuRows } from "@/lib/drinksRead";
import { chargeCard, safeIdemKey, type PaidCard } from "@/lib/squareServer";
import { randomUUID } from "node:crypto";
import { orderNo } from "@/lib/activeOrder";
import { squarePriceMap } from "@/lib/squareCatalog";
import { priceCups, priceChangedWords, tipCentsFor } from "@/lib/cupPrice";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { userFromRequest } from "@/lib/apiAuth";
import { benefitsForUser, acceptedCode } from "@/lib/benefits";
import { raiseAlert } from "@/lib/serverAlerts";
import { notifyCustomer, accountEmail } from "@/lib/notify";
import { readyWords, refusalWords, pickupWords, type Ordering } from "@/lib/ordering";
import { orderingFrom, readOrdering, readStopMenu } from "@/lib/orderingRead";
import { cartRefusal, MENU_UNCHECKED, offStopMenu, stopMenuRefusal } from "@/lib/catalog";
import { isMissingFunction, writeAcrossSkew } from "@/lib/schemaSkew";
import { FOUNDING_MARKET, toMarket } from "@/lib/markets";
import { money } from "@/lib/money";
import { route } from "@/lib/apiRoute";
import { errorMessage } from "@/lib/errorMessage";
import { chargeOnce, claimKey, couldNotConfirm, placeOnce, seenBefore, type Answer, type Stopped } from "@/lib/chargeOnce";
import { checkoutClaims } from "@/lib/checkoutClaims";

const reply = (a: Answer) => NextResponse.json(a.body, { status: a.status });

async function post(req: Request) {
  // Every write into `orders` goes through here now — paid (Square) AND pay-at-pickup (unpaid).
  // Pay-at-pickup used to insert directly from the client (RLS-gated to unpaid rows only); moving
  // it here means the SAME availability + ordering-window checks the paid path already enforces now
  // apply to it too, and the client INSERT door on `orders` can close (0156) — the last order table
  // with a client write path becomes server-only, like every sibling table.
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Checkout isn't switched on yet." }, { status: 503 });
  }

  let body: { sourceId?: string; items?: unknown[]; tipCents?: number; customer?: string; code?: string; idempotencyKey?: string; expectedCents?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  // A literal `null` body (e.g. body: 'null') is valid JSON — req.json() resolves to it without
  // throwing, so it slips past the try/catch above. Destructuring `null` next would throw a raw
  // TypeError outside any try block, producing a generic 500 instead of a clean 400.
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const { sourceId, items, tipCents } = body;
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "Empty order" }, { status: 400 });
  }
  if (items.length > 25) return NextResponse.json({ error: "Order too large" }, { status: 400 });
  // Every line is a drink's slug (the Catalog's key). The code list used to refuse anything else as "Unknown item"; since
  // the Catalog is the menu (R2) the check is said here, before any read.
  if (!items.every((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  // sourceId present = paying by card now (Square required). Absent = pay-at-pickup (no Square
  // call at all — the crew charges in person at the window).
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID;
  const paying = !!sourceId;
  if (paying && (!token || !locationId)) {
    return NextResponse.json({ error: "Card checkout isn't switched on yet." }, { status: 503 });
  }
  const customer = typeof body.customer === "string" && body.customer.trim() ? body.customer.trim().slice(0, 80) : null;
  if (!paying && !customer) return NextResponse.json({ error: "Add a name for pickup" }, { status: 400 });

  // ONE KEY, ONE CHARGE (0371, lib/chargeOnce). The page keeps one key per checkout, whichever button
  // sends it, and this route claims it before Square is called. A key that has been here before is
  // answered NOW — before the limiter, the stock or the truck's hours are asked again — with what its
  // first request said, or "still confirming": a retry of an order that went in must hear "order in",
  // not "sold out" or "closed" because the world moved on while the first answer was lost. Nothing
  // under a claimed key is ever sent to Square again.
  // arrives-with: 0371 — before it is pasted lib/checkoutClaims reports the table missing and the
  // checkout runs without claims, exactly as it did before them; nothing is refused for it.
  const idemKey = safeIdemKey(body.idempotencyKey);
  const now = () => Date.now();
  // A claim whose request died (lib/chargeOnce.answerFor) is told to the crew by the retry that finds it.
  const stopped = async ({ key, claim }: Stopped) => {
    const who = customer ? ` Name: ${customer}.` : "";
    if (claim.card && claim.state === "charged") {
      await raiseAlert({ severity: "critical", category: "money", title: "Paid order may not have recorded — check the pass", body: `A card payment went through (${claim.payment_id ?? "no payment id"}, ${money(claim.amount_cents ?? 0)}) and the checkout stopped before the order was saved.${who} If it isn't on the pass, add it. Items: ${items.map((slug) => nameFrom(null, String(slug))).join(", ")}.` });
    } else if (claim.card) {
      await raiseAlert({ severity: "critical", category: "money", title: "Checkout charge status unknown — check Square", body: `A checkout stopped while Square was being asked to charge ${money(claim.amount_cents ?? 0)}.${who} A payment, if there is one, carries this key as its reference id: ${key}. Retries are not charged; check Square before taking payment again.` });
    } else {
      await raiseAlert({ severity: "important", category: "order", title: "A pre-order may not have saved — check the pass", body: `A pay-at-pickup order stopped while it was being saved.${who} Items: ${items.map((slug) => nameFrom(null, String(slug))).join(", ")}. If it isn't on the pass, add it.` });
    }
  };
  const seen = await seenBefore(checkoutClaims(supabaseAdmin), idemKey, paying, now, stopped);
  if ("answer" in seen) return reply(seen.answer);

  // Card-testing guard: the guest card path is open by design (walk-up POS, no login), which makes it
  // the natural target for scripted BIN/stolen-card testing. Throttle it with the durable Postgres
  // limiter (rate_limit_hit, 0154, shared across lambdas): a tight per-IP burst cap plus a global
  // ceiling so a rotating-IP script still can't grind cards through Square. Pay-at-pickup is exempt
  // (no charge). Fails open if the limiter is unreachable — Square's own fraud tools are the backstop.
  if (paying) {
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "anon";
    const [ipHit, allHit] = await Promise.all([
      supabaseAdmin.rpc("rate_limit_hit", { p_bucket: `checkout:${ip}`, p_window_ms: 60_000, p_max: 6 }),
      supabaseAdmin.rpc("rate_limit_hit", { p_bucket: "checkout:global", p_window_ms: 60_000, p_max: 60 }),
    ]);
    if (ipHit.data === false || allHit.data === false) {
      return NextResponse.json({ error: "Too many attempts — give it a minute." }, { status: 429 });
    }
  }

  // Availability is enforced HERE, not just on the screen: a stale cart or tampered client can't
  // buy an 86'd or delisted item. Checked before any charge. A drink is sold only while it has a
  // products row on the menu (C3, 2026-10-12): a missing row used to fail open — "a catalog gap must
  // not brick checkout" — which kept a drink deleted in the Catalog on sale. A failed read is not an
  // empty menu: it waits (503). Same query also carries price_cents — the one price authority — so
  // this single read covers both jobs.
  const productPrices: Record<string, number> = {};
  let cupRows: Awaited<ReturnType<typeof readMenuRows>>["rows"] = [];
  {
    const uniq = [...new Set(items)];
    // The Catalog's rows for this cart — the menu's own read (lib/drinksRead; 0393's columns when they are there), so "sold by
    // the cup" and the names Pay says come from the same rows as the price.
    const { rows, error: availErr } = await readMenuRows(supabaseAdmin, uniq);
    if (availErr) return NextResponse.json({ error: MENU_UNCHECKED }, { status: 503 });
    cupRows = rows;
    const refused = cartRefusal(uniq, rows, (slug) => nameFrom(rows, slug));
    if (refused) return NextResponse.json({ error: refused }, { status: 409 });
    for (const p of rows) if (typeof p.price_cents === "number" && p.price_cents > 0) productPrices[p.slug] = p.price_cents;
  }

  // Cups are only sold when there's a truck to make them — lib/ordering's rule, on lib/orderingRead's
  // rows, the SAME two the menu, the drink sheet and this checkout's own sheet ask (2026-10-04).
  // This used to be a second copy that read the live_status singleton and the global lead, so a
  // stop's own order-ahead window (0191) and a city's own live switch (0285) were offered on the
  // phone and refused here, at Pay. It is the authoritative check before any charge, and if the
  // read fails the gate closes — better to refuse an order than charge a card we can't record.
  //
  // MARKET (0279): the gate asks about the buyer's city, not "is any stop anywhere next". A client
  // that sends nothing is the founding market, gated exactly as it was.
  let ordering: Ordering;
  const market = toMarket((body as { market?: unknown }).market);
  {
    const nowMs = Date.now();
    const read = await readOrdering(supabaseAdmin, market, nowMs);
    if (!read.inputs) {
      return NextResponse.json({ error: "We couldn't check the truck's schedule — give it another tap in a moment." }, { status: 503 });
    }
    ordering = orderingFrom(read.inputs, nowMs);
    if (!ordering.open) return NextResponse.json({ error: refusalWords(ordering, nowMs) }, { status: 409 });
    // A STOP'S MENU (R2, 2026-10-13): a stop with a menu set sells what it pours (stop_menu, 0393). A read that failed is
    // not "no menu": the order waits, like the truck's schedule above. Before 0393 there is no menu to read — nothing limits.
    if (ordering.stop?.id) {
      const sm = await readStopMenu(supabaseAdmin, ordering.stop.id);
      if (sm.error && !isMissingFunction(sm.error)) return NextResponse.json({ error: "We couldn't check this stop's menu — give it another tap in a moment." }, { status: 503 });
      const off = offStopMenu(items, sm.menu).map((slug) => nameFrom(cupRows, slug));
      const refusedHere = stopMenuRefusal(off, ordering.stop.name);
      if (refusedHere) return NextResponse.json({ error: refusedHere }, { status: 409 });
    }
    // AN 86 IS FOR ONE CITY (2026-10-15, 0408): the Pass's 86 sells an item out in its truck's city only. The order's city
    // is its stop's (readOrdering reads this market's stops), else the founding city — the rule the order's own insert
    // checks (0408's check_order_availability). Asked here, before the card, in the words an 86 everywhere is refused in.
    const city = ordering.stop ? market : FOUNDING_MARKET;
    const cart = [...new Set(items)];
    const here = await readCityOut(supabaseAdmin, city, cart);
    if (here.error) return NextResponse.json({ error: MENU_UNCHECKED }, { status: 503 });
    const outHere = here.out.size ? cartRefusal(cart, cupRows.map((r) => (here.out.has(r.slug) ? { ...r, sold_out: true } : r)), (slug) => nameFrom(cupRows, slug)) : null;
    if (outHere) return NextResponse.json({ error: outHere }, { status: 409 });
  }
  // What the customer was promised, said once for the screen, the email and the crew's pass: placed
  // ahead of a stop, it is made from the stop's start (orders.ready_from, 0343); otherwise now.
  const promise = { readyFrom: ordering.readyFrom, ready: readyWords(ordering), pickup: pickupWords(ordering) };
  // 0343 may not be pasted yet when this ships: the order goes in without ready_from rather than not
  // at all (lib/schemaSkew.writeAcrossSkew — the one column named, nothing else forgiven). The same for the tip (0390,
  // H9 of the customer audit): kept with the order once 0390 is pasted, and the order goes in without it before.
  // arrives-with: 0343, 0390
  const insertOrder = (row: Record<string, unknown>) =>
    writeAcrossSkew((r) => supabaseAdmin!.from("orders").insert(r), promise.readyFrom ? { ...row, ready_from: promise.readyFrom } : row, ["ready_from", "tip_cents"]);

  // Pay-at-pickup is the owner's dial (live_status.pay_at_pickup, 0147) — server-authoritative now
  // that this path runs through the API at all, matching the subscriptions_enabled pattern (0150).
  if (!paying) {
    const { data: ls2 } = await supabaseAdmin.from("live_status").select("pay_at_pickup").maybeSingle();
    if ((ls2 as { pay_at_pickup?: boolean } | null)?.pay_at_pickup === false) {
      return NextResponse.json({ error: "Pay at pickup isn't available right now — pay by card instead." }, { status: 409 });
    }
  }

  // Server computes the authoritative goods subtotal (never trust a client amount). products.
  // price_cents first (the one price authority); Square Catalog only for a slug missing from
  // products (a catalog gap) AND only when a Square token exists (pay-at-pickup can run with no
  // Square configured at all); lib/menu.ts's px only if both are unreachable.
  const needsSquare = items.some((id) => productPrices[id] == null);
  const squarePrices = needsSquare && token ? await squarePriceMap(token) : {};
  // Member benefits (0176): a founding member's tier perks (e.g. $8 latte) apply to the authoritative
  // per-slug price. Server-resolved from the caller's tier — never trusts a client-sent discount.
  const benefitUser = await userFromRequest(req);
  const benefits = await benefitsForUser(benefitUser?.id ?? null, body.code);
  // lib/cupPrice — the one pricing the quote (/api/checkout/quote) runs too, so the page shows what this charges.
  const priced = priceCups(items, productPrices, squarePrices, benefits, (slug) => nameFrom(cupRows, slug));
  if ("unknown" in priced) return NextResponse.json({ error: `Unknown item: ${priced.unknown}` }, { status: 400 });
  const subtotal = priced.subtotal;
  // Which code to RECORD on the order (0268): only one that can actually reprice this channel.
  // amount_off is order-level (packs) — validating it here without a discount would inflate the
  // coupon-redemption KPI with rows where nothing was redeemed.
  const cupsCode = acceptedCode(benefits.filter((b) => b.scope !== "code" || b.kind !== "amount_off"), body.code);
  // Tip is additive and capped at the subtotal as a fat-finger guard. Pay-at-pickup has no tip yet
  // (nothing charged here to attach it to) — the field is ignored on that path.
  const tip = tipCentsFor(paying, tipCents, subtotal);
  const amount = subtotal + tip;

  // THE AMOUNT ON THE BUTTON IS THE AMOUNT ON THE CARD (C2, 2026-10-12). The page sends what it showed — its quote
  // from /api/checkout/quote, the tip on top — and this route charges nothing else: a price changed or a perk applied
  // since, and it refuses before the claim and the card, with the amount it is now and the lines, which the page shows
  // before the next tap. A page that sends no amount (an app build from before this) is charged as it always was.
  const expected = typeof body.expectedCents === "number" && Number.isFinite(body.expectedCents) ? Math.round(body.expectedCents) : null;
  const due = paying ? amount : subtotal;
  if (expected !== null && expected !== due) {
    return NextResponse.json({ error: priceChangedWords(due, paying), priceChanged: true, subtotalCents: subtotal, amountCents: due, lines: priced.lines }, { status: 409 });
  }

  // Canonical customer link (0151) + who's ordering — shared by both branches below.
  const user = await userFromRequest(req); // null for guest checkout
  const customerId = user?.id
    ? ((await supabaseAdmin.rpc("resolve_customer", { p_user_id: user.id, p_phone: null, p_email: null, p_name: customer })).data as string | null)
    : null;

  // THE ORDER'S NUMBER AND ITS TICKET (2026-10-13, R3b of the customer audit — board 09). The id is made here, so the
  // answer can say the number the window calls ("#4F2A") without reading the row back. The ticket — the link that shows
  // this one order to whoever holds it, guests too (0395) — is the table's own, read once the row is in, as the
  // receipt's lines (what this route priced) and the card's brand and last four are written beside it.
  const orderId = randomUUID();
  const receiptLines = priced.lines.map((l) => ({ slug: l.slug, name: l.name, qty: l.qty, unit_cents: l.cents, ...(l.cents !== l.baseCents ? { base_cents: l.baseCents } : {}) }));
  const ticketFor = async (card: PaidCard | null): Promise<string | null> => {
    // arrives-with: 0395 — until it is pasted the columns are not there: this write and its read fail together, on
    // their own, after the order is in; the answer carries the order's number and no link.
    // scoped-by: orderId was made above and the row was just inserted with it — this checkout's own order, one row.
    const { data } = await supabaseAdmin!.from("orders")
      .update(card?.last4 ? { lines: receiptLines, card_brand: card.brand, card_last4: card.last4 } : { lines: receiptLines })
      .eq("id", orderId).select("ticket").maybeSingle();
    return (data as { ticket?: string | null } | null)?.ticket ?? null;
  };

  if (!paying) {
    // Pay-at-pickup: record unpaid, no Square call — the crew charges in person at the window. Claimed
    // like a charge (lib/chargeOnce): a retry after "we're offline" gets this order's answer back
    // instead of putting a second one on the pass. A refused insert gives the key back.
    const held = await claimKey(seen.claims, idemKey, { channel: "cups", card: false, amountCents: subtotal }, now, stopped);
    if ("answer" in held) return reply(held.answer);
    return reply(await placeOnce({ claims: held.claims, key: idemKey, now, place: async (): Promise<Answer> => {
      const orderRow = { id: orderId, items, total_cents: subtotal, paid: false, payment_id: null, customer, user_id: user?.id ?? null, customer_id: customerId, status: "new", benefit_code: cupsCode, stop_id: ordering.stop?.id ?? null };
      const { error: insErr } = await insertOrder(orderRow);
      if (insErr) return { status: 500, body: { error: "That didn't go through — give it another tap" } };
      // Confirmation email — cup orders carry no phone (a quick on-the-spot order, not a form), so this
      // is account-email-only and only for signed-in members; guests just have the on-screen confirm.
      if (user?.id) {
        await notifyCustomer({ email: await accountEmail(user.id), subject: "GT3 — order in", message: `GT3: your order is in. ${promise.ready} ${promise.pickup}. ${money(subtotal)} at pickup.` });
      }
      // `paid` says which kind of order this was, because one key covers the checkout whichever button
      // was tapped: a retry from Pay can be answered with this pre-order, and must not read as a charge.
      const ticket = await ticketFor(null);
      return { status: 200, body: { ok: true, paid: false, amount: subtotal, recorded: true, no: orderNo(orderId), ticket, ...promise } };
    } }));
  }

  // buyerEmail → Square emails the customer a receipt (enterprise round P3); guests charge as before.
  // Read before the claim, so a failure reading it is a failure before anything was claimed or charged.
  const buyerEmail = user?.id ? await accountEmail(user.id) : null;
  const held = await claimKey(seen.claims, idemKey, { channel: "cups", card: true, amountCents: amount }, now, stopped);
  if ("answer" in held) return reply(held.answer);

  // Record the paid order server-side (paid + payment_id are trustworthy here). Its answer is kept on
  // the claim and said again to every retry of this key.
  // paidWith: the card Square says it was paid with (brand and last four — R3b, 0395), for the receipt.
  const recordPaid = async (paymentId: string | null, paidWith: PaidCard | null): Promise<Answer> => {
    try {
      // Idempotency at the ORDER row, the line behind the claim: Square answers a repeated key with the
      // SAME paymentId, so if an order already carries it — a retry while 0371 is unpasted, when that
      // replay is the only dedupe there is — don't insert a SECOND paid order → double fulfillment.
      // (A unique index on payment_id backs this in DB.)
      if (paymentId) {
        // scoped-by: payment_id carries a UNIQUE index (verified in production) and the value is issued by Square, never chosen by the caller — at most one row in the whole table, a stricter key than tenant_id
        const { data: already } = await supabaseAdmin!.from("orders").select("id").eq("payment_id", paymentId).maybeSingle();
        if (already) return { status: 200, body: { ok: true, paid: true, paymentId, amount, recorded: true, ...promise } };
      }

      // total_cents is the GOODS subtotal (tip excluded) so history + the referral floor
      // are consistent across paid and pre-order paths.
      // stop_id: the stop the order is for (0219's column; 0391 — a canceled stop tells the orders placed for it).
      const orderRow = { id: orderId, items, total_cents: subtotal, tip_cents: tip, paid: true, payment_id: paymentId, customer, user_id: user?.id ?? null, customer_id: customerId, status: "new", benefit_code: cupsCode, stop_id: ordering.stop?.id ?? null };
      let { error: insErr } = await insertOrder(orderRow);
      if (insErr) {
        // Charge succeeded but recording failed. Retry once — a transient DB blip must not cost the
        // customer their order record when their money is already taken.
        ({ error: insErr } = await insertOrder(orderRow));
      }
      if (insErr) {
        // Two requests for one charge reach this insert only without the claim (0371 unpasted): Square
        // answered both with the same paymentId, so the OTHER insert succeeding isn't a failure, it's the
        // dedupe working. Confirm that row is really there before raising a false "didn't record" alert,
        // which would otherwise have staff double-add an order that's already correctly on the pass.
        if ((insErr as { code?: string }).code === "23505" && paymentId) {
          // scoped-by: payment_id carries a UNIQUE index (verified in production) and the value is issued by Square, never chosen by the caller — at most one row in the whole table, a stricter key than tenant_id
          const { data: already2 } = await supabaseAdmin!.from("orders").select("id").eq("payment_id", paymentId).maybeSingle();
          if (already2) return { status: 200, body: { ok: true, paid: true, paymentId, amount, recorded: true, ...promise } };
        }
        // Still failed, and not a benign race: alert the crew immediately with the payment, what it was
        // for, and why it didn't save, and hand the customer a reference to show at the window. The
        // usual why is the table's own stock check (0129): an item 86'd between this route's check and
        // the insert, after the card was charged — so the alert says make it, or refund that payment.
        const ref = (paymentId || "").slice(-6).toUpperCase();
        const why = String((insErr as { message?: string }).message ?? "").slice(0, 90);
        await raiseAlert({ severity: "critical", category: "money", title: "Paid order didn't record — add it", body: `A card payment succeeded (${paymentId}, ${money(amount)}) but the order didn't save${why ? `: ${why}` : "."} ${customer ? `Name: ${customer}. ` : ""}Items: ${items.map((slug) => nameFrom(cupRows, slug)).join(", ")}. Add it to the pass — or, if it can't be made, refund that payment in Square.${promise.readyFrom ? ` Placed ahead for ${promise.pickup}.` : ""}` });
        return { status: 200, body: { ok: true, paid: true, paymentId, amount, recorded: false, ref, warn: `Payment received${ref ? ` — ref ${ref}` : ""}. We've alerted the crew to add your order; show this ref at the window.`, ...promise } };
      }
      if (user?.id) {
        await notifyCustomer({ email: await accountEmail(user.id), subject: "GT3 — order in", message: `GT3: your order is in. ${promise.ready} ${promise.pickup}. ${money(amount)} paid.` });
      }
      const ticket = await ticketFor(paidWith);
      return { status: 200, body: { ok: true, paid: true, paymentId, amount, recorded: true, no: orderNo(orderId), ticket, ...promise } };
    } catch {
      // The charge is DONE at this point (we have a paymentId) — an exception here means something
      // broke while RECORDING it, not while paying. "Payment service unavailable" would be actively
      // wrong (they WERE charged); point them to the crew instead of implying nothing happened.
      return { status: 200, body: { ok: true, paid: true, paymentId, amount, recorded: false, warn: "Payment received, but we hit a snag recording your order — show this screen at the window and we'll sort it.", ...promise } };
    }
  };

  return reply(await chargeOnce({
    claims: held.claims, key: idemKey, now,
    charge: () => chargeCard({ token: token!, locationId: locationId!, sourceId: sourceId!, amountCents: amount, note: "GT3PB pre-order", idempotencyKey: idemKey, buyerEmail }),
    // The card it was paid with goes on the receipt (R3b, 0395); a retry answered from the claim charges nothing,
    // and its receipt says "Paid" without the card.
    record: (paymentId, charged) => recordPaid(paymentId, charged.card ?? null),
    // chargeCard threw: a dropped connection after Square may already have taken the money, or an answer
    // that does not say whether it did (a 5xx, a reused key — lib/squareServer.chargeVerdict). This is a
    // genuine "may have been charged" state, so it gets its own alert, naming the key the payment carries
    // as its reference id. The claim is now 'unknown': this answer and every retry's are the same words —
    // the crew has been told, don't pay again — and nothing under this key is sent to Square again. (502,
    // and `pending`, so the page keeps the key and the card token: lib/idempotency.attemptVerdict.)
    unknown: async (e) => {
      await raiseAlert({ severity: "critical", category: "money", title: "Checkout charge status unknown — check Square", body: `A card charge may or may not have gone through (${money(amount)}${customer ? `, name: ${customer}` : ""}). A payment, if there is one, carries this key as its reference id: ${idemKey}. Retries are not charged; check Square before taking payment again. ${errorMessage(e, 80)}` });
      return { status: 502, body: { ...couldNotConfirm(true).body } };
    },
  }));
}

export const POST = route("checkout", post);
