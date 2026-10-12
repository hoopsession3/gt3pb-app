"use client";

import { useEffect, useState } from "react";
import { SectionHeader } from "@/components/kit";
import { fetchSnapshot, type Snapshot } from "@/lib/reports";
import { supabase } from "@/lib/supabase";
import { nextDrop , dropDateKey} from "@/lib/orderAhead";
import { moneyRound } from "@/lib/money";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";

// Business snapshot — inventory value + low-stock, subscriber health, loyalty. One staff-gated
// RPC (report_snapshot). On-brand, dependency-free. Lives in the MONEY tab under Sales.
//
// A FAILED READ IS NOT "NO DATA YET" (2026-10-12). Any failure — the read refused, the network gone — came back as null
// and drew "No snapshot data yet", the words for a new business, over a business whose numbers simply were not read.
// It loads through useAsyncData now, and a failure says so, with Try again.

const planLabel = (p: string) => (p || "—").replace(/_/g, " + ").toUpperCase();

export default function SnapshotReport() {
  const snapState = useAsyncData<Snapshot>(fetchSnapshot, []);
  // Order-ahead reservation revenue — its own stream (drop_orders), so it isn't invisible to the
  // money view the way it was before. Read client-side (staff RLS), no report RPC change needed.
  const [resv, setResv] = useState<{ drop: number; dropN: number; m30: number; m30N: number } | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      if (!supabase) return;
      const since = new Date(Date.now() - 30 * 864e5).toISOString();
      const sat = dropDateKey(nextDrop().sat);
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

  return (
    <div className="adm-sec rpt">
      <SectionHeader label="Business snapshot" annotation="the whole picture" />
      <AsyncSection
        state={snapState}
        isEmpty={() => false}
        emptyTitle="No snapshot data yet"
        loadingLabel="Reading the snapshot…"
        errorTitle="Couldn't read the snapshot"
        errorSub="This is not zero — we could not read inventory, subscribers or loyalty just now."
      >
        {(snap) => {
          const inv = snap.inventory, subs = snap.subs, loy = snap.loyalty;
          const catMax = Math.max(1, ...(inv.by_category ?? []).map((c) => c.value_cents));
          const planMax = Math.max(1, ...(subs.by_plan ?? []).map((p) => p.n));
          const repeatRate = loy.buyers > 0 ? Math.round((loy.repeat_customers / loy.buyers) * 100) : 0;
          return (
            <>
              {resv && (resv.m30N > 0) && (
                <div className="rpt-block">
                  <div className="rpt-bh">Reservations · order-ahead</div>
                  <div className="rpt-kpis">
                    <div className="rpt-kpi"><span className="rpt-k">This drop</span><b>{moneyRound(resv.drop)}</b><span className="rpt-sub">{resv.dropN} reserved</span></div>
                    <div className="rpt-kpi"><span className="rpt-k">Last 30 days</span><b>{moneyRound(resv.m30)}</b><span className="rpt-sub">{resv.m30N} reservation{resv.m30N === 1 ? "" : "s"}</span></div>
                  </div>
                  <div className="rpt-foot">One-off Saturday drops (drop_orders) — one-time, never recurring.</div>
                </div>
              )}

              <div className="rpt-block">
                <div className="rpt-bh">Inventory value</div>
                <div className="rpt-kpis">
                  <div className="rpt-kpi"><span className="rpt-k">On-hand value</span><b>{moneyRound(inv.value_cents)}</b></div>
                  <div className="rpt-kpi"><span className="rpt-k">Items tracked</span><b>{inv.item_count.toLocaleString()}</b><span className="rpt-sub">{inv.low_stock} below reorder</span></div>
                </div>
                {(inv.by_category ?? []).slice(0, 6).map((c, i) => (
                  <div key={i} className="rpt-bar">
                    <div className="rpt-bar-l"><span>{c.cat}</span><b>{moneyRound(c.value_cents)}</b></div>
                    <div className="rpt-track"><div className="rpt-fill" style={{ width: `${Math.max(3, (c.value_cents / catMax) * 100)}%` }} /></div>
                  </div>
                ))}
              </div>

              <div className="rpt-block">
                <div className="rpt-bh">Subscribers</div>
                <div className="rpt-kpis">
                  <div className="rpt-kpi"><span className="rpt-k">MRR</span><b>{moneyRound(subs.mrr_cents)}</b><span className="rpt-sub">{subs.active} active of {subs.total}</span></div>
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
            </>
          );
        }}
      </AsyncSection>
    </div>
  );
}
