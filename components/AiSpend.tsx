"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { PRICING, fmtUSD } from "@/lib/aiPricing";
import EmptyState from "./EmptyState";
import Icon from "@/components/Icon";

// AI SPEND — the owner's answer to "how much am I spending when my AI is queried?" Reads ai_usage
// (0190): every Claude call logs its tokens + computed cost here. Shows 30-day and today spend, the
// per-agent breakdown (so you see WHICH copilot costs what), and what prompt-caching is saving. Pilot
// scale is low-volume, so it aggregates the last 30 days client-side; an RPC can replace this if it grows.
type Row = {
  agent: string; model: string;
  input_tokens: number; output_tokens: number;
  cache_write_tokens: number; cache_read_tokens: number;
  cost_cents: number; created_at: string;
};

export default function AiSpend() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      if (!supabase) return;
      const since = new Date(Date.now() - 30 * 864e5).toISOString();
      const { data, error } = await supabase
        .from("ai_usage")
        .select("agent, model, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_cents, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (!live) return;
      if (error) { setErr(error.message); setRows([]); return; }
      setRows((data as Row[]) ?? []);
    })();
    return () => { live = false; };
  }, []);

  const s = useMemo(() => {
    const r = rows ?? [];
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
    const todayMs = startToday.getTime();
    let spend = 0, today = 0, cacheReadTok = 0, cacheWriteTok = 0, inTok = 0, outTok = 0;
    const byAgent = new Map<string, { calls: number; cents: number }>();
    const byModel = new Map<string, { calls: number; cents: number }>();
    let saved = 0;
    for (const x of r) {
      spend += x.cost_cents;
      if (new Date(x.created_at).getTime() >= todayMs) today += x.cost_cents;
      cacheReadTok += x.cache_read_tokens; cacheWriteTok += x.cache_write_tokens;
      inTok += x.input_tokens; outTok += x.output_tokens;
      const a = byAgent.get(x.agent) ?? { calls: 0, cents: 0 }; a.calls++; a.cents += x.cost_cents; byAgent.set(x.agent, a);
      const m = byModel.get(x.model) ?? { calls: 0, cents: 0 }; m.calls++; m.cents += x.cost_cents; byModel.set(x.model, m);
      // What caching saved: cache-read tokens billed at the cheap rate instead of full input rate.
      const p = PRICING[x.model]; if (p) saved += x.cache_read_tokens * (p.in - p.cacheRead) / 1e6 * 100;
    }
    const agents = [...byAgent.entries()].map(([agent, v]) => ({ agent, ...v })).sort((a, b) => b.cents - a.cents);
    const models = [...byModel.entries()].map(([model, v]) => ({ model, ...v })).sort((a, b) => b.cents - a.cents);
    return { spend, today, calls: r.length, avg: r.length ? spend / r.length : 0, agents, models, saved, cacheReadTok, cacheWriteTok, inTok, outTok };
  }, [rows]);

  if (rows === null) return <div className="spend-empty">Loading spend…</div>;
  if (err) return <div className="spend-empty">Couldn’t load spend — {err}</div>;
  if (rows.length === 0) return <EmptyState title="No AI spend logged yet" sub="As copilots run, every query’s tokens and cost land here — with a per-agent breakdown and what caching saved." />;

  return (
    <div className="spend">
      <div className="spend-kpis">
        <div className="spend-kpi"><span className="spend-k-v">{fmtUSD(s.spend)}</span><span className="spend-k-l">last 30 days</span></div>
        <div className="spend-kpi"><span className="spend-k-v">{fmtUSD(s.today)}</span><span className="spend-k-l">today</span></div>
        <div className="spend-kpi"><span className="spend-k-v">{s.calls.toLocaleString()}</span><span className="spend-k-l">queries · 30d</span></div>
        <div className="spend-kpi"><span className="spend-k-v">{fmtUSD(s.avg)}</span><span className="spend-k-l">avg / query</span></div>
      </div>

      {s.saved > 0 && (
        <div className="spend-cache"><Icon name="star" /> Prompt caching saved <b>{fmtUSD(s.saved)}</b> this month — {(s.cacheReadTok / 1e3).toFixed(0)}k tokens read from cache instead of billed in full.</div>
      )}

      <div className="spend-sec">By copilot</div>
      <div className="spend-tbl">
        {s.agents.map((a) => (
          <div key={a.agent} className="spend-row">
            <span className="spend-agent">{a.agent}</span>
            <span className="spend-bar" aria-hidden><span style={{ width: `${s.spend ? Math.max(3, (a.cents / s.spend) * 100) : 0}%` }} /></span>
            <span className="spend-calls">{a.calls}×</span>
            <span className="spend-cents">{fmtUSD(a.cents)}</span>
          </div>
        ))}
      </div>

      <div className="spend-sec">By model</div>
      <div className="spend-models">
        {s.models.map((m) => (
          <div key={m.model} className="spend-mrow"><span>{m.model.replace(/-\d{8}$/, "")}</span><span>{m.calls}× · {fmtUSD(m.cents)}</span></div>
        ))}
      </div>
      <p className="spend-foot">Costs are computed from published token rates (lib/aiPricing) at the moment each call runs. Rates are approximate — treat this as a close estimate, not a billing statement.</p>
    </div>
  );
}
