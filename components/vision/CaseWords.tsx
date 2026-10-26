"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { useAppStable } from "@/components/AppProvider";
import { useUnsaved } from "@/components/Sheet";
import { failureWords } from "@/lib/failureWords";
import { haptic } from "@/lib/haptics";
import { isMissingColumn, isMissingRelation, isMissingTable } from "@/lib/schemaSkew";
import { LEVELS, LEVEL_WORD, RISK_STATUS, keyRisks, toRisk, weight, type Level, type Risk, type RiskStatus } from "@/lib/visionRisks";
import type { Plan } from "@/lib/visionPlans";

// THE PLAN'S CASE, IN WORDS (R61, 0454). Who it's for and the problem it solves, the market it serves, how it stands
// apart; then its risks and assumptions — how likely, how much it would hurt, what we'd do, the evidence or the test, and
// where each stands. The crew read them with the plan; owners and admins write them. Words, not numbers: a market figure
// belongs with its source, in the research.
type Draft = Omit<Risk, "plan_id" | "sort">;
const toDraft = (r: Risk): Draft & { id?: string } => ({ id: r.id, kind: r.kind, words: r.words, likelihood: r.likelihood, impact: r.impact, mitigation: r.mitigation, evidence: r.evidence, status: r.status });
const blank = (kind: Risk["kind"]): Draft => ({ kind, words: "", likelihood: null, impact: null, mitigation: null, evidence: null, status: "open" });

export default function CaseWords({ plan, canEdit, onSaved }: { plan: Plan; canEdit: boolean; onSaved: () => void }) {
  const load = useCallback(async (): Promise<Risk[] | "not-yet"> => {
    if (!supabase) return [];
    // arrives-with: 0454  — until 0454 the risks table is absent: the case says it arrives with it; the rest of the plan reads as before
    const { data, error } = await supabase.from("vision_plan_risks").select("*").eq("plan_id", plan.id).order("sort").order("created_at");
    if (error && (isMissingTable(error) || isMissingRelation(error))) return "not-yet";
    if (error) throw new Error(error.message);
    return ((data ?? []) as Record<string, unknown>[]).map((r) => toRisk(r));
  }, [plan.id]);
  const state = useAsyncData(load, [plan.id]);
  if (state.data === "not-yet") return <p className="vz-card-s">Who it&apos;s for, the market and its risks arrive with the next database update (0454).</p>;
  if (!state.data) return state.status === "error" ? <p className="load-failed">{failureWords(state.error as Error, "Couldn't read the case")}</p> : <p className="vz-card-s">Reading the case…</p>;
  return <Words key={plan.id} plan={plan} risks={state.data} canEdit={canEdit} onSaved={() => { state.reload(); onSaved(); }} />;
}

