"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";
import AssignTaskSheet from "./AssignTaskSheet";
import Icon from "@/components/Icon";

// CHIEF OF STAFF — the executive-assistant briefing. Pick a horizon (week / month / quarter) and it
// reads the whole org and tells you what to focus on and in what order: headline, ranked priorities,
// an ordered "lead the period" plan, the risks that need a decision, and a by-area status. On-demand
// and always fresh (regenerates from live data). Leadership surface.
/* eslint-disable @typescript-eslint/no-explicit-any */

const PERIODS: { key: "week" | "month" | "quarter"; label: string }[] = [
  { key: "week", label: "This week" }, { key: "month", label: "Month" }, { key: "quarter", label: "Quarter" },
];
const URG: Record<string, string> = { high: "#c4453c", medium: "#e0892b", low: "#6aa05c" };
const STAT: Record<string, { c: string; t: string }> = { good: { c: "#6aa05c", t: "On track" }, watch: { c: "#e0892b", t: "Watch" }, behind: { c: "#c4453c", t: "Behind" } };

export default function ChiefOfStaff() {
  const [period, setPeriod] = useState<"week" | "month" | "quarter">("week");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<any | null>(null);
  const [doneRefs, setDoneRefs] = useState<Set<string>>(new Set());   // priorities checked off this session
  const [assignTitle, setAssignTitle] = useState<string | null>(null); // open the assign sheet with this title

  // Close the SOURCE record a priority points at (a real todo / event_task), so ✓ Done on the
  // briefing actually completes the overdue item — not just a cosmetic check. Scoped by id + still-open
  // so a stale/hallucinated ref is a harmless no-op.
  const complete = async (ref: { kind: string; id: string }) => {
    if (!supabase) return;
    const key = `${ref.kind}:${ref.id}`;
    setDoneRefs((s) => new Set(s).add(key));
    const table = ref.kind === "task" ? "event_tasks" : "todos";
    const patch = ref.kind === "task" ? { done: true } : { done: true, done_at: new Date().toISOString() };
    const { error } = await supabase.from(table).update(patch).eq("id", ref.id).eq("done", false);
    if (error) setDoneRefs((s) => { const n = new Set(s); n.delete(key); return n; });
  };

  const run = async (p = period) => {
    if (!supabase || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await authedFetch("/api/agents/chief", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period: p }) });
      const j = await r.json();
      if (!j.ok) setErr(j.error || "Couldn't build the briefing."); else setRes(j);
    } catch (e: any) { setErr(String(e?.message ?? e)); }
    setBusy(false);
  };
  const pick = (p: "week" | "month" | "quarter") => { setPeriod(p); setRes(null); };

  const b = res?.briefing;
  return (
    <div className="cos">
      <div className="cos-head">
        <div className="cos-eyebrow"><Icon name="compass" /> Chief of Staff</div>
        <div className="cos-toggle">
          {PERIODS.map((p) => <button key={p.key} type="button" className={`cos-tg${period === p.key ? " on" : ""}`} onClick={() => pick(p.key)}>{p.label}</button>)}
        </div>
      </div>

      {!b ? (
        <button type="button" className="cos-go" onClick={() => run()} disabled={busy}>{busy ? "Reading everything…" : <><Icon name="sparkles" /> Brief &amp; lead my {period === "week" ? "week" : period}</>}</button>
      ) : (
        <>
          <div className="cos-headline">{b.headline}</div>
          <div className="cos-counts">{res.counts && Object.entries(res.counts).filter(([, v]) => (v as number) > 0).map(([k, v]) => <span key={k}>{v as number} {k.replace("_", " ")}</span>)}</div>

          {b.priorities?.length > 0 && (
            <div className="cos-block">
              <div className="cos-block-h">Priorities</div>
              {b.priorities.map((p: any, i: number) => {
                const ref = p.ref && (p.ref.kind === "todo" || p.ref.kind === "task") ? p.ref : null;
                const isDone = ref ? doneRefs.has(`${ref.kind}:${ref.id}`) : false;
                return (
                  <div key={i} className={`cos-prio${isDone ? " done" : ""}`}>
                    <span className="cos-prio-n" style={{ background: URG[p.urgency] || "#888" }}>{i + 1}</span>
                    <span className="cos-prio-main">
                      <b>{p.title}</b>{p.why ? <span>{p.why}</span> : null}
                      <span className="cos-prio-acts">
                        {ref && (isDone
                          ? <span className="cos-doneflag"><Icon name="check" /> Done</span>
                          : <button type="button" className="cos-act" onClick={() => complete(ref)}><Icon name="check" /> Done</button>)}
                        <button type="button" className="cos-act" onClick={() => setAssignTitle(p.title)}><Icon name="plus" /> Task</button>
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {b.lead_plan?.length > 0 && (
            <div className="cos-block">
              <div className="cos-block-h">Lead the {period === "week" ? "week" : period}</div>
              <ol className="cos-plan">{b.lead_plan.map((s: string, i: number) => <li key={i}><span>{s}</span><button type="button" className="cos-act sm" onClick={() => setAssignTitle(s)} aria-label="Make a task from this step"><Icon name="plus" /></button></li>)}</ol>
            </div>
          )}

          {b.risks?.length > 0 && (
            <div className="cos-block">
              <div className="cos-block-h">Decisions / risks</div>
              {b.risks.map((r: any, i: number) => (
                <div key={i} className="cos-risk"><b><Icon name="warning" /> {r.risk}</b><span><Icon name="arrowRight" /> {r.action}</span></div>
              ))}
            </div>
          )}

          {b.by_area?.length > 0 && (
            <div className="cos-block">
              <div className="cos-block-h">By area</div>
              <div className="cos-areas">
                {b.by_area.map((a: any, i: number) => (
                  <div key={i} className="cos-area">
                    <span className="cos-area-dot" style={{ background: STAT[a.status]?.c || "#888" }} />
                    <span className="cos-area-main"><b>{a.area}</b><span>{a.note}</span></span>
                    <span className="cos-area-tag" style={{ color: STAT[a.status]?.c }}>{STAT[a.status]?.t || a.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {b.watch?.length > 0 && (
            <div className="cos-watch">👁 {b.watch.join(" · ")}</div>
          )}

          <button type="button" className="cos-redo" onClick={() => run()} disabled={busy}>{busy ? "Refreshing…" : "↻ Refresh briefing"}</button>
        </>
      )}
      {err && <div className="dp-err" style={{ marginTop: 8 }}>{err}</div>}
      {assignTitle != null && (
        <AssignTaskSheet defaultTitle={assignTitle} onClose={() => setAssignTitle(null)} onCreated={() => setAssignTitle(null)} />
      )}
    </div>
  );
}
