import { NextResponse } from "next/server";
import { chargeCard, safeIdemKey } from "@/lib/squareServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { callerFromRequest, SIGN_IN_UNCHECKED } from "@/lib/apiAuth";
import { raiseAlert } from "@/lib/serverAlerts";
import { accountEmail } from "@/lib/notify";
import { tellCustomer } from "@/lib/customerMessage";
import { orderReceipt } from "@/lib/receipt";
import { aboveShown, shownCents } from "@/lib/shownTotal";
import { integrationTenant } from "@/lib/tenantScope";
import { money } from "@/lib/money";
import { route } from "@/lib/apiRoute";
import { errorMessage } from "@/lib/errorMessage";
import { chargeOnce, claimKey, seenBefore, type Answer, type Say, type Stopped } from "@/lib/chargeOnce";
import { checkoutClaims } from "@/lib/checkoutClaims";
import { callerIp, limitsFit } from "@/lib/rateLimit";
import { CARD_TRIES, cardsPausedRefusal } from "@/lib/cardGuard";
import { COURSE_TIER, courseAccessRow } from "@/lib/nutritionBuy";

// member: GT3 Nutrition, bought — one time, by a signed-in member (the access is theirs, kept on their account), every card try bounded per caller and for the app before the card is asked, and a key charged once

export const runtime = "nodejs";
export const maxDuration = 30;

const reply = (a: Answer) => NextResponse.json(a.body, { status: a.status });

