import { NextResponse } from "next/server";
import { chargeCard } from "@/lib/squareServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { userFromRequest } from "@/lib/apiAuth";
import { raiseAlert } from "@/lib/serverAlerts";
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

  let body: { sourceId?: string; name?: string; phone?: string; size?: number; glass?: string; mix?: Partial<Mix>; dropDate?: string };
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
  const requested = String(body.dropDate ?? "").slice(0, 10);
  const cutoff = offered.get(requested);
  if (!cutoff) {
    return NextResponse.json({ error: "That pickup day just changed — refresh to see the current stops." }, { status: 409 });
  }
  if (Date.now() > cutoff.getTime()) {
    return NextResponse.json({ error: "That drop has closed — pick the next pickup day." }, { status: 400 });
  }
  const dropDate = requested;

  // Authoritative total — recomputed from the pricing grid, never the client amount.
  const amount = toCents(packTotal(size, glass as GlassPath));

  try {
    // Charge only when a card token was supplied; otherwise it's a pay-at-pickup pre-order.
    let paymentId: string | null = null;
    let paid = false;
    if (wantsCharge) {
      const charge = await chargeCard({ token: token!, locationId: locationId!, sourceId: body.sourceId!, amountCents: amount, note: `GT3PB order-ahead · ${size}-pack · ${glass} · pickup ${dropDate}` });
      if (!charge.ok) return NextResponse.json({ error: charge.error }, { status: 400 });
      paymentId = charge.paymentId;
      paid = true;
    }

    // Canonical customer link (0151) — member-only route, so user.id is the strong key; phone folds
    // any prior guest orders on the same number into this record.
    const customerId = (await supabaseAdmin.rpc("resolve_customer", { p_user_id: user.id, p_phone: phone || null, p_email: null, p_name: name })).data as string | null;
    const row = { user_id: user.id, customer_id: customerId, name, phone, size, glass, mix, total_cents: amount, paid, payment_id: paymentId, drop_date: dropDate };
    let { data: inserted, error: insErr } = await supabaseAdmin.from("drop_orders").insert(row).select("id").single();
    if (insErr) ({ data: inserted, error: insErr } = await supabaseAdmin.from("drop_orders").insert(row).select("id").single()); // retry once
    if (insErr) {
      const ref = (paymentId || "").slice(-6).toUpperCase();
      const title = paid ? "Paid reservation didn't record — add it" : "Reservation didn't record — add it";
      await raiseAlert({ severity: "critical", category: paid ? "money" : "order", title, body: `${paid ? `A card payment succeeded (${paymentId}) but the` : "A pre-order"} reservation didn't save. ${name} · ${size}-pack ${glass} · ${mixSummary(mix)} · pickup ${dropDate}.${paid ? " Add it and confirm in Square." : " Add it to the drop."}` });
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

    await raiseAlert({ severity: "fyi", category: "note", title: "New reservation 🎉", body: `${name} reserved a ${size}-pack (${mixSummary(mix)}) for ${dropDate} — ${dollars(packTotal(size, glass as GlassPath))}, ${glass === "return" ? "bringing bottles back" : "new glass"}${paid ? "" : " · pay at pickup"}.` });
    return NextResponse.json({ ok: true, id: inserted?.id ?? null, paid, recorded: true });
  } catch {
    return NextResponse.json({ error: "Reservation service unavailable" }, { status: 502 });
  }
}
