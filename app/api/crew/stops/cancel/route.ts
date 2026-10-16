import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { staffFromRequest, callerClient } from "@/lib/apiAuth";
import { raiseAlert } from "@/lib/serverAlerts";
import { notifyCustomer, accountEmail } from "@/lib/notify";
import { isMissingColumn, isMissingFunction } from "@/lib/schemaSkew";
import { isUuid } from "@/lib/uuid";
import { cupWords, packWords, crewWords, type CanceledStop } from "@/lib/stopCancel";
import { orderNo } from "@/lib/activeOrder";
import { route } from "@/lib/apiRoute";

// CALL A STOP OFF, AND TELL THE PEOPLE WHO ORDERED FOR IT (0391, 2026-10-12 — H5 of the customer audit, release C1,
// approved; texting customers is decision 7). The cancel is the database's, as the caller: cancel_stop checks they are
// an owner or admin (the stops' writers), archives the stop (every reader drops it, and 0386 turns the live switch off
// if it named it), and marks it canceled with the reason. Then this tells:
//   · each cup order placed for it and not yet picked up — canceled, and told; a paid one is the crew's to refund,
//     and the one line to the crew names each with its Square reference (no money moves here);
//   · each pack picked up at it (0397), and the day's packs linked to no stop when no other stop is left that day — told
//     to move it or cancel it (theirs to choose).
// A second call changes nothing and tells nobody again.

