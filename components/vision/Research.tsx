"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";
import { useAppStable } from "@/components/AppProvider";
import { failureOr, failureWords } from "@/lib/failureWords";
import { haptic } from "@/lib/haptics";
import Said from "@/components/Said";
import type { MetricKey } from "@/lib/visionMoney";
import { ASSESS_WEIGHT, BLOCKER_WORD, READINESS_WORD, type AssessKey, type Blocker, type Readiness, type Score } from "@/lib/visionScore";
import { BEARING_WORD, EVERY, EVERY_WORD, STALE_DAYS, TOPICS, TOPIC_WORD, age, domainOf, type Bearing, type Research } from "@/lib/visionResearch";

// THE SCORE AND THE RESEARCH (R56, phase D). The score: out of 100, every factor its points, its weight, its rubric and
// its reason — a door to the figure it reads. Not a probability, and it says so. The research: what the market says,
// each finding with its source's address and the day GT3 read it; proposed until an owner or admin accepts it, and
// only accepted findings count. A finding older than ninety days says so: run it again.

const READY_TAG: Record<Readiness, string> = { ready: "k-tag ok", validate: "k-tag gold", not_ready: "k-tag warn", unknown: "k-tag" };
const TONE = (p: number | null) => (p == null ? "k-tag" : p >= 70 ? "k-tag ok" : p >= 40 ? "k-tag gold" : "k-tag warn");
const STATUS_TAG = { proposed: "k-tag", accepted: "k-tag ok", rejected: "k-tag warn" } as const;
const STATUS_WORD = { proposed: "Proposed", accepted: "Accepted", rejected: "Rejected" } as const;

export function ScoreCard({ s, onOpen, onAcknowledge, ackWhy = null }: { s: Score; onOpen: (k: MetricKey) => void; onAcknowledge?: (key: string, note: string) => Promise<void>; ackWhy?: string | null }) {
  const [open, setOpen] = useState<AssessKey | null>(null);
  return (
    <div className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5">
      <div className="vz-drill-v"><b>{s.total == null ? "—" : s.total}<span className="vz-card-s"> / 100</span></b><span className={READY_TAG[s.readiness]}>{READINESS_WORD[s.readiness]}</span></div>
      <div className="vz-kpis grid gap-2 grid-cols-3">
        <div className="vz-kpi"><span>Readiness score</span><b>{s.total == null ? "—" : s.total}</b><em>on what&apos;s judged</em></div>
        <div className="vz-kpi"><span>Evidence coverage</span><b>{s.coverage}%</b><em>of the weight judged</em></div>
        <div className="vz-kpi"><span>Critical blockers</span><b>{s.open}</b><em>{s.blockers.length - s.open ? `open · ${s.blockers.length - s.open} acknowledged` : "open"}</em></div>
      </div>
      <p className="vz-card-s">{s.says}</p>
      {s.blockers.length > 0 && <Blockers list={s.blockers} onAcknowledge={onAcknowledge} why={ackWhy} />}
      <div className="vz-kpis grid gap-2 grid-cols-2 min-[700px]:grid-cols-4">
        {(Object.keys(s.assessments) as AssessKey[]).map((k) => { const a = s.assessments[k]; return (
          <button key={k} type="button" className={open === k ? "vz-kpi vz-kpi-btn moved" : "vz-kpi vz-kpi-btn"} aria-expanded={open === k} onClick={() => setOpen((v) => (v === k ? null : k))}>
            <span>{a.label} · weight {ASSESS_WEIGHT[k]}</span><b>{a.score == null ? "Not scored" : a.score}</b>
          </button>); })}
      </div>
      {open && (() => { const a = s.assessments[open]; return (
        <div className="flex flex-col gap-2">
          <p className="vz-card-s"><b>Why this score.</b> {a.why}</p>
          {a.evidence.length > 0 && <p className="vz-card-s"><b>The evidence.</b> {a.evidence.join(" · ")}</p>}
          {a.uncertain.length > 0 && <p className="vz-card-s"><b>Uncertain.</b> {a.uncertain.join(" ")}</p>}
          <ol className="vz-path" aria-label={`How ${a.label.toLowerCase()} is scored`}>
            {a.criteria.map((c) => (
              <li key={c.key} className="flex-col">
                <div className="flex justify-between gap-3"><span>{c.label} · weight {c.weight}</span><span className={TONE(c.points)}>{c.points == null ? "Not judged" : `${c.points} / 100`}</span></div>
                {c.says && <span className="vz-card-s">{c.says}</span>}
                <span className="vz-card-s">Rubric: {c.rubric}</span>
                {c.about && <button type="button" className="btn-ter self-start" onClick={() => onOpen(c.about!)}>The figure it reads</button>}
              </li>
            ))}
          </ol>
        </div>); })()}
      {s.actions.length > 0 && (
        <div className="flex flex-col gap-1">
          <b className="font-sans">The three things that would raise it most</b>
          <ol className="vz-path">{s.actions.map((x) => <li key={x.criterion}><span>{x.text}</span><b>up to +{x.gain}</b></li>)}</ol>
        </div>
      )}
    </div>
  );
}

