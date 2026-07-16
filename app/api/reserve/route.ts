import { NextResponse } from "next/server";
import { chargeCard, safeIdemKey } from "@/lib/squareServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { userFromRequest } from "@/lib/apiAuth";
import { raiseAlert } from "@/lib/serverAlerts";
import { benefitsForUser, refillIsFree, applyOrderPercent } from "@/lib/benefits";
import { notifyCustomer, accountEmail } from "@/lib/notify";
import { PRICING, FLAVORS, isPackSize, packTotal, toCents, mixComplete, mixSummary, nextDrop, dropForStop, dropDateKey, dollars, type GlassPath, type Mix } from "@/lib/orderAhead";

// ORDER-AHEAD reserve — records a one-off Saturday-drop reservation. Price + cutoff are recomputed
// SERVER-SIDE from lib/orderAhead (never trust the client), the charge is a Square ONE-TIME payment
// (no recurring), and the row is written with the service role so `paid` can't be forged. Mirrors
// /api/checkout. Member-only: a reservation always belongs to an account (guests browse; the walk-up
// window stays open to everyone).
export async function POST(req: Request) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID;
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Reservations aren't switched on yet." }, { status: 503 });
  }

  let body: { sourceId?: string; idempotencyKey?: string; name?: string; phone?: string; size?: number; glass?: string; mix?: Partial<Mix>; dropDate?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }

  // Order-ahead is member-only: the reservation needs an owner (drop_orders.user_id) so it lives
  // in the member's account. Checked FIRST — before validation and long before any charge.
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Order-ahead is for members — sign in to reserve." }, { status: 401 });

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  const phone = typeof body.phone === "string" ? body.phone.trim().slice(0, 40) : "";
  const size = Number(body.size);
  const glass = body.glass === "new" ? "new" : "return";
  // A card token means "charge now"; no token means a pre-order (reserve now, pay at pickup). The
  // charge path needs Square configured; the pre-order path just needs the DB — so the reserve flow
  // is never a dead end.
  const wantsCharge = !!body.sourceId;
  if (wantsCharge && (!token || !locationId)) return NextResponse.json({ error: "Card checkout isn't switched on yet." }, { status: 503 });
  if (!name || !phone) return NextResponse.json({ error: "Name and phone are required for the pickup text." }, { status: 400 });
  if (!isPackSize(size)) return NextResponse.json({ error: "Pick a pack size (3, 6, or 12)." }, { status: 400 });

  // Rebuild the mix from trusted flavor keys only, and require it to total the pack size.
  const mix: Mix = { RISE: 0, FLOW: 0, DUSK: 0 };
  for (const f of FLAVORS) { const n = Math.max(0, Math.floor(Number(body.mix?.[f] ?? 0))); mix[f] = n; }
  if (!mixComplete(mix, size)) return NextResponse.json({ error: "Your flavor picks must add up to the pack size." }, { status: 400 });
  if (!PRICING.allowFlavorMix && FLAVORS.filter((f) => mix[f] > 0).length > 1) {
    return NextResponse.json({ error: "This drop is single-flavor — pick one flavor for the whole pack." }, { status: 400 });
  }

  // Pickup day is the customer's CHOICE — among the truck's real upcoming stops (server-
  // authoritative; the Saturday cadence is the fallback when the route is empty). The client's
  // dropDate must match one of them, and its drop must still be open, or we reject — regardless
  // of what the client clock or a stale page said.
  const { data: nextStops } = await supabaseAdmin.from("stops").select("starts_at")
    .is("archived_at", null).neq("status", "done").not("starts_at", "is", null)
    .gte("starts_at", new Date().toISOString()).order("starts_at", { ascending: true }).limit(6);
  const offered = new Map<string, Date>(); // dropDate key → its order cutoff
  for (const st of nextStops ?? []) {
    const at = (st as { starts_at: string }).starts_at;
    offered.set(dropDateKey(new Date(at)), dropForStop(at).cutoff);
  }
  if (offered.size === 0) { const fb = nextDrop(); offered.set(dropDateKey(fb.sat), fb.cutoff); }
  // Accept a plain day key or a full ISO instant; an instant resolves through the same ET
  // day-key rule the offered map uses (post-8pm-ET stops are otherwise off by one UTC day).
  const raw = String(body.dropDate ?? "");
  const parsed = new Date(raw);
  const requested = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : Number.isNaN(parsed.getTime()) ? raw.slice(0, 10) : dropDateKey(parsed);
  const cutoff = offered.get(requested);
  if (!cutoff) {
    return NextResponse.json({ error: "That pickup day just changed — refresh to see the current stops." }, { status: 409 });
  }
  if (Date.now() > cutoff.getTime()) {
    return NextResponse.json({ error: "That drop has closed — pick the next pickup day." }, { status: 400 });
  }
  const dropDate = requested;

  // Authoritative total — recomputed from the pricing grid, never the client amount.
  let amount = toCents(packTotal(size, glass as GlassPath));
  // Member benefits (0176): the caller's tier perks plus any code they present, resolved server-side
  // (the client can't forge them). A founding member bringing bottles back gets straight-brew refills
  // free (order-ahead packs are always straight brew, so the refill benefit zeroes a return pack); a
  // percent-off code discounts the whole order (new or return). Best benefit wins.
  const benefits = await benefitsForUser(user.id, (body as { code?: string }).code);
  if (glass === "return" && refillIsFree(benefits)) amount = 0;
  else amount = applyOrderPercent(amount, benefits);

  try {
    // Charge only when a card token was supplied; otherwise it's a pay-at-pickup pre-order.
    let paymentId: string | null = null;
    let paid = false;
    if (wantsCharge) {
      const charge = await chargeCard({ token: token!, locationId: locationId!, sourceId: body.sourceId!, amountCents: amount, note: `GT3PB order-ahead · ${size}-pack · ${glass} · pickup ${dropDate}`, idempotencyKey: safeIdemKey(body.idempotencyKey) });
      if (!charge.ok) return NextResponse.json({ error: charge.error }, { status: 400 });
      paymentId = charge.paymentId;
      paid = true;
      // Idempotency at the ORDER row — the same protection /api/checkout has, missing here until now.
      // A retried request (a fast double-tap before the button visually disables, or a client retry
      // after a lost response) carries the SAME idempotency key, so Square correctly returns the SAME
      // paymentId for both — but without this check, both requests would independently insert a row,
      // producing two funded pack reservations for one charge. (A unique index on
      // drop_orders.payment_id backs this in the DB — see the accompanying migration.)
      if (paymentId) {
        const { data: already } = await supabaseAdmin.from("drop_orders").select("id").eq("payment_id", paymentId).maybeSingle();
        if (already) return NextResponse.json({ ok: true, id: already.id, paid: true, recorded: true });
      }
    }

    // Canonical customer link (0151) — member-only route, so user.id is the strong key; phone folds
    // any prior guest orders on the same number into this record.
    const customerId = (await supabaseAdmin.rpc("resolve_customer", { p_user_id: user.id, p_phone: phone || null, p_email: null, p_name: name })).data as string | null;
    const row = { user_id: user.id, customer_id: customerId, name, phone, size, glass, mix, total_cents: amount, paid, payment_id: paymentId, drop_date: dropDate };
    let { data: inserted, error: insErr } = await supabaseAdmin.from("drop_orders").insert(row).select("id").single();
    if (insErr) ({ data: inserted, error: insErr } = await supabaseAdmin.from("drop_orders").insert(row).select("id").single()); // retry once
    if (insErr) {
      // A concurrent request can still lose this exact race even with the pre-charge check above
      // (both requests can pass it before either insert commits) — the DB unique index is the real
      // backstop. Confirm the other request's row is there before raising a false "didn't record"
      // alert, which would otherwise have staff double-add a reservation that's already on the drop.
      if ((insErr as { code?: string }).code === "23505" && paymentId) {
        const { data: already2 } = await supabaseAdmin.from("drop_orders").select("id").eq("payment_id", paymentId).maybeSingle();
        if (already2) return NextResponse.json({ ok: true, id: already2.id, paid, recorded: true });
      }
      const ref = (paymentId || "").slice(-6).toUpperCase();
      const title = paid ? "Paid reservation didn't record — add it" : "Reservation didn't record — add it";
      await raiseAlert({ severity: "critical", category: paid ? "money" : "order", kind: "ops_incident", title, body: `${paid ? `A card payment succeeded (${paymentId}) but the` : "A pre-order"} reservation didn't save. ${name} · ${size}-pack ${glass} · ${mixSummary(mix)} · pickup ${dropDate}.${paid ? " Add it and confirm in Square." : " Add it to the drop."}` });
      return NextResponse.json({ ok: true, paid, recorded: false, ref, warn: `Reserved${ref ? ` — ref ${ref}` : ""}. We've alerted the crew; show this at pickup.` });
    }

    // Confirmation to the customer — SMS (they gave a phone for exactly this) + account email.
    // Best-effort: a provider hiccup never fails the reservation.
    await notifyCustomer({
      phone,
      email: await accountEmail(user.id),
      subject: `GT3 — ${size}-pack reserved for ${dropDate}`,
      message: `GT3: your ${size}-pack (${mixSummary(mix)}) is reserved for pickup ${dropDate}${paid ? " — paid ✓" : ` — ${dollars(packTotal(size, glass as GlassPath))} at pickup`}. We brew it fresh for pickup day.${glass === "return" ? " Rinse your empties and bring them along." : ""}`,
    });

    await raiseAlert({ severity: "fyi", category: "order", kind: "reservation_new", subjectId: inserted?.id ?? undefined, title: "New reservation 🎉", body: `${name} reserved a ${size}-pack (${mixSummary(mix)}) for ${dropDate} — ${dollars(packTotal(size, glass as GlassPath))}, ${glass === "return" ? "bringing bottles back" : "new glass"}${paid ? "" : " · pay at pickup"}.` });
    return NextResponse.json({ ok: true, id: inserted?.id ?? null, paid, recorded: true });
  } catch {
    return NextResponse.json({ error: "Reservation service unavailable" }, { status: 502 });
  }
}
