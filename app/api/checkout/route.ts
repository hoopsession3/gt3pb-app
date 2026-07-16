import { NextResponse } from "next/server";
import { DRINKS, type DrinkId } from "@/lib/menu";
import { SQUARE_BASE, SQUARE_VERSION, chargeCard, safeIdemKey } from "@/lib/squareServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { userFromRequest } from "@/lib/apiAuth";
import { benefitsForUser, priceForSlug } from "@/lib/benefits";
import { raiseAlert } from "@/lib/serverAlerts";
import { notifyCustomer, accountEmail } from "@/lib/notify";
import { preorderWindow, preorderLeadMs } from "@/lib/orderAhead";

// Square Catalog as a secondary sync — used ONLY for items missing from `products` (a catalog gap),
// never as the primary source. products.price_cents is the one price authority (0062, and the same
// order MenuManager writes to + /api/menu already serves to the client) — Square used to be checked
// first here, which meant a reprice via Money > Menu could silently charge the OLD Square/hardcoded
// price. lib/menu.ts's px stays as the final fallback (revenue continuity beats a hard fail if both
// products and Square are unreachable) but is never preferred over a real price.
//
// Square has no concept of our slugs, so its items are matched back to one by DISPLAY NAME. For 7 of
// 10 items the lowercased name happens to equal the slug (rise, flow, dusk, tide, forge, hunt, wild),
// which used to mask this bug: kingme ("KING ME"), maple ("SALTED MAPLE LATTE"), and aide ("NATURE'S
// AIDE") don't match their slug — so a name-keyed map silently missed the live Square price for those
// 3 below (line 141 looks this map up BY SLUG) and fell through to the stale lib/menu.ts price instead,
// whenever this fallback actually fired.
const NAME_TO_SLUG: Record<string, DrinkId> = Object.fromEntries(
  (Object.keys(DRINKS) as DrinkId[]).map((slug) => [DRINKS[slug].n.toLowerCase(), slug])
) as Record<string, DrinkId>;

async function squarePriceMap(token: string): Promise<Record<string, number>> {
  try {
    const res = await fetch(`${SQUARE_BASE}/v2/catalog/list?types=ITEM`, {
      headers: { Authorization: `Bearer ${token}`, "Square-Version": SQUARE_VERSION },
      next: { revalidate: 60 },
    });
    const data = await res.json();
    const m: Record<string, number> = {};
    for (const o of data?.objects ?? []) {
      const n = o?.item_data?.name?.toLowerCase();
      const a = o?.item_data?.variations?.[0]?.item_variation_data?.price_money?.amount;
      const slug = n ? NAME_TO_SLUG[n] : undefined;
      if (slug && typeof a === "number") m[slug] = a;
    }
    return m;
  } catch {
    return {};
  }
}

