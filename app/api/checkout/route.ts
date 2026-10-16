import { NextResponse } from "next/server";
import { MAX_CUPS, nameFrom } from "@/lib/drinks";
import { readCityOut, readMenuRows } from "@/lib/drinksRead";
import { chargeCard, safeIdemKey, type PaidCard } from "@/lib/squareServer";
import { randomUUID } from "node:crypto";
import { orderNo } from "@/lib/activeOrder";
import { orderIdForToday } from "@/lib/orderNumber";
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
import { isMissingFunction } from "@/lib/schemaSkew";
import { FOUNDING_MARKET, toMarket } from "@/lib/markets";
import { money } from "@/lib/money";
import { route } from "@/lib/apiRoute";
import { errorMessage } from "@/lib/errorMessage";
import { chargeOnce, checkOnly, claimKey, couldNotConfirm, placeOnce, seenBefore, type Answer, type Stopped } from "@/lib/chargeOnce";
import { checkoutClaims } from "@/lib/checkoutClaims";
import { CONNECT_APP } from "@/lib/connect";
import { callerIp, limitsFit } from "@/lib/rateLimit";

const reply = (a: Answer) => NextResponse.json(a.body, { status: a.status });
// A minute at most (R10b — the 10/10 audit; reserves/pay's rule): a claim still "started" two minutes on is taken for a
// request that died (lib/chargeOnce IN_FLIGHT_MS), so no request may outlive it — Square is asked with a 20-second
// deadline (lib/squareServer squareDeadline) and the platform stops this at sixty.
export const maxDuration = 60;

/** Orders one member may have waiting to be paid at the window at once (R9): a fourth is paid by card. */
const OPEN_AT_WINDOW_MAX = 3;

