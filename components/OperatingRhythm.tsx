"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";
import { useAsyncData } from "@/lib/useAsyncData";
import { authedFetch } from "@/lib/authedFetch";
import { useApp } from "./AppProvider";
import { DecisionLog } from "./StrategyCollab";
import { SectionHeader } from "@/components/kit";
import Sheet from "@/components/Sheet";
import Icon from "@/components/Icon";

// OPERATING RHYTHM (2026-08-02 exec-rhythm P1–P3) — the review step of plan → execute → REVIEW →
// adjust, installed as a surface. Two rituals, one ledger:
//   · Weekly Operating Review — assembled from live data (revenue, goals, initiatives, incidents,
//     decisions, the week ahead), landing as a continuation-ready note. Retro = addenda on it.
//   · Strategy Session — the agenda nobody has to remember (open threads, stalled goals, pending
//     plays, program hygiene, aging blockers), same landing.
//   · The decision ledger, surfaced OUT of the playbook so governance is seen, not buried.
// Both assemblers are deterministic server routes — no AI dependency, numbers can't be invented.

type Latest = { id: string; title: string; met_on: string } | null;
type Pulse = { review: Latest; strategy: Latest; atRisk: number; quiet: number };

const nice = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export default function OperatingRhythm({ isAdmin, onOpenNotes }: { isAdmin: boolean; onOpenNotes: () => void }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState<"review" | "session" | null>(null);
  // The Post-Session Pipeline, automated (the OS's rhythm #3): paste the transcript, the five
  // extractions file themselves — decisions → ledger, open items → dated follow-ups, calendar →
  // events, pipeline moves → matched accounts (unmatched names reported, never minted).
  const [extractOpen, setExtractOpen] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [extracting, setExtracting] = useState(false);
  const runExtract = async () => {
    if (!transcript.trim() || extracting) return;
    setExtracting(true);
    try {
      const r = await authedFetch("/api/agents/session-extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: transcript }) });
      const j = await r.json();
      if (j.ok) {
        toast(`Filed: ${j.decisions} decision${j.decisions === 1 ? "" : "s"} · ${j.open_items} follow-up${j.open_items === 1 ? "" : "s"} · ${j.events} event${j.events === 1 ? "" : "s"} · ${j.pipeline_moves} pipeline move${j.pipeline_moves === 1 ? "" : "s"}${j.activities ? ` · ${j.activities} activit${j.activities === 1 ? "y" : "ies"}` : ""}${j.skipped?.length ? ` · couldn't match: ${j.skipped.join(", ")}` : ""}`);
        setExtractOpen(false); setTranscript(""); onOpenNotes();
      } else toast(String(j.error ?? "").includes("ANTHROPIC") ? "AI isn't switched on yet — add the API key" : `Couldn't extract — ${j.error ?? r.status}`, "error");
    } catch { toast("Couldn't reach the extractor", "error"); }
    setExtracting(false);
  };

  const loader = useCallback(async (): Promise<Pulse> => {
    if (!supabase) return { review: null, strategy: null, atRisk: 0, quiet: 0 };
    const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
    const [r, s, g] = await Promise.all([
      supabase.from("meeting_notes").select("id, title, met_on").eq("source", "review").is("archived_at", null).order("met_on", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("meeting_notes").select("id, title, met_on").eq("source", "strategy").is("archived_at", null).order("met_on", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("goals").select("id, checkin_status, updated_at").eq("status", "active"),
    ]);
    const goals = (g.data ?? []) as { checkin_status: string | null; updated_at: string }[];
    return {
      review: (r.data as Latest) ?? null,
      strategy: (s.data as Latest) ?? null,
      atRisk: goals.filter((x) => x.checkin_status === "at_risk").length,
      quiet: goals.filter((x) => x.checkin_status !== "at_risk" && x.updated_at < weekAgo).length,
    };
  }, []);
  const state = useAsyncData(loader, []);
  const { reload } = state;
  useRealtimeTable(["meeting_notes", "goals"], reload);

  const assemble = async (kind: "review" | "session") => {
    if (busy) return;
    setBusy(kind);
    try {
      const r = await authedFetch(kind === "review" ? "/api/agents/weekreview" : "/api/agents/stratsession", { method: "POST" });
      const j = await r.json();
      if (j.ok) {
        toast(j.existing ? (kind === "review" ? "This week's review already stands — it's in Notes" : "Today's agenda already stands — it's in Notes") : `${j.title} — assembled, it's in Notes`);
        reload(); onOpenNotes();
      } else toast(`Couldn't assemble — ${j.error ?? r.status}`, "error");
    } catch { toast("Couldn't reach the assembler", "error"); }
    setBusy(null);
  };

  const p = state.data;
  return (
    <div className="adm-sec rhythm">
      <SectionHeader label="Operating rhythm" />
      <div className="h-sub">Plan → execute → <b>review</b> → adjust. The review writes itself from live numbers; the retro is captured as additions on the note; every strategic call lands in the ledger.</div>
      {(p && (p.atRisk > 0 || p.quiet > 0)) && (
        <div className="rhythm-pulse">{p.atRisk > 0 && <span className="rhythm-risk">🔴 {p.atRisk} goal{p.atRisk === 1 ? "" : "s"} at risk</span>}{p.quiet > 0 && <span className="rhythm-quiet">💤 {p.quiet} quiet a week+</span>}<span className="rhythm-pulse-hint">— check-ins live on Command › Goals</span></div>
      )}
      <div className="rhythm-cards">
        <div className="rhythm-card">
          <div className="rhythm-k">Weekly Operating Review</div>
          <p className="rhythm-sub">The week that was — revenue, goals moved or stalled, events run, incidents, decisions — plus the week ahead. Retro: keep · change · start.</p>
          {p?.review && <button type="button" className="rhythm-last" onClick={onOpenNotes}>Latest: {p.review.title.replace("Weekly Operating Review · ", "")} — open in Notes <Icon name="arrowRight" /></button>}
          {isAdmin && <button type="button" className="rhythm-go" onClick={() => assemble("review")} disabled={busy !== null}>{busy === "review" ? "Assembling…" : <><Icon name="sparkles" /> Assemble this week&rsquo;s review</>}</button>}
        </div>
        <div className="rhythm-card">
          <div className="rhythm-k">Strategy Session</div>
          <p className="rhythm-sub">The agenda nobody has to remember: open threads, goals needing a call, plays on the table, program hygiene, aging blockers. Close every call with ⚖ Log a decision.</p>
          {p?.strategy && <button type="button" className="rhythm-last" onClick={onOpenNotes}>Latest: {nice(p.strategy.met_on)} — open in Notes <Icon name="arrowRight" /></button>}
          {isAdmin && <button type="button" className="rhythm-go" onClick={() => assemble("session")} disabled={busy !== null}>{busy === "session" ? "Assembling…" : <><Icon name="sparkles" /> Start a strategy session</>}</button>}
          {isAdmin && <button type="button" className="rhythm-last" onClick={() => setExtractOpen(true)}>⇣ Had the session already? Paste the transcript — extract &amp; file</button>}
        </div>
      </div>
      {extractOpen && (
        <Sheet open onClose={() => setExtractOpen(false)} label="Extract a session"
          header={<div className="note-lux-head"><span className="note-lux-eyb">Post-session pipeline</span><button type="button" className="qd-x" onClick={() => setExtractOpen(false)} aria-label="Close"><Icon name="close" /></button></div>}
          footer={<div className="note-actions"><button type="button" className="note-cancel" onClick={() => setExtractOpen(false)}>Cancel</button><button type="button" className="note-save" onClick={runExtract} disabled={!transcript.trim() || extracting}>{extracting ? "Extracting…" : "Extract & file"}</button></div>}>
          <p className="rhythm-sub">The five extractions, filed on their spines in one pass: decisions → the ledger (with provenance) · open items → dated follow-ups · calendar → events · pipeline moves → matched accounts. Account names it can&rsquo;t match are reported, never guessed into new accounts. The transcript itself is kept on the session note.</p>
          <textarea className="note-area" rows={12} placeholder="Paste the whole transcript or your raw session notes…" value={transcript} onChange={(e) => setTranscript(e.target.value)} autoFocus />
        </Sheet>
      )}
      <details className="rhythm-ledger">
        <summary>⚖ Decision ledger — append-only, with follow-through</summary>
        <DecisionLog canWrite={isAdmin} />
      </details>
    </div>
  );
}
