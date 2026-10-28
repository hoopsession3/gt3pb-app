"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";
import { useAppStable } from "@/components/AppProvider";
import { failureOr, failureWords } from "@/lib/failureWords";
import { haptic } from "@/lib/haptics";
import Said from "@/components/Said";
import type { MetricKey } from "@/lib/visionMoney";
import { ASSESS_WEIGHT, BLOCKER_STATUS_WORD, BLOCKER_WORD, READINESS_WORD, SCORE_METHOD, STAGE_POLICY, type AssessKey, type Blocker, type BlockerKey, type BlockerStatus, type Readiness, type Score } from "@/lib/visionScore";
import { BEARING_WORD, EVERY, EVERY_WORD, STALE_DAYS, TOPICS, TOPIC_WORD, age, domainOf, type Bearing, type Research } from "@/lib/visionResearch";

// THE SCORE AND THE RESEARCH (R56, phase D). The score: out of 100, every factor its points, its weight, its rubric and
// its reason — a door to the figure it reads. Not a probability, and it says so. The research: what the market says,
// each finding with its source's address and the day GT3 read it; proposed until an owner or admin accepts it, and
// only accepted findings count. A finding older than ninety days says so: run it again.

const READY_TAG: Record<Readiness, string> = { complete: "k-tag ok", discussion: "k-tag gold", internal: "k-tag gold", not_ready: "k-tag warn", unknown: "k-tag" };
const STATUS_TAG_B: Record<BlockerStatus, string> = { open: "k-tag warn", in_remediation: "k-tag gold", pending_verification: "k-tag gold", risk_accepted: "k-tag", acceptance_lapsed: "k-tag warn" };
const TONE = (p: number | null) => (p == null ? "k-tag" : p >= 70 ? "k-tag ok" : p >= 40 ? "k-tag gold" : "k-tag warn");
const STATUS_TAG = { proposed: "k-tag", accepted: "k-tag ok", rejected: "k-tag warn" } as const;
const STATUS_WORD = { proposed: "Proposed", accepted: "Accepted", rejected: "Rejected" } as const;

