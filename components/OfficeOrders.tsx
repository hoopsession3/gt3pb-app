"use client";

import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { supabase } from "@/lib/supabase";
import { mondayLabel, nextMondayKey } from "@/lib/office";

// CREW · OFFICE ORDERS — the operator's control surface for the Monday B2B route (0187). See upcoming
// office deliveries, log the jug swap (full out / empties in) on delivery, and settle billing
// (prepaid → paid · net terms → invoiced). Same Pit-Wall language as the rest of crew. On a swap it
// writes the jug_ledger + bumps the account's jug balance so the container count stays truthful.
type BOrder = {
  id: string; business_id: string | null; company: string; contact_phone: string | null;
  address_street: string; address_city: string; address_zip: string; access_instructions: string | null;
  delivery_date: string; gallons: number; total_cents: number; billing_terms: string;
  payment_status: string; status: string; jugs_out: number; jugs_in: number | null; standing: boolean;
};
const dollars = (c: number) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;

export default function OfficeOrders() {
  const { toast } = useApp();
  const [rows, setRows] = useState<BOrder[]>([]);
  const [standingN, setStandingN] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [empties, setEmpties] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [ord, acct] = await Promise.all([
      supabase.from("business_orders").select("*").is("canceled_at", null).neq("status", "delivered").order("delivery_date").limit(100),
      supabase.from("business_accounts").select("id", { count: "exact", head: true }).eq("standing_active", true),
    ]);
    setRows((ord.data as BOrder[]) ?? []);
    setStandingN(acct.count ?? 0);
    setLoaded(true);
  }, []);

  // Generate the next Monday's route from every standing account (idempotent RPC, 0188).
  const gen = async () => {
    if (!supabase || busyId) return; setBusyId("gen");
    const dk = nextMondayKey();
    const { data, error } = await supabase.rpc("generate_office_route", { p_date: dk });
    setBusyId(null);
    toast(error ? "Couldn't generate the route" : `${data ?? 0} standing order${(data ?? 0) === 1 ? "" : "s"} added for ${mondayLabel(dk)}`, error ? "error" : undefined);
    load();
  };
  useEffect(() => { load(); }, [load]);

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
    setBusyId(null); setOpenId(null); toast(`${o.company} — delivered`); load();
  };

  const setPay = async (o: BOrder, status: "paid" | "invoiced") => {
    if (!supabase || busyId) return; setBusyId(o.id);
    const { error } = await supabase.from("business_orders").update({ payment_status: status }).eq("id", o.id);
    if (status === "invoiced" && !error && o.business_id) {
      await supabase.from("invoices").insert({ business_id: o.business_id, business_order_id: o.id, amount_cents: o.total_cents, terms: o.billing_terms === "net30" ? "net30" : "net15", status: "open" });
    }
    setBusyId(null); toast(error ? "Didn't save" : status === "paid" ? "Marked paid" : "Invoice queued", error ? "error" : undefined); load();
  };

  const cancel = async (o: BOrder) => {
    if (!supabase || busyId) return; setBusyId(o.id);
    await supabase.from("business_orders").update({ canceled_at: new Date().toISOString(), status: "issue" }).eq("id", o.id);
    setBusyId(null); toast(`${o.company} — canceled`); load();
  };

  if (!loaded) return null;
  if (rows.length === 0 && standingN === 0) return null; // self-hides when there's no office activity at all

  return (
    <section className="oo" aria-label="Office orders">
      <div className="oo-h">
        <span className="oo-k">Office route</span>
        <span className="oo-h-r">
          {standingN > 0 && <button type="button" className="oo-gen" onClick={gen} disabled={!!busyId}>{busyId === "gen" ? "…" : `↻ Generate · ${mondayLabel(nextMondayKey())}`}</button>}
          <span className="oo-n">{rows.length} order{rows.length === 1 ? "" : "s"}</span>
        </span>
      </div>
      {rows.length === 0 && <div className="oo-empty">No orders booked yet — generate this week&rsquo;s standing route above.</div>}
      {rows.map((o) => {
        const open = openId === o.id;
        return (
          <div key={o.id} className={`oo-row${o.standing ? " standing" : ""}`}>
            <div className="oo-top">
              <div className="oo-co"><b>{o.company}</b>{o.standing && <span className="oo-badge">standing</span>}</div>
              <div className="oo-gal">{Math.round(o.gallons)} gal</div>
            </div>
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
                <button type="button" className="adm-btn primary" onClick={() => { setOpenId(o.id); setEmpties((e) => ({ ...e, [o.id]: Math.round(o.gallons) })); }}>Log delivery</button>
                {o.payment_status !== "paid" && o.payment_status !== "invoiced" && (
                  o.billing_terms === "prepaid"
                    ? <button type="button" className="adm-btn" onClick={() => setPay(o, "paid")} disabled={busyId === o.id}>Mark paid</button>
                    : <button type="button" className="adm-btn" onClick={() => setPay(o, "invoiced")} disabled={busyId === o.id}>Invoice</button>
                )}
                <button type="button" className="adm-btn ghost" onClick={() => cancel(o)} disabled={busyId === o.id}>Cancel</button>
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
                <button type="button" className="adm-act go" onClick={() => deliver(o, true)} disabled={busyId === o.id}>✓ Delivered &amp; swapped</button>
                <button type="button" className="adm-btn" onClick={() => deliver(o, false)} disabled={busyId === o.id}>Delivered — no empties</button>
                <button type="button" className="adm-btn ghost" onClick={() => setOpenId(null)}>Back</button>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