async function post(req: Request) {
  // Every write into `orders` goes through here now — paid (Square) AND pay-at-pickup (unpaid).
  // Pay-at-pickup used to insert directly from the client (RLS-gated to unpaid rows only); moving
  // it here means the SAME availability + ordering-window checks the paid path already enforces now
  // apply to it too, and the client INSERT door on `orders` can close (0156) — the last order table
  // with a client write path becomes server-only, like every sibling table.
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Checkout isn't switched on yet.", charged: false }, { status: 503 });
  }

  let body: { sourceId?: string; items?: unknown[]; tipCents?: number; customer?: string; code?: string; idempotencyKey?: string; expectedCents?: number; check?: unknown; card?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  // A literal `null` body (e.g. body: 'null') is valid JSON — req.json() resolves to it without
  // throwing, so it slips past the try/catch above. Destructuring `null` next would throw a raw
  // TypeError outside any try block, producing a generic 500 instead of a clean 400.
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Bad request" }, { status: 400 });

  // A claim whose request died (lib/chargeOnce.answerFor) is told to the crew once — by the retry or by the page's check
  // (R7b), whichever finds it first: paid and not saved, Square's answer lost, or a pre-order that may not have saved. The
  // drinks by the Catalog's names (R7b): the code's list named a drink added in the Catalog by its slug; a failed read
  // still names them, by the code's list, rather than holding the alert back.
  const stoppedAlert = (items: string[] | null, customer: string | null, checked: boolean) => async ({ key, claim }: Stopped) => {
    const who = customer ? ` Name: ${customer}.` : "";
    const how = checked ? " The customer checked on it from the app." : "";
    const named = items ? (await readMenuRows(supabaseAdmin!, [...new Set(items)]).catch(() => ({ rows: null }))).rows ?? null : null;
    const drinks = items ? ` Items: ${items.map((slug) => nameFrom(named, slug)).join(", ")}.` : "";
    if (claim.card && claim.state === "charged") {
      await raiseAlert({ severity: "critical", category: "money", title: "Paid order may not have recorded — check the pass", body: `A card payment went through (${claim.payment_id ?? "no payment id"}, ${money(claim.amount_cents ?? 0)}) and the checkout stopped before the order was saved.${how}${who} If it isn't on the pass, add it.${drinks}` });
    } else if (claim.card) {
      await raiseAlert({ severity: "critical", category: "money", title: "Checkout charge status unknown — check Square", body: `A checkout stopped while Square was being asked to charge ${money(claim.amount_cents ?? 0)}.${how}${who} A payment, if there is one, carries this key as its reference id: ${key}. Retries are not charged; check Square before taking payment again.${drinks}` });
    } else {
      await raiseAlert({ severity: "important", category: "order", title: "A pre-order may not have saved — check the pass", body: `A pay-at-pickup order stopped while it was being saved.${how}${who}${drinks} If it isn't on the pass, add it.` });
    }
  };
  const drinkList = (x: unknown): string[] | null =>
    Array.isArray(x) && x.length > 0 && x.length <= MAX_CUPS && x.every((d): d is string => typeof d === "string" && d.length > 0 && d.length <= 64) ? x : null;
  const nameGiven = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim().slice(0, 80) : null);

  // CHECK ON A PAYMENT (R7b): the page's "Check on my payment" asks what became of one key — its claim's answer, or, for a
  // key never seen, "never reached us" (and the key closed: lib/chargeOnce.checkOnly). Nothing is charged or placed here;
  // the drinks and the name the page still holds for that payment go only into the crew's alert, should it find one.
  if (body.check === true) {
    if (typeof body.idempotencyKey !== "string" || body.idempotencyKey !== safeIdemKey(body.idempotencyKey)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const card = body.card !== false;
    // Bounded like any write a signed-out caller can make (a key it closes is a row): a burst per phone, a ceiling for all —
    // asked in that order (lib/rateLimit, R10), so a phone over its own burst never spends the ceiling everyone shares.
    const ip = callerIp(req);
    if (!(await limitsFit(supabaseAdmin, [
      { bucket: `checkout-check:${ip}`, windowMs: 60_000, max: 10 },
      { bucket: "checkout-check:global", windowMs: 60_000, max: 120 },
    ]))) return NextResponse.json({ error: "Too many tries — give it a minute.", pending: true }, { status: 429 });
    return reply(await checkOnly(checkoutClaims(supabaseAdmin), body.idempotencyKey, card, () => Date.now(), stoppedAlert(drinkList(body.items), nameGiven(body.customer), true)));
  }
  const { sourceId, items, tipCents } = body;
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "Empty order" }, { status: 400 });
  }
  if (items.length > MAX_CUPS) return NextResponse.json({ error: `${MAX_CUPS} drinks is the most one order holds.` }, { status: 400 });
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
    return NextResponse.json({ error: "Card checkout isn't switched on yet.", charged: false }, { status: 503 });
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
  const stopped = stoppedAlert(items.map(String), customer, false);
  const seen = await seenBefore(checkoutClaims(supabaseAdmin), idemKey, paying, now, stopped);
  if ("answer" in seen) return reply(seen.answer);

  // Card-testing guard: the guest card path is open by design (walk-up POS, no login), which makes it
  // the natural target for scripted BIN/stolen-card testing. Throttle it with the durable Postgres
  // limiter (rate_limit_hit, 0154, shared across lambdas): a tight per-IP burst cap plus a global
  // ceiling so a rotating-IP script still can't grind cards through Square. Pay-at-pickup is exempt
  // (no charge). Fails open if the limiter is unreachable — Square's own fraud tools are the backstop.
  // The address is asked first and the ceiling last (lib/rateLimit, R10): one address past its own six never spends
  // the sixty every customer shares — before, its sixty-first try a minute closed card checkout for everybody.
  const ip = callerIp(req);
  // Who is ordering, read once: the limiter below, the member's perks and the order's own row all ask it.
  const caller = await userFromRequest(req);
  if (paying) {
    if (!(await limitsFit(supabaseAdmin, [
      { bucket: `checkout:${ip}`, windowMs: 60_000, max: 6 },
      { bucket: "checkout:global", windowMs: 60_000, max: 60 },
    ]))) {
      return NextResponse.json({ error: "Too many attempts — give it a minute." }, { status: 429 });
    }
  } else {
    // PAY AT PICKUP IS LIMITED TOO (R9 — the abuse audit's first). It charges nothing, so it was never asked, and every
    // order rings the Pass on every crew phone — then again each quarter hour it waits (0369). A script posting a name
    // and a drink put tickets on the Pass all service. A member is limited by their account (venue Wi-Fi shares one
    // address among a crowd) and by the orders they already have waiting at the window; a guest by their address, loosely
    // (a carrier's or a venue's address is a crowd's); and guests together by a ceiling no rush at one truck reaches — a
    // flood past it is the owner's to stop with the pay-at-pickup switch (live_status, 0147). Fails open, as the card
    // guard does.
    const fits = await limitsFit(supabaseAdmin, caller
      ? [{ bucket: `checkout-later:u:${caller.id}`, windowMs: 600_000, max: 4 }]
      : [{ bucket: `checkout-later:${ip}`, windowMs: 600_000, max: 20 }, { bucket: "checkout-later:guests", windowMs: 60_000, max: 30 }]);
    if (!fits) {
      return NextResponse.json({ error: "Too many orders to pay at the window just now — pay by card, or give it a few minutes.", charged: false }, { status: 429 });
    }
    if (caller) {
      // scoped-by: user_id = the caller's own id, read from their verified bearer above.
      // Today's only: an order from days ago left at Ready (nothing closes those) isn't waiting at the window.
      const waiting = await supabaseAdmin.from("orders").select("id", { count: "exact", head: true })
        .eq("user_id", caller.id).eq("paid", false).is("collected_at", null).in("status", ["new", "preparing", "ready"])
        .gte("created_at", new Date(Date.now() - 18 * 3600_000).toISOString());
      if (!waiting.error && (waiting.count ?? 0) >= OPEN_AT_WINDOW_MAX) {
        return NextResponse.json({ error: `You have ${waiting.count} orders waiting to be paid at the window — pick those up first, or pay for this one by card.`, charged: false }, { status: 409 });
      }
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
    if (availErr) return NextResponse.json({ error: MENU_UNCHECKED, charged: false }, { status: 503 });
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
      return NextResponse.json({ error: "We couldn't check the truck's schedule — give it another tap in a moment.", charged: false }, { status: 503 });
    }
    ordering = orderingFrom(read.inputs, nowMs);
    if (!ordering.open) return NextResponse.json({ error: refusalWords(ordering, nowMs) }, { status: 409 });
    // A STOP'S MENU (R2, 2026-10-13): a stop with a menu set sells what it pours (stop_menu, 0393). A read that failed is
    // not "no menu": the order waits, like the truck's schedule above. Before 0393 there is no menu to read — nothing limits.
    if (ordering.stop?.id) {
      const sm = await readStopMenu(supabaseAdmin, ordering.stop.id);
      if (sm.error && !isMissingFunction(sm.error)) return NextResponse.json({ error: "We couldn't check this stop's menu — give it another tap in a moment.", charged: false }, { status: 503 });
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
    if (here.error) return NextResponse.json({ error: MENU_UNCHECKED, charged: false }, { status: 503 });
    const outHere = here.out.size ? cartRefusal(cart, cupRows.map((r) => (here.out.has(r.slug) ? { ...r, sold_out: true } : r)), (slug) => nameFrom(cupRows, slug)) : null;
    if (outHere) return NextResponse.json({ error: outHere }, { status: 409 });
  }
  // What the customer was promised, said once for the screen, the email and the crew's pass: placed
  // ahead of a stop, it is made from the stop's start (orders.ready_from, 0343); otherwise now.
  const promise = { readyFrom: ordering.readyFrom, ready: readyWords(ordering), pickup: pickupWords(ordering) };
  // EVERY COLUMN, ALWAYS (R10b, 2026-10-16 — the 10/10 audit). Before 0343 and 0390 were pasted, a write that named
  // ready_from or tip_cents went in without them (lib/schemaSkew.writeAcrossSkew) — both have long been in production, so
  // the only thing left that could trip that path was a stale schema cache, and then a paid order lost its tip with
  // nothing said. The row goes in whole or not at all; a refusal is the checkout's own (it alerts and answers).
  const insertOrder = (row: Record<string, unknown>) =>
    supabaseAdmin!.from("orders").insert(promise.readyFrom ? { ...row, ready_from: promise.readyFrom } : row);

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
  const benefits = await benefitsForUser(caller?.id ?? null, body.code);
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
  const user = caller; // null for guest checkout
  const customerId = user?.id
    ? ((await supabaseAdmin.rpc("resolve_customer", { p_user_id: user.id, p_phone: null, p_email: null, p_name: customer })).data as string | null)
    : null;

  // THE ORDER'S NUMBER AND ITS TICKET (2026-10-13, R3b of the customer audit — board 09). The id is made here, so the
  // answer can say the number the window calls ("#4F2A") without reading the row back. The ticket — the link that shows
  // this one order to whoever holds it, guests too (0395) — is the table's own, read once the row is in, as the
  // receipt's lines (what this route priced) and the card's brand and last four are written beside it. Its four are free
  // among today's orders (R8, lib/orderNumber): two orders on one day could share the number the window calls.
  const orderId = await orderIdForToday(supabaseAdmin, randomUUID);
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
      if (insErr) return { status: 500, body: { error: "That didn't go through — give it another tap", charged: false } };
      // `paid` says which kind of order this was, because one key covers the checkout whichever button
      // was tapped: a retry from Pay can be answered with this pre-order, and must not read as a charge.
      const ticket = await ticketFor(null);
      // Confirmation email — cup orders carry no phone (a quick on-the-spot order, not a form), so this
      // is account-email-only and only for signed-in members; guests just have the on-screen confirm.
      // Its number and its page (R7): the email named neither, and the number is what the window calls.
      if (user?.id) {
        await notifyCustomer({ email: await accountEmail(user.id), subject: `GT3 — order ${orderNo(orderId)} is in`, message: orderInWords(orderNo(orderId), promise, `${money(subtotal)} at pickup`, ticket) });
      }
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
      const ticket = await ticketFor(paidWith);
      if (user?.id) {
        await notifyCustomer({ email: await accountEmail(user.id), subject: `GT3 — order ${orderNo(orderId)} is in`, message: orderInWords(orderNo(orderId), promise, `${money(amount)} paid`, ticket) });
      }
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

/** The "order in" email (R7): its number, where and when, the money, and its page — the email said none of the first or
 *  the last, so a member had nothing to call at the window and no way back to the order from it. */
function orderInWords(no: string, promise: { ready: string; pickup: string }, money$: string, ticket: string | null): string {
  return `GT3: order ${no} is in. ${promise.ready} ${promise.pickup}. ${money$}.${ticket ? ` Follow it, or tell the truck you're on your way: ${CONNECT_APP}/order?t=${ticket}` : ""}`;
}

export const POST = route("checkout", post);
