import { NextResponse } from "next/server";
import { chargeCard, safeIdemKey } from "@/lib/squareServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { userFromRequest } from "@/lib/apiAuth";
import { raiseAlert } from "@/lib/serverAlerts";
import { accountEmail } from "@/lib/notify";
import { tellCustomer } from "@/lib/customerMessage";
import { orderReceipt, shopReceipt } from "@/lib/receipt";
import { submitOrderToApliiq } from "@/lib/apliiq";
import { skuFor } from "@/lib/apliiqOrder";
import { variantLabel, type Variant } from "@/lib/shopCart";
import { aboveShown, shownCents } from "@/lib/shownTotal";
import { stateCode, usZip } from "@/lib/usAddress";
import { integrationTenant } from "@/lib/tenantScope";
import { money } from "@/lib/money";
import { route } from "@/lib/apiRoute";
import { errorMessage } from "@/lib/errorMessage";
import { chargeOnce, claimKey, seenBefore, type Answer, type Say, type Stopped } from "@/lib/chargeOnce";
import { checkoutClaims } from "@/lib/checkoutClaims";

export const runtime = "nodejs";
// After the charge, Apliiq is given 25 seconds (lib/apliiq APLIIQ_SUBMIT_TIMEOUT_MS): the function outlives the wait.
export const maxDuration = 60;

const reply = (a: Answer) => NextResponse.json(a.body, { status: a.status });

// SHOP checkout (0273) — merch on the 0271 storefront spine, the same Square one-time-charge discipline
// as /api/reserve: the total is recomputed SERVER-SIDE from shop_products (never the client's number),
// the row is written with the service role so `paid` can't be forged, and the charge is deduped on the
// unique shop_orders.payment_id so a retried request can't double-charge. After the money is safely
// recorded we hand the order to Apliiq for print-on-demand fulfillment; if that call fails the order
// simply sits in the crew "needs fulfillment" queue — the customer's money is never lost to a POD hiccup.
type InItem = { product_id?: string; variant?: unknown; qty?: number };
type Ship = { name?: string; street?: string; city?: string; state?: string; zip?: string; email?: string };

