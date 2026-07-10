"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";
import { raiseAlertClient } from "@/lib/clientAlerts";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { GTM_PLAYS, type GtmPlay } from "@/lib/strategy";

// STRATEGY COLLABORATION — three small tools that make the playbook a working document:
//  · StrategyThread — live discussion on any block/play (the comments engine + strategy_key, 0140);
//    posting pings the other owners/admins through the alert ladder, so "live" means live.
//  · DecisionLog — append-only governance ledger: no strategic call without a log line. It cannot
//    be edited or deleted (no RLS policies for it, on purpose) — history is history.
//  · PlayBuilder — the guided walkthrough for building a new play or overhauling one: seven steps,
//    each with one coaching line, saved as a DRAFT in the debrief's GTM record shape.

// ── live thread ──
type C = { id: string; body: string; author_id: string | null; created_at: string };
export function StrategyThread({ k, label }: { k: string; label: string }) {
  const { toast } = useApp();
  const { user, profile } = useAuth();
  const [rows, setRows] = useState<C[]>([]);
  const [staff, setStaff] = useState<{ id: string; display_name: string | null; role: string | null }[]>([]);
  const [text, setText] = useState("");
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("comments").select("id, body, author_id, created_at").eq("strategy_key", k).order("created_at");
    setRows((data as C[]) ?? []);
  }, [k]);
  useEffect(() => {
    load();
    if (!supabase) return;
    supabase.from("profiles").select("id, display_name, role").neq("role", "member").then(({ data }) => setStaff((data as typeof staff) ?? []));
  }, [load]);
  useRealtimeTable({ table: "comments", filter: `strategy_key=eq.${k}` }, load);
  const nameOf = (uid: string | null) => (uid === user?.id ? "You" : (staff.find((s) => s.id === uid)?.display_name?.trim().split(" ")[0] || "Crew"));
  const send = async () => {
    if (!supabase || !text.trim()) return;
    const body = text.trim();
    const { error } = await supabase.from("comments").insert({ strategy_key: k, body, author_id: user?.id ?? null });
    if (error) { toast(`Error: ${error.message}`, "error"); return; }
    setText(""); load();
    // ping the other owners/admins so collaboration is live even when the page isn't open
    const meFirst = (profile?.display_name || "Owner").split(" ")[0];
    staff.filter((s) => (s.role === "owner" || s.role === "admin") && s.id !== user?.id).forEach((s) =>
      raiseAlertClient({ severity: "important", category: "strategy", title: `${meFirst} on the playbook`, body: `${label}: ${body.slice(0, 140)}`, link: "/playbook", targetUserId: s.id }));
  };
  return (
    <div className="st-thread">
      {rows.map((c) => (
        <div key={c.id} className={`st-msg${c.author_id === user?.id ? " me" : ""}`}>
          <b>{nameOf(c.author_id)}</b> <span className="st-when">{new Date(c.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
          <p>{c.body}</p>
        </div>
      ))}
      <div className="st-inbar">
        <input className="auth-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Talk it through — the other owners get pinged" onKeyDown={(e) => e.key === "Enter" && send()} aria-label="Comment" />
        <button type="button" className="handle" onClick={send} disabled={!text.trim()}><span>Send</span></button>
      </div>
    </div>
  );
}

// ── decision log ──
type Decision = { id: string; key: string; decision: string; why: string | null; author_name: string | null; created_at: string };
export function DecisionLog({ canWrite }: { canWrite: boolean }) {
  const { toast } = useApp();
  const { user, profile } = useAuth();
  const [rows, setRows] = useState<Decision[]>([]);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ key: "", decision: "", why: "" });
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("strategy_decisions").select("*").order("created_at", { ascending: false }).limit(50);
    setRows((data as Decision[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);
  const add = async () => {
    if (!supabase || !f.decision.trim()) return;
    const { error } = await supabase.from("strategy_decisions").insert({
      key: f.key.trim() || "general", decision: f.decision.trim(), why: f.why.trim() || null,
      author_id: user?.id ?? null, author_name: profile?.display_name ?? null,
    });
    if (error) { toast(`Error: ${error.message}`, "error"); return; }
    setF({ key: "", decision: "", why: "" }); setAdding(false); load();
    toast("Logged — the record stands");
  };
  return (
    <div className="st-log">
      {canWrite && (
        adding ? (
          <div className="st-log-form">
            <input className="auth-input" placeholder="What it concerns (e.g. pricing, gtm:wholesale)" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} />
            <input className="auth-input" placeholder="The decision, one sentence" value={f.decision} onChange={(e) => setF({ ...f, decision: e.target.value })} />
            <input className="auth-input" placeholder="Why (optional, future-you will ask)" value={f.why} onChange={(e) => setF({ ...f, why: e.target.value })} />
            <div className="st-log-btns">
              <button type="button" className="handle" onClick={add} disabled={!f.decision.trim()}><span>Log it</span></button>
              <button type="button" className="dl-back" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        ) : <button type="button" className="dl-card st-log-add" onClick={() => setAdding(true)}><b>＋ Log a decision</b><span>Append-only — it can never be edited or deleted. No strategic call without a log line.</span></button>
      )}
      {rows.length === 0 && !adding && <p className="dl-sub">Nothing logged yet. The first entry should probably be adopting Rev 1.0.</p>}
      {rows.map((d) => (
        <div key={d.id} className="st-log-row">
          <div className="st-log-top"><span className="st-log-key">{d.key}</span><span className="st-when">{d.author_name?.split(" ")[0] || "Owner"} · {new Date(d.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></div>
          <b>{d.decision}</b>
          {d.why && <p>{d.why}</p>}
        </div>
      ))}
    </div>
  );
}

// ── the guided builder ──
export type Draft = {
  id: string; name: string; category: string; overhauls: string | null; audience: string | null;
  what: string; execution_steps: string[]; projected_revenue: string | null; projected_cost: string | null;
  projected_cac: string | null; payback: string | null; in_app: string | null; status: string; author_name: string | null;
};
const CATS = ["channel", "partnership", "campaign", "community", "retention"] as const;
const COACH: Record<number, string> = {
  0: "Name it like you'd say it to Kayla. Pick the shelf it lives on.",
  1: "Who is this FOR? A play aimed at everyone is aimed at no one.",
  2: "The play in two sentences, plain English. If it needs more, it isn't a play yet — it's a wish.",
  3: "The first three moves. Concrete enough that next Tuesday knows what to do.",
  4: "Honest numbers beat happy ones — the log will compare you to them later.",
  5: "Every play needs a surface in the app that runs it — or name what's missing so it becomes a build.",
  6: "Read it once out loud. Then save the draft and open the discussion.",
};
export function PlayBuilder({ prefill, onDone }: { prefill?: GtmPlay | null; onDone: () => void }) {
  const { toast } = useApp();
  const { user, profile } = useAuth();
  const [step, setStep] = useState(0);
  const [f, setF] = useState({
    name: prefill?.name ?? "", category: (prefill?.category ?? "channel") as string,
    audience: "", what: prefill?.what ?? "", steps: "", revenue: "", cost: "", cac: "",
    payback: prefill?.payback ?? "", inApp: prefill?.inApp ?? "",
  });
  const save = async () => {
    if (!supabase) return;
    const { error } = await supabase.from("gtm_drafts").insert({
      name: f.name.trim(), category: f.category, overhauls: prefill ? prefill.name : null,
      audience: f.audience.trim() || null, what: f.what.trim(),
      execution_steps: f.steps.split("\n").map((s) => s.trim()).filter(Boolean),
      projected_revenue: f.revenue.trim() || null, projected_cost: f.cost.trim() || null,
      projected_cac: f.cac.trim() || null, payback: f.payback.trim() || null, in_app: f.inApp.trim() || null,
      author_id: user?.id ?? null, author_name: profile?.display_name ?? null,
    });
    if (error) { toast(`Error: ${error.message}`, "error"); return; }
    toast(prefill ? "Overhaul drafted — discuss it, then log the decision" : "Play drafted — discuss it, then log the decision");
    onDone();
  };
  const steps = [
    <div key={0} className="st-b">
      <input className="auth-input" placeholder="Play name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <div className="st-cats">{CATS.map((c) => <button type="button" key={c} className={`chub-q st-cat${f.category === c ? " on" : ""}`} onClick={() => setF({ ...f, category: c })}>{c}</button>)}</div>
    </div>,
    <input key={1} className="auth-input" placeholder="Target audience" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })} />,
    <textarea key={2} className="auth-input" rows={3} placeholder="The play, in plain English" value={f.what} onChange={(e) => setF({ ...f, what: e.target.value })} />,
    <textarea key={3} className="auth-input" rows={4} placeholder={"Execution steps — one per line"} value={f.steps} onChange={(e) => setF({ ...f, steps: e.target.value })} />,
    <div key={4} className="st-b">
      <input className="auth-input" placeholder="Projected revenue (e.g. $2,000–2,400/mo)" value={f.revenue} onChange={(e) => setF({ ...f, revenue: e.target.value })} />
      <input className="auth-input" placeholder="Projected cost" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} />
      <input className="auth-input" placeholder="Customer acquisition (how many, from where)" value={f.cac} onChange={(e) => setF({ ...f, cac: e.target.value })} />
      <input className="auth-input" placeholder="Payback period" value={f.payback} onChange={(e) => setF({ ...f, payback: e.target.value })} />
    </div>,
    <input key={5} className="auth-input" placeholder="Where the app runs it (or what's missing)" value={f.inApp} onChange={(e) => setF({ ...f, inApp: e.target.value })} />,
    <div key={6} className="st-review">
      <b>{f.name || "Unnamed"}</b> <span className="pb-status planning">{f.category}</span>
      {prefill && <p className="dl-sub">Overhauls: {prefill.name}</p>}
      <p>{f.what}</p>
      {f.steps && <p className="dl-sub">{f.steps.split("\n").filter(Boolean).length} execution steps</p>}
      <p className="pb-roi"><b>{[f.revenue, f.cost && `cost ${f.cost}`, f.payback && `payback ${f.payback}`].filter(Boolean).join(" · ") || "no numbers yet"}</b></p>
      {f.inApp && <p className="pb-inapp">{f.inApp}</p>}
    </div>,
  ];
  const canNext = step === 0 ? !!f.name.trim() : step === 2 ? !!f.what.trim() : true;
  return (
    <div className="st-builder">
      <div className="dops-kick">{prefill ? `Overhaul: ${prefill.name}` : "Build a play"} · step {step + 1} of 7</div>
      <p className="st-coach">{COACH[step]}</p>
      {steps[step]}
      <div className="st-log-btns">
        {step > 0 && <button type="button" className="dl-back" onClick={() => setStep(step - 1)}>‹ Back</button>}
        {step < 6
          ? <button type="button" className="handle" onClick={() => setStep(step + 1)} disabled={!canNext}><span>Next ›</span></button>
          : <button type="button" className="handle" onClick={save} disabled={!f.name.trim() || !f.what.trim()}><span>Save draft</span></button>}
        <button type="button" className="dl-back" onClick={onDone}>Close</button>
      </div>
    </div>
  );
}

export function useDrafts() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("gtm_drafts").select("*").neq("status", "retired").order("created_at", { ascending: false });
    setDrafts((data as Draft[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);
  return { drafts, reload: load };
}
export { GTM_PLAYS };
