import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { staffFromRequest, callerClient } from "@/lib/apiAuth";
import { raiseAlert } from "@/lib/serverAlerts";
import { notifyCustomer, accountEmail } from "@/lib/notify";
import { isUuid } from "@/lib/uuid";
import { cupWords, packWords, crewWords, type CanceledStop, type CupHow } from "@/lib/stopCancel";
import { orderNo } from "@/lib/activeOrder";
import { route, isJsonObject } from "@/lib/apiRoute";

// CALL A STOP OFF, AND TELL THE PEOPLE WHO ORDERED FOR IT (0391, 2026-10-12 — H5 of the customer audit, release C1,
// approved; texting customers is decision 7). The cancel is the database's, as the caller: cancel_stop checks they are
// an owner or admin (the stops' writers), archives the stop (every reader drops it, and 0386 turns the live switch off
// if it named it), and marks it canceled with the reason. Then this tells:
//   · each cup order placed for it and not yet picked up — canceled, and told; a paid one is the crew's to refund, and
//     its refund flag is the database's, one per cup (0416 void_stop_orders; no money moves here);
//   · each pack picked up at it (0397), and the day's packs linked to no stop when no other stop is left that day — told
//     to move it or cancel it (theirs to choose).
// A second call voids what is still open — a first call that died part way left it — and tells nobody twice: each
// message is keyed by what happened (R22, lib/notify onceKey), so a retry tells whoever the first call didn't reach.

/** A few at a time (R22): one by one, thirty customers waited on thirty answers in a row — up to ten seconds each. */
async function eachFew<T>(rows: readonly T[], send: (row: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < rows.length; i += 4) await Promise.all(rows.slice(i, i + 4).map(send));
}