// GT3 NUTRITION, BOUGHT (R46 — Ryan: "One-time buy"; $47 the founding price). The shop's card discipline (app/api/shop/
// checkout) for a thing with nothing to ship: the price is the catalog's (the one program_tier 'pro' row, 0443), never
// the page's; one key is one charge (lib/chargeOnce); the order is written with the service role and its access granted
// on the member's customer record, tied to that order (program_access.order_id) — so a refund takes it back (0443's
// trigger). The order is 'delivered' the moment it is paid: the course is open as the receipt is sent. A member signs
// in first: a course bought by a guest would belong to nobody.
async function post(req: Request) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID;
  if (!supabaseAdmin) return NextResponse.json({ error: "GT3 Nutrition isn't on sale yet." }, { status: 503 });

  let body: { sourceId?: string; idempotencyKey?: string; expectedCents?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Bad request" }, { status: 400 });
  if (!token || !locationId) return NextResponse.json({ error: "Card checkout isn't switched on yet." }, { status: 503 });
  if (!body.sourceId) return NextResponse.json({ error: "A card is required." }, { status: 400 });

  const who = await callerFromRequest(req);
  if (who.kind === "unavailable") return NextResponse.json({ error: SIGN_IN_UNCHECKED }, { status: 503 });
  const user = who.kind === "user" ? { id: who.id } : null;
  if (!user) return NextResponse.json({ error: "Sign in first — GT3 Nutrition is kept on your account." }, { status: 401 });
  const email = (await accountEmail(user.id)) || "";
  if (!email) return NextResponse.json({ error: "Your account needs an email for the receipt — add one in Settings." }, { status: 400 });

  const idemKey = safeIdemKey(body.idempotencyKey);
  const now = () => Date.now();
  const say: Say = {
    paidNotRecorded: (c) => {
      const ref = (c.payment_id || "").slice(-6).toUpperCase();
      return { status: 200, body: { ok: true, paid: true, recorded: false, ref, warn: `Paid${ref ? ` — ref ${ref}` : ""}. We've told the crew to open the course for you; we'll email you.` } };
    },
    couldNotConfirm: () => ({ status: 409, body: { pending: true, error: "We couldn't confirm your payment, and the crew has been told. Don't pay again — we'll email you either way." } }),
  };
  const stopped = async ({ key, claim }: Stopped) => {
    if (claim.state === "charged") {
      await raiseAlert({ severity: "critical", category: "money", kind: "ops_incident", title: "GT3 Nutrition paid — the course may not have opened", body: `A card payment went through (${claim.payment_id ?? "no payment id"}, ${money(claim.amount_cents ?? 0)}) and the checkout stopped before the order was saved. ${email}. If it isn't in shop orders, add it and open the course for them, or refund it.` });
    } else {
      await raiseAlert({ severity: "critical", category: "money", kind: "ops_incident", title: "GT3 Nutrition charge status unknown — check Square", body: `A GT3 Nutrition checkout stopped while Square was being asked to charge ${money(claim.amount_cents ?? 0)} (${email}). A payment, if there is one, carries the reference ${key}.` });
    }
  };
  const seen = await seenBefore(checkoutClaims(supabaseAdmin), idemKey, true, now, stopped, say);
  if ("answer" in seen) return reply(seen.answer);

  const ip = callerIp(req);
  if (!(await limitsFit(supabaseAdmin, [
    { bucket: `course-checkout:${ip}`, windowMs: 60_000, max: 6 },
    { bucket: `course-checkout-user:${user.id}`, windowMs: 3_600_000, max: 12 },
  ]))) return NextResponse.json({ error: "Too many attempts — give it a minute." }, { status: 429 });

  const tenant = integrationTenant();
  // Already theirs: nothing to sell twice.
  const customerId = (await supabaseAdmin.rpc("resolve_customer", { p_user_id: user.id, p_phone: null, p_email: email, p_name: null })).data as string | null;
  if (!customerId) return NextResponse.json({ error: "We couldn't find your account just now — try again in a moment." }, { status: 503 });
  // scoped-by: the caller's own customer record, resolved from their verified id
  const { data: has, error: hasErr } = await supabaseAdmin.from("program_access").select("id").eq("customer_id", customerId).eq("tier", COURSE_TIER).is("revoked_at", null).limit(1);
  if (hasErr) return NextResponse.json({ error: "We couldn't check your account just now — nothing was charged." }, { status: 503 });
  if (has?.length) return NextResponse.json({ ok: true, already: true }, { status: 200 });

  const { data: prod, error: prodErr } = await supabaseAdmin.from("shop_products")
    .select("id, title, price_cents, cost_cents").eq("tenant_id", tenant).eq("kind", "program_tier").eq("program_tier", COURSE_TIER)
    .not("published_at", "is", null).is("archived_at", null).order("sort").limit(1).maybeSingle();
  if (prodErr) return NextResponse.json({ error: "Couldn't price GT3 Nutrition just now — nothing was charged." }, { status: 500 });
  if (!prod) return NextResponse.json({ error: "GT3 Nutrition isn't on sale yet." }, { status: 409 });
  const p = prod as { id: string; title: string; price_cents: number | null; cost_cents: number | null };
  const total = Math.max(0, Number(p.price_cents) || 0);
  if (total <= 0) return NextResponse.json({ error: "GT3 Nutrition isn't priced yet." }, { status: 409 });
  const raised = aboveShown(total, shownCents(body.expectedCents));
  if (raised) return NextResponse.json(raised, { status: 409 });

  const paused = await cardsPausedRefusal(supabaseAdmin, { userId: user.id, ip });
  if (paused) return NextResponse.json({ error: paused }, { status: 429 });
  if (!(await limitsFit(supabaseAdmin, [{ bucket: "course-checkout:global", windowMs: 60_000, max: CARD_TRIES.allPerMinute }]))) {
    return NextResponse.json({ error: "Too many attempts — give it a minute." }, { status: 429 });
  }

  const held = await claimKey(seen.claims, idemKey, { channel: "shop", card: true, amountCents: total }, now, stopped, say);
  if ("answer" in held) return reply(held.answer);

  const db = supabaseAdmin;
  const record = async (paymentId: string | null): Promise<Answer> => {
    try {
      let orderId: string | null = null;
      if (paymentId) {
        // scoped-by: payment_id carries a UNIQUE index and is Square's, not the caller's.
        const { data: already } = await db.from("shop_orders").select("id").eq("payment_id", paymentId).maybeSingle();
        orderId = (already as { id?: string } | null)?.id ?? null;
      }
      if (!orderId) {
        const row = { customer_id: customerId, user_id: user.id, email, payment_id: paymentId, subtotal_cents: total, total_cents: total, ship_name: null, ship_address: null, status: "delivered", note: "GT3 Nutrition — the course" };
        let { data: order, error: insErr } = await db.from("shop_orders").insert(row).select("id").single();
        if (insErr) ({ data: order, error: insErr } = await db.from("shop_orders").insert(row).select("id").single());
        if (insErr || !order) {
          const ref = (paymentId || "").slice(-6).toUpperCase();
          await raiseAlert({ severity: "critical", category: "money", kind: "ops_incident", title: "GT3 Nutrition paid — the order didn't save", body: `A card payment succeeded (${paymentId}, ${money(total)}) and the order didn't save (${errorMessage(insErr, 120)}). ${email}. Add it and open the course for them, or refund it.` });
          return { status: 200, body: { ok: true, paid: true, recorded: false, ref, warn: `Paid — ref ${ref}. We've told the crew to open the course for you; we'll email you.` } };
        }
        orderId = (order as { id: string }).id;
        const line = { order_id: orderId, product_id: p.id, title: p.title, variant: null, qty: 1, unit_cents: total, cost_cents: p.cost_cents ?? null };
        let { error: itemErr } = await db.from("shop_order_items").insert(line);
        if (itemErr) ({ error: itemErr } = await db.from("shop_order_items").insert(line));
        if (itemErr) await raiseAlert({ severity: "important", category: "order", kind: "fulfillment", subjectId: orderId, title: "GT3 Nutrition order saved without its line", body: `${email}'s GT3 Nutrition order (${money(total)}, paid) saved without its line (${errorMessage(itemErr, 120)}). Add it before a receipt is resent.` });
      }

      // THE COURSE, OPENED. On their customer record, tied to this order (a refund takes it back, 0443).
      const access = courseAccessRow(customerId, orderId);
      let { error: accErr } = await db.from("program_access").upsert(access, { onConflict: "customer_id,tier" });
      if (accErr) ({ error: accErr } = await db.from("program_access").upsert(access, { onConflict: "customer_id,tier" }));
      if (accErr) {
        await raiseAlert({ severity: "critical", category: "money", kind: "ops_incident", subjectId: orderId, title: "GT3 Nutrition paid — open the course for them", body: `${email} paid ${money(total)} for GT3 Nutrition and the course didn't open (${errorMessage(accErr, 120)}). Give them access by hand, or refund it.` });
        return { status: 200, body: { ok: true, id: orderId, paid: true, recorded: true, opened: false, warn: "Paid. The course didn't open on your account just yet — the crew has been told and will open it; we'll email you." } };
      }

      let emailed = false;
      try {
        const msg = orderReceipt({ id: orderId, ship_name: null, total_cents: total, items: [{ title: p.title, qty: 1, unit_cents: total }], digital: true });
        const sent = await tellCustomer({ orderId, email, kind: "receipt", ...msg });
        emailed = sent.ok;
      } catch { /* the course is open; a receipt can be resent from the order */ }
      await raiseAlert({ severity: "fyi", category: "order", kind: "shop_order_new", subjectId: orderId, title: "GT3 Nutrition sold", body: `${email} — GT3 Nutrition · ${money(total)}. The course is open on their account.` });
      return { status: 200, body: { ok: true, id: orderId, paid: true, recorded: true, opened: true, emailed, totalCents: total } };
    } catch (e) {
      const ref = (paymentId || "").slice(-6).toUpperCase();
      await raiseAlert({ severity: "critical", category: "money", kind: "ops_incident", title: "GT3 Nutrition paid — check the order", body: `A card payment succeeded (${paymentId ?? "no payment id"}, ${money(total)}) and finishing it broke (${errorMessage(e, 160)}). ${email}. Check shop orders and the course access; add what's missing or refund it.` });
      return { status: 200, body: { ok: true, paid: true, recorded: false, ref, warn: `Paid${ref ? ` — ref ${ref}` : ""}. We've told the crew to open the course for you; we'll email you.` } };
    }
  };

  return reply(await chargeOnce({
    claims: held.claims, key: idemKey, now,
    charge: () => chargeCard({ token, locationId, sourceId: body.sourceId!, amountCents: total, note: "GT3 Nutrition · the course", idempotencyKey: idemKey, buyerEmail: email, who: { userId: user.id, ip } }),
    record: (paymentId) => record(paymentId),
    unknown: async (e) => {
      await raiseAlert({ severity: "critical", category: "money", kind: "ops_incident", title: "GT3 Nutrition charge status unknown — check Square", body: `A card charge of ${money(total)} for GT3 Nutrition (${email}) may or may not have gone through (${errorMessage(e, 160)}). A payment, if there is one, carries the reference ${idemKey}.` });
      return say.couldNotConfirm!(true);
    },
  }));
}

export const POST = route("nutrition/checkout", post);
