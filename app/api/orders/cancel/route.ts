import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { userFromRequest } from "@/lib/apiAuth";
import { raiseAlert } from "@/lib/serverAlerts";
import { notifyCustomer, accountEmail } from "@/lib/notify";
import { money } from "@/lib/money";
import { route } from "@/lib/apiRoute";
import { packClosesAt, closesWords, type PackStop } from "@/lib/pickupDay";
import { orderNo } from "@/lib/activeOrder";
import { deliveryCancelClosesAt } from "@/lib/delivery";
import { TEXTS_HELP_EMAIL } from "@/lib/texts";
import { isMissingColumn } from "@/lib/schemaSkew";

// CANCEL A CUSTOMER ORDER — one route for all three channels (cup / pickup pack / Sunday delivery).
// The database RPC already does the hard, trusted part (owner check + status-window check + the
// void/cancel write) and it CANNOT be moved out — but a Postgres function can't send an email or a
// text, and it only ever pinged the crew for PAID cancellations. So two gaps went unfilled: the
// operator saw nothing when an UNPAID order was canceled, and the customer never got a "you're
// canceled" confirmation on any channel. This route closes both without touching the money-path
// RPCs: it runs the cancel as the user (RLS/ownership still enforced), then on success adds the
// missing operator ping (unpaid only — paid already alerts inside the RPC, so we don't double it)
// and always confirms to the customer by email/text. Every notify is best-effort: the cancel has
// already committed by the time we get here, so a provider hiccup can never un-cancel an order.

const CHANNELS = ["cup", "pickup", "delivery"] as const;
type Channel = (typeof CHANNELS)[number];
const channelWord: Record<Channel, string> = { cup: "cup order", pickup: "pickup pack", delivery: "delivery" };

// Render a YYYY-MM-DD drop/delivery date as "Sat, Jul 18" without pulling the row's time zone in.
const dayLabel = (isoDate: string): string => {
  const d = new Date(`${isoDate}T12:00:00`);
  return Number.isNaN(d.getTime()) ? isoDate
    : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

type Canceled = { paid: boolean; who: string; label: string; phone: string | null; total_cents: number };

async function post(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon || !supabaseAdmin) {
    return NextResponse.json({ error: "Not available." }, { status: 503 });
  }

  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Sign in to cancel." }, { status: 401 });

  let body: { channel?: string; id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request." }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Bad request." }, { status: 400 });   // a literal null is valid JSON (R10b): a 400, not a TypeError's 500
  const channel = body.channel as Channel;
  const id = typeof body.id === "string" ? body.id.trim() : "";   // a number here threw (R10b): a 400, not a 500
  if (!CHANNELS.includes(channel) || !id) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  // Run the cancel AS THE USER: the caller's token on the anon client means the SECURITY DEFINER
  // RPC still sees auth.uid() = the caller, so its owner + status-window checks are authoritative.
  // The service role is used only afterward, to read contact details and to alert/notify.
  const token = (req.headers.get("authorization") || "").slice(7);
  const asUser = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: ok, error } = await asUser.rpc("cancel_any_order", { p_channel: channel, p_id: id });
  if (error || ok !== true) {
    // The RPC returns false when it's too late (already on the pass / brewed / picked up) or not
    // the caller's order — the surfaces phrase this as "too late to cancel online."
    // A CUP SAYS WHICH (2026-10-13, R3b — "Cancel reports its outcome"): too late (it's being made, it's ready, it was
    // picked up — the status it is in now), paid at the window (the crew's to cancel there), not this person's, or a
    // failure. Each was "We couldn't cancel it — it may already be on the way". The packs and deliveries answer as before.
    if (channel === "cup") {
      const why = await whyNot(id, user.id, !!error);
      return NextResponse.json({ ok: false, ...why.body }, { status: why.status });
    }
    // A PACK SAYS WHICH TOO (R5, 0397): canceled already, picked up, paid at the window, in the crew's hands, or its drop
    // closed — with when. It was a bare "Couldn't cancel — it may already be picked up" whatever the reason.
    if (channel === "pickup") {
      const why = await whyNotPack(id, user.id, !!error);
      return NextResponse.json({ ok: false, ...why.body }, { status: why.status });
    }
    // A DELIVERY SAYS WHICH TOO (R7b): canceled already, on its way or delivered, or past its cancel time — with when. It
    // was a bare { ok: false }, and the page said "too late — text us" with no number, whatever the reason.
    if (channel === "delivery") {
      const why = await whyNotDelivery(id, user.id, !!error);
      return NextResponse.json({ ok: false, ...why.body }, { status: why.status });
    }
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  // Cancel committed. Everything below is best-effort and must never turn a success into a failure.
  const info = await lookup(channel, id, user.id);
  if (info) {
    // Operator ping for the UNPAID case only — paid cancels already insert a money/"refund needed"
    // alert inside the RPC (0118/0136/0139); adding another here would double the inbox (task #41,
    // de-noise). So we fill exactly the hole: a plain FYI that a no-charge order was canceled.
    if (!info.paid) {
      await raiseAlert({
        severity: "fyi",
        category: "order",
        title: `Canceled: ${info.who}'s ${channelWord[channel]}`,
        body: `${info.who} canceled their ${info.label}. Nothing was charged — no refund needed.`,
        link: "/crew",
      });
    }
    // Confirm to the customer on every channel — the missing "email or text about my order being
    // canceled." Phone (pickup/delivery rows carry it) + account email, both best-effort.
    const email = await accountEmail(user.id);
    // Was worded as a done deal with a concrete timeline ("your refund is on the way... in a few
    // business days") — but nothing in this path actually calls Square to issue a refund; it only
    // queues a staff alert ("refund it in Square"). If that alert gets buried in a busy inbox, the
    // system has no follow-up, no retry, and had just told the customer something it can't enforce.
    // Say what's actually true instead of a promise this route can't keep.
    const refundLine = info.paid
      ? ` You paid ${money(info.total_cents)} — your card is being refunded in full; the crew processes it in Square. If you don't see it on your card within a few business days, reach out and we'll sort it.`
      : " Nothing was charged.";
    await notifyCustomer({
      phone: info.phone,
      email,
      subject: "Your GT3PB order is canceled",
      message: `Your ${info.label} is canceled.${refundLine}`,
    });
  }

  return NextResponse.json({ ok: true, outcome: "canceled", paid: !!info?.paid }, { status: 200 });
}

