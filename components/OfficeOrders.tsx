"use client";

import { useCallback, useEffect, useState } from "react";
import { useAppStable } from "@/components/AppProvider";
import { useAuth } from "@/components/AuthProvider";
import { canOf } from "@/lib/roles";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";
import { mondayLabel, windowHours } from "@/lib/office";
import { dayLabel } from "@/lib/officeStatus";
import { clientChanges, requestLabel } from "@/lib/officeChange";
import { haptic } from "@/lib/haptics";
import { addDays, dayWithDate, etToday } from "@/lib/dates";
import { useAsyncData } from "@/lib/useAsyncData";
import { useRealtimeTable } from "@/lib/realtime";
import AsyncSection from "./AsyncSection";
import EmptyState from "./EmptyState";
import { InfoRow } from "@/components/kit";
import FoldCard from "@/components/crew/FoldCard";
import Icon from "@/components/Icon";
import { money } from "@/lib/money";
import { usePrompt } from "@/components/PromptSheet";
import { useConfirm } from "@/components/ConfirmSheet";
import { useMinute } from "@/lib/useMinute";
import { dueAnchor, officeLate, type OfficeFeed } from "@/lib/dueNext";
import { refusalText } from "@/lib/refusal";
import { plainFailure, failureWords } from "@/lib/failureWords";

// CREW · OFFICE ORDERS — the operator's control surface for the Monday B2B route (0187). See upcoming
// office deliveries, log the jug swap (full out / empties in) on delivery, and settle billing
// (prepaid → paid · net terms → invoiced). Same Pit-Wall language as the rest of crew. On a swap it
// writes the jug_ledger + bumps the account's jug balance so the container count stays truthful.
// Fetch state via useAsyncData. The section still self-hides (renders nothing) while loading and when
// there's truly no office program yet (no standing accounts, no orders) — same as before. What's fixed:
// a fetch error used to collapse into that exact same "nothing" state, indistinguishable from a quiet
// week; now it surfaces as a real error instead of vanishing.
//
// DELIVERED IS NOT DONE (2026-10-04). The list read `.neq("status", "delivered")`, so the moment a
// driver logged the swap the order left the only screen that could take its money: a prepaid order
// delivered before its link was paid could never be marked paid, a net-terms order could no longer
// be invoiced, and "Undo jug swap" — which only means something AFTER a delivery — sat on every
// order that had not had one, where it could only ever answer "No open jug entry". Delivered orders
// now stay while money is still owed on them (pending, or a failed payment) and for the week after,
// so a miscounted swap can be put right; an invoiced one is followed by its invoice under Needs you.
// The two "deliver" actions show on the undelivered, the undo on the delivered.
type BOrder = {
  id: string; business_id: string | null; company: string; contact_phone: string | null;
  address_street: string; address_city: string; address_zip: string; access_instructions: string | null;
  delivery_date: string; delivery_window: string | null; gallons: number; total_cents: number; billing_terms: string;
  payment_status: string; status: string; jugs_out: number; jugs_in: number | null; standing: boolean;
  cutoff_at: string | null;
  // a client's own hand on it (0359) — select("*") brings them once the columns exist
  moved_from?: string | null; gallons_changed_at?: string | null; change_reason?: string | null; client_note?: string | null;
  // its Square payment link (0221), and the link's own id (0417) — select("*") brings them
  paylink_url?: string | null; paylink_id?: string | null;
};
// What a client asked GT3 for (0359's company_requests): the crew's to answer, here beside the route.
type Req = { id: string; kind: string; body: string; status: string; order_id: string | null; created_at: string; companies: { name: string } | null };
type Board = { rows: BOrder[]; later: BOrder[]; standingN: number; requests: Req[]; due: string | null };

/** onDue: the day this route is next due (an overdue one first), for Live Ops' Due next to put the runs in order.
 *  onRows: the route's stops still to deliver, as this card read them, for Due next's one list (2026-10-11). */