/** IP1.3 — the critical blockers: what each is, what it does to the result, and an owner's acknowledgement with its reason. */
function Blockers({ list, onAcknowledge, why }: { list: Blocker[]; onAcknowledge?: (key: string, note: string) => Promise<void>; why: string | null }) {
  const [writing, setWriting] = useState<string | null>(null);
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-col gap-1">
      <b className="font-sans">Critical blockers — resolve each, or an owner acknowledges it, before the plan is called ready</b>
      <ol className="vz-path" aria-label="Critical blockers">
        {list.map((b) => (
          <li key={b.key} className="flex-col">
            <div className="flex justify-between gap-3"><span>{BLOCKER_WORD[b.key]} · {b.kind}</span><span className={b.acknowledged ? "k-tag gold" : "k-tag warn"}>{b.acknowledged ? "Acknowledged" : "Open"}</span></div>
            <span className="vz-card-s">{b.says}</span>
            <span className="vz-card-s">What it does to the result: {b.effect}</span>
            {b.acknowledged && <span className="vz-card-s">Owner&apos;s reason{b.acknowledged.at ? ` (${b.acknowledged.at.slice(0, 10)})` : ""}: {b.acknowledged.note}</span>}
            {!b.acknowledged && onAcknowledge && (writing === b.key ? (
              <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (note.trim()) void onAcknowledge(b.key, note).then(() => { setWriting(null); setNote(""); }); }}>
                <label className="prod-f"><span>Why it&apos;s acceptable to present with this open — investors on a link see this reason</span><textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
                <div className="flex gap-2"><button type="submit" className="btn-sec btn-sm" disabled={!note.trim()}>Acknowledge</button><button type="button" className="btn-ter" onClick={() => { setWriting(null); setNote(""); }}>Cancel</button></div>
              </form>
            ) : <button type="button" className="btn-ter self-start" onClick={() => { setWriting(b.key); setNote(""); }}>Acknowledge with a reason</button>)}
          </li>
        ))}
      </ol>
      {!onAcknowledge && why && list.some((b) => !b.acknowledged) && <p className="vz-card-s">{why}</p>}
    </div>
  );
}

