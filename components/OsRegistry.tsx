"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";
import { useApp } from "./AppProvider";
import { useRealtimeTable } from "@/lib/realtime";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import Sheet from "@/components/Sheet";
import { SectionHeader } from "@/components/kit";
import Icon from "@/components/Icon";

/* eslint-disable @typescript-eslint/no-explicit-any */
// THE WORKSTREAM REGISTRY (0264, 2026-08-03) — "the one place to manage every component and
// stream." Ten workstreams, one accountable owner each, audited every Monday on the Executive
// OS rubric: Owner · Next action · Blockers · Artifacts · Signal, 2 points each. The score is a
// search function for where management attention goes this week — not a grade. House rules,
// encoded: 10 green · 8–9 amber watch · below 8 gets named in the weekly review · below 8 two
// weeks running demands a kill / pause / recover decision IN THE LEDGER · parked-by-decision is
// legal, stalled-without-a-decision is not.

type Ws = {
  id: string; name: string; owner: string; status: "active" | "blocked" | "parked";
  health: number; next_action: string | null; due: string | null; blocker: string | null;
  last_audited: string | null; sort: number;
};
type Audit = { id: string; workstream_id: string; week_of: string; total: number };

const CRITERIA = [
  { key: "c_owner",     label: "Owner",       hint: "Exactly one name. Shared ownership scores zero." },
  { key: "c_next",      label: "Next action", hint: "Specific, dated, no more than 7 days out." },
  { key: "c_blockers",  label: "Blockers",    hint: "None stale past 7 days without escalation." },
  { key: "c_artifacts", label: "Artifacts",   hint: "Latest version linked. No unversioned edits in the wild." },
  { key: "c_signal",    label: "Signal",      hint: "A linked KPI or gate has moved since the last audit." },
] as const;

const dotClass = (h: number, status: string) => status === "parked" ? "park" : h >= 10 ? "green" : h >= 8 ? "amber" : "red";
const nice = (iso: string | null) => iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
const daysSince = (iso: string | null) => iso ? Math.floor((Date.now() - new Date(`${iso}T12:00:00`).getTime()) / 864e5) : null;

