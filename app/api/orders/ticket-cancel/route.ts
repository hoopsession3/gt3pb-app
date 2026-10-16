import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { accountEmail, notifyCustomer } from "@/lib/notify";
import { money } from "@/lib/money";
import { orderNo } from "@/lib/activeOrder";
import { isUuid } from "@/lib/uuid";
import { route } from "@/lib/apiRoute";
import { isGone } from "@/lib/refusal";

// CANCEL FROM THE ORDER'S PAGE, AND TELL ITS MEMBER (2026-10-15, R7 of the customer re-audit).
//
// The order page canceled through cancel_by_ticket (0396) straight from the phone, and a database function sends no
// email: a member who canceled from their order's page — every cup order has one, members' too — got no "your order is
// canceled", which /api/orders/cancel sends from the app and gt3pb-help-kb promises for every cancel. This runs the same
// function with the same ticket — the ticket is the key, as it is on the phone — and then, when the order is a member's,
// says so to their account's email in /api/orders/cancel's words, the tip in the amount (0409). Best-effort, after the
// cancel has committed: a provider hiccup never un-cancels an order. A guest has no address with us; their page says it.
//
// public: the order's ticket is the key to its order — whoever holds it may cancel it while it is In, exactly as the
// phone could call cancel_by_ticket itself (0396); this adds the member's email and nothing else.

type Outcome = { ok?: boolean; outcome?: string; now?: string; paid?: boolean };

async function post(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ ok: false, outcome: "error", error: "Not available." }, { status: 503 });
  let body: { ticket?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, outcome: "error", error: "Bad request." }, { status: 400 }); }
  const ticket = typeof body?.ticket === "string" ? body.ticket : "";
  if (!isUuid(ticket)) return NextResponse.json({ ok: false, outcome: "error", error: "That isn't an order's link." }, { status: 400 });

  // A bound every instance shares (rate_limit_hit, 0154): a few tries a minute from one address — a person cancels one
  // order once — and a ceiling for everyone, so a script guessing tickets is slowed to nothing. Fails open when the
  // limiter can't be asked: a customer's cancel matters more than the bound.
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "anon";
  const [ipHit, allHit] = await Promise.all([
    supabaseAdmin.rpc("rate_limit_hit", { p_bucket: `ticket-cancel:${ip}`, p_window_ms: 60_000, p_max: 6 }),
    supabaseAdmin.rpc("rate_limit_hit", { p_bucket: "ticket-cancel:global", p_window_ms: 60_000, p_max: 120 }),
  ]);
  if (ipHit.data === false || allHit.data === false) {
    return NextResponse.json({ ok: false, outcome: "error", error: "Too many tries — give it a minute." }, { status: 429 });
  }

  const { data, error } = await supabaseAdmin.rpc("cancel_by_ticket", { p_ticket: ticket });
  if (error) {
    // An unknown ticket is refused in words (0396 — gone, lib/refusal): said as the 4xx it is.
    const missing = isGone(error);
    return NextResponse.json({ ok: false, outcome: missing ? "not_found" : "error", error: missing ? error.message : "Couldn't cancel it just now — try again, or ask at the truck." },
      { status: missing ? 404 : 500 });
  }
  const r = (data ?? {}) as Outcome;
  if (r.ok) {
    try {
      // scoped-by: ticket — the order this ticket just canceled, and no other.
      const { data: o } = await supabaseAdmin.from("orders").select("id, user_id, total_cents, tip_cents, paid").eq("ticket", ticket).maybeSingle();
      const row = o as { id: string; user_id: string | null; total_cents: number | null; tip_cents: number | null; paid: boolean | null } | null;
      if (row?.user_id) {
        const charged = (row.total_cents ?? 0) + (row.tip_cents ?? 0);
        await notifyCustomer({
          email: await accountEmail(row.user_id),
          subject: "Your GT3PB order is canceled",
          message: `Your cup order ${orderNo(row.id)} is canceled.${row.paid
            ? ` You paid ${money(charged)} — your card is being refunded in full; the crew processes it in Square. If you don't see it on your card within a few business days, reach out and we'll sort it.`
            : " Nothing was charged."}`,
        });
      }
    } catch { /* the cancel stands; the email is best-effort */ }
  }
  return NextResponse.json(r, { status: 200 });
}

export const POST = route("orders/ticket-cancel", post);