export function ResearchPanel({ planId, items, ready, onChanged, every = 0, lastAt = null }: { planId: string; items: Research[]; ready: boolean; onChanged: () => void; every?: number; lastAt?: string | null }) {
  const { toast } = useAppStable();
  const [often, setOften] = useState<number>(every);
  const schedule = async (days: number) => {
    if (!supabase) return;
    const was = often;
    setOften(days);
    const me = (await supabase.auth.getUser()).data.user?.id ?? null;
    // arrives-with: 0453
    const { error } = await supabase.from("vision_plans").update({ research_every_days: days, research_by: me }).eq("id", planId);
    if (error) { setOften(was); toast(failureWords(error, "Couldn't set the schedule"), "error"); return; }
    haptic("selection"); toast(days ? `Checked again ${EVERY_WORD[days as keyof typeof EVERY_WORD].toLowerCase()} — you'll be told when it finds something new.` : "Research runs only when asked.");
  };
  const next = often && lastAt ? new Date(Date.parse(lastAt) + often * 86_400_000) : null;
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState("");
  const [said, setSaid] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showRejected, setShowRejected] = useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true); setErr(null); setSaid(null);
    try {
      const r = await authedFetch("/api/vision/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId, focus }) }, { deadlineMs: 70_000 });
      let j: { ok?: boolean; error?: string; says?: string } = {};
      try { j = await r.json(); } catch { j = { ok: false, error: `The research didn't answer (${r.status}).` }; }
      if (!r.ok || !j.ok) { setErr(failureOr(j.error ?? null, `The research didn't run (${r.status}).`)); haptic("error"); return; }
      setSaid(j.says ?? "Done."); haptic("success"); onChanged();
    } catch (e) { setErr(failureWords(e as Error, "The research didn't run")); } finally { setBusy(false); }
  };
  const mark = async (id: string, status: Research["status"], bearing: Bearing | null = null) => {
    if (!supabase) return;
    // arrives-with: 0450
    const { error } = await supabase.from("vision_research").update({ status, bearing: status === "accepted" ? bearing : null, reviewed_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast(failureWords(error, "Couldn't mark it"), "error"); return; }
    haptic("selection"); onChanged();
  };
  if (!ready) return <p className="vz-sub">The research arrives with the next database update (0450).</p>;
  const shown = items.filter((x) => showRejected || x.status !== "rejected");
  const newest = items.reduce<string | null>((a, x) => (!a || x.retrieved_at > a ? x.retrieved_at : a), null);
  return (
    <div className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5">
      <b className="font-sans text-subhead">What the market says</b>
      <p className="vz-card-s">Web research on this plan&apos;s market — only what a source says, each with its address. Nothing counts in the score until you accept it.{newest ? ` Last run ${age(newest).days} day${age(newest).days === 1 ? "" : "s"} ago.` : ""}</p>
      <label className="prod-f"><span>Focus (optional)</span><input value={focus} maxLength={200} placeholder="e.g. gyms nearby" onChange={(e) => setFocus(e.target.value)} /></label>
      <button type="button" className="btn-sec btn-sm self-start" onClick={() => void run()} disabled={busy}>{busy ? "Researching… (up to a minute)" : items.length ? "Run it again" : "Research this plan"}</button>
      <label className="prod-f"><span>Check it again</span><select value={often} onChange={(e) => void schedule(Number(e.target.value))}>{EVERY.map((d) => <option key={d} value={d}>{EVERY_WORD[d]}</option>)}</select></label>
      {often > 0 && <p className="vz-card-s">{next ? `Next check from ${next.toLocaleDateString("en-US", { month: "short", day: "numeric" })} — it runs when an owner or admin opens the vision, and finds only what's new.` : "The first check runs the next time an owner or admin opens the vision."}</p>}
      <Said as="p" className="vz-card-s">{said ?? ""}</Said>
      {err && <Said as="p" className="vz-issue warn">{err}</Said>}
      {TOPICS.map((t) => {
        const rows = shown.filter((x) => x.topic === t);
        if (!rows.length) return null;
        return (
          <div key={t} className="flex flex-col gap-1">
            <b className="font-sans">{TOPIC_WORD[t]}</b>
            {rows.map((x) => { const a = age(x.retrieved_at); return (
              <div key={x.id} className="vz-obs">
                <span>{x.claim}{x.figure ? <> · <b>{x.figure}</b></> : null}</span>
                <span><a href={x.source_url} target="_blank" rel="noopener noreferrer">{x.source_title || domainOf(x.source_url)}</a> · {domainOf(x.source_url)}{x.published ? ` · ${x.published}` : ""} · read {a.days} day{a.days === 1 ? "" : "s"} ago{a.stale ? ` — older than ${STALE_DAYS} days, run it again` : ""}</span>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={STATUS_TAG[x.status]}>{STATUS_WORD[x.status]}</span>
                  {x.status === "accepted" && x.bearing && <span className="vz-card-s">{BEARING_WORD[x.bearing]}</span>}
                  {(x.status !== "accepted" || x.bearing !== "for") && <button type="button" className="btn-ter" onClick={() => void mark(x.id, "accepted", "for")}>Accept — supports it</button>}
                  {(x.status !== "accepted" || x.bearing !== "against") && <button type="button" className="btn-ter" onClick={() => void mark(x.id, "accepted", "against")}>Accept — weighs against</button>}
                  {x.status !== "rejected" && <button type="button" className="btn-ter" onClick={() => void mark(x.id, "rejected")}>Reject</button>}
                </div>
              </div>); })}
          </div>
        );
      })}
      {items.some((x) => x.status === "rejected") && <button type="button" className="btn-ter self-start" onClick={() => setShowRejected((v) => !v)}>{showRejected ? "Hide rejected" : "Show rejected"}</button>}
      <p className="vz-card-s">Research is a reading of public sources on a day — check the source before it goes in front of an investor.</p>
    </div>
  );
}
