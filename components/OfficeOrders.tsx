"use client";

import { useCallback, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";
import { mondayLabel, nextMondayKey, windowHours } from "@/lib/office";
import { isMissingFunction, isMissingTable } from "@/lib/schemaSkew";
import { dayLabel } from "@/lib/officeStatus";
import { clientChanges, requestLabel } from "@/lib/officeChange";
import { haptic } from "@/lib/haptics";
import { addDays, etToday } from "@/lib/dates";
import { useAsyncData } from "@/lib/useAsyncData";
import { useRealtimeTable } from "@/lib/realtime";
import AsyncSection from "./AsyncSection";
import EmptyState from "./EmptyState";
import { SectionHeader, InfoRow } from "@/components/kit";
import Icon from "@/components/Icon";
import { money } from "@/lib/money";
import { usePrompt } from "@/components/PromptSheet";

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
};
// What a client asked GT3 for (0359's company_requests): the crew's to answer, here beside the route.
type Req = { id: string; kind: string; body: string; status: string; order_id: string | null; created_at: string; companies: { name: string } | null };
type Board = { rows: BOrder[]; later: BOrder[]; standingN: number; requests: Req[] };

export default function OfficeOrders() {
  const prompt = usePrompt();
  const { toast } = useApp();
  const [openId, setOpenId] = useState<string | null>(null);
  const [empties, setEmpties] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showLater, setShowLater] = useState(false);

  const loader = useCallback(async (): Promise<Board> => {
    if (!supabase) return { rows: [], later: [], standingN: 0, requests: [] };
    const weekAgo = addDays(etToday(), -7);
    const [ord, acct, reqs] = await Promise.all([
      supabase.from("business_orders").select("*").is("canceled_at", null)
        .or(`status.neq.delivered,payment_status.in.(pending,failed),delivery_date.gte.${weekAgo}`)
        .order("delivery_date").limit(400),
      supabase.from("business_accounts").select("id", { count: "exact", head: true }).eq("standing_active", true),
      // arrives-with: 0359 — until it is pasted the table isn't there (PGRST205): isMissingTable below reads
      // that as nothing asked yet, and the route loads as it did; it is its own request, so it fails alone.
      supabase.from("company_requests").select("id, kind, body, status, order_id, created_at, companies(name)")
        .in("status", ["open", "in_progress"]).order("created_at").limit(50),
    ]);
    if (ord.error) throw new Error(ord.error.message);
    if (acct.error) throw new Error(acct.error.message);
    // Before 0359 the requests table isn't there: nothing asked yet, not a broken route.
    if (reqs.error && !isMissingTable(reqs.error)) throw new Error(reqs.error.message);
    const requests = reqs.error ? [] : ((reqs.data as unknown as Req[]) ?? []);
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
    return { rows: [...route, ...done], later, standingN: acct.count ?? 0, requests };
  }, []);
  const board = useAsyncData(loader, []);
  const { reload } = board;
  // The driver logs from the run (components/OfficeRun); this route hears it live (business_orders joins
  // the realtime publication in 0357 — before that the subscription simply receives nothing).
  useRealtimeTable("business_orders", reload);
  useRealtimeTable("company_requests", reload);

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
    if (error) { toast(error.message, "error"); return; }
    haptic("success");
    toast(status === "in_progress" ? `${who} — it's yours` : status === "done" ? `${who} — done, and they can see it` : `${who} — declined, with your reason`);
    reload();
  };

  // THE SCHEDULE, FROM THE PROGRAMS (2026-10-07, 0356; six weeks from 0358). generate_office_deliveries
  // makes every active program's deliveries for the next six weeks, each in its market's own time, once
  // each, and logs the run — what the schedule now does by itself every night. This made one Monday, picked by the
  // phone's clock, so on a Sunday evening the phone and the server could pick different weeks. Until
  // 0356 is pasted the function isn't there and the old one-Monday call stands.
  const gen = async () => {
    if (!supabase || busyId) return; setBusyId("gen");
    let res = await supabase.rpc("generate_office_deliveries");
    let made = "for the next six weeks";
    if (res.error && isMissingFunction(res.error)) {
      const dk = nextMondayKey(); made = `for ${mondayLabel(dk)}`;
      res = await supabase.rpc("generate_office_route", { p_date: dk });
    }
    setBusyId(null);
    const n = (res.data as number | null) ?? 0;
    toast(res.error ? "Couldn't generate the route" : n ? `${n} office deliver${n === 1 ? "y" : "ies"} made ${made}` : `Nothing new — every delivery ${made} is already on the route`, res.error ? "error" : undefined);
    reload();
  };

  const bumpJugs = async (o: BOrder, jugsIn: number) => {
    if (!o.business_id) return; // one-off order, no standing account to track a balance for
    const { data: acct } = await supabase!.from("business_accounts").select("jug_balance").eq("id", o.business_id).single();
    const bal = Math.max(0, (acct?.jug_balance ?? 0) + Math.round(o.gallons) - jugsIn); // +full out, −empties in
    await supabase!.from("jug_ledger").insert({ business_id: o.business_id, business_order_id: o.id, jugs_out: Math.round(o.gallons), jugs_in: jugsIn, balance_after: bal });
    await supabase!.from("business_accounts").update({ jug_balance: bal }).eq("id", o.business_id);
  };

  // UNDOING A SWAP. bumpJugs writes a jug_ledger row and moves business_accounts.jug_balance, so a
  // miscount is wrong in two places at once. void_jug_entry reverses both in one transaction and
  // keeps the row as the record — and it clamps at zero exactly where bumpJugs does, which is the
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
    if (error) { toast(error.message, "error"); return; }
    toast(`${o.company} — jug swap undone, balance corrected`);
    reload();
  };

  // ONE WRITE (2026-10-07, 0357). office_log_delivery records the outcome, the jugs, the ledger row and
  // the balance together with the order locked — the driver's run (components/OfficeRun) uses the same
  // door, so two phones cannot count one swap twice; these were three writes from the browser. Until
  // 0357 is pasted the function isn't there and the old writes below stand.
  const deliver = async (o: BOrder, swapped: boolean) => {
    if (!supabase || busyId) return; setBusyId(o.id);
    const jugsIn = swapped ? Math.max(0, empties[o.id] ?? Math.round(o.gallons)) : 0;
    const one = await supabase.rpc("office_log_delivery", { p_order: o.id, p_outcome: swapped ? "delivered_swapped" : "delivered_no_swap", p_jugs_in: swapped ? jugsIn : null });
    if (one.error && !isMissingFunction(one.error)) { toast(one.error.message, "error"); setBusyId(null); reload(); return; }
    if (one.error) {
      const { error } = await supabase.from("business_orders").update({
        status: "delivered", driver_outcome: swapped ? "delivered_swapped" : "delivered_no_swap",
        jugs_out: Math.round(o.gallons), jugs_in: jugsIn,
      }).eq("id", o.id);
      if (error) { toast("Didn't save — try again", "error"); setBusyId(null); return; }
      await bumpJugs(o, jugsIn);
    }
    setBusyId(null); setOpenId(null); toast(`${o.company} — delivered`); reload();
  };

  // Settling an office order. The status moves only from a state that still owes, so a second tap —
  // or a second phone — finds nothing to move instead of making a second invoice. The invoice write
  // is checked: it used to be fired and forgotten, so a refused insert left the order saying
  // "invoiced" with no invoice behind it, owed by nobody. Its due date comes from the terms in the
  // database (0341), which is what puts it under Needs you when it falls due.
  const setPay = async (o: BOrder, status: "paid" | "invoiced") => {
    if (!supabase || busyId) return; setBusyId(o.id);
    const { data: moved, error } = await supabase.from("business_orders").update({ payment_status: status })
      .eq("id", o.id).in("payment_status", ["pending", "failed"]).select("id");
    if (error || !moved?.length) {
      setBusyId(null);
      toast(error ? `Didn't save — ${error.message}` : `${o.company} was already ${o.payment_status === "paid" ? "paid" : "settled"}`, error ? "error" : undefined);
      reload(); return;
    }
    if (status === "invoiced") {
      const { error: invErr } = await supabase.from("invoices").insert({ business_id: o.business_id, business_order_id: o.id, amount_cents: o.total_cents, terms: o.billing_terms === "net30" ? "net30" : "net15", status: "open" });
      if (invErr) {
        await supabase.from("business_orders").update({ payment_status: o.payment_status }).eq("id", o.id).eq("payment_status", "invoiced");
        setBusyId(null); toast(`Couldn't make the invoice — ${invErr.message}`, "error"); reload(); return;
      }
    }
    setBusyId(null);
    toast(status === "paid" ? `${o.company} — marked paid` : `${o.company} — invoiced, ${o.billing_terms === "net30" ? "due in 30 days" : "due in 15 days"}`);
    reload();
  };

  // The app creates the Square payment link itself (0221) — one tap, link on the clipboard, and when
  // the customer pays, the webhook auto-marks the order paid. No more hand-texted links + hand-marking.
  const payLink = async (o: BOrder) => {
    if (busyId) return; setBusyId(o.id);
    try {
      const r = await authedFetch("/api/office/paylink", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: o.id }) });
      const j = await r.json();
      if (!j.ok || !j.url) { toast(`Couldn't create the link — ${j.error ?? "try again"}`, "error"); setBusyId(null); return; }
      try { await navigator.clipboard.writeText(j.url); toast("Payment link copied — text it to the customer. It auto-marks paid."); }
      catch { toast(`Payment link ready: ${j.url}`); }
    } catch { toast("Couldn't create the link — try again", "error"); }
    setBusyId(null);
  };

  const cancel = async (o: BOrder) => {
    if (!supabase || busyId) return; setBusyId(o.id);
    await supabase.from("business_orders").update({ canceled_at: new Date().toISOString(), status: "issue" }).eq("id", o.id);
    setBusyId(null); toast(`${o.company} — canceled`); reload();
  };

  if (board.status === "loading") return null; // quiet during initial load, same as the original gate
  if (board.status === "ready" && board.data && board.data.rows.length === 0 && board.data.standingN === 0 && board.data.requests.length === 0) return null; // no office program at all yet — same self-hide as before

  return (
    <AsyncSection state={board} isEmpty={() => false} errorTitle="Couldn't load the office route" emptyTitle="No office activity yet">
      {(data) => {
        const { standingN, later, requests } = data;
        const route = data.rows.filter((o) => o.status !== "delivered");
        const rows = showLater ? [...route, ...later, ...data.rows.filter((o) => o.status === "delivered")] : data.rows;
        return (
          // Kit SectionHeader replaces the ad-hoc .oo-h/.oo-k title row; each order is now a kit
          // InfoRow (company → name, "standing" → nameExtra, gallons → trailing, date/pay-status/
          // total/address → meta). The open/closed delivery-log block (jug-count stepper + its own
          // action set) stays bespoke markup inside meta rather than forcing it into lead/sub —
          // same call DeliveryOps made for its own row actions, just one level more involved here.
          // Action buttons now use .btn-pri/.btn-sec/.btn-ter: "Delivered & swapped" is the one
          // .btn-pri on this screen (only one order can be open at a time via openId, so it's never
          // rendered more than once at once). .oo-gen (route-generate) and the order count aren't
          // .adm-btn/.adm-act, so they keep their own look, now inside SectionHeader's `right` slot.
          // No data fetching, state, handlers, or conditions below changed — presentation only.
          <section className="oo" aria-label="Office orders" style={{ padding: "0 14px 14px" }}>
            {/* The count rides with the title and the button says one word: at 390px the long button
                pushed the title onto two lines and over itself (2026-10-07). */}
            <SectionHeader
              label="Office route"
              annotation={`${route.length} on the route`}
              right={standingN > 0 ? <button type="button" className="oo-gen" onClick={gen} disabled={!!busyId} aria-label="Generate the schedule — the next six weeks of deliveries">{busyId === "gen" ? "…" : "↻ Generate"}</button> : undefined}
            />
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
                          {r.status === "open" && <button type="button" className="btn-sec" onClick={() => answer(r, "in_progress")} disabled={busyId === r.id}>Take it</button>}
                          <button type="button" className="btn-sec" onClick={() => answer(r, "done")} disabled={busyId === r.id}>Done</button>
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
                return (
                  <div key={o.id}>
                    <InfoRow
                      name={o.company}
                      nameExtra={<>{o.standing && <span className="oo-badge">standing</span>}{o.status === "delivered" && <span className="oo-badge done">delivered</span>}</>}
                      trailing={<span className="oo-gal">{Math.round(o.gallons)} gal</span>}
                      meta={<>
                        <div className="oo-meta">
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
                            {o.status !== "delivered" && <button type="button" className="btn-sec" onClick={() => { setOpenId(o.id); setEmpties((e) => ({ ...e, [o.id]: Math.round(o.gallons) })); }}>Log delivery</button>}
                            {/* MONEY AFTER THE CUTOFF (0358). With six weeks on the route, a pay link or a net
                                invoice could be made weeks early: the invoice fell due before the delivery, and a
                                delivery with a link or an invoice stops following its program (a pause, new
                                gallons). So they wait until the delivery is decided — its cutoff, or delivered. */}
                            {(o.payment_status === "pending" || o.payment_status === "failed") && (o.status === "delivered" || !o.cutoff_at || new Date(o.cutoff_at).getTime() <= Date.now()) && (
                              o.billing_terms === "prepaid"
                                ? <>
                                    <button type="button" className="btn-sec" onClick={() => payLink(o)} disabled={busyId === o.id}>Payment link</button>
                                    <button type="button" className="btn-ter" onClick={() => setPay(o, "paid")} disabled={busyId === o.id}>Mark paid</button>
                                  </>
                                : <button type="button" className="btn-sec" onClick={() => setPay(o, "invoiced")} disabled={busyId === o.id}>Invoice</button>
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
                                <button type="button" onClick={() => setEmpties((e) => ({ ...e, [o.id]: Math.max(0, (e[o.id] ?? Math.round(o.gallons)) - 1) }))} aria-label="Fewer">−</button>
                                <span className="oo-jug-v">{empties[o.id] ?? Math.round(o.gallons)}</span>
                                <button type="button" onClick={() => setEmpties((e) => ({ ...e, [o.id]: (e[o.id] ?? Math.round(o.gallons)) + 1 }))} aria-label="More">+</button>
                              </div>
                            </div>
                            <button type="button" className="btn-pri" onClick={() => deliver(o, true)} disabled={busyId === o.id}><Icon name="check" /> Delivered &amp; swapped</button>
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
          </section>
        );
      }}
    </AsyncSection>
  );
}