export default function OsRegistry() {
  const { user, profile } = useAuth();
  const { toast } = useApp();
  const isAdmin = !!profile?.is_admin || ["owner", "admin"].includes(String((profile as any)?.role ?? ""));
  const [auditing, setAuditing] = useState<Ws | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState({ name: "", owner: "", next_action: "", due: "", blocker: "", status: "active" as Ws["status"], note: "" });
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");

  const loader = useCallback(async (): Promise<{ rows: Ws[]; recent: Audit[] }> => {
    if (!supabase) return { rows: [], recent: [] };
    const [w, a] = await Promise.all([
      supabase.from("os_workstreams").select("*").order("sort"),
      supabase.from("workstream_audits").select("id, workstream_id, week_of, total").order("week_of", { ascending: false }).limit(40),
    ]);
    if (w.error) throw new Error(w.error.message);
    return { rows: (w.data as Ws[]) ?? [], recent: (a.data as Audit[]) ?? [] };
  }, []);
  const state = useAsyncData(loader, []);
  const { reload } = state;
  useRealtimeTable(["os_workstreams", "workstream_audits"], reload);

  const openAudit = (w: Ws) => {
    setAuditing(w);
    setScores({});
    setDraft({ name: w.name, owner: w.owner, next_action: w.next_action ?? "", due: w.due ?? "", blocker: w.blocker ?? "", status: w.status, note: "" });
  };
  const total = CRITERIA.reduce((s, c) => s + (scores[c.key] ?? 0), 0);
  const anyScored = CRITERIA.some((c) => scores[c.key] !== undefined);
  const scored = CRITERIA.every((c) => scores[c.key] !== undefined);

  // Everything is editable in place, no restart (2026-08-03, Ryan): the same sheet saves two
  // ways — score all five and it's a Monday AUDIT (history row + health), score none and it's a
  // DETAILS edit (rename, re-own, re-date, re-status — nothing else moves). Partial scoring
  // blocks the save so a half-audit can never masquerade as either.
  const save = async () => {
    if (!supabase || !auditing || saving || (anyScored && !scored) || !draft.name.trim() || !draft.owner.trim()) return;
    setSaving(true);
    const today = new Date().toISOString().slice(0, 10);
    if (scored) {
      const { error } = await supabase.from("workstream_audits").upsert({
        workstream_id: auditing.id, week_of: today,
        c_owner: scores.c_owner, c_next: scores.c_next, c_blockers: scores.c_blockers,
        c_artifacts: scores.c_artifacts, c_signal: scores.c_signal,
        total, note: draft.note.trim() || null, audited_by: user?.id ?? null,
      }, { onConflict: "workstream_id,week_of" });
      if (error) { toast(`Couldn't save the audit — ${error.message}`, "error"); setSaving(false); return; }
    }
    const { error: e2 } = await supabase.from("os_workstreams").update({
      name: draft.name.trim().slice(0, 80), owner: draft.owner.trim().slice(0, 40), status: draft.status,
      next_action: draft.next_action.trim() || null, due: draft.due || null, blocker: draft.blocker.trim() || null,
      ...(scored ? { health: total, last_audited: today } : {}),
    }).eq("id", auditing.id);
    setSaving(false);
    if (e2) { toast(`Couldn't save — ${e2.message}`, "error"); return; }
    toast(!scored ? "Stream updated" : total >= 10 ? `${draft.name}: 10 — green` : total >= 8 ? `${draft.name}: ${total} — amber watch` : `${draft.name}: ${total} — named in this week's review`);
    setAuditing(null); reload();
  };

  const addStream = async () => {
    if (!supabase || !newName.trim()) return;
    const { error } = await supabase.from("os_workstreams").insert({ name: newName.trim().slice(0, 80), owner: "Ryan", health: 0, sort: 1000 });
    if (error) { toast(String(error.message).includes("unique") ? "That workstream already exists" : `Couldn't add — ${error.message}`, "error"); return; }
    setNewName(""); toast("Added — open it to set the owner and next action"); reload();
  };
  const removeStream = async () => {
    if (!supabase || !auditing) return;
    if (typeof window !== "undefined" && !window.confirm(`Remove "${auditing.name}" from the portfolio? Its audit history goes with it. (Parking by decision is usually the better move.)`)) return;
    const { error } = await supabase.from("os_workstreams").delete().eq("id", auditing.id);
    if (error) { toast(`Couldn't remove — ${error.message}`, "error"); return; }
    toast("Removed from the portfolio"); setAuditing(null); reload();
  };

  return (
    <div className="adm-sec" id="os-registry">
      <AsyncSection state={state} isEmpty={({ rows }) => rows.length === 0} emptyTitle="No workstreams yet" loadingLabel="Loading the portfolio…" errorTitle="Couldn't load the portfolio">
        {({ rows, recent }) => {
          const active = rows.filter((r) => r.status !== "parked");
          const mean = active.length ? (active.reduce((s, r) => s + r.health, 0) / active.length) : 0;
          // Two-week rule: latest two audits both below 8 → the stream owes the ledger a decision.
          const owesDecision = (w: Ws) => {
            const mine = recent.filter((a) => a.workstream_id === w.id).slice(0, 2);
            return w.status === "active" && mine.length >= 2 && mine.every((a) => a.total < 8);
          };
          return (
            <>
              <SectionHeader label="The portfolio" annotation="ten workstreams · audited Mondays"
                right={<span className={`osr-mean ${mean >= 8 ? "ok" : "warn"}`}>mean {mean.toFixed(1)}</span>} />
              <div className="h-sub">Score is a search function for where attention goes this week. Below 8 gets named in the review; below 8 two weeks running owes the ledger a kill / pause / recover decision. Parked by decision is legal — stalled without one is not.</div>
              <div className="osr-rows">
                {isAdmin && (
                  <div className="osr-add">
                    <input className="note-in" placeholder="＋ Add a workstream…" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addStream(); }} aria-label="New workstream name" />
                    {newName.trim() && <button type="button" className="note-save" onClick={addStream}>Add</button>}
                  </div>
                )}
                {rows.map((w) => {
                  const stale = (daysSince(w.last_audited) ?? 99) >= 7;
                  return (
                    <button key={w.id} type="button" className={`osr-row${w.status === "parked" ? " parked" : ""}`} onClick={() => isAdmin && openAudit(w)} disabled={!isAdmin} aria-label={`Audit ${w.name}`}>
                      <span className={`osr-dot ${dotClass(w.health, w.status)}`}>{w.status === "parked" ? "‖" : w.health}</span>
                      <span className="osr-main">
                        <span className="osr-name">{w.name}<i className="osr-owner">{w.owner}</i>{w.status === "blocked" && <i className="osr-flag">blocked</i>}{w.status === "parked" && <i className="osr-flag park">parked by decision</i>}</span>
                        {w.status !== "parked" && (
                          <span className="osr-next">{w.next_action ?? "no next action — that's a 0 on criterion 2"}{w.due ? ` · ${nice(w.due)}` : ""}</span>
                        )}
                        {w.blocker && w.status !== "parked" && <span className="osr-block"><Icon name="warning" /> {w.blocker}</span>}
                        {owesDecision(w) && <span className="osr-owes">⚖ two weeks below 8 — log kill / pause / recover in the ledger (Plan › Operating rhythm)</span>}
                      </span>
                      <span className={`osr-when${stale ? " stale" : ""}`}>{w.last_audited ? `${daysSince(w.last_audited)}d` : "never"}</span>
                    </button>
                  );
                })}
              </div>
            </>
          );
        }}
      </AsyncSection>

      {auditing && (
        <Sheet open onClose={() => setAuditing(null)} label={`Audit ${auditing.name}`}
          header={<div className="note-lux-head"><span className="note-lux-eyb">Monday audit · {auditing.name}</span><button type="button" className="qd-x" onClick={() => setAuditing(null)} aria-label="Close"><Icon name="close" /></button></div>}
          footer={<div className="note-actions"><span className="osr-total">{scored ? `${total} / 10` : anyScored ? "score all five" : "details only"}</span><button type="button" className="note-cancel" onClick={() => setAuditing(null)}>Cancel</button><button type="button" className="note-save" disabled={saving || (anyScored && !scored) || !draft.name.trim() || !draft.owner.trim()} onClick={save}>{saving ? "Saving…" : scored ? "Save audit" : "Save details"}</button></div>}>
          <div className="osr-audit">
            <div className="osr-audit-row">
              <label className="prod-f"><span>Workstream</span>
                <input className="note-in" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={80} /></label>
              <label className="prod-f"><span>Owner — exactly one name</span>
                <input className="note-in" value={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.value })} maxLength={40} /></label>
            </div>
            {CRITERIA.map((c) => (
              <div key={c.key} className="osr-crit">
                <div className="osr-crit-h"><b>{c.label}</b><span>{c.hint}</span></div>
                <div className="osr-crit-chips" role="radiogroup" aria-label={c.label}>
                  {[0, 1, 2].map((v) => (
                    <button key={v} type="button" role="radio" aria-checked={scores[c.key] === v}
                      className={`osr-chip${scores[c.key] === v ? " on" : ""}${v === 2 ? " full" : v === 0 ? " zero" : ""}`}
                      onClick={() => setScores((s) => ({ ...s, [c.key]: v }))}>{v}</button>
                  ))}
                </div>
              </div>
            ))}
            <label className="prod-f"><span>Next action — specific, dated, ≤ 7 days out</span>
              <input className="note-in" value={draft.next_action} onChange={(e) => setDraft({ ...draft, next_action: e.target.value })} placeholder="The one move this week" /></label>
            <div className="osr-audit-row">
              <label className="prod-f"><span>Due</span><input type="date" className="note-in" value={draft.due} onChange={(e) => setDraft({ ...draft, due: e.target.value })} /></label>
              <label className="prod-f"><span>Status</span>
                <select className="note-in" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Ws["status"] })}>
                  <option value="active">Active</option><option value="blocked">Blocked</option><option value="parked">Parked (by logged decision)</option>
                </select></label>
            </div>
            <label className="prod-f"><span>Blocker — none stale past 7 days without escalation</span>
              <input className="note-in" value={draft.blocker} onChange={(e) => setDraft({ ...draft, blocker: e.target.value })} placeholder="What's stuck, if anything" /></label>
            <label className="prod-f"><span>Audit note — why it isn't a 10</span>
              <input className="note-in" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="One line, plain" /></label>
            <button type="button" className="note-del osr-remove" onClick={removeStream}>Remove from the portfolio</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