export default function OfficeOrders({ onDue, onRows }: { onDue?: (day: string | null) => void; onRows?: (feed: OfficeFeed) => void } = {}) {
  const prompt = usePrompt();
  const now = useMinute();
  const confirm = useConfirm();
  const { toast } = useAppStable();
  // Settling is an owner's or an admin's (0420 settle_office_order, as is_admin() in SQL: the role, or the flag): the
  // rest of the crew sees what is owed, and the buttons that settle it are not theirs.
  const { profile } = useAuth();
  const canSettle = canOf(profile).admin || !!profile?.is_admin;
  const [openId, setOpenId] = useState<string | null>(null);
  const [empties, setEmpties] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showLater, setShowLater] = useState(false);

  const loader = useCallback(async (): Promise<Board> => {
    if (!supabase) return { rows: [], later: [], standingN: 0, requests: [], due: null };
    const weekAgo = addDays(etToday(), -7);
    const [ord, acct, reqs] = await Promise.all([
      supabase.from("business_orders").select("*").is("canceled_at", null)
        .or(`status.neq.delivered,payment_status.in.(pending,failed),delivery_date.gte.${weekAgo}`)
        .order("delivery_date").limit(400),
      supabase.from("business_accounts").select("id", { count: "exact", head: true }).eq("standing_active", true),
      supabase.from("company_requests").select("id, kind, body, status, order_id, created_at, companies(name)")
        .in("status", ["open", "in_progress"]).order("created_at").limit(50),
    ]);
    if (ord.error) throw new Error(ord.error.message);
    if (acct.error) throw new Error(acct.error.message);
    if (reqs.error) throw new Error(reqs.error.message);
    const requests = (reqs.data as unknown as Req[]) ?? [];
    // SIX WEEKS AHEAD (2026-10-07, 0358). The schedule now keeps six weeks of each program's
    // deliveries, so "every undelivered order" is the next route plus five more weeks of the same
    // offices. The route is the next delivery day (and anything overdue before it), in date order;
    // later weeks are counted under it and open on a tap; what is already delivered follows, newest
    // first. The query is the same one — still owed or recent stays — with room for six weeks.
    const all = (ord.data as BOrder[]) ?? [];
    const today = etToday();
    const open = all.filter((o) => o.status !== "delivered");
    const nextDay = open.map((o) => o.delivery_date).filter((d) => d >= today).sort()[0] ?? null;
    const route = open.filter((o) => nextDay === null || o.delivery_date <= nextDay);
    const later = open.filter((o) => nextDay !== null && o.delivery_date > nextDay);
    const done = all.filter((o) => o.status === "delivered").sort((a, b) => b.delivery_date.localeCompare(a.delivery_date));
    // Due (2026-10-11, Live Ops' Due next): the route's first day still owed — an overdue one first.
    const due = open.map((o) => o.delivery_date).sort()[0] ?? null;
    return { rows: [...route, ...done], later, standingN: acct.count ?? 0, requests, due };
  }, []);
  const board = useAsyncData(loader, []);
  const { reload } = board;
  // The driver logs from the run (components/OfficeRun); this route hears it live (business_orders joins
  // the realtime publication in 0357 — before that the subscription simply receives nothing).
  useRealtimeTable("business_orders", reload);
  useRealtimeTable("company_requests", reload);
  const dueDay = board.data?.due ?? null;
  useEffect(() => { onDue?.(dueDay); }, [dueDay, onDue]);
  // Due next's one list is this route: every stop up to its next day still to deliver, an overdue one first.
  useEffect(() => {
    onRows?.({ status: board.status, rows: board.data ? board.data.rows.filter((o) => o.status !== "delivered") : [] });
  }, [board.status, board.data, onRows]);

  // A CLIENT ASKED (2026-10-07, 0359). Each request is the crew's to answer: take it (in progress), or
  // close it — done, or declined with the reason — and what is typed here is what the client reads on
  // their GT3 page. office_request_set answers the crew's alert about it in the same write.
  const answer = async (r: Req, status: "in_progress" | "done" | "declined") => {
    if (!supabase || busyId) return;
    const who = r.companies?.name ?? "the client";
    let resolution: string | null = null;
    if (status !== "in_progress") {
      const said = await prompt({
        title: status === "done" ? `Done — what should ${who} hear?` : `Decline — tell ${who} why`,
        hint: "They read this on their GT3 page.", multiline: true,
        placeholder: status === "done" ? "Made it 6 — see you Monday." : "Saturdays aren't on a route yet — Monday works.",
        confirmLabel: status === "done" ? "Mark done" : "Decline",
      });
      if (said === null) return;
      resolution = said.trim() || null;
      if (status === "declined" && !resolution) { toast("Say why — the client reads it", "error"); return; }
    }
    setBusyId(r.id);
    const { error } = await supabase.rpc("office_request_set", { p_request: r.id, p_status: status, p_resolution: resolution });
    setBusyId(null);
    if (error) { toast(failureWords(error), "error"); return; }
    haptic("success");
    toast(status === "in_progress" ? `${who} — it's yours` : status === "done" ? `${who} — done, and they can see it` : `${who} — declined, with your reason`);
    reload();
  };

  // THE SCHEDULE, FROM THE PROGRAMS (2026-10-07, 0356; six weeks from 0358). generate_office_deliveries
  // makes every active program's deliveries for the next six weeks, each in its market's own time, once
  // each, and logs the run — what the schedule now does by itself every night. This made one Monday, picked by the
  // phone's clock, so on a Sunday evening the phone and the server could pick different weeks.
  const gen = async () => {
    if (!supabase || busyId) return; setBusyId("gen");
    const res = await supabase.rpc("generate_office_deliveries");
    const made = "for the next six weeks";
    setBusyId(null);
    const n = (res.data as number | null) ?? 0;
    toast(res.error ? `Couldn't generate the route — ${plainFailure(res.error)}` : n ? `${n} office deliver${n === 1 ? "y" : "ies"} made ${made}` : `Nothing new — every delivery ${made} is already on the route`, res.error ? "error" : undefined);
    reload();
  };

  // UNDOING A SWAP. A logged swap wrote a jug_ledger row and moved business_accounts.jug_balance, so a
  // miscount is wrong in two places at once. void_jug_entry reverses both in one transaction and
  // keeps the row as the record — and it clamps at zero exactly where the logged swap did, which is the
  // bug 0310 fixed after I shipped the reversal without it.
  const voidSwap = async (o: BOrder) => {
    if (!supabase || busyId) return;
    const { data: rows } = await supabase.from("v_jug_open")
      .select("id, jugs_out, jugs_in").eq("business_order_id", o.id).order("created_at", { ascending: false }).limit(1);
    const row = ((rows as { id: string; jugs_out: number; jugs_in: number }[]) ?? [])[0];
    if (!row) { toast("No open jug entry on this delivery to undo.", "error"); return; }
    const why = await prompt({ title: `Undo the swap logged for ${o.company}?`, hint: `${row.jugs_out} out, ${row.jugs_in} back. Say why — it goes on the record.`, defaultValue: "miscounted the empties", confirmLabel: "Undo it" });
    if (!why || !why.trim()) return;
    setBusyId(o.id);
    const { error } = await supabase.rpc("void_jug_entry", { p_id: row.id, p_reason: why.trim() });
    setBusyId(null);
    if (error) { toast(failureWords(error), "error"); return; }
    toast(`${o.company} — jug swap undone, balance corrected`);
    reload();
  };

  // ONE WRITE (2026-10-07, 0357). office_log_delivery records the outcome, the jugs, the ledger row and
  // the balance together with the order locked — the driver's run (components/OfficeRun) uses the same
  // door, so two phones cannot count one swap twice; these were three writes from the browser.
  // THE ONLY WRITE (R12b, the 10/10 audit, F4): 0357 is applied, so the browser's three writes — kept for a database
  // without the function — went; they read none of their answers (a ledger row with no balance moved, or the reverse).
  const deliver = async (o: BOrder, swapped: boolean) => {
    if (!supabase || busyId) return; setBusyId(o.id);
    const jugsIn = swapped ? Math.max(0, empties[o.id] ?? Math.round(o.gallons)) : 0;
    const one = await supabase.rpc("office_log_delivery", { p_order: o.id, p_outcome: swapped ? "delivered_swapped" : "delivered_no_swap", p_jugs_in: swapped ? jugsIn : null });
    if (one.error) { toast(refusalText(one.error) ?? "Didn't save — try again", "error"); setBusyId(null); reload(); return; }
    setBusyId(null); setOpenId(null); toast(`${o.company} — delivered`); reload();
  };

  // Settling an office order — ONE DOOR (R10, 0420 settle_office_order). The page wrote the order's payment status and
  // then the invoice, two writes, and any crew member could write either (or the order's total). Now the database does
  // both in one write, for an owner or an admin, from a state that still owes only: a second tap — or a second phone —
  // hears "already settled" instead of making a second invoice, and an invoice that cannot be made leaves the order
  // owing, as it was. Its due date comes from the terms in the database (0341), which puts it under Needs you.
  const setPay = async (o: BOrder, status: "paid" | "invoiced") => {
    if (!supabase || busyId) return; setBusyId(o.id);
    const { data, error } = await supabase.rpc("settle_office_order", { p_order: o.id, p_how: status });
    const said = (data ?? null) as { ok?: boolean; already?: string | null } | null;
    if (error || !said?.ok || said.already) {
      setBusyId(null);
      toast(error ? failureWords(error, "Didn't save") : `${o.company} was already ${said?.already === "paid" ? "paid" : "settled"}`, error ? "error" : undefined);
      reload(); return;
    }
    // Paid another way, its payment link goes (R9): left live, it was paid a second time and nothing said so. Said back
    // when Square would not switch it off; a payment landing on it anyway is flagged by the webhook.
    let linkWord = "";
    if (status === "paid" && o.paylink_url) {
      try {
        const r = await authedFetch("/api/office/paylink", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: o.id, off: true }) });
        const j = await r.json().catch(() => null) as { link?: string } | null;
        linkWord = j?.link === "off" ? " — its payment link is off" : " — its payment link may still work: switch it off in Square";
      } catch { linkWord = " — its payment link may still work: switch it off in Square"; }
    }
    setBusyId(null);
    toast(status === "paid" ? `${o.company} — marked paid${linkWord}` : `${o.company} — invoiced, ${o.billing_terms === "net30" ? "due in 30 days" : "due in 15 days"}`);
    reload();
  };

  // The app creates the Square payment link itself (0221) — one tap, link on the clipboard, and when
  // the customer pays, the webhook auto-marks the order paid. No more hand-texted links + hand-marking.
  const payLink = async (o: BOrder) => {
    if (busyId) return; setBusyId(o.id);
    try {
      const r = await authedFetch("/api/office/paylink", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: o.id }) });
      const j = await r.json();
      if (!j.ok || !j.url) { toast(`Couldn't create the link — ${j.error ? plainFailure(j.error) : "try again"}`, "error"); setBusyId(null); return; }
      try { await navigator.clipboard.writeText(j.url); toast("Payment link copied — text it to the customer. It auto-marks paid."); }
      catch { toast(`Payment link ready: ${j.url}`); }
    } catch { toast("Couldn't create the link — try again", "error"); }
    setBusyId(null);
  };

  // A STOP NOT DELIVERED, REOPENED (2026-10-11, the dispatch round). The driver's "Couldn't deliver" logs the stop, and the
  // database will not log a logged stop twice ("undo it first") — but only the driver's screen had the undo, so this
  // route's own Log delivery could never land on it. office_reopen_delivery (0357) is that undo: it puts the stop back on
  // the run, answers the crew's alert about it, and keeps the reason on the record. Then Log delivery works.
  const reopen = async (o: BOrder) => {
    if (!supabase || busyId) return;
    const why = await prompt({ title: `Reopen ${o.company}'s delivery?`, hint: "It goes back on the run, to log again. Say why — it goes on the record.", defaultValue: "delivering it after all", confirmLabel: "Reopen" });
    if (!why || !why.trim()) return;
    setBusyId(o.id);
    const { error } = await supabase.rpc("office_reopen_delivery", { p_order: o.id, p_reason: why.trim() });
    setBusyId(null);
    if (error) { toast(failureWords(error, "Couldn't reopen it"), "error"); return; }
    toast(`${o.company} — back on the run`); reload();
  };

  // CANCEL ASKS, AND SAYS WHEN IT DIDN'T (2026-10-11). One tap took a delivery off the route with no question, and the
  // write was not checked, so a refused one still read "canceled". A canceled delivery leaves the route, the driver's
  // run and the client's page, and nothing here brings it back — so it asks first, like every step that can't be undone.
  // AND SAYS WHAT BECOMES OF THE MONEY (R9, 2026-10-16). It went through a plain update that said nothing of money: a paid
  // order canceled raised no refund flag, and an owed one's payment link stayed live — the client paid it, and the
  // canceled order read paid. The cancel is the server's now (app/api/office/cancel): the link is switched off first, the
  // order canceled once, and a paid one's refund flag is the database's (0416).
  const cancel = async (o: BOrder) => {
    if (busyId) return;
    const paid = o.payment_status === "paid";
    const body = paid
      ? `They paid ${money(o.total_cents)} — refund it in Square; the crew inbox gets a flag. It comes off the route, the driver's run and their GT3 page.`
      : o.paylink_url
        ? "Its payment link is switched off, so it can't be paid. It comes off the route, the driver's run and their GT3 page."
        : "It comes off the route, the driver's run and their GT3 page. It can't be undone here.";
    if (!(await confirm({ title: `Cancel ${o.company}'s ${mondayLabel(o.delivery_date)} delivery?`, body, confirmLabel: "Cancel delivery", danger: true }))) return;
    setBusyId(o.id);
    let j: { ok?: boolean; already?: boolean; link?: string; error?: string } | null = null;
    try {
      const r = await authedFetch("/api/office/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: o.id }) });
      j = await r.json().catch(() => null);
    } catch { /* said below */ }
    setBusyId(null);
    if (!j?.ok) { toast(`Didn't cancel — ${j?.error ? plainFailure(j.error) : "no answer came back; check the route before trying again"}`, "error"); reload(); return; }
    toast(j.already ? `${o.company} was already canceled`
      : j.link === "unknown" ? `${o.company} — canceled. Square didn't confirm its payment link is off: switch it off in Square`
      : paid ? `${o.company} — canceled. Refund ${money(o.total_cents)} in Square (it's in your alerts)`
      : `${o.company} — canceled`, j.link === "unknown" ? "error" : undefined);
    reload();
  };

  if (board.status === "loading") return null; // quiet during initial load, same as the original gate
  if (board.status === "ready" && board.data && board.data.rows.length === 0 && board.data.standingN === 0 && board.data.requests.length === 0) return null; // no office program at all yet — same self-hide as before

  return (
    <AsyncSection state={board} isEmpty={() => false} errorTitle="Couldn't load the office route" emptyTitle="No office activity yet">
      {(data) => {
        const { standingN, later, requests } = data;
        const route = data.rows.filter((o) => o.status !== "delivered");
        const rows = showLater ? [...route, ...later, ...data.rows.filter((o) => o.status === "delivered")] : data.rows;
        // ITS DAY (2026-10-10, the Live Ops fold). Live Ops is today; the route drew every order on it all
        // week — on a Saturday, 1,100px of Monday under the Pass. It is one row now (the day, how many
        // deliveries, the gallons to fill) until it is today's work: the delivery day, a delivery that is
        // late, or a client who asked and has not been answered. A tap opens it on any day.
        const today = etToday();
        const day = route[0]?.delivery_date ?? null;
        const gal = route.reduce((a, o) => a + Math.round(o.gallons), 0);
        const asked = requests.filter((r) => r.status === "open").length;
        const itsDay = route.some((o) => o.delivery_date <= today) || asked > 0;
        return (
          // The fold's row is the title (ITS DAY, above); each order is a kit InfoRow (company → name,
          // "standing" → nameExtra, gallons → trailing, date/pay-status/total/address → meta). The
          // open/closed delivery-log block (jug-count stepper + its own action set) stays bespoke markup
          // inside meta rather than forcing it into lead/sub — same call DeliveryOps made for its own row
          // actions, just one level more involved here. "Delivered & swapped" is the one .btn-pri on this
          // screen (only one order can be open at a time via openId, so it's never rendered more than once
          // at once); a row's actions are compact (.btn-sm, 2026-10-09).
          <FoldCard label="Office orders" title="Office route" today={itsDay} id="due-office"
            sub={day ? `${dayWithDate(day)} · ${route.length} deliver${route.length === 1 ? "y" : "ies"}` : "Nothing on the route yet"}
            value={asked > 0 ? <span className="mpanel-warn">{asked} {asked === 1 ? "request" : "requests"}</span> : gal > 0 ? `${gal} gal` : null}>
            {/* Generate keeps its one word, on the right: at 390px a long button pushed the title onto two
                lines and over itself (2026-10-07). The title and the count ride on the fold's row now. */}
            {standingN > 0 && (
              <div className="flex justify-end mb-2">
                <button type="button" className="btn-ter" onClick={gen} disabled={!!busyId} aria-label="Generate the schedule — the next six weeks of deliveries">{busyId === "gen" ? "…" : "↻ Generate"}</button>
              </div>
            )}
            {requests.length > 0 && (
              <div className="k-rows mb-3.5" aria-label="Client requests">
                {requests.map((r) => {
                  const on = r.order_id ? [...data.rows, ...later].find((o) => o.id === r.order_id) : null;
                  return (
                    <InfoRow key={r.id}
                      name={r.companies?.name ?? "A client"}
                      nameExtra={<span className="oo-badge">{requestLabel(r.kind)}</span>}
                      trailing={<span className="oo-n">{r.status === "in_progress" ? "taken" : "new"}</span>}
                      meta={<>
                        <div className="oo-addr whitespace-pre-line">{r.body}</div>
                        <div className="oo-meta"><span>Asked {new Date(r.created_at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}</span>{on && <><span className="oo-dot">·</span><span>the {dayLabel(on.delivery_date)} delivery</span></>}</div>
                        <div className="oo-acts">
                          {r.status === "open" && <button type="button" className="btn-sec btn-sm" onClick={() => answer(r, "in_progress")} disabled={busyId === r.id}>Take it</button>}
                          <button type="button" className="btn-sec btn-sm" onClick={() => answer(r, "done")} disabled={busyId === r.id}>Done</button>
                          <button type="button" className="btn-ter" onClick={() => answer(r, "declined")} disabled={busyId === r.id}>Decline</button>
                        </div>
                      </>}
                    />
                  );
                })}
              </div>
            )}
            {rows.length === 0 && later.length === 0 && <EmptyState title="No orders booked yet" sub="Generate the schedule above." />}
            {later.length > 0 && (
              <button type="button" className="btn-ter" onClick={() => setShowLater((v) => !v)} aria-expanded={showLater}>
                {showLater ? "Hide" : "Show"} the next weeks — {later.length} more deliver{later.length === 1 ? "y" : "ies"}, through {mondayLabel(later[later.length - 1].delivery_date)}
              </button>
            )}
            <div className="k-rows">
              {rows.map((o) => {
                const open = openId === o.id;
                // STATES IN WORDS (2026-10-11, the dispatch round): a stop the driver couldn't make said nothing here, and
                // one past its window read as one on time. The row carries its id, so Due next lands on it.
                const said = o.status === "issue" ? "not delivered" : officeLate(o, now) ? "late" : null;
                return (
                  <div key={o.id} id={dueAnchor("office", o.id)} tabIndex={-1} className="outline-none">
                    <InfoRow
                      name={o.company}
                      nameExtra={<>{o.standing && <span className="oo-badge">standing</span>}{o.status === "delivered" && <span className="oo-badge done">delivered</span>}</>}
                      trailing={<span className="oo-gal">{Math.round(o.gallons)} gal</span>}
                      meta={<>
                        <div className="oo-meta">
                          {said && <><span className="mpanel-warn">{said}</span><span className="oo-dot">·</span></>}
                          <span>{mondayLabel(o.delivery_date)} · {windowHours(o.delivery_window)}</span>
                          <span className="oo-dot">·</span>
                          <span className={`oo-pay p-${o.payment_status}`}>{o.payment_status === "paid" ? "paid" : o.payment_status === "invoiced" ? "invoiced" : o.billing_terms === "prepaid" ? "awaiting prepay" : "to invoice"}</span>
                          <span className="oo-dot">·</span>
                          <span>{money(o.total_cents)}</span>
                        </div>
                        <div className="oo-addr">{o.address_street}, {o.address_city} {o.address_zip}{o.contact_phone ? ` · ${o.contact_phone}` : ""}{o.access_instructions ? ` · ${o.access_instructions}` : ""}</div>
                        {clientChanges(o).length > 0 && <div className="oo-addr text-gold2">Client: {clientChanges(o).join(" · ")}</div>}

                        {!open ? (
                          <div className="oo-acts">
                            {o.status === "issue"
                              ? <button type="button" className="btn-sec btn-sm" onClick={() => reopen(o)} disabled={busyId === o.id}>Reopen</button>
                              : o.status !== "delivered" && <button type="button" className="btn-sec btn-sm" onClick={() => { setOpenId(o.id); setEmpties((e) => ({ ...e, [o.id]: Math.round(o.gallons) })); }}>Log delivery</button>}
                            {/* MONEY AFTER THE CUTOFF (0358). With six weeks on the route, a pay link or a net
                                invoice could be made weeks early: the invoice fell due before the delivery, and a
                                delivery with a link or an invoice stops following its program (a pause, new
                                gallons). So they wait until the delivery is decided — its cutoff, or delivered. */}
                            {canSettle && (o.payment_status === "pending" || o.payment_status === "failed") && (o.status === "delivered" || !o.cutoff_at || new Date(o.cutoff_at).getTime() <= Date.now()) && (
                              o.billing_terms === "prepaid"
                                ? <>
                                    <button type="button" className="btn-sec btn-sm" onClick={() => payLink(o)} disabled={busyId === o.id}>Payment link</button>
                                    <button type="button" className="btn-ter" onClick={() => setPay(o, "paid")} disabled={busyId === o.id}>Mark paid</button>
                                  </>
                                : <button type="button" className="btn-sec btn-sm" onClick={() => setPay(o, "invoiced")} disabled={busyId === o.id}>Invoice</button>
                            )}
                            {o.status !== "delivered" && <button type="button" className="btn-ter" onClick={() => cancel(o)} disabled={busyId === o.id}>Cancel</button>}
                            {/* A wrong empties count landed in two places — the ledger row AND the
                                account's container balance — and could be corrected in neither.
                                Voiding puts both back (0309/0310). Only a delivery has a swap. */}
                            {o.status === "delivered" && <button type="button" className="btn-ter" onClick={() => voidSwap(o)} disabled={busyId === o.id}>Undo jug swap</button>}
                          </div>
                        ) : (
                          <div className="oo-log">
                            <div className="oo-jug">
                              <span className="oo-jug-l">Empty jugs collected</span>
                              <div className="oo-step">
                                <button type="button" className="min-h-11 min-w-11" onClick={() => setEmpties((e) => ({ ...e, [o.id]: Math.max(0, (e[o.id] ?? Math.round(o.gallons)) - 1) }))} aria-label="Fewer">−</button>
                                <span className="oo-jug-v">{empties[o.id] ?? Math.round(o.gallons)}</span>
                                <button type="button" className="min-h-11 min-w-11" onClick={() => setEmpties((e) => ({ ...e, [o.id]: (e[o.id] ?? Math.round(o.gallons)) + 1 }))} aria-label="More">+</button>
                              </div>
                            </div>
                            <button type="button" className="btn-pri btn-wide" onClick={() => deliver(o, true)} disabled={busyId === o.id}><Icon name="check" /> Delivered &amp; swapped</button>
                            <button type="button" className="btn-sec" onClick={() => deliver(o, false)} disabled={busyId === o.id}>Delivered — no empties</button>
                            <button type="button" className="btn-ter" onClick={() => setOpenId(null)}>Back</button>
                          </div>
                        )}
                      </>}
                    />
                  </div>
                );
              })}
            </div>
          </FoldCard>
        );
      }}
    </AsyncSection>
  );
}
