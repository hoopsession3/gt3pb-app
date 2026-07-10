"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { raiseAlertClient } from "@/lib/clientAlerts";

// PROPOSAL DESK (0180) — the reach-out strategy as a working, co-authored document that moves through
// a real lifecycle. Any staffer edits the strategy; anyone advances it draft -> in_review -> sent ->
// negotiating; only the owner (admin) records the decision (won/lost). Every move is logged to an
// append-only trail, so the owner sees the whole path to the sales-engineer decision. Lives inside
// the opportunity, beside the discussion thread — the thread is the talk, this is the artifact.

type Status = "draft" | "in_review" | "sent" | "negotiating" | "won" | "lost";
type Proposal = {
  id: string; opportunity_id: string; strategy: string | null; status: Status;
  decision_note: string | null; decided_by: string | null; decided_at: string | null;
  updated_by: string | null; updated_at: string; created_by: string | null;
};
type Ev = { id: string; from_status: string | null; to_status: string; note: string | null; actor_id: string | null; at: string };

const LINEAR: Status[] = ["draft", "in_review", "sent", "negotiating"];
const LABEL: Record<Status, string> = { draft: "Draft", in_review: "In review", sent: "Sent", negotiating: "Negotiating", won: "Won", lost: "Lost" };
const NEXT_VERB: Record<string, string> = { in_review: "Send for review", sent: "Mark sent", negotiating: "Move to negotiating" };
const when = (s: string) => new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function ProposalDesk({ oppId, vendorName, isAdmin }: { oppId: string; vendorName: string | null; isAdmin: boolean }) {
  const { toast } = useApp();
  const { user, profile } = useAuth();
  const [prop, setProp] = useState<Proposal | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [staff, setStaff] = useState<{ id: string; display_name: string | null; role: string | null }[]>([]);
  const [strategy, setStrategy] = useState("");
  const [dirty, setDirty] = useState(false);
  const [decisionNote, setDecisionNote] = useState("");
  const [trailOpen, setTrailOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("proposals")
      .select("id, opportunity_id, strategy, status, decision_note, decided_by, decided_at, updated_by, updated_at, created_by")
      .eq("opportunity_id", oppId).maybeSingle();
    const p = (data as Proposal | null) ?? null;
    setProp(p);
    setStrategy((cur) => (dirty ? cur : (p?.strategy ?? "")));   // don't clobber an in-flight edit
    if (p) {
      const { data: ev } = await supabase.from("proposal_events")
        .select("id, from_status, to_status, note, actor_id, at").eq("proposal_id", p.id).order("at", { ascending: false });
      setEvents((ev as Ev[]) ?? []);
    } else setEvents([]);
  }, [oppId, dirty]);

  useEffect(() => { load(); if (supabase) supabase.from("profiles").select("id, display_name, role").neq("role", "member").then(({ data }) => setStaff((data as typeof staff) ?? [])); }, [load]);
  useRealtimeTable({ table: "proposals", filter: `opportunity_id=eq.${oppId}` }, load);
  useRealtimeTable("proposal_events", load);

  const nameOf = (uid: string | null) => (uid === user?.id ? "You" : (staff.find((s) => s.id === uid)?.display_name?.trim().split(" ")[0] || "Crew"));
  const status = prop?.status ?? null;
  const decided = status === "won" || status === "lost";
  const idx = status ? LINEAR.indexOf(status) : -1;
  const nextStatus = idx >= 0 && idx < LINEAR.length - 1 ? LINEAR[idx + 1] : null;
  const prevStatus = idx > 0 ? LINEAR[idx - 1] : null;

  // Co-authored strategy edit — plain upsert keyed on opportunity_id (staff-write RLS); realtime
  // carries it to co-editors. One row shape (no id / created_by) so onConflict does the matching and
  // the birth trigger logs the first insert; status rides its column default of 'draft'.
  const saveStrategy = async () => {
    if (!supabase || !dirty) return;
    setBusy(true);
    const row = { opportunity_id: oppId, strategy, updated_by: user?.id ?? null, updated_at: new Date().toISOString() };
    const { error } = await supabase.from("proposals").upsert(row, { onConflict: "opportunity_id" });
    setBusy(false); setDirty(false);
    if (error) { toast(`Couldn't save — ${error.message}`, "error"); return; }
    load();
  };

  const advance = async (to: Status, note?: string) => {
    if (!supabase) return;
    setBusy(true);
    if (dirty) await saveStrategy();
    const { error } = await supabase.rpc("advance_proposal", { p_opportunity: oppId, p_to: to, p_note: note ?? null });
    setBusy(false);
    if (error) { toast(`Couldn't move it — ${error.message}`, "error"); return; }
    if (to !== "won" && to !== "lost") setDecisionNote("");
    // Ping the right people so the lifecycle is live: owners when it needs review/decision, the whole
    // desk when the owner decides.
    const meFirst = (profile?.display_name || "Crew").split(" ")[0];
    const label = vendorName ?? "an opportunity";
    if (to === "in_review") staff.filter((s) => (s.role === "owner" || s.role === "admin") && s.id !== user?.id)
      .forEach((s) => raiseAlertClient({ severity: "important", category: "strategy", kind: "thread_reply", subjectId: oppId, title: `Proposal ready for review — ${label}`, body: `${meFirst} sent the ${label} proposal for your review.`, link: "/crew?s=pipeline", targetUserId: s.id }));
    if (to === "won" || to === "lost") staff.filter((s) => s.id !== user?.id)
      .forEach((s) => raiseAlertClient({ severity: to === "won" ? "important" : "fyi", category: "strategy", kind: "thread_reply", subjectId: oppId, title: `Proposal ${to.toUpperCase()} — ${label}`, body: `${meFirst} recorded the decision on ${label}: ${to}.${note ? ` "${note.slice(0, 100)}"` : ""}`, link: "/crew?s=pipeline", targetUserId: s.id }));
    load();
  };

  const stepPill = (s: Status) => {
    const on = status === s;
    const past = idx >= 0 && LINEAR.indexOf(s) >= 0 && LINEAR.indexOf(s) < idx;
    return <span key={s} className={`pd-step${on ? " on" : ""}${past ? " past" : ""}`}>{LABEL[s]}</span>;
  };

  const editedLine = useMemo(() => prop ? `Edited by ${nameOf(prop.updated_by)} · ${when(prop.updated_at)}` : "", [prop, staff, user]);

  return (
    <div className="pd">
      <div className="pd-head">
        <span className="pd-title">Proposal &amp; reach-out strategy</span>
        {status && <span className={`pd-status s-${status}`}>{LABEL[status]}</span>}
      </div>

      {status && !decided && (
        <div className="pd-steps">{LINEAR.map(stepPill)}<span className="pd-step-arrow">→</span><span className={`pd-step decide${decided ? " on" : ""}`}>Decision</span></div>
      )}

      <textarea className="pd-strategy" value={strategy}
        onChange={(e) => { setStrategy(e.target.value); setDirty(true); }}
        onBlur={saveStrategy}
        placeholder={`How we win ${vendorName ?? "this account"} — the angle, who we reach, the offer, the sequence, objections and answers. Everyone on the desk can edit this.`}
        rows={5} aria-label="Reach-out strategy" />
      <div className="pd-meta">
        {dirty ? <span className="pd-saving">Unsaved…</span> : editedLine && <span>{editedLine}</span>}
        {busy && <span className="pd-saving">Working…</span>}
      </div>

      {!status && (
        <button type="button" className="pd-start" onClick={() => advance("draft")} disabled={busy}>Start the proposal</button>
      )}

      {status && !decided && (
        <div className="pd-controls">
          {prevStatus && <button type="button" className="pd-back" onClick={() => advance(prevStatus)} disabled={busy}>← {LABEL[prevStatus]}</button>}
          {nextStatus && <button type="button" className="pd-adv" onClick={() => advance(nextStatus)} disabled={busy}>{NEXT_VERB[nextStatus] ?? `To ${LABEL[nextStatus]}`} →</button>}
          {isAdmin && (
            <div className="pd-decide">
              <input className="auth-input" value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} placeholder="Decision note (optional)" aria-label="Decision note" />
              <button type="button" className="pd-won" onClick={() => advance("won", decisionNote.trim() || undefined)} disabled={busy}>Mark won</button>
              <button type="button" className="pd-lost" onClick={() => advance("lost", decisionNote.trim() || undefined)} disabled={busy}>Mark lost</button>
            </div>
          )}
          {!isAdmin && idx >= LINEAR.indexOf("sent") && <p className="pd-hint">Ready for the owner&rsquo;s decision — they&rsquo;ll record won or lost.</p>}
        </div>
      )}

      {decided && (
        <div className={`pd-decided ${status}`}>
          <b>{status === "won" ? "Won" : "Lost"}</b> · {prop?.decided_by ? nameOf(prop.decided_by) : "Owner"}{prop?.decided_at ? ` · ${when(prop.decided_at)}` : ""}
          {prop?.decision_note && <p className="pd-decided-note">&ldquo;{prop.decision_note}&rdquo;</p>}
          {isAdmin && <button type="button" className="pd-reopen" onClick={() => advance("negotiating")} disabled={busy}>Reopen</button>}
        </div>
      )}

      {events.length > 0 && (
        <div className="pd-trail">
          <button type="button" className="pd-trail-h" onClick={() => setTrailOpen((v) => !v)} aria-expanded={trailOpen}>Trail · {events.length} {trailOpen ? "▲" : "▼"}</button>
          {trailOpen && (
            <ol className="pd-trail-list">
              {events.map((e) => (
                <li key={e.id} className="pd-ev">
                  <span className="pd-ev-dot" aria-hidden />
                  <div>
                    <span className="pd-ev-t">{nameOf(e.actor_id)} {e.from_status ? `moved ${LABEL[e.from_status as Status] ?? e.from_status} → ${LABEL[e.to_status as Status] ?? e.to_status}` : `started the proposal`}</span>
                    <span className="pd-ev-w">{when(e.at)}</span>
                    {e.note && <p className="pd-ev-note">&ldquo;{e.note}&rdquo;</p>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
