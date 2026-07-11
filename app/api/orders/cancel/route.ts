import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { userFromRequest } from "@/lib/apiAuth";
import { raiseAlert } from "@/lib/serverAlerts";
import { notifyCustomer, accountEmail } from "@/lib/notify";

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

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
// Render a YYYY-MM-DD drop/delivery date as "Sat, Jul 18" without pulling the row's time zone in.
const dayLabel = (isoDate: string): string => {
  const d = new Date(`${isoDate}T12:00:00`);
  return Number.isNaN(d.getTime()) ? isoDate
    : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

type Canceled = { paid: boolean; who: string; label: string; phone: string | null; total_cents: number };

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon || !supabaseAdmin) {
    return NextResponse.json({ error: "Not available." }, { status: 503 });
  }

  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Sign in to cancel." }, { status: 401 });

  let body: { channel?: string; id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request." }, { status: 400 }); }
  const channel = body.channel as Channel;
  const id = (body.id || "").trim();
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
    const refundLine = info.paid
      ? ` You paid ${money(info.total_cents)} — your refund is on the way and posts to your card in a few business days.`
      : " Nothing was charged.";
    await notifyCustomer({
      phone: info.phone,
      email,
      subject: "Your GT3PB order is canceled",
      message: `Your ${info.label} is canceled.${refundLine}`,
    });
  }

  return NextResponse.json({ ok: true, paid: !!info?.paid }, { status: 200 });
}

// Read the just-canceled row with the service role (RLS-bypassing) but re-scope to the caller's
// user_id so this can only ever surface the caller's own contact details. Returns null on any gap.
async function lookup(channel: Channel, id: string, userId: string): Promise<Canceled | null> {
  try {
    if (channel === "cup") {
      const { data } = await supabaseAdmin!
        .from("orders").select("customer,total_cents,paid").eq("id", id).eq("user_id", userId).maybeSingle();
      if (!data) return null;
      return { paid: !!data.paid, who: data.customer || "A member",
        label: `cup order #${id.slice(0, 4).toUpperCase()}`, phone: null, total_cents: data.total_cents ?? 0 };
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
