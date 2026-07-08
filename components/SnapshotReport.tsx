"use client";

import { useEffect, useState } from "react";
import { fetchSnapshot, type Snapshot } from "@/lib/reports";
import { supabase } from "@/lib/supabase";
import { nextDrop } from "@/lib/orderAhead";

// Business snapshot — inventory value + low-stock, subscriber health, loyalty. One staff-gated
// RPC (report_snapshot). On-brand, dependency-free. Lives in the MONEY tab under Sales.

const usd = (cents: number) => "$" + Math.round((cents || 0) / 100).toLocaleString();
const planLabel = (p: string) => (p || "—").replace(/_/g, " + ").toUpperCase();

export default function SnapshotReport() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  // Order-ahead reservation revenue — its own stream (drop_orders), so it isn't invisible to the
  // money view the way it was before. Read client-side (staff RLS), no report RPC change needed.
  const [resv, setResv] = useState<{ drop: number; dropN: number; m30: number; m30N: number } | null>(null);

  useEffect(() => {
    let live = true;
    fetchSnapshot().then((s) => { if (live) { setSnap(s); setLoading(false); } });
    (async () => {
      if (!supabase) return;
      const since = new Date(Date.now() - 30 * 864e5).toISOString();
      const sat = nextDrop().sat.toISOString().slice(0, 10);
      const { data } = await supabase.from("drop_orders").select("total_cents, drop_date").gte("created_at", since);
      if (!live || !data) return;
      let drop = 0, dropN = 0, m30 = 0, m30N = 0;
      for (const r of data as { total_cents: number; drop_date: string }[]) {
        m30 += r.total_cents; m30N++;
        if ((r.drop_date || "").slice(0, 10) === sat) { drop += r.total_cents; dropN++; }
      }
      setResv({ drop, dropN, m30, m30N });
    })();
    return () => { live = false; };
  }, []);

  if (loading) return <div className="adm-sec rpt"><div className="sec">Business snapshot</div><div className="rpt-hint">Loading…</div></div>;
  if (!snap || snap.error) return null;

  const inv = snap.inventory, subs = snap.subs, loy = snap.loyalty;
  const catMax = Math.max(1, ...(inv.by_category ?? []).map((c) => c.value_cents));
  const planMax = Math.max(1, ...(subs.by_plan ?? []).map((p) => p.n));
  const repeatRate = loy.buyers > 0 ? Math.round((loy.repeat_customers / loy.buyers) * 100) : 0;

  return (
    <div className="adm-sec rpt">
      <div className="sec">Business snapshot</div>

      {resv && (resv.m30N > 0) && (
        <div className="rpt-block">
          <div className="rpt-bh">Reservations · order-ahead</div>
          <div className="rpt-kpis">
            <div className="rpt-kpi"><span className="rpt-k">This drop</span><b>{usd(resv.drop)}</b><span className="rpt-sub">{resv.dropN} reserved</span></div>
            <div className="rpt-kpi"><span className="rpt-k">Last 30 days</span><b>{usd(resv.m30)}</b><span className="rpt-sub">{resv.m30N} reservation{resv.m30N === 1 ? "" : "s"}</span></div>
          </div>
          <div className="rpt-foot">One-off Saturday drops (drop_orders) — one-time, never recurring.</div>
        </div>
      )}

      <div className="rpt-block">
        <div className="rpt-bh">Inventory value</div>
        <div className="rpt-kpis">
          <div className="rpt-kpi"><span className="rpt-k">On-hand value</span><b>{usd(inv.value_cents)}</b></div>
          <div className="rpt-kpi"><span className="rpt-k">Items tracked</span><b>{inv.item_count.toLocaleString()}</b><span className="rpt-sub">{inv.low_stock} below reorder</span></div>
        </div>
        {(inv.by_category ?? []).slice(0, 6).map((c, i) => (
          <div key={i} className="rpt-bar">
            <div className="rpt-bar-l"><span>{c.cat}</span><b>{usd(c.value_cents)}</b></div>
            <div className="rpt-track"><div className="rpt-fill" style={{ width: `${Math.max(3, (c.value_cents / catMax) * 100)}%` }} /></div>
          </div>
        ))}
      </div>

      <div className="rpt-block">
        <div className="rpt-bh">Subscribers</div>
        <div className="rpt-kpis">
          <div className="rpt-kpi"><span className="rpt-k">MRR</span><b>{usd(subs.mrr_cents)}</b><span className="rpt-sub">{subs.active} active of {subs.total}</span></div>
          {subs.past_due > 0 && <div className="rpt-kpi"><span className="rpt-k">Past due</span><b>{subs.past_due.toLocaleString()}</b><span className="rpt-sub">{subs.paused} paused</span></div>}
        </div>
        {(subs.by_plan ?? []).map((p, i) => (
          <div key={i} className="rpt-bar">
            <div className="rpt-bar-l"><span>{planLabel(p.plan)}</span><b>{p.n.toLocaleString()}</b></div>
            <div className="rpt-track"><div className="rpt-fill alt" style={{ width: `${Math.max(3, (p.n / planMax) * 100)}%` }} /></div>
          </div>
        ))}
        <div className="rpt-foot">MRR = active subs × plan price (6 / 12 / 18-pack, every 2 weeks), normalized monthly. Edit prices in subscription_plans.</div>
      </div>

      <div className="rpt-block">
        <div className="rpt-bh">Loyalty</div>
        <div className="rpt-kpis">
          <div className="rpt-kpi"><span className="rpt-k">Members</span><b>{loy.members.toLocaleString()}</b></div>
          <div className="rpt-kpi"><span className="rpt-k">Repeat rate</span><b>{repeatRate}%</b><span className="rpt-sub">{loy.repeat_customers}/{loy.buyers} buyers</span></div>
        </div>
        <div className="rpt-foot">{loy.points_out.toLocaleString()} points outstanding across members.</div>
      </div>
    </div>
  );
}
