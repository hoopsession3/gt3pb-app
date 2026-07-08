"use client";

import { useEffect, useState } from "react";
import { fetchSalesReport, type SalesReport } from "@/lib/reports";

// Sales actuals — the first reporting dashboard (MONEY tab). Real revenue + per-event actuals +
// product mix + daily trend, read from one staff-gated RPC. On-brand bars, no chart dependency.

const DRINKS: Record<string, string> = { rise: "RISE", flow: "FLOW", dusk: "DUSK", tide: "TIDE", forge: "FORGE", hunt: "HUNT", wild: "WILD" };
const label = (k: string) => DRINKS[k] || (k || "—").toUpperCase();
const usd = (cents: number) => "$" + Math.round((cents || 0) / 100).toLocaleString();
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
      <div className="rpt-head">
        <div className="sec">Sales</div>
        <div className="rpt-range">
          {RANGES.map((d) => (
            <button key={d} className={`rpt-r${days === d ? " on" : ""}`} onClick={() => setDays(d)}>{d}d</button>
          ))}
        </div>
      </div>

      {loading && !rep ? (
        <div className="rpt-hint">Loading…</div>
      ) : (
        <>
          {empty ? (
            <div className="rpt-hint">No sales recorded in the last {days} days. This fills in as orders come through.</div>
          ) : (
            <>
            {/* revenue is the hero; the rest is one quiet line (zero-tiles never render) */}
            <div className="rpt-hero"><b>{usd(rev)}</b><span>revenue · {days}d</span></div>
            <p className="rpt-line">{orders.toLocaleString()} orders · {usd2(aov)} avg · est. margin {usd(margin)} at {Math.round((1 - cogs) * 100)}%</p>
            <>
              {(rep?.by_event?.length ?? 0) > 0 && (
                <div className="rpt-block">
                  <div className="rpt-bh">Revenue by event</div>
                  {rep!.by_event.map((e, i) => (
                    <div key={i} className="rpt-bar">
                      <div className="rpt-bar-l"><span>{e.event}</span><b>{usd(e.cents)}</b></div>
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
                      <div key={i} className="rpt-col" title={`${d.day}: ${usd(d.cents)}`}>
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