export type BlockerActions = {
  /** An owner accepts a blocker as a risk: a reason and a review date (IP1.4). Omitted when this person can't. */
  onAccept?: (key: string, note: string, reviewBy: string) => Promise<void>;
  acceptWhy?: string | null;
  /** Start the remediation as one of the plan's needs (vision_plan_needs) — the existing workflow, no second task list. */
  onAddNeed?: (key: BlockerKey) => Promise<void>;
  /** Go to where the remedy is done (the research, the scenarios, the startup lines). */
  onGo?: (key: BlockerKey) => void;
};
export function ScoreCard({ s, onOpen, actions = {} }: { s: Score; onOpen: (k: MetricKey) => void; actions?: BlockerActions }) {
  const [open, setOpen] = useState<AssessKey | null>(null);
  const accepted = s.blockers.filter((b) => b.status === "risk_accepted").length;
  return (
    <div className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5">
      <div className="self-start"><span className={READY_TAG[s.readiness]}>{READINESS_WORD[s.readiness]}</span></div>
      <div className="vz-kpis grid gap-2 grid-cols-1 min-[420px]:grid-cols-3">
        <div className="vz-kpi"><span>Assessed score</span><b>{s.total == null ? "—" : `${s.total} / 100`}</b><em>on what can be judged</em></div>
        <div className="vz-kpi"><span>Evidence coverage</span><b>{s.coverage}%</b><em>of the score&apos;s weight</em></div>
        <div className="vz-kpi"><span>Critical blockers</span><b>{s.open} to close</b><em>{accepted ? `${accepted} accepted as a risk` : s.blockers.length ? "none accepted" : "none"}</em></div>
      </div>
      <p className="vz-card-s">An assessed score isn&apos;t readiness: the stage above comes from the blockers, by policy.</p>
      {s.blockers.length > 0 && <Blockers list={s.blockers} actions={actions} />}
      <details className="vp-table">
        <summary>How it&apos;s worked out · method {s.method}</summary>
        <p className="vz-card-s">{SCORE_METHOD.summary}</p>
        <ul className="vz-path">{(Object.keys(STAGE_POLICY) as (keyof typeof STAGE_POLICY)[]).map((k) => <li key={k} className="flex-col"><b className="font-sans">{READINESS_WORD[k]}</b><span className="vz-card-s">{STAGE_POLICY[k]}</span></li>)}</ul>
        <p className="vz-card-s">Method history: {SCORE_METHOD.changes.map((c) => `${c.version} — ${c.what}`).join(" ")}</p>
      </details>
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

/** IP1.3/IP1.4 — the critical blockers: where each stands, what it does to the result, what closes it, who says so — and
 *  the actions that start the work. Accepting a risk keeps it listed; only fixing the cause clears it. */
function Blockers({ list, actions }: { list: Blocker[]; actions: BlockerActions }) {
  const [writing, setWriting] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [review, setReview] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [today, setToday] = useState("");
  return (
    <div className="flex flex-col gap-1">
      <b className="font-sans">Critical blockers</b>
      <ol className="vz-path" aria-label="Critical blockers">
        {list.map((b) => (
          <li key={b.key} className="flex-col">
            <div className="flex justify-between gap-3"><span><b className="font-sans">{BLOCKER_WORD[b.key]}</b> · {b.kind}</span><span className={STATUS_TAG_B[b.status]}>{BLOCKER_STATUS_WORD[b.status]}</span></div>
            <span className="vz-card-s">{b.says}</span>
            {b.need && <span className="vz-card-s">Being worked on as a need: {b.need.label}{b.need.owner ? ` · ${b.need.owner}` : " · no owner named yet"}{b.need.done_on ? ` · marked done ${b.need.done_on}, waiting to be checked against the plan` : b.need.due_on ? ` · due ${b.need.due_on}` : ""}</span>}
            {b.acknowledged && <span className="vz-card-s">Accepted as a risk{b.acknowledged.at ? ` on ${b.acknowledged.at.slice(0, 10)}` : ""}, review by {b.acknowledged.reviewBy}: {b.acknowledged.note} Investors on a link see this.</span>}
            <details>
              <summary className="vz-card-s vz-more">What closes it</summary>
              <dl className="vz-dl">
                <dt>Criterion</dt><dd>{b.remedy.criterion}</dd>
                <dt>Missing</dt><dd>{b.remedy.missing}</dd>
                <dt>Where</dt><dd>{b.remedy.section}</dd>
                <dt>Closed when</dt><dd>{b.remedy.acceptance}</dd>
                <dt>Checked by</dt><dd>{b.remedy.verifier}</dd>
                <dt>Effect now</dt><dd>{b.effect}</dd>
              </dl>
            </details>
            <div className="flex flex-wrap gap-2">
              {actions.onGo && <button type="button" className="btn-sec btn-sm" onClick={() => actions.onGo!(b.key)}>{b.remedy.action}</button>}
              {actions.onAddNeed && !b.need && <button type="button" className="btn-ter" disabled={busy === b.key} onClick={() => { setBusy(b.key); void actions.onAddNeed!(b.key).finally(() => setBusy(null)); }}>{busy === b.key ? "Adding…" : "Add it to the plan's needs"}</button>}
              {actions.onAccept && b.status !== "risk_accepted" && writing !== b.key && <button type="button" className="btn-ter" onClick={() => { const now = new Date(); setToday(now.toISOString().slice(0, 10)); setWriting(b.key); setNote(""); setReview(new Date(now.getTime() + 30 * 86400000).toISOString().slice(0, 10)); }}>Accept as a risk</button>}
            </div>
            {writing === b.key && actions.onAccept && (
              <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (note.trim() && review) void actions.onAccept!(b.key, note, review).then(() => { setWriting(null); setNote(""); }); }}>
                <label className="prod-f"><span>Why it&apos;s acceptable to go to investors with this open — they&apos;ll see this reason</span><textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
                <label className="prod-f"><span>Review by — the acceptance lapses after this date</span><input type="date" value={review} min={today} onChange={(e) => setReview(e.target.value)} /></label>
                <div className="flex gap-2"><button type="submit" className="btn-sec btn-sm" disabled={!note.trim() || !review}>Accept the risk</button><button type="button" className="btn-ter" onClick={() => setWriting(null)}>Cancel</button></div>
              </form>
            )}
          </li>
        ))}
      </ol>
      {!actions.onAccept && actions.acceptWhy && list.some((b) => b.status !== "risk_accepted") && <p className="vz-card-s">{actions.acceptWhy}</p>}
    </div>
  );
}

export function ResearchPanel({ planId, items, onChanged, every = 0, lastAt = null }: { planId: string; items: Research[]; onChanged: () => void; every?: number; lastAt?: string | null }) {
  const { toast } = useAppStable();
  const [often, setOften] = useState<number>(every);
  const schedule = async (days: number) => {
    if (!supabase) return;
    const was = often;
    setOften(days);
    const me = (await supabase.auth.getUser()).data.user?.id ?? null;
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
    const { error } = await supabase.from("vision_research").update({ status, bearing: status === "accepted" ? bearing : null, reviewed_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast(failureWords(error, "Couldn't mark it"), "error"); return; }
    haptic("selection"); onChanged();
  };
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