async function post(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ error: "Canceling isn't switched on yet." }, { status: 503 });
  if (!(await staffFromRequest(req))) return NextResponse.json({ error: "Crew only." }, { status: 403 });
  const sb = callerClient(req);
  if (!sb) return NextResponse.json({ error: "Sign in again to cancel a visit." }, { status: 401 });

  let body: { id?: unknown; reason?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  const id = isUuid(body.id) ? body.id : "";
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 140) : "";
  if (!id) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const { data, error } = await sb.rpc("cancel_stop", { p_stop: id, p_reason: reason || null });
  if (error) {
    if (isMissingFunction(error)) return NextResponse.json({ error: "Canceling isn't switched on yet." }, { status: 503 });
    if (error.code === "42501") return NextResponse.json({ error: "Only an owner or an admin can cancel a visit." }, { status: 403 });
    return NextResponse.json({ error: "Couldn't cancel it — try again." }, { status: 500 });
  }
  const res = data as { day: string | null; cups: number; packs: number; other_stop_that_day?: boolean; already: boolean } | null;
  if (!res) return NextResponse.json({ error: "That visit isn't on the schedule." }, { status: 404 });
  if (res.already) return NextResponse.json({ ok: true, already: true, cups: 0, packs: 0 });

  // arrives-with: 0391 — read only after cancel_stop answered, which is there only once 0391 is.
  // scoped-by: the stop id is the one cancel_stop just accepted from an owner or admin, by their own token.
  const { data: stopRow } = await supabaseAdmin.from("stops").select("name, starts_at, cancel_reason").eq("id", id).maybeSingle();
  const stop = (stopRow as CanceledStop | null) ?? { name: null, starts_at: null, cancel_reason: reason || null };

  // The cup orders placed for it, still to be picked up: canceled with it, and told.
  // scoped-by: orders.stop_id = this stop, which an owner or admin just canceled through the database's own check.
  const { data: cupRows } = await supabaseAdmin.from("orders").select("id, user_id, items, paid, total_cents, tip_cents, payment_id")
    .eq("stop_id", id).in("status", ["new", "preparing", "ready"]);
  type CupRow = { id: string; user_id: string | null; items: string[] | null; paid: boolean; total_cents: number; tip_cents?: number | null; payment_id: string | null };
  const openCups = (cupRows ?? []) as CupRow[];
  // Voided together, and only the ones that were are told (R7b): one order the database refused used to stop the whole
  // update, and every member was still emailed "canceled". Refused together, they are voided one at a time, and the ones
  // still refused are named to the crew, who void them on the Pass.
  let voided = new Set<string>();
  if (openCups.length) {
    // scoped-by: the ids just read for this stop.
    const all = await supabaseAdmin.from("orders").update({ status: "void" }).in("id", openCups.map((c) => c.id)).in("status", ["new", "preparing", "ready"]).select("id");
    if (!all.error) voided = new Set(((all.data ?? []) as { id: string }[]).map((r) => r.id));
    else {
      for (const c of openCups) {
        // scoped-by: one id just read for this stop.
        const one = await supabaseAdmin.from("orders").update({ status: "void" }).eq("id", c.id).in("status", ["new", "preparing", "ready"]).select("id");
        if (!one.error && (one.data ?? []).length) voided.add(c.id);
      }
    }
  }
  const cups = openCups.filter((c) => voided.has(c.id));
  const stuck = openCups.filter((c) => !voided.has(c.id)).map((c) => orderNo(c.id));
  // Told: a member, by email here and on their phone by the push function (the void, R3b). A guest has no address with
  // us — their order's page (the ticket, 0395) says it was called off, and why. The crew's toast counts which is which.
  let told = 0;
  for (const c of cups) {
    const email = await accountEmail(c.user_id);
    if (email) {
      await notifyCustomer({ email, subject: "GT3 — your order is canceled", message: cupWords(stop, { cups: c.items?.length || 1, paid: c.paid }) });
    }
    if (c.user_id) told++;
  }

  // The packs picked up at it (0397: a pack knows its stop) and, when no other stop is left that day, the day's packs
  // linked to none: told to move or cancel. Only those — another stop that day goes on, and its customers are not told
  // theirs is off (cancel_stop counts the same packs).
  type PackRow = { user_id: string | null; phone: string | null; size: number; paid: boolean };
  let packs: PackRow[] = [];
  if (res.packs > 0 && res.day) {
    const cols = "user_id, phone, size, paid";
    // arrives-with: 0397 — before it is pasted this read is refused, and cancel_stop (0391) counts packs only when no
    // other stop is left that day, so every pack that day is this stop's: the day's packs, as before.
    // scoped-by: stop_id = the stop an owner or admin just canceled through cancel_stop's own check.
    const atStop = await supabaseAdmin.from("drop_orders").select(cols).eq("stop_id", id).is("canceled_at", null).eq("picked_up", false);
    if (atStop.error && isMissingColumn(atStop.error)) {
      // scoped-by: drop_date = the canceled stop's own day, and cancel_stop counted them (no other stop that day).
      const { data: dayRows } = await supabaseAdmin.from("drop_orders").select(cols)
        .eq("drop_date", res.day).is("canceled_at", null).eq("picked_up", false);
      packs = (dayRows ?? []) as PackRow[];
    } else {
      packs = (atStop.data ?? []) as PackRow[];
      if (!res.other_stop_that_day) {
        // scoped-by: drop_date = the canceled stop's own day, no other stop left on it, and linked to no stop.
        const { data: loose } = await supabaseAdmin.from("drop_orders").select(cols)
          .eq("drop_date", res.day).is("stop_id", null).is("canceled_at", null).eq("picked_up", false);
        packs = packs.concat((loose ?? []) as PackRow[]);
      }
    }
    for (const p of packs) {
      await notifyCustomer({ phone: p.phone, email: await accountEmail(p.user_id), subject: "GT3 — your pickup day changed", message: packWords(stop, { size: p.size, paid: p.paid }) });
    }
  }

  // What each card was charged — the drinks and the tip (R7): the list said "of drinks", and that is what was refunded.
  const paidCups = cups.filter((c) => c.paid).map((c) => ({ no: orderNo(c.id), ref: (c.payment_id || c.id).slice(-6).toUpperCase(), cents: c.total_cents + (c.tip_cents ?? 0) }));
  const line = crewWords(stop, { cups: cups.length, told, paidCups, packs: packs.length });
  const stuckLine = stuck.length ? ` ${stuck.length === 1 ? "One order" : `${stuck.length} orders`} couldn't be canceled here — void ${stuck.length === 1 ? "it" : "them"} on the Pass: ${stuck.join(", ")}.` : "";
  await raiseAlert({ severity: paidCups.length || stuck.length ? "critical" : "important", category: paidCups.length ? "money" : "order", kind: "stop_canceled",
    subjectId: id, title: line.title, body: line.body + stuckLine, link: "/crew?s=now" });
  return NextResponse.json({ ok: true, cups: cups.length, told, paid: paidCups.length, packs: packs.length, stuck: stuck.length });
}

export const POST = route("crew/stops/cancel", post);