async function post(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ error: "Canceling isn't switched on yet." }, { status: 503 });
  if (!(await staffFromRequest(req))) return NextResponse.json({ error: "Crew only." }, { status: 403 });
  const sb = callerClient(req);
  if (!sb) return NextResponse.json({ error: "Sign in again to cancel a visit." }, { status: 401 });

  let body: { id?: unknown; reason?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  if (!isJsonObject(body)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const id = isUuid(body.id) ? body.id : "";
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 140) : "";
  if (!id) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const { data, error } = await sb.rpc("cancel_stop", { p_stop: id, p_reason: reason || null });
  if (error) {
    if (error.code === "42501") return NextResponse.json({ error: "Only an owner or an admin can cancel a visit." }, { status: 403 });
    return NextResponse.json({ error: "Couldn't cancel it — try again." }, { status: 500 });
  }
  const res = data as { day: string | null; cups: number; packs: number; other_stop_that_day?: boolean; already: boolean } | null;
  if (!res) return NextResponse.json({ error: "That visit isn't on the schedule." }, { status: 404 });

  // scoped-by: the stop id is the one cancel_stop just accepted from an owner or admin, by their own token.
  const { data: stopRow } = await supabaseAdmin.from("stops").select("name, starts_at, cancel_reason, canceled_at").eq("id", id).maybeSingle();
  const stop = (stopRow as CanceledStop | null) ?? { name: null, starts_at: null, cancel_reason: reason || null };
  const canceledAt = (stopRow as { canceled_at?: string | null } | null)?.canceled_at ?? null;

  // The cup orders placed for it, still to be picked up: voided with it, each its own write, as the caller (R9 — 0416
  // void_stop_orders). Each paid one — online or on the card reader — raises its own refund flag in the database, in the
  // same write, with the stop's name: the one long list this route raised was cut at 300 characters, left the reader's
  // cups off, and was never raised again on a retry. A retry ("already") voids what is still open: a call that died
  // after cancel_stop voided nothing, and the second one does it.
  type CupRow = { id: string; user_id: string | null; items: string[] | null; paid: boolean; collected_via?: string | null; total_cents: number; tip_cents?: number | null; payment_id: string | null };
  let cups: CupRow[] = [];
  let stuck: string[] = [];
  const voided = await sb.rpc("void_stop_orders", { p_stop: id });
  if (!voided.error) {
    const v = voided.data as { voided?: CupRow[]; stuck?: string[] } | null;
    cups = v?.voided ?? [];
    stuck = (v?.stuck ?? []).map((x) => orderNo(x));
  } else {
    return NextResponse.json({ error: "The visit is canceled, but its cup orders couldn't be — try again." }, { status: 500 });
  }
  // A retry with nothing left to void (R22): its packs are told again below — keyed, so only whoever the first call
  // didn't reach hears it — and nothing new is raised to the crew.
  const retryOnly = res.already && !cups.length && !stuck.length;
  // …and its cups (R24 — the 10/10 audit, API F11's last): void_stop_orders answers only what IT voided, so a member's cup
  // that a first call voided and died before telling was never told. A retry reads them back — this stop's, voided since
  // it was called off (a cup voided on the Pass before that is the Pass's to tell, and told) — and tells each with the
  // same key: whoever the first call reached hears nothing twice (lib/notify).
  let retold: CupRow[] = [];
  let cupsUnread = false;
  if (res.already && canceledAt) {
    // scoped-by: stop_id = the stop an owner or admin just canceled through cancel_stop's own check.
    const back = await supabaseAdmin.from("orders").select("id, user_id, items, paid, collected_via, total_cents, tip_cents, payment_id")
      .eq("stop_id", id).eq("status", "void").gte("status_changed_at", canceledAt);
    if (back.error) cupsUnread = true;
    else retold = ((back.data ?? []) as CupRow[]).filter((c) => c.user_id && !cups.some((x) => x.id === c.id));
  }

  // Told: a member, by email here and on their phone by the push function (the void, R3b). A guest has no address with
  // us — their order's page (the ticket, 0395) says it was called off, and why. The crew's toast counts which is which.
  // Keyed as every "canceled" for an order is (the Pass's void, the member's own cancel): one each, however it is told.
  let told = 0;
  await eachFew([...cups, ...retold], async (c) => {
    const email = await accountEmail(c.user_id);
    if (email) {
      await notifyCustomer({ email, subject: "GT3 — your order is canceled", message: cupWords(stop, { cups: c.items?.length || 1, how: cupHow(c) }), key: `order-canceled:${c.id}` });
    }
    if (c.user_id && cups.includes(c)) told++;
  });

  // The packs picked up at it (0397: a pack knows its stop) and, when no other stop is left that day, the day's packs
  // linked to none: told to move or cancel. Only those — another stop that day goes on, and its customers are not told
  // theirs is off (cancel_stop counts the same packs).
  type PackRow = { id: string; user_id: string | null; phone: string | null; size: number; paid: boolean };
  let packs: PackRow[] = [];
  let packsUnread = false;
  // On a retry too (R22): a first call that died before its packs were told left them never told — the customer at a
  // stop that wasn't there. Keyed, a pack told before is not told again.
  if (res.packs > 0 && res.day) {
    const cols = "id, user_id, phone, size, paid";
    // scoped-by: stop_id = the stop an owner or admin just canceled through cancel_stop's own check.
    const atStop = await supabaseAdmin.from("drop_orders").select(cols).eq("stop_id", id).is("canceled_at", null).eq("picked_up", false);
    // A read that failed is not "no packs at it" (R14): the crew is told to reach those customers themselves.
    if (atStop.error) packsUnread = true;
    packs = (atStop.data ?? []) as PackRow[];
    if (!res.other_stop_that_day) {
      // scoped-by: drop_date = the canceled stop's own day, no other stop left on it, and linked to no stop.
      const loose = await supabaseAdmin.from("drop_orders").select(cols)
        .eq("drop_date", res.day).is("stop_id", null).is("canceled_at", null).eq("picked_up", false);
      if (loose.error) packsUnread = true;
      packs = packs.concat((loose.data ?? []) as PackRow[]);
    }
    await eachFew(packs, async (p) => {
      await notifyCustomer({ phone: p.phone, email: await accountEmail(p.user_id), subject: "GT3 — your pickup day changed", message: packWords(stop, { size: p.size, paid: p.paid }), key: `stop-canceled:${id}:pack:${p.id}` });
    });
  }
  // A retry whose packs couldn't be read goes on to the crew's line below (the R22 review): "Already canceled" would hide
  // that the packs a first call died before telling may never hear.
  if (retryOnly && !packsUnread && !cupsUnread) return NextResponse.json({ ok: true, already: true, cups: 0, packs: packs.length, retold: retold.length });

  // The crew's one line: who was told, how many cards to refund — each has its own flag (above), so the line counts them
  // and never lists them (R9) — and the cups the database would not void, to void on the Pass.
  const refunds = cups.filter((c) => cupHow(c) === "online" || cupHow(c) === "card_reader").length;
  const line = crewWords(stop, { cups: cups.length, told, refunds, packs: packs.length, stuck });
  const unread = (packsUnread ? ` Its packs couldn't be read just now (${res.packs} on it) — their customers were not told; reach them from the pack board.` : "")
    + (cupsUnread ? " Its canceled cups couldn't be read again just now — a member the first try missed may not have been told; their orders say it was called off." : "");
  await raiseAlert({ severity: refunds || stuck.length || packsUnread || cupsUnread ? "critical" : "important", category: refunds ? "money" : "order", kind: "stop_canceled",
    subjectId: id, title: line.title, body: line.body + unread, link: "/crew?s=now" });
  return NextResponse.json({ ok: true, cups: cups.length, told, paid: refunds, packs: packs.length, stuck: stuck.length });
}

/** How a voided cup was paid, which is what its customer is told comes back: a card online or on the reader is refunded,
 *  cash comes back at the window, covered (a free cup or credit, 0416) took nothing. */
function cupHow(c: { paid: boolean; collected_via?: string | null }): CupHow {
  if (c.collected_via === "card_reader" || c.collected_via === "cash" || c.collected_via === "covered") return c.collected_via;
  return c.paid ? "online" : null;
}

export const POST = route("crew/stops/cancel", post);
