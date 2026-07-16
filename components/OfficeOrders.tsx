"use client";

import { useCallback, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";
import { mondayLabel, nextMondayKey } from "@/lib/office";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import EmptyState from "./EmptyState";
import { SectionHeader, InfoRow } from "@/components/kit";
import Icon from "@/components/Icon";

// CREW · OFFICE ORDERS — the operator's control surface for the Monday B2B route (0187). See upcoming
// office deliveries, log the jug swap (full out / empties in) on delivery, and settle billing
// (prepaid → paid · net terms → invoiced). Same Pit-Wall language as the rest of crew. On a swap it
// writes the jug_ledger + bumps the account's jug balance so the container count stays truthful.
// Fetch state via useAsyncData. The section still self-hides (renders nothing) while loading and when
// there's truly no office program yet (no standing accounts, no orders) — same as before. What's fixed:
// a fetch error used to collapse into that exact same "nothing" state, indistinguishable from a quiet
// week; now it surfaces as a real error instead of vanishing.
type BOrder = {
  id: string; business_id: string | null; company: string; contact_phone: string | null;
  address_street: string; address_city: string; address_zip: string; access_instructions: string | null;
  delivery_date: string; gallons: number; total_cents: number; billing_terms: string;
  payment_status: string; status: string; jugs_out: number; jugs_in: number | null; standing: boolean;
};
type Board = { rows: BOrder[]; standingN: number };
const dollars = (c: number) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;

export default function OfficeOrders() {
  const { toast } = useApp();
  const [openId, setOpenId] = useState<string | null>(null);
  const [empties, setEmpties] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const loader = useCallback(async (): Promise<Board> => {
    if (!supabase) return { rows: [], standingN: 0 };
    const [ord, acct] = await Promise.all([
      supabase.from("business_orders").select("*").is("canceled_at", null).neq("status", "delivered").order("delivery_date").limit(100),
      supabase.from("business_accounts").select("id", { count: "exact", head: true }).eq("standing_active", true),
    ]);
    if (ord.error) throw new Error(ord.error.message);
    if (acct.error) throw new Error(acct.error.message);
    return { rows: (ord.data as BOrder[]) ?? [], standingN: acct.count ?? 0 };
  }, []);
  const board = useAsyncData(loader, []);
  const { reload } = board;

  // Generate the next Monday's route from every standing account (idempotent RPC, 0188).
  const gen = async () => {
    if (!supabase || busyId) return; setBusyId("gen");
    const dk = nextMondayKey();
    const { data, error } = await supabase.rpc("generate_office_route", { p_date: dk });
    setBusyId(null);
    toast(error ? "Couldn't generate the route" : `${data ?? 0} standing order${(data ?? 0) === 1 ? "" : "s"} added for ${mondayLabel(dk)}`, error ? "error" : undefined);
    reload();
  };

  const bumpJugs = async (o: BOrder, jugsIn: number) => {
    if (!o.business_id) return; // one-off order, no standing account to track a balance for
    const { data: acct } = await supabase!.from("business_accounts").select("jug_balance").eq("id", o.business_id).single();
    const bal = Math.max(0, (acct?.jug_balance ?? 0) + Math.round(o.gallons) - jugsIn); // +full out, −empties in
    await supabase!.from("jug_ledger").insert({ business_id: o.business_id, business_order_id: o.id, jugs_out: Math.round(o.gallons), jugs_in: jugsIn, balance_after: bal });
    await supabase!.from("business_accounts").update({ jug_balance: bal }).eq("id", o.business_id);
  };

  const deliver = async (o: BOrder, swapped: boolean) => {
    if (!supabase || busyId) return; setBusyId(o.id);
    const jugsIn = swapped ? Math.max(0, empties[o.id] ?? Math.round(o.gallons)) : 0;
    const { error } = await supabase.from("business_orders").update({
      status: "delivered", driver_outcome: swapped ? "delivered_swapped" : "delivered_no_swap",
      jugs_out: Math.round(o.gallons), jugs_in: jugsIn,
    }).eq("id", o.id);
    if (error) { toast("Didn't save — try again", "error"); setBusyId(null); return; }
    await bumpJugs(o, jugsIn);
    setBusyId(null); setOpenId(null); toast(`${o.company} — delivered`); reload();
  };

  const setPay = async (o: BOrder, status: "paid" | "invoiced") => {
    if (!supabase || busyId) return; setBusyId(o.id);
    const { error } = await supabase.from("business_orders").update({ payment_status: status }).eq("id", o.id);
    if (status === "invoiced" && !error && o.business_id) {
      await supabase.from("invoices").insert({ business_id: o.business_id, business_order_id: o.id, amount_cents: o.total_cents, terms: o.billing_terms === "net30" ? "net30" : "net15", status: "open" });
    }
    setBusyId(null); toast(error ? "Didn't save" : status === "paid" ? "Marked paid" : "Invoice queued", error ? "error" : undefined); reload();
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
  if (board.status === "ready" && board.data && board.data.rows.length === 0 && board.data.standingN === 0) return null; // no office program at all yet — same self-hide as before

  return (
    <AsyncSection state={board} isEmpty={() => false} errorTitle="Couldn't load the office route" emptyTitle="No office activity yet">
      {(data) => {
        const { rows, standingN } = data;
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
            <SectionHeader
              label="Office route"
              right={<>
                {standingN > 0 && <button type="button" className="oo-gen" onClick={gen} disabled={!!busyId}>{busyId === "gen" ? "…" : `↻ Generate · ${mondayLabel(nextMondayKey())}`}</button>}
                <span className="oo-n">{rows.length} order{rows.length === 1 ? "" : "s"}</span>
              </>}
            />
            {rows.length === 0 && <EmptyState title="No orders booked yet" sub="Generate this week's standing route above." />}
            <div className="k-rows">
              {rows.map((o) => {
                const open = openId === o.id;
                return (
                  <div key={o.id}>
                    <InfoRow
                      name={o.company}
                      nameExtra={o.standing && <span className="oo-badge">standing</span>}
                      trailing={<span className="oo-gal">{Math.round(o.gallons)} gal</span>}
                      meta={<>
                        <div className="oo-meta">
                          <span>{mondayLabel(o.delivery_date)} · 5–8 AM</span>
                          <span className="oo-dot">·</span>
                          <span className={`oo-pay p-${o.payment_status}`}>{o.payment_status === "paid" ? "paid" : o.payment_status === "invoiced" ? "invoiced" : o.billing_terms === "prepaid" ? "awaiting prepay" : "to invoice"}</span>
                          <span className="oo-dot">·</span>
                          <span>{dollars(o.total_cents)}</span>
                        </div>
                        <div className="oo-addr">{o.address_street}, {o.address_city} {o.address_zip}{o.contact_phone ? ` · ${o.contact_phone}` : ""}{o.access_instructions ? ` · ${o.access_instructions}` : ""}</div>

                        {!open ? (
                          <div className="oo-acts">
                            <button type="button" className="btn-sec" onClick={() => { setOpenId(o.id); setEmpties((e) => ({ ...e, [o.id]: Math.round(o.gallons) })); }}>Log delivery</button>
                            {o.payment_status !== "paid" && o.payment_status !== "invoiced" && (
                              o.billing_terms === "prepaid"
                                ? <>
                                    <button type="button" className="btn-sec" onClick={() => payLink(o)} disabled={busyId === o.id}>Payment link</button>
                                    <button type="button" className="btn-ter" onClick={() => setPay(o, "paid")} disabled={busyId === o.id}>Mark paid</button>
                                  </>
                                : <button type="button" className="btn-sec" onClick={() => setPay(o, "invoiced")} disabled={busyId === o.id}>Invoice</button>
                            )}
                            <button type="button" className="btn-ter" onClick={() => cancel(o)} disabled={busyId === o.id}>Cancel</button>
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