/** Why a cup wasn't canceled, read as the caller's own row (service role, scoped back to their user_id). */
async function whyNot(id: string, userId: string, failed: boolean): Promise<{ status: number; body: { outcome: string; now?: string } }> {
  // scoped-by: user_id = the caller, whose token the cancel was just refused for — only ever their own order.
  const { data, error } = await supabaseAdmin!.from("orders").select("status, collected_at").eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) return { status: 500, body: { outcome: "error" } };
  const o = data as { status: string; collected_at: string | null } | null;
  if (!o) return { status: 404, body: { outcome: "not_yours" } };
  if (o.status !== "new") return { status: 409, body: { outcome: "too_late", now: o.status } };
  if (o.collected_at) return { status: 409, body: { outcome: "at_window" } };
  return failed ? { status: 500, body: { outcome: "error" } } : { status: 409, body: { outcome: "too_late", now: o.status } };
}

/** Why a pack wasn't canceled — the database's own rule (0397 cancel_own_reservation), read back as the caller's row. */
async function whyNotPack(id: string, userId: string, failed: boolean): Promise<{ status: number; body: { outcome: string; now?: string; error: string } }> {
  // arrives-with: 0397 — stop_id is read here. Until it is pasted the column is not there (lib/schemaSkew): the pack is
  // read without it, and its day's rule says when it closed.
  // scoped-by: user_id = the caller, whose token the cancel was just refused for — only ever their own pack.
  const withStop = await supabaseAdmin!.from("drop_orders").select("drop_date, stop_id, stage, picked_up, canceled_at, collected_at").eq("id", id).eq("user_id", userId).maybeSingle();
  const { data, error } = withStop.error && isMissingColumn(withStop.error)
    // scoped-by: user_id = the caller, as above — the same row without the column 0397 adds.
    ? await supabaseAdmin!.from("drop_orders").select("drop_date, stage, picked_up, canceled_at, collected_at").eq("id", id).eq("user_id", userId).maybeSingle()
    : withStop;
  if (error) return { status: 500, body: { outcome: "error", error: "Couldn't cancel it just now — try again, or ask at the truck." } };
  const p = data as { drop_date: string; stop_id?: string | null; stage: string | null; picked_up: boolean; canceled_at: string | null; collected_at: string | null } | null;
  if (!p) return { status: 404, body: { outcome: "not_yours", error: "That pack isn't on your account." } };
  if (p.canceled_at) return { status: 409, body: { outcome: "too_late", now: "canceled", error: "That pack is already canceled." } };
  if (p.picked_up) return { status: 409, body: { outcome: "too_late", now: "picked_up", error: "That pack was picked up." } };
  if (p.collected_at) return { status: 409, body: { outcome: "at_window", error: "Paid at the window — the crew cancels it there." } };
  if (p.stage && p.stage !== "reserved") return { status: 409, body: { outcome: "too_late", now: p.stage, error: "The crew already has this pack in motion — ask at the truck." } };
  // scoped-by: the caller's own pack's stop; stops are the public schedule.
  const { data: st } = p.stop_id ? await supabaseAdmin!.from("stops").select("starts_at, canceled_at").eq("id", p.stop_id).maybeSingle() : { data: null };
  const closes = packClosesAt(p.drop_date, st as PackStop);
  if (closes && Date.now() >= closes.getTime()) return { status: 409, body: { outcome: "too_late", now: "closed", error: `Its drop closed ${closesWords(closes)} — we may already be brewing it. Ask at the truck.` } };
  return failed ? { status: 500, body: { outcome: "error", error: "Couldn't cancel it just now — try again, or ask at the truck." } }
    : { status: 409, body: { outcome: "too_late", error: "Couldn't cancel it — ask at the truck." } };
}