async function post(req: Request) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID;
  if (!supabaseAdmin) return NextResponse.json({ error: "The shop isn't switched on yet." }, { status: 503 });

  let body: { sourceId?: string; idempotencyKey?: string; items?: InItem[]; ship?: Ship; expectedCents?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }

  if (!token || !locationId) return NextResponse.json({ error: "Card checkout isn't switched on yet." }, { status: 503 });
  if (!body.sourceId) return NextResponse.json({ error: "A card is required to check out." }, { status: 400 });

  // Guests can buy merch (unlike order-ahead) — but we need a shipping address + a contact email to send
  // tracking. A signed-in member's account email is used automatically; a guest supplies one.
  const user = await userFromRequest(req);
  const ship: Ship = body.ship ?? {};
  const shipName = String(ship.name ?? "").trim().slice(0, 90);
  const email = (user ? await accountEmail(user.id) : String(ship.email ?? "").trim().slice(0, 120)) || "";
  const addr = { street: String(ship.street ?? "").trim(), city: String(ship.city ?? "").trim(), state: String(ship.state ?? "").trim(), zip: String(ship.zip ?? "").trim() };
  if (!shipName || !addr.street || !addr.city || !addr.state || !addr.zip) {
    return NextResponse.json({ error: "A full shipping name and address are required." }, { status: 400 });
  }
  // The state and ZIP as the printer needs them, BEFORE the card is charged (lib/usAddress). A state
  // the printer cannot read used to be charged for and then refused at Apliiq, into the crew queue
  // with the money already taken. The order keeps the code: "SC", never "south carolina".
  const state = stateCode(addr.state), zip = usZip(addr.zip);
  if (!state) return NextResponse.json({ error: "Pick the state to ship to — we ship within the US." }, { status: 400 });
  if (!zip) return NextResponse.json({ error: "Check the ZIP — five digits." }, { status: 400 });
  addr.state = state; addr.zip = zip;
  if (!email) return NextResponse.json({ error: "An email is required for your order + tracking." }, { status: 400 });

  // ONE KEY, ONE CHARGE (R5, 2026-10-13 — lib/chargeOnce, 0371, as the cup checkout). The page keeps one key per
  // checkout (components/ShopCheckout, useIdemKey); this route claims it before Square is asked, so a second tap while the
  // first is still out hears "still confirming", and an answer Square never gave stays "we couldn't confirm" — the crew
  // told, nothing under that key sent to Square again. It was a bare 502, "Checkout service unavailable", with nobody
  // told, whether Square's answer was lost or the order failed to save after the card was charged.
  // arrives-with: 0371 — before it is pasted the checkout runs without claims, as it did before them.
  const idemKey = safeIdemKey(body.idempotencyKey);
  const now = () => Date.now();
  const say: Say = {
    paidNotRecorded: (c) => {
      const ref = (c.payment_id || "").slice(-6).toUpperCase();
      return { status: 200, body: { ok: true, paid: true, recorded: false, ref, warn: `Paid${ref ? ` — ref ${ref}` : ""}. We've alerted the crew to add your order; we'll follow up by email.` } };
    },
    couldNotConfirm: () => ({ status: 409, body: { pending: true, error: "We couldn't confirm your payment, and the crew has been told. Don't pay again — we'll email you either way." } }),
  };
  const stopped = async ({ key, claim }: Stopped) => {
    if (claim.state === "charged") {
      await raiseAlert({ severity: "critical", category: "money", kind: "ops_incident", title: "Paid shop order may not have recorded — check shop orders", body: `A card payment went through (${claim.payment_id ?? "no payment id"}, ${money(claim.amount_cents ?? 0)}) and the shop checkout stopped before the order was saved. ${shipName}, ${email}. If it isn't in shop orders, add it or refund it.` });
    } else {
      await raiseAlert({ severity: "critical", category: "money", kind: "ops_incident", title: "Shop charge status unknown — check Square", body: `A shop checkout stopped while Square was being asked to charge ${money(claim.amount_cents ?? 0)} (${shipName}, ${email}). A payment, if there is one, carries the reference ${key}.` });
    }
  };
  // Asked before the cart is priced again: a retry of an order that went through hears "paid", not "no longer available"
  // because the catalog moved while its first answer was lost.
  const seen = await seenBefore(checkoutClaims(supabaseAdmin), idemKey, true, now, stopped, say);
  if ("answer" in seen) return reply(seen.answer);

  // Card-testing guard (R8, as /api/checkout's): a guest pays here by card with no sign-in, which makes this the natural
  // place to run stolen cards through Square — and every try wrote a claim. A tight burst per address and a ceiling for
  // everyone, in the store every instance shares (rate_limit_hit, 0154 — true is UNDER the cap, false the refusal). Asked
  // after a seen key is answered, so a retry of a payment already made is never turned away. Fails open if the limiter
  // can't be asked: Square's own fraud tools are the backstop.
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "anon";
  const [ipFits, allFits] = await Promise.all([
    supabaseAdmin.rpc("rate_limit_hit", { p_bucket: `shop-checkout:${ip}`, p_window_ms: 60_000, p_max: 6 }),
    supabaseAdmin.rpc("rate_limit_hit", { p_bucket: "shop-checkout:global", p_window_ms: 60_000, p_max: 60 }),
  ]);
  if (ipFits.data === false || allFits.data === false) return NextResponse.json({ error: "Too many attempts — give it a minute." }, { status: 429 });

  // Rebuild the cart from trusted product ids only, and price it from the catalog.
  const rawItems = Array.isArray(body.items) ? body.items.slice(0, 40) : [];
  const ids = [...new Set(rawItems.map((i) => String(i.product_id ?? "")).filter(Boolean))];
  if (ids.length === 0) return NextResponse.json({ error: "Your cart is empty." }, { status: 400 });

  // R-002: a guest has no bearer, so there is no session to read a tenant from and never will be.
  // The scope is the storefront this checkout was opened from — the same uuid 0134 stamps on the
  // order that is about to be written, so the read and the write agree by construction.
  const tenant = integrationTenant();
  const { data: prods, error: prodErr } = await supabaseAdmin.from("shop_products")
    .select("id, title, price_cents, cost_cents, apliiq_product_id, variants, kind, published_at, archived_at").eq("tenant_id", tenant)
    .in("id", ids).eq("kind", "merch");
  if (prodErr) return NextResponse.json({ error: "Couldn't price your cart." }, { status: 500 });
  const byId = new Map((prods ?? []).map((p) => [(p as { id: string }).id, p as Record<string, any>]));

  let subtotal = 0;
  // `apliiq_sku` is resolved HERE, while the product's variant list and the shopper's choice are
  // both in hand — the fulfilment call downstream sees only the line and cannot work it out later.
  const lineItems: { product_id: string; title: string; variant: unknown; qty: number; unit_cents: number; cost_cents: number | null; apliiq_product_id: string | null; apliiq_sku: string | null }[] = [];
  for (const it of rawItems) {
    const p = byId.get(String(it.product_id ?? ""));
    if (!p) continue;
    if (!p.published_at || p.archived_at) return NextResponse.json({ error: `"${p.title}" is no longer available.` }, { status: 409 });
    const qty = Math.max(1, Math.min(20, Math.floor(Number(it.qty) || 1)));
    const unit = Math.max(0, Number(p.price_cents) || 0);
    // An unpriced line is not free (R9): a product sync without a price once wrote $0 over a live one, and a cart with it
    // charged for the rest and shipped it too. Refused before any charge, naming it.
    if (unit <= 0) return NextResponse.json({ error: `"${p.title}" isn't priced yet — take it out to check out.` }, { status: 409 });
    subtotal += unit * qty;
    lineItems.push({ product_id: p.id, title: p.title, variant: it.variant ?? null, qty, unit_cents: unit, cost_cents: p.cost_cents ?? null, apliiq_product_id: p.apliiq_product_id ?? null, apliiq_sku: skuFor(p.variants, it.variant ?? null) });
  }
  if (lineItems.length === 0) return NextResponse.json({ error: "Nothing in your cart is available." }, { status: 409 });
  const total = subtotal; // shipping/tax can layer here later; POD ships flat via Apliiq for now
  if (total <= 0) return NextResponse.json({ error: "Cart total is $0 — nothing to charge." }, { status: 400 });
  // Never more than the Pay button said (R5, lib/shownTotal — as packs and delivery): a price raised in the catalog while
  // the cart sat open is refused before any charge, with the total it is now; the next tap agrees to it. It was charged at
  // the new price, under a button that said the old one.
  const raised = aboveShown(total, shownCents(body.expectedCents));
  if (raised) return NextResponse.json(raised, { status: 409 });

  const held = await claimKey(seen.claims, idemKey, { channel: "shop", card: true, amountCents: total }, now, stopped, say);
  if ("answer" in held) return reply(held.answer);

  // After the money: the order, its lines, the printer, the receipt. Its answer is kept on the claim and said again to
  // every retry of this key. It cannot throw: the card is charged by now, so a failure here is told to the crew and
  // answered as "paid, being added" — never as a checkout that failed.
  const db = supabaseAdmin;   // checked at the top; the closure below runs after the charge
  const recordShop = async (paymentId: string | null): Promise<Answer> => {
    try {
      // Dedupe at the order row — a retried request carries the same idempotency key, so Square returns
      // the same paymentId; the unique index on shop_orders.payment_id is the real backstop.
      if (paymentId) {
        // scoped-by: payment_id carries a UNIQUE index (verified in production) and the value is issued by
        // Square, not chosen by the caller — at most one row in the whole table, so a tenant
        // filter would narrow nothing. A stricter key than tenant_id, not a looser one.
        const { data: already } = await db.from("shop_orders").select("id").eq("payment_id", paymentId).maybeSingle();
        if (already) return { status: 200, body: { ok: true, id: (already as { id: string }).id, paid: true, recorded: true } };
      }

      const customerId = (await db.rpc("resolve_customer", { p_user_id: user?.id ?? null, p_phone: null, p_email: email, p_name: shipName })).data as string | null;
      const orderRow = {
        customer_id: customerId, user_id: user?.id ?? null, email, payment_id: paymentId,
        subtotal_cents: subtotal, total_cents: total, ship_name: shipName, ship_address: addr, status: "needs_fulfillment",
      };
      let { data: order, error: insErr } = await db.from("shop_orders").insert(orderRow).select("id").single();
      if (insErr) ({ data: order, error: insErr } = await db.from("shop_orders").insert(orderRow).select("id").single()); // retry once
      if (insErr) {
        if ((insErr as { code?: string }).code === "23505" && paymentId) {
          // scoped-by: payment_id carries a UNIQUE index (verified in production) and the value is issued by
          // Square, not chosen by the caller — at most one row in the whole table, so a tenant
          // filter would narrow nothing. A stricter key than tenant_id, not a looser one.
          const dupe = await db.from("shop_orders").select("id").eq("payment_id", paymentId).maybeSingle();
          if (dupe.data) return { status: 200, body: { ok: true, id: (dupe.data as { id: string }).id, paid: true, recorded: true } };
        }
        const ref = (paymentId || "").slice(-6).toUpperCase();
        await raiseAlert({ severity: "critical", category: "money", kind: "ops_incident", title: "Paid shop order didn't record — add it", body: `A card payment succeeded (${paymentId}) but the shop order didn't save. ${shipName} · ${lineItems.map((l) => `${l.qty}× ${l.title}`).join(", ")}. Confirm in Square and add it.` });
        return { status: 200, body: { ok: true, paid: true, recorded: false, ref, warn: `Paid — ref ${ref}. We've alerted the crew; we'll follow up by email.` } };
      }
      const orderId = (order as { id: string }).id;
      // Its lines, checked (R8): the insert's answer was thrown away, and a paid order whose lines didn't save had none —
      // "Send to printer" refused it ("no line items to send") and a resent receipt said "(no items on this order)", while
      // the customer had been told it was recorded. Tried twice; still refused, the crew is told what they were.
      const itemRows = lineItems.map((l) => ({ order_id: orderId, product_id: l.product_id, title: l.title, variant: l.variant, qty: l.qty, unit_cents: l.unit_cents, cost_cents: l.cost_cents }));
      let { error: itemsErr } = await db.from("shop_order_items").insert(itemRows);
      if (itemsErr) ({ error: itemsErr } = await db.from("shop_order_items").insert(itemRows));
      if (itemsErr) {
        await raiseAlert({ severity: "critical", category: "order", kind: "fulfillment", subjectId: orderId, title: "Paid shop order saved without its items — add them", body: `${shipName}'s order (${money(total)}, paid) saved, and its items didn't (${errorMessage(itemsErr, 120)}): ${lineItems.map((l) => `${l.qty}× ${l.title}${variantLabel((l.variant ?? null) as Variant | null) ? ` (${variantLabel((l.variant ?? null) as Variant | null)})` : ""}`).join(", ")}. Add them to the order before it is resent or reprinted.` });
      }

      // Hand the paid order to Apliiq for print-on-demand. Best-effort: a failure leaves the order in the
      // crew "needs fulfillment" queue (money already collected), never blocks the customer's confirmation.
      //
      // AS SEND TO PRINTER DOES (R9, 0417): the order is claimed first (0335's claim — a crew press on this brand-new
      // order in the queue meanwhile is refused, not a second cap), and it reads "no clear answer" from before it leaves
      // until Apliiq gives one — a function stopped mid-send leaves it for the crew to look in Apliiq, never to send it
      // again. Not claimed, or not marked: not sent; the crew sends it from the order.
      // scoped-by: orderId is the id returned by this request's own INSERT above — not a value any caller supplied — and
      // every write below names that row alone, while Apliiq has no id for it.
      const unsent = () => db.from("shop_orders").update({ apliiq_submit_started_at: null, apliiq_submit_unknown_at: null }).eq("id", orderId).is("apliiq_order_id", null);
      try {
        const claimed = await db.rpc("claim_shop_order_for_submit", { p_order: orderId, p_tenant: tenant });
        // scoped-by: the same row, the one this request inserted
        const ready = claimed.data === "ok"
          ? await db.from("shop_orders").update({ apliiq_submit_unknown_at: new Date().toISOString() }).eq("id", orderId).is("apliiq_order_id", null).select("id")
          : null;
        if (!ready || ready.error || !ready.data?.length) {
          if (claimed.data === "ok") await unsent();
          await raiseAlert({ severity: "important", category: "order", kind: "fulfillment", subjectId: orderId, title: "Shop order needs sending to the printer", body: `${shipName}'s order is paid and wasn't sent to Apliiq (${claimed.error || ready?.error ? "the send couldn't be started" : String(claimed.data ?? "not claimed")}). Nothing reached the printer — send it from the order.` });
        } else {
          const submit = await submitOrderToApliiq({
            id: orderId,
            ship: { name: shipName, street: addr.street, city: addr.city, state: addr.state, zip: addr.zip },
            // EVERY line, not only the ones with a POD link. Filtering here is what let a half-order
            // reach Apliiq: a two-item cart where one item had no link submitted the other and called
            // the whole order "submitted", so the customer paid for two and one was never made.
            // buildOrderPayload refuses the whole order instead, and it lands in the crew queue naming
            // the item that is missing its SKU.
            items: lineItems.map((l) => ({ id: l.product_id, title: l.title, qty: l.qty, priceCents: l.unit_cents, sku: l.apliiq_sku })),
          });
          if (submit.ok) {
            // Marked, checked (R8): the update's answer was thrown away, so an order Apliiq had stayed "needs fulfillment"
            // with no Apliiq id — and the queue offered "Send to printer": a second cap, a second Apliiq charge. Tried twice;
            // still refused, the crew is told it is at the printer — and the order still reads "no clear answer", so the
            // button cannot send it meanwhile.
            const marked = { apliiq_order_id: submit.apliiqOrderId, status: "submitted", apliiq_submit_unknown_at: null, updated_at: new Date().toISOString() };
            // scoped-by: orderId is the id returned by this request's own INSERT thirty lines above — not a
            // value any caller supplied. Nothing else can be named here.
            let { error: markErr } = await db.from("shop_orders").update(marked).eq("id", orderId);
            // scoped-by: the same row, the same id, once more
            if (markErr) ({ error: markErr } = await db.from("shop_orders").update(marked).eq("id", orderId));
            if (markErr) {
              await raiseAlert({ severity: "critical", category: "order", kind: "fulfillment", subjectId: orderId, title: "Shop order is at the printer — don't send it again", body: `${shipName}'s order went to Apliiq (order ${submit.apliiqOrderId}) and couldn't be marked sent (${errorMessage(markErr, 120)}). On the order, say it's at Apliiq as ${submit.apliiqOrderId} — sending it again prints and charges a second one.` });
            }
          } else if (submit.unclear) {
            // scoped-by: the same row, the one this request inserted
            const settle = () => db.from("shop_orders").update({ apliiq_submit_unknown_at: new Date().toISOString(), apliiq_submit_started_at: null }).eq("id", orderId).is("apliiq_order_id", null);
            if ((await settle()).error) await settle();
            await raiseAlert({ severity: "important", category: "order", kind: "printer_unclear", subjectId: orderId, title: "Sent to the printer — no clear answer", body: `${shipName}'s order went to Apliiq and no clear answer came back (${submit.error}). Apliiq may have it. Look in Apliiq's pending orders, then say on the order whether it's there — sending it again before that could print and charge a second one.` });
          } else {
            if ((await unsent()).error) await unsent();
            await raiseAlert({ severity: "important", category: "order", kind: "fulfillment", subjectId: orderId, title: "Shop order needs sending to the printer", body: `Apliiq didn't take ${shipName}'s order (${submit.error}). Nothing reached the printer. It's paid and in the queue — fix that, then send it from the order.` });
          }
        }
      } catch { /* keep the confirmation clean; the order is safely 'needs_fulfillment' */ }

      // WHAT ACTUALLY HAPPENED TO THE RECEIPT. This block used to await notifyCustomer and throw the
      // answer away, so when Ryan's first cap order sent no email on 2026-09-29 the order looked
      // perfect from every angle: charged, recorded, at the printer, and a confirmation screen
      // promising a receipt that was never sent.
      //
      // "off" is a STANDING condition — no provider key — and belongs on the integrations panel, not
      // in an alert per order; alerting on it would fire on every sale until somebody muted it.
      // "failed" and "no-address" are this order's problem and the crew has to hear about them.
      let emailed = false;
      try {
        // The wording lives in lib/receipt so the resend button two days later sends the SAME text —
        // a second receipt that does not match the first gives the customer two accounts of one
        // order. tellCustomer sends it AND records it; there is no way to do one without the other.
        const body = orderReceipt({ id: orderId, ship_name: shipName, total_cents: total, items: lineItems });
        const sent = await tellCustomer({ orderId, email, kind: "receipt", ...body });
        emailed = sent.ok;
        if (sent.email === "failed" || sent.email === "no-address") {
          await raiseAlert({
            severity: "important", category: "order", kind: "fulfillment", subjectId: orderId,
            title: "Shop receipt didn't send",
            body: `${shipName} paid ${money(total)} and the confirmation promised an email. ${sent.email === "no-address" ? "No address was on the order." : `Sending to ${email} failed — ${sent.detail ?? "no reason given"}.`} Resend it from the order record once that is fixed.`,
          });
        }
      } catch { /* notify is best-effort — a provider hiccup must never fail a paid order */ }
      await raiseAlert({ severity: "fyi", category: "order", kind: "shop_order_new", subjectId: orderId, title: "New shop order 🧢", body: `${shipName} — ${lineItems.map((l) => `${l.qty}× ${l.title}`).join(", ")} · ${money(total)}.` });
      // `emailed` is what the confirmation screen uses instead of promising one unconditionally. The receipt is what it
      // shows (R5, lib/receipt shopReceipt): the lines as priced here and the total charged, the email's own number.
      const receipt = shopReceipt({ id: orderId, ship_name: shipName, city: addr.city, state: addr.state, total_cents: total, emailed_to: emailed ? email : null,
        lines: lineItems.map((l) => ({ title: l.title, variant: variantLabel((l.variant ?? null) as Variant | null) || null, qty: l.qty, unit_cents: l.unit_cents })) });
      return { status: 200, body: { ok: true, id: orderId, paid: true, recorded: true, emailed, totalCents: total, receipt } };
    } catch (e) {
      const ref = (paymentId || "").slice(-6).toUpperCase();
      await raiseAlert({ severity: "critical", category: "money", kind: "ops_incident", title: "Paid shop order didn't finish saving — check it", body: `A card payment succeeded (${paymentId ?? "no payment id"}, ${money(total)}) and saving the order broke (${errorMessage(e, 160)}). ${shipName}, ${email}. Check shop orders; add what is missing or refund it.` });
      return { status: 200, body: { ok: true, paid: true, recorded: false, ref, warn: `Paid${ref ? ` — ref ${ref}` : ""}. We've alerted the crew to finish your order; we'll follow up by email.` } };
    }
  };

  return reply(await chargeOnce({
    claims: held.claims, key: idemKey, now,
    charge: () => chargeCard({ token, locationId, sourceId: body.sourceId!, amountCents: total, note: `GT3 shop · ${lineItems.reduce((n, l) => n + l.qty, 0)} item(s)`, idempotencyKey: idemKey, buyerEmail: email }),
    record: (paymentId) => recordShop(paymentId),
    // chargeCard threw: Square's answer never came or did not say whether the card was charged. The claim is 'unknown'
    // from here; this answer and every retry's are the same words, and the payment, if there is one, carries the key.
    unknown: async (e) => {
      await raiseAlert({ severity: "critical", category: "money", kind: "ops_incident", title: "Shop charge status unknown — check Square", body: `A card charge of ${money(total)} for ${shipName} (${email}) may or may not have gone through (${errorMessage(e, 160)}). A payment, if there is one, carries the reference ${idemKey}.` });
      return say.couldNotConfirm!(true);
    },
  }));
}

export const POST = route("shop/checkout", post);