function Words({ plan, risks, canEdit, onSaved }: { plan: Plan; risks: Risk[]; canEdit: boolean; onSaved: () => void }) {
  const { toast } = useAppStable();
  const [editing, setEditing] = useState(false);
  const [customer, setCustomer] = useState(plan.customer ?? "");
  const [market, setMarket] = useState(plan.market ?? "");
  const [positioning, setPositioning] = useState(plan.positioning ?? "");
  const [rows, setRows] = useState<(Draft & { id?: string })[]>(risks.map(toDraft));
  const [busy, setBusy] = useState(false);
  const [first] = useState(() => JSON.stringify([customer, market, positioning, rows]));
  const dirty = editing && JSON.stringify([customer, market, positioning, rows]) !== first;
  useUnsaved(dirty);
  const put = (k: number, patch: Partial<Draft>) => setRows((rs) => rs.map((r, j) => (j === k ? { ...r, ...patch } : r)));

  const save = async () => {
    if (!supabase || busy) return;
    setBusy(true);
    try {
      // arrives-with: 0454
      const p = await supabase.from("vision_plans").update({ customer: customer.trim() || null, market: market.trim() || null, positioning: positioning.trim() || null }).eq("id", plan.id);
      if (p.error) throw p.error;
      const keep = rows.filter((r) => r.words.trim());
      const gone = risks.filter((r) => r.id && !keep.some((k) => k.id === r.id)).map((r) => r.id!);
      if (gone.length) { const d = await supabase.from("vision_plan_risks").delete().in("id", gone); if (d.error) throw d.error; }
      for (const [k, r] of keep.entries()) {
        const row = { plan_id: plan.id, kind: r.kind, words: r.words.trim(), likelihood: r.likelihood, impact: r.impact, mitigation: r.mitigation?.trim() || null, evidence: r.evidence?.trim() || null, status: r.status, sort: k };
        const w = r.id ? await supabase.from("vision_plan_risks").update(row).eq("id", r.id) : await supabase.from("vision_plan_risks").insert(row);
        if (w.error) throw w.error;
      }
      haptic("success"); toast("Saved — the plan's case."); setEditing(false); onSaved();
    } catch (e) {
      const err = e as { message?: string; code?: string };
      toast(isMissingColumn(err) ? "The case arrives with the next database update (0454)." : failureWords(err, "Couldn't save the case"), "error");
    } finally { setBusy(false); }
  };

  if (!editing) {
    const top = keyRisks(risks);
    return (
      <div className="flex flex-col gap-2 min-w-0">
        {plan.customer && <><b className="font-sans">Who it&apos;s for</b><p className="vz-sub">{plan.customer}</p></>}
        {plan.market && <><b className="font-sans">The market</b><p className="vz-sub">{plan.market}</p></>}
        {plan.positioning && <><b className="font-sans">How it stands apart</b><p className="vz-sub">{plan.positioning}</p></>}
        <b className="font-sans">Risks and assumptions{risks.length ? ` · ${risks.filter((r) => r.status === "open" || r.status === "wrong").length} open` : ""}</b>
        {risks.length === 0 ? <p className="vz-card-s">None written yet — what could go wrong, and what are we assuming?</p> : risks.map((r, k) => (
          <div key={r.id ?? k} className="vz-obs">
            <span><b>{r.kind === "assumption" ? "Assuming" : "Risk"}:</b> {r.words}</span>
            <span>{r.likelihood && r.impact ? `${LEVEL_WORD[r.likelihood]} likelihood · ${LEVEL_WORD[r.impact]} impact` : "Not rated yet"} · {RISK_STATUS[r.status]}{top.includes(r) ? " · one to watch" : ""}</span>
            {r.mitigation && <span>What we&apos;d do: {r.mitigation}</span>}
            {r.evidence && <span>{r.kind === "assumption" ? "How we'd test it" : "Evidence"}: {r.evidence}</span>}
          </div>
        ))}
        {canEdit && <button type="button" className="btn-sec btn-sm self-start" onClick={() => setEditing(true)}>Write the case</button>}
      </div>
    );
  }
  return (
    <div className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5 min-w-0">
      <label className="prod-f"><span>Who it&apos;s for, and the problem it solves for them</span><textarea rows={2} maxLength={600} value={customer} onChange={(e) => setCustomer(e.target.value)} /></label>
      <label className="prod-f"><span>The market it serves (a number belongs with its source, in the research)</span><textarea rows={2} maxLength={1000} value={market} onChange={(e) => setMarket(e.target.value)} /></label>
      <label className="prod-f"><span>How it stands apart</span><textarea rows={2} maxLength={600} value={positioning} onChange={(e) => setPositioning(e.target.value)} /></label>
      {rows.map((r, k) => (
        <div key={r.id ?? `n${k}`} className="vz-ask">
          <label className="prod-f col-span-2"><span>{r.kind === "assumption" ? "We're assuming" : "What could go wrong"}</span><textarea rows={2} maxLength={400} value={r.words} onChange={(e) => put(k, { words: e.target.value })} /></label>
          <label className="prod-f"><span>Likelihood</span><select value={r.likelihood ?? ""} onChange={(e) => put(k, { likelihood: (e.target.value || null) as Level | null })}><option value="">Not rated</option>{LEVELS.map((l) => <option key={l} value={l}>{LEVEL_WORD[l]}</option>)}</select></label>
          <label className="prod-f"><span>Impact</span><select value={r.impact ?? ""} onChange={(e) => put(k, { impact: (e.target.value || null) as Level | null })}><option value="">Not rated</option>{LEVELS.map((l) => <option key={l} value={l}>{LEVEL_WORD[l]}</option>)}</select></label>
          <label className="prod-f col-span-2"><span>What we&apos;d do</span><textarea rows={2} maxLength={600} value={r.mitigation ?? ""} onChange={(e) => put(k, { mitigation: e.target.value || null })} /></label>
          <label className="prod-f col-span-2"><span>{r.kind === "assumption" ? "How we'd test it" : "The evidence"}</span><textarea rows={2} maxLength={600} value={r.evidence ?? ""} onChange={(e) => put(k, { evidence: e.target.value || null })} /></label>
          <label className="prod-f col-span-2"><span>Where it stands</span><select value={r.status} onChange={(e) => put(k, { status: e.target.value as RiskStatus })}>{(Object.keys(RISK_STATUS) as RiskStatus[]).filter((s) => r.kind === "assumption" ? s !== "handled" : s !== "validated" && s !== "wrong").map((s) => <option key={s} value={s}>{RISK_STATUS[s]}</option>)}</select></label>
          <p className="vz-card-s col-span-2">{weight(r) != null ? `Weight ${weight(r)} of 9 — likelihood × impact.` : "Rate it to rank it."}</p>
          <div className="vz-ask-x"><button type="button" className="btn-ter" onClick={() => setRows((rs) => rs.filter((_, j) => j !== k))}>Remove</button></div>
        </div>
      ))}
      <div className="vz-row">
        <button type="button" className="btn-sec btn-sm" onClick={() => setRows((rs) => [...rs, blank("risk")])}>+ A risk</button>
        <button type="button" className="btn-sec btn-sm" onClick={() => setRows((rs) => [...rs, blank("assumption")])}>+ An assumption</button>
      </div>
      <div className="vz-row">
        <button type="button" className="btn-pri btn-sm" onClick={() => void save()} disabled={busy || !dirty}>{busy ? "Saving…" : "Save the case"}</button>
        <button type="button" className="btn-ter" onClick={() => { setCustomer(plan.customer ?? ""); setMarket(plan.market ?? ""); setPositioning(plan.positioning ?? ""); setRows(risks.map(toDraft)); setEditing(false); }} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}
