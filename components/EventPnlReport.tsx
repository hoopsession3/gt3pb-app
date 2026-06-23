"use client";

import { useEffect, useState } from "react";
import { fetchEventPnl, type EventPnlRow } from "@/lib/reports";

// Per-event P&L — actual revenue (Square mirror) minus COGS minus fixed event costs from the
// event_economics model. Scaffold: fills in as sales flow against live events. MONEY tab.

const usd = (cents: number) => (cents < 0 ? "-$" : "$") + Math.round(Math.abs(cents || 0) / 100).toLocaleString();

export default function EventPnlReport() {
  const [rows, setRows] = useState<EventPnlRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    fetchEventPnl().then((r) => { if (live) { setRows(r); setLoading(false); } });
    return () => { live = false; };
  }, []);

  if (loading) return <div className="adm-sec rpt"><div className="sec">Per-event P&amp;L</div><div className="rpt-hint">Loading…</div></div>;
  if (!rows) return null;
  const anyActual = rows.some((r) => r.actual_cents > 0);

  return (
    <div className="adm-sec rpt">
      <div className="sec">Per-event P&amp;L</div>
      {rows.length === 0 ? (
        <div className="rpt-hint">No events yet.</div>
      ) : (
        <div className="rpt-block">
          {rows.map((r, i) => (
            <div key={i} className="rpt-pnl">
              <div className="rpt-pnl-l">
                <b>{r.event}</b>
                <span>{r.orders} orders · {Math.round((1 - r.cogs_pct) * 100)}% gross{r.fixed_cents > 0 ? ` · ${usd(r.fixed_cents)} fixed` : ""}</span>
              </div>
              <div className="rpt-pnl-r">
                <div className="rpt-pnl-rev">{usd(r.actual_cents)}</div>
                <div className={`rpt-pnl-m${r.margin_cents >= 0 ? "" : " neg"}`}>{usd(r.margin_cents)} net</div>
              </div>
            </div>
          ))}
          <div className="rpt-foot">{anyActual
            ? "Actual revenue (Square) − COGS − fixed event costs (booth / transport / permit / consumables)."
            : "Actuals fill in from Square as you sell at each event; costs come from each event's economics."}</div>
        </div>
      )}
    </div>
  );
}
