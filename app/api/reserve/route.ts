import { NextResponse } from "next/server";
import { SQUARE_BASE, SQUARE_VERSION } from "@/lib/squareServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { userFromRequest } from "@/lib/apiAuth";
import { raiseAlert } from "@/lib/serverAlerts";
import { PRICING, FLAVORS, isPackSize, packTotal, toCents, mixComplete, mixSummary, nextDrop, dropDateKey, dollars, type GlassPath, type Mix } from "@/lib/orderAhead";

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

  // Pickup follows the truck's NEXT scheduled stop (server-authoritative), falling back to the
  // Saturday drop when the route is empty. The client's dropDate must match the current one, or we
  // reject — regardless of what the client clock or a stale page said.
  const { data: nextStop } = await supabaseAdmin.from("stops").select("starts_at")
    .is("archived_at", null).neq("status", "done").not("starts_at", "is", null)
    .gte("starts_at", new Date().toISOString()).order("starts_at", { ascending: true }).limit(1).maybeSingle();
  const dropDate = nextStop?.starts_at ? dropDateKey(new Date(nextStop.starts_at)) : dropDateKey(nextDrop().sat);
  if (!body.dropDate || String(body.dropDate).slice(0, 10) !== dropDate) {
    return NextResponse.json({ error: "That pickup just changed — refresh to see the next stop." }, { status: 409 });
  }

  // Authoritative total — recomputed from the pricing grid, never the client amount.
  const amount = toCents(packTotal(size, glass as GlassPath));

  try {
    // Charge only when a card token was supplied; otherwise it's a pay-at-pickup pre-order.
    let paymentId: string | null = null;
    let paid = false;
    if (wantsCharge) {
      const res = await fetch(`${SQUARE_BASE}/v2/payments`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Square-Version": SQUARE_VERSION },
        body: JSON.stringify({
          source_id: body.sourceId,
          idempotency_key: crypto.randomUUID(),
          amount_money: { amount, currency: "USD" },
          location_id: locationId,
          note: `GT3PB order-ahead · ${size}-pack · ${glass} · pickup ${dropDate}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) return NextResponse.json({ error: data?.errors?.[0]?.detail || "Payment declined" }, { status: 400 });
      paymentId = data?.payment?.id ?? null;
      paid = true;
    }

    const row = { user_id: user.id, name, phone, size, glass, mix, total_cents: amount, paid, payment_id: paymentId, drop_date: dropDate };
    let { data: inserted, error: insErr } = await supabaseAdmin.from("drop_orders").insert(row).select("id").single();
    if (insErr) ({ data: inserted, error: insErr } = await supabaseAdmin.from("drop_orders").insert(row).select("id").single()); // retry once
    if (insErr) {
      const ref = (paymentId || "").slice(-6).toUpperCase();
      const title = paid ? "Paid reservation didn't record — add it" : "Reservation didn't record — add it";
      await raiseAlert({ severity: "critical", category: paid ? "money" : "order", title, body: `${paid ? `A card payment succeeded (${paymentId}) but the` : "A pre-order"} reservation didn't save. ${name} · ${size}-pack ${glass} · ${mixSummary(mix)} · pickup ${dropDate}.${paid ? " Add it and confirm in Square." : " Add it to the drop."}` });
      return NextResponse.json({ ok: true, paid, recorded: false, ref, warn: `Reserved${ref ? ` — ref ${ref}` : ""}. We've alerted the crew; show this at pickup.` });
    }

    await raiseAlert({ severity: "fyi", category: "note", title: "New reservation 🎉", body: `${name} reserved a ${size}-pack (${mixSummary(mix)}) for ${dropDate} — ${dollars(packTotal(size, glass as GlassPath))}, ${glass === "return" ? "bringing bottles back" : "new glass"}${paid ? "" : " · pay at pickup"}.` });
    return NextResponse.json({ ok: true, id: inserted?.id ?? null, paid, recorded: true });
  } catch {
    return NextResponse.json({ error: "Reservation service unavailable" }, { status: 502 });
  }
}
