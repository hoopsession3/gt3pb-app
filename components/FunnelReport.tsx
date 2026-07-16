"use client";

import { useCallback, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";

// FUNNELS — where people drop off, from anonymous step counts (funnel_events, 0199). No cookies, no
// personal data: each funnel is a fixed step sequence and we show the count at each step as a bar
// (relative to the first step) plus how many were lost between steps. Reads the staff-only aggregate
// RPC funnel_counts(); the raw rows are never exposed to the client. Fetch state via useAsyncData —
// a failed load is a real error now, not a silent "No funnel activity yet".
type Row = { funnel: string; step: string; n: number };

const FUNNELS: { key: string; label: string; steps: [string, string][] }[] = [
  { key: "order", label: "Cup order", steps: [["open", "Opened"], ["pay_start", "Tapped pay"], ["paid", "Paid by card"]] },
  { key: "reserve", label: "Order-ahead reserve", steps: [["start", "Started"], ["done", "Reserved"]] },
  { key: "delivery", label: "Sunday delivery", steps: [["start", "Started"], ["done", "Ordered"]] },
  { key: "signup", label: "Sign up", steps: [["open", "Opened"], ["code_sent", "Code sent"], ["signed_in", "Signed in"]] },
];

export default function FunnelReport() {
  const [days, setDays] = useState(14);

  const loader = useCallback(async (): Promise<Row[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.rpc("funnel_counts", { p_days: days });
    if (error) throw new Error(error.message);
    return (data as Row[]) ?? [];
  }, [days]);
  const board = useAsyncData(loader, [days]);
  const rows = board.data ?? [];

  const at = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) m[`${r.funnel}:${r.step}`] = Number(r.n) || 0;
    return m;
  }, [rows]);

  return (
    <div className="fn">
      <div className="fn-head">
        <span className="fn-sub">Anonymous step counts — no cookies, no personal data.</span>
        <div className="fn-days" role="tablist" aria-label="Window">
          {[7, 14, 30].map((d) => (
            <button key={d} type="button" role="tab" aria-selected={days === d} className={`fn-day${days === d ? " on" : ""}`} onClick={() => setDays(d)}>{d}d</button>
          ))}
        </div>
      </div>

      <AsyncSection state={board} isEmpty={(data) => data.length === 0} emptyTitle="No funnel activity yet in this window" emptySub="It fills in as guests move through order, reserve, delivery and sign-up." errorTitle="Couldn't load the funnel report">
        {() => FUNNELS.map((f) => {
          const first = at[`${f.key}:${f.steps[0][0]}`] ?? 0;
          const last = at[`${f.key}:${f.steps[f.steps.length - 1][0]}`] ?? 0;
          const conv = first > 0 ? Math.round((last / first) * 100) : null;
          const pickup = f.key === "order" ? (at["order:pickup"] ?? 0) : 0;
          return (
            <div className="fn-block" key={f.key}>
              <div className="fn-block-h">
                <b>{f.label}</b>
                {conv != null && <span className="fn-conv">{conv}% finish</span>}
                {pickup > 0 && <span className="fn-alt">+{pickup} pay at window</span>}
              </div>
              <div className="fn-steps">
                {f.steps.map(([s, lbl], i) => {
                  const n = at[`${f.key}:${s}`] ?? 0;
                  const w = first > 0 ? Math.max(3, Math.round((n / first) * 100)) : 0;
                  const drop = i > 0 ? (at[`${f.key}:${f.steps[i - 1][0]}`] ?? 0) - n : 0;
                  return (
                    <div className="fn-step" key={s}>
                      <div className="fn-step-l"><span>{lbl}</span><b>{n}</b></div>
                      <div className="fn-bar"><span style={{ width: `${w}%` }} /></div>
                      {i > 0 && drop > 0 && <div className="fn-drop">−{drop} dropped</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </AsyncSection>
    </div>
  );
}
