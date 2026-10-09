"use client";

import { useEffect, useState } from "react";
import { SectionHeader } from "@/components/kit";
import { fetchSalesReport, type SalesReport } from "@/lib/reports";
import { moneyRound } from "@/lib/money";
import { supabase } from "@/lib/supabase";
import { Segmented } from "@/components/controls";

// Sales actuals — the first reporting dashboard (MONEY tab). Real revenue + per-event actuals +
// product mix + daily trend, read from one staff-gated RPC. On-brand bars, no chart dependency.

const DRINKS: Record<string, string> = { rise: "RISE", flow: "FLOW", dusk: "DUSK", tide: "TIDE", forge: "FORGE", hunt: "HUNT", wild: "WILD" };
const label = (k: string) => DRINKS[k] || (k || "—").toUpperCase();
const usd2 = (cents: number) => "$" + ((cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const RANGES = [7, 30, 90];

export default function Reports() {
  const [days, setDays] = useState(30);
  const [rep, setRep] = useState<SalesReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    fetchSalesReport(days).then((r) => { if (live) { setRep(r); setLoading(false); } });
    return () => { live = false; };
  }, [days]);

  // CASH AT THE WINDOW (2026-10-04, 0341). It is inside the revenue above — cash sets paid — and
  // said on its own because it is the one part of that number in a till rather than a bank: the
  // count to check the drawer against. Same window and same exclusions as report_sales. Its own
  // read, apart from the report's: the column arrives with 0341, and until then the filter is
  // refused and the line is simply not drawn — never a zero that looks like a count.
  const [cash, setCash] = useState<{ cents: number; n: number } | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      if (!supabase) return;
      const since = `${new Date(Date.now() - (Math.max(days, 1) - 1) * 864e5).toISOString().slice(0, 10)}T00:00:00Z`;
      // arrives-with: 0341
      const [o, p] = await Promise.all([
        supabase.from("orders").select("total_cents").eq("collected_via", "cash").neq("status", "void").gte("created_at", since),
        supabase.from("drop_orders").select("total_cents").eq("collected_via", "cash").is("canceled_at", null).gte("created_at", since),
      ]);
      if (!live) return;
      if (o.error || p.error) { setCash(null); return; }
      const got = [...((o.data ?? []) as { total_cents: number }[]), ...((p.data ?? []) as { total_cents: number }[])];
      setCash({ cents: got.reduce((a, r) => a + (r.total_cents || 0), 0), n: got.length });
    })();
    return () => { live = false; };
  }, [days]);

  const rev = rep?.revenue_cents ?? 0;
  const orders = rep?.order_count ?? 0;
  const aov = orders > 0 ? rev / orders : 0;
  const cogs = rep?.cogs_pct ?? 0.3;
  const margin = Math.round(rev * (1 - cogs));
  const evMax = Math.max(1, ...(rep?.by_event ?? []).map((e) => e.cents));
  const prMax = Math.max(1, ...(rep?.by_product ?? []).map((p) => p.n));
  const dayMax = Math.max(1, ...(rep?.by_day ?? []).map((d) => d.cents));
  const empty = !loading && rev === 0 && orders === 0 && (rep?.by_event?.length ?? 0) === 0;

  return (
    <div className="adm-sec rpt">
      <SectionHeader label="Sales" annotation="the number" right={
        <Segmented label="Range" kind="choice" size="sm" value={String(days)} onChange={(k) => setDays(Number(k))}
          options={RANGES.map((d) => ({ key: String(d), label: `${d}d`, title: `The last ${d} days` }))} />
      } />

      {loading && !rep ? (
        <div className="rpt-hint">Loading…</div>
      ) : (
        <>
          {empty ? (
            <div className="rpt-hint">No sales recorded in the last {days} days. This fills in as orders come through.</div>
          ) : (
            <>
            {/* revenue is the hero; the rest is one quiet line (zero-tiles never render) */}
            <div className="rpt-hero"><b>{moneyRound(rev)}</b><span>revenue · {days}d</span></div>
            <p className="rpt-line">{orders.toLocaleString()} orders · {usd2(aov)} avg · est. margin {moneyRound(margin)} at {Math.round((1 - cogs) * 100)}%</p>
            {cash && cash.cents > 0 && <p className="rpt-line">{usd2(cash.cents)} of it cash at the window · {cash.n} pre-order{cash.n === 1 ? "" : "s"}</p>}
            <>
              {(rep?.by_event?.length ?? 0) > 0 && (
                <div className="rpt-block">
                  <div className="rpt-bh">Revenue by event</div>
                  {rep!.by_event.map((e, i) => (
                    <div key={i} className="rpt-bar">
                      <div className="rpt-bar-l"><span>{e.event}</span><b>{moneyRound(e.cents)}</b></div>
                      <div className="rpt-track"><div className="rpt-fill" style={{ width: `${Math.max(3, (e.cents / evMax) * 100)}%` }} /></div>
                    </div>
                  ))}
                </div>
              )}

              {(rep?.by_product?.length ?? 0) > 0 && (
                <div className="rpt-block">
                  <div className="rpt-bh">Product mix · units</div>
                  {rep!.by_product.map((p, i) => (
                    <div key={i} className="rpt-bar">
                      <div className="rpt-bar-l"><span>{label(p.key)}</span><b>{p.n.toLocaleString()}</b></div>
                      <div className="rpt-track"><div className="rpt-fill alt" style={{ width: `${Math.max(3, (p.n / prMax) * 100)}%` }} /></div>
                    </div>
                  ))}
                </div>
              )}

              {(rep?.by_day?.length ?? 0) > 0 && (
                <div className="rpt-block">
                  <div className="rpt-bh">Daily revenue</div>
                  <div className="rpt-spark">
                    {rep!.by_day.map((d, i) => (
                      <div key={i} className="rpt-col" title={`${d.day}: ${moneyRound(d.cents)}`}>
                        <div className="rpt-colbar" style={{ height: `${Math.max(2, (d.cents / dayMax) * 100)}%` }} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
            </>
          )}
          <div className="rpt-foot">Live from orders + Square. Margin = revenue × (1 − blended COGS {Math.round(cogs * 100)}%); set exact costs in Product economics.</div>
        </>
      )}
    </div>
  );
}