export async function POST(req: Request) {
  // Every write into `orders` goes through here now — paid (Square) AND pay-at-pickup (unpaid).
  // Pay-at-pickup used to insert directly from the client (RLS-gated to unpaid rows only); moving
  // it here means the SAME availability + ordering-window checks the paid path already enforces now
  // apply to it too, and the client INSERT door on `orders` can close (0156) — the last order table
  // with a client write path becomes server-only, like every sibling table.
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Checkout isn't switched on yet." }, { status: 503 });
  }

  let body: { sourceId?: string; items?: DrinkId[]; tipCents?: number; customer?: string; code?: string; idempotencyKey?: string };
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
  // buy an 86'd or delisted item. Checked before any charge. Missing product rows fail open (a
  // catalog gap must not brick checkout). Same query also carries price_cents — the one price
  // authority — so this single read covers both jobs.
  const productPrices: Record<string, number> = {};
  {
    const uniq = [...new Set(items)];
    const { data: avail } = await supabaseAdmin.from("products").select("slug, sold_out, active, price_cents").in("slug", uniq);
    const rows = (avail ?? []) as { slug: string; sold_out: boolean | null; active: boolean | null; price_cents: number | null }[];
    const blocked = rows.filter((p) => p.sold_out || p.active === false).map((p) => DRINKS[p.slug as DrinkId]?.n ?? p.slug);
    if (blocked.length) {
      return NextResponse.json({ error: `${blocked.join(" · ")} just sold out — remove ${blocked.length === 1 ? "it" : "them"} and try again.` }, { status: 409 });
    }
    for (const p of rows) if (typeof p.price_cents === "number" && p.price_cents > 0) productPrices[p.slug] = p.price_cents;
  }

  // Cups are only sold when there's a truck to make them: live, or inside the window around the
  // next stop (4h before -> 8h after start — lib/orderAhead.preorderWindow; the sheet enforces the
  // same rule, this is the authoritative check before any charge). If these reads fail the gate
  // closes — better to refuse an order than charge a card we can't record.
  {
    const [{ data: ls }, { data: st }] = await Promise.all([
      supabaseAdmin.from("live_status").select("is_live, preorder_lead_h").maybeSingle(),
      supabaseAdmin.from("stops").select("starts_at").is("archived_at", null).neq("status", "done").not("starts_at", "is", null)
        .gte("starts_at", new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString())
        .order("starts_at", { ascending: true }).limit(1).maybeSingle(),
    ]);
    const l = ls as { is_live?: boolean; preorder_lead_h?: number | null } | null;
    const nextStart = (st as { starts_at?: string | null } | null)?.starts_at ?? null;
    if (!preorderWindow(Date.now(), !!l?.is_live, nextStart, preorderLeadMs(l?.preorder_lead_h)).open) {
      return NextResponse.json({ error: "The truck isn't pouring right now — cup orders open closer to the next stop. Reserve a pack instead." }, { status: 409 });
    }
  }

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
  let subtotal = 0;
  for (const id of items) {
    if (!DRINKS[id]) return NextResponse.json({ error: `Unknown item: ${id}` }, { status: 400 });
    const base = productPrices[id] ?? squarePrices[id] ?? Math.round(parseFloat(DRINKS[id].px.replace("$", "")) * 100);
    subtotal += priceForSlug(benefits, id, base);
  }
  // Tip is additive and capped at the subtotal as a fat-finger guard. Pay-at-pickup has no tip yet
  // (nothing charged here to attach it to) — the field is ignored on that path.
  const tip = paying && typeof tipCents === "number" && Number.isFinite(tipCents) && tipCents > 0 ? Math.min(Math.round(tipCents), subtotal) : 0;
  const amount = subtotal + tip;

  // Canonical customer link (0151) + who's ordering — shared by both branches below.
  const user = await userFromRequest(req); // null for guest checkout
  const customerId = user?.id
    ? ((await supabaseAdmin.rpc("resolve_customer", { p_user_id: user.id, p_phone: null, p_email: null, p_name: customer })).data as string | null)
    : null;

  if (!paying) {
    // Pay-at-pickup: record unpaid, no Square call — the crew charges in person at the window.
    const orderRow = { items, total_cents: subtotal, paid: false, payment_id: null, customer, user_id: user?.id ?? null, customer_id: customerId, status: "new" };
    const { error: insErr } = await supabaseAdmin.from("orders").insert(orderRow);
    if (insErr) return NextResponse.json({ error: "That didn't go through — give it another tap" }, { status: 500 });
    // Confirmation email — cup orders carry no phone (a quick on-the-spot order, not a form), so this
    // is account-email-only and only for signed-in members; guests just have the on-screen confirm.
    if (user?.id) {
      await notifyCustomer({ email: await accountEmail(user.id), subject: "GT3 — order in", message: `GT3: your order is in — ready in ~8 min. $${(subtotal / 100).toFixed(2)} at pickup.` });
    }
    return NextResponse.json({ ok: true, amount: subtotal, recorded: true });
  }

  const idemKey = safeIdemKey(body.idempotencyKey);
  let charge: Awaited<ReturnType<typeof chargeCard>>;
  try {
    charge = await chargeCard({ token: token!, locationId: locationId!, sourceId: sourceId!, amountCents: amount, note: "GT3PB pre-order", idempotencyKey: idemKey });
  } catch (e) {
    // chargeCard's own fetch/parse can throw BEFORE returning a result — a dropped connection after
    // Square already received (and possibly processed) the request is the classic case. Unlike every
    // failure below, this is a genuine "may have been charged" state, so it gets its own alert (with
    // what we DO know — the idempotency key — so staff can check Square directly) instead of the
    // total silence this used to be. Retrying is still safe: the idempotency key is unchanged, so
    // Square will dedupe a genuine double-send — the message below says so instead of implying
    // nothing happened (which risked a customer paying a SECOND time by another channel).
    await raiseAlert({ severity: "critical", category: "money", title: "Checkout charge status unknown — check Square", body: `A card charge may or may not have gone through (idempotency key ${idemKey}, $${(amount / 100).toFixed(2)}${customer ? `, name: ${customer}` : ""}). The request errored before a response came back: ${String(e instanceof Error ? e.message : e).slice(0, 200)}. Check Square by that idempotency key before assuming nothing happened.` });
    return NextResponse.json({ error: "Couldn't confirm the payment — safe to tap Pay and try again, you won't be charged twice." }, { status: 502 });
  }
  if (!charge.ok) return NextResponse.json({ error: charge.error }, { status: 400 });
  const paymentId = charge.paymentId;

  try {
    // Idempotency at the ORDER row: the charge's idempotency key makes a retry return the SAME
    // paymentId, so if we already recorded an order for it (a retry after a lost response), don't
    // insert a SECOND paid order → double fulfillment. (A unique index on payment_id backs this in DB.)
    if (paymentId) {
      const { data: already } = await supabaseAdmin.from("orders").select("id").eq("payment_id", paymentId).maybeSingle();
      if (already) return NextResponse.json({ ok: true, paymentId, amount, recorded: true });
    }

    // Record the paid order server-side (paid + payment_id are trustworthy here).
    // total_cents is the GOODS subtotal (tip excluded) so history + the referral floor
    // are consistent across paid and pre-order paths.
    const orderRow = { items, total_cents: subtotal, paid: true, payment_id: paymentId, customer, user_id: user?.id ?? null, customer_id: customerId, status: "new" };
    let { error: insErr } = await supabaseAdmin.from("orders").insert(orderRow);
    if (insErr) {
      // Charge succeeded but recording failed. Retry once — a transient DB blip must not cost the
      // customer their order record when their money is already taken.
      ({ error: insErr } = await supabaseAdmin.from("orders").insert(orderRow));
    }
    if (insErr) {
      // A concurrent request (a fast double-tap before the button visually disables, or a client-side
      // retry after a slow response) can lose this exact race — Square already deduped the CHARGE via
      // idempotency key, so the OTHER request's insert succeeding isn't a failure, it's the dedupe
      // working. Confirm that row is really there before raising a false "didn't record" alert, which
      // would otherwise have staff double-add an order that's already correctly on the pass.
      if ((insErr as { code?: string }).code === "23505" && paymentId) {
        const { data: already2 } = await supabaseAdmin.from("orders").select("id").eq("payment_id", paymentId).maybeSingle();
        if (already2) return NextResponse.json({ ok: true, paymentId, amount, recorded: true });
      }
      // Still failed, and not a benign race: alert the crew immediately with the payment id + items
      // so they add it by hand, and hand the customer a reference to show at the window.
      const ref = (paymentId || "").slice(-6).toUpperCase();
      await raiseAlert({ severity: "critical", category: "money", title: "Paid order didn't record — add it", body: `A card payment succeeded (${paymentId}) but the order didn't save. ${customer ? `Name: ${customer}. ` : ""}Items: ${items.join(", ")}. Add it to the pass and confirm in Square.` });
      return NextResponse.json({ ok: true, paymentId, amount, recorded: false, ref, warn: `Payment received${ref ? ` — ref ${ref}` : ""}. We've alerted the crew to add your order; show this ref at the window.` }, { status: 200 });
    }
    if (user?.id) {
      await notifyCustomer({ email: await accountEmail(user.id), subject: "GT3 — order in", message: `GT3: your order is in — ready in ~8 min. $${(amount / 100).toFixed(2)} paid.` });
    }
    return NextResponse.json({ ok: true, paymentId, amount, recorded: true });
  } catch {
    // The charge is DONE at this point (we have a paymentId) — an exception here means something
    // broke while RECORDING it, not while paying. "Payment service unavailable" would be actively
    // wrong (they WERE charged); point them to the crew instead of implying nothing happened.
    return NextResponse.json({ ok: true, paymentId, amount, recorded: false, warn: "Payment received, but we hit a snag recording your order — show this screen at the window and we'll sort it." }, { status: 200 });
  }
}