async function whyNotDelivery(id: string, userId: string, failed: boolean): Promise<{ status: number; body: { outcome: string; now?: string; error: string } }> {
  // scoped-by: user_id = the caller, whose token the cancel was just refused for — only ever their own delivery.
  const { data, error } = await supabaseAdmin!.from("delivery_orders").select("delivery_date, status, canceled_at").eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) return { status: 500, body: { outcome: "error", error: "Couldn't cancel it just now — try again in a minute." } };
  const d = data as { delivery_date: string; status: string; canceled_at: string | null } | null;
  if (!d) return { status: 404, body: { outcome: "not_yours", error: "That delivery isn't on your account." } };
  if (d.canceled_at) return { status: 409, body: { outcome: "too_late", now: "canceled", error: "That delivery is already canceled." } };
  if (d.status !== "received") return { status: 409, body: { outcome: "too_late", now: d.status, error: `It's already on its way to you — email ${TEXTS_HELP_EMAIL} and we'll sort it out.` } };
  const closes = deliveryCancelClosesAt(d.delivery_date);
  if (Date.now() >= closes.getTime()) return { status: 409, body: { outcome: "too_late", now: "closed", error: `Online cancels closed ${closesWords(closes)} — we're already brewing it. Email ${TEXTS_HELP_EMAIL} and we'll sort it out.` } };
  return failed ? { status: 500, body: { outcome: "error", error: "Couldn't cancel it just now — try again in a minute." } }
    : { status: 409, body: { outcome: "too_late", error: `Couldn't cancel it — email ${TEXTS_HELP_EMAIL} and we'll sort it out.` } };
}

// Read the just-canceled row with the service role (RLS-bypassing) but re-scope to the caller's
// user_id so this can only ever surface the caller's own contact details. Returns null on any gap.
async function lookup(channel: Channel, id: string, userId: string): Promise<Canceled | null> {
  try {
    if (channel === "cup") {
      // What the card was charged: the drinks and the tip (R7, 0409) — "You paid" named the drinks only.
      const { data } = await supabaseAdmin!
        .from("orders").select("customer,total_cents,tip_cents,paid").eq("id", id).eq("user_id", userId).maybeSingle();
      if (!data) return null;
      return { paid: !!data.paid, who: data.customer || "A member",
        label: `cup order ${orderNo(id)}`, phone: null, total_cents: (data.total_cents ?? 0) + (data.tip_cents ?? 0) };
    }
    if (channel === "pickup") {
      const { data } = await supabaseAdmin!
        .from("drop_orders").select("name,phone,size,total_cents,paid,drop_date").eq("id", id).eq("user_id", userId).maybeSingle();
      if (!data) return null;
      return { paid: !!data.paid, who: data.name || "A member",
        label: `${data.size}-pack for ${dayLabel(data.drop_date)}`, phone: data.phone ?? null, total_cents: data.total_cents ?? 0 };
    }
    // delivery
    const { data } = await supabaseAdmin!
      .from("delivery_orders").select("name,phone,pack_size,total_cents,payment_status,delivery_date").eq("id", id).eq("user_id", userId).maybeSingle();
    if (!data) return null;
    return { paid: data.payment_status === "paid", who: data.name || "A member",
      label: `${data.pack_size}-bottle delivery for ${dayLabel(data.delivery_date)}`, phone: data.phone ?? null, total_cents: data.total_cents ?? 0 };
  } catch { return null; }
}

export const POST = route("orders/cancel", post);
