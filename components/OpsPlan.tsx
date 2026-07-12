"use client";

import { useState } from "react";
import { useAuth } from "./AuthProvider";
import { useApp } from "./AppProvider";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";

// OPS PLAN (chief-of-staff) — turn a meeting note into a build-able operations plan. Calls the
// opsplan agent, then lets the operator tap "Create" on each proposed op (event/stop, vendor,
// pipeline opportunity, prep task) — each writes through the SAME path the manual UI uses — and
// flags gaps the app can't handle yet. Human-in-the-loop: the agent proposes, you commit.
type Op = { type: string; title: string; when?: string; who?: string; details?: string; critical?: boolean; isNew?: boolean };
type Gap = { need: string; why?: string };
type Plan = { headline?: string; operations: Op[]; gaps: Gap[] };

const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DOW = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
// A `when` string → a YYYY-MM-DD key. ISO passes through; a weekday word → its next occurrence;
// anything else → the next Saturday (the truck's default event day).
function whenToDate(when?: string): string {
  const s = (when ?? "").trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const low = s.toLowerCase();
  for (let i = 0; i < 7; i++) if (low.includes(DOW[i]) || low.includes(DOW[i].slice(0, 3))) {
    const d = new Date(); const add = ((i - d.getDay() + 7) % 7) || 7; d.setDate(d.getDate() + add); return keyOf(d);
  }
  const d = new Date(); const add = ((6 - d.getDay() + 7) % 7) || 7; d.setDate(d.getDate() + add); return keyOf(d);
}

const TYPE_LABEL: Record<string, string> = { event: "Event", stop: "Truck stop", vendor: "Vendor", pipeline: "Pipeline", task: "Task", brew: "Brew" };

export default function OpsPlan({ noteId }: { noteId: string }) {
  const { user } = useAuth();
  const { toast } = useApp();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Record<number, boolean>>({}); // armed for a 2nd-tap approve
  const [done, setDone] = useState<Record<number, boolean>>({});
  const [gapDone, setGapDone] = useState<Record<number, boolean>>({});

  const analyze = async () => {
    if (busy) return; setBusy(true);
    try {
      const r = await authedFetch("/api/agents/opsplan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note_id: noteId }) });
      const d = await r.json();
      if (!d?.ok) { toast(d?.error || "Couldn't read the note", "error"); setBusy(false); return; }
      setPlan(d.plan as Plan);
      if (!d.plan.operations?.length && !d.plan.gaps?.length) toast("No operations found in this note");
    } catch { toast("Analysis failed — try again", "error"); }
    setBusy(false);
  };

  const createOp = async (op: Op, i: number) => {
    if (!supabase || !user || done[i]) return;
    try {
      if (op.type === "task" || op.type === "brew") {
        await supabase.from("event_tasks").insert({ meeting_note_id: noteId, origin_note_id: noteId, label: (op.type === "brew" ? `Brew — ${op.title}` : op.title).slice(0, 300), kind: "task", section: "Follow-up", critical: !!op.critical, sort: 1000 + i });
      } else if (op.type === "stop" || op.type === "event") {
        const dk = whenToDate(op.when);
        await supabase.from("stops").insert({ name: (op.who || op.title).slice(0, 120), location_text: op.who || null, starts_at: new Date(`${dk}T11:00:00`).toISOString(), status: "upcoming", sort: 0 });
      } else if (op.type === "vendor") {
        await supabase.from("vendors").insert({ name: (op.who || op.title).slice(0, 120), vendor_type: "gym" });
      } else if (op.type === "pipeline") {
        const vname = (op.who || op.title).slice(0, 120);
        let vid: string | null = null;
        const { data: ex } = await supabase.from("vendors").select("id").ilike("name", vname).limit(1).maybeSingle();
        if (ex) vid = (ex as { id: string }).id;
        else { const { data: nv } = await supabase.from("vendors").insert({ name: vname, vendor_type: "gym" }).select("id").single(); vid = (nv as { id: string } | null)?.id ?? null; }
        if (vid) await supabase.from("opportunities").insert({ vendor_id: vid, next_step: (op.details || "Make first contact").slice(0, 300), created_by: user.id });
      }
      setDone((s) => ({ ...s, [i]: true })); toast(`${TYPE_LABEL[op.type] ?? "Op"} created`);
    } catch { toast("Couldn't create that one", "error"); }
  };

  const trackGap = async (g: Gap, i: number) => {
    if (!supabase || gapDone[i]) return;
    await supabase.from("event_tasks").insert({ meeting_note_id: noteId, origin_note_id: noteId, label: `BUILD: ${g.need}`.slice(0, 300), kind: "task", section: "Product gaps", critical: false, sort: 2000 + i });
    setGapDone((s) => ({ ...s, [i]: true })); toast("Gap tracked as a build task");
  };

  if (!plan) return (
    <button type="button" className="ops-go" onClick={analyze} disabled={busy}>{busy ? "Reading the note…" : "⚡ Build operations"}</button>
  );

  return (
    <div className="ops-plan">
      {plan.headline && <p className="ops-headline">{plan.headline}</p>}
      <p className="ops-hint">Proposals only — nothing is created until you tap <b>Approve</b> on each.</p>
      {plan.operations.map((op, i) => (
        <div key={i} className={`ops-op${done[i] ? " ops-done" : ""}`}>
          <span className={`ops-badge t-${op.type}`}>{TYPE_LABEL[op.type] ?? op.type}</span>
          <div className="ops-op-x">
            <b>{op.title}{op.isNew ? <span className="ops-new">new</span> : null}</b>
            <span>{[op.who, op.when, op.details].filter(Boolean).join(" · ")}</span>
          </div>
          {done[i] ? (
            <button type="button" className="ops-create" disabled>✓ Created</button>
          ) : pending[i] ? (
            <span className="ops-confirm">
              <button type="button" className="ops-create ok" onClick={() => { setPending((p) => ({ ...p, [i]: false })); createOp(op, i); }}>Approve</button>
              <button type="button" className="ops-create ghost" onClick={() => setPending((p) => ({ ...p, [i]: false }))} aria-label="Cancel">✕</button>
            </span>
          ) : (
            <button type="button" className="ops-create" onClick={() => setPending((p) => ({ ...p, [i]: true }))}>Create</button>
          )}
        </div>
      ))}
      {plan.gaps.length > 0 && (
        <div className="ops-gaps">
          <div className="ops-gaps-h">⚠ Not built yet</div>
          {plan.gaps.map((g, i) => (
            <div key={i} className="ops-gap">
              <div className="ops-op-x"><b>{g.need}</b>{g.why && <span>{g.why}</span>}</div>
              <button type="button" className="ops-create ghost" onClick={() => trackGap(g, i)} disabled={gapDone[i]}>{gapDone[i] ? "✓" : "Track"}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
