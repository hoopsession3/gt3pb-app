"use client";

import { useState } from "react";
import { useAuth } from "./AuthProvider";
import { useApp } from "./AppProvider";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";
import { haptic, HAPTIC } from "@/lib/haptics";
import { resolveVendor, type ResolveDecision, type VendorMatch } from "@/lib/vendorLink";
import VendorResolve from "./VendorResolve";
import Icon from "@/components/Icon";

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
  // A look-alike vendor paused this op — the confirm sheet completes it with the human's decision.
  const [resolve, setResolve] = useState<{ op: Op; i: number; name: string; candidates: VendorMatch[] } | null>(null);

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

  const createOp = async (op: Op, i: number, decision?: ResolveDecision | "skip") => {
    if (!supabase || !user || done[i]) return;
    try {
      // Every venue/vendor goes through the ONE resolver (0226): exact name → the existing vendor;
      // a ≥40% look-alike → PAUSE and ask (the confirm sheet), never a silent duplicate; a clean
      // miss → created PENDING for owner approval. Created records link back to the note.
      const vendorFor = async (name: string): Promise<string | null | "asked"> => {
        if (decision === "skip") return null;
        const r = await resolveVendor(name, { source: "a meeting note", decision });
        if (r.kind === "similar") { setResolve({ op, i, name, candidates: r.candidates }); return "asked"; }
        return r.kind === "error" ? null : r.id;
      };
      // A vendor/pipeline op IS its vendor — skipping it creates nothing, so it must not read "done"
      // (panel finding: a skipped vendor op showed a ✓ and "created" with no row written).
      if (decision === "skip" && (op.type === "vendor" || op.type === "pipeline")) {
        toast("Skipped — nothing created"); return;
      }
      if (op.type === "task" || op.type === "brew") {
        await supabase.from("event_tasks").insert({ meeting_note_id: noteId, origin_note_id: noteId, label: (op.type === "brew" ? `Brew — ${op.title}` : op.title).slice(0, 300), kind: "task", section: "Follow-up", critical: !!op.critical, sort: 1000 + i });
      } else if (op.type === "stop") {
        const dk = whenToDate(op.when);
        const vid = await vendorFor(op.who || op.title);
        if (vid === "asked") return;
        const { data: s } = await supabase.from("stops").insert({ name: (op.who || op.title).slice(0, 120), location_text: op.who || null, starts_at: new Date(`${dk}T11:00:00`).toISOString(), status: "upcoming", sort: 0, vendor_id: vid }).select("id").single();
        if (s) await supabase.from("meeting_notes").update({ stop_id: (s as { id: string }).id }).eq("id", noteId);
      } else if (op.type === "event") {
        // An EVENT is a booked show — it belongs in the events table, not stops (the old code
        // mis-routed both into stops).
        const dk = whenToDate(op.when);
        const vid = await vendorFor(op.who || op.title);
        if (vid === "asked") return;
        const { data: e } = await supabase.from("events").insert({ title: op.title.slice(0, 160), day: dk, category: "event", location_text: op.who || null, vendor_id: vid }).select("id").single();
        if (e) await supabase.from("meeting_notes").update({ event_id: (e as { id: string }).id }).eq("id", noteId);
      } else if (op.type === "vendor") {
        const vid = await vendorFor(op.who || op.title);
        if (vid === "asked") return;
        if (vid) await supabase.from("meeting_notes").update({ vendor_id: vid }).eq("id", noteId);
      } else if (op.type === "pipeline") {
        const vid = await vendorFor(op.who || op.title);
        if (vid === "asked") return;
        if (vid) {
          const { data: opp } = await supabase.from("opportunities").insert({ vendor_id: vid, next_step: (op.details || "Make first contact").slice(0, 300), created_by: user.id }).select("id").single();
          if (opp) await supabase.from("meeting_notes").update({ opportunity_id: (opp as { id: string }).id, vendor_id: vid }).eq("id", noteId);
        }
      }
      setDone((s) => ({ ...s, [i]: true })); haptic(HAPTIC.success); toast(`${TYPE_LABEL[op.type] ?? "Op"} created`);
    } catch { toast("Couldn't create that one", "error"); }
  };

  const trackGap = async (g: Gap, i: number) => {
    if (!supabase || gapDone[i]) return;
    await supabase.from("event_tasks").insert({ meeting_note_id: noteId, origin_note_id: noteId, label: `BUILD: ${g.need}`.slice(0, 300), kind: "task", section: "Product gaps", critical: false, sort: 2000 + i });
    setGapDone((s) => ({ ...s, [i]: true })); toast("Gap tracked as a build task");
  };

  if (!plan) return (
    <button type="button" className={`ops-go${busy ? " loading" : ""}`} onClick={analyze} disabled={busy}>
      {busy ? <>Reading the note<span className="ops-dots"><i /><i /><i /></span></> : <><Icon name="sparkles" /> Build operations</>}
    </button>
  );

  const approved = Object.values(done).filter(Boolean).length;
  const total = plan.operations.length;

  return (
    <div className="ops-plan">
      <div className="ops-brief">
        <span className="ops-eye">Chief of staff · operations plan</span>
        {plan.headline && <p className="ops-headline">{plan.headline}</p>}
        <div className="ops-prog">
          <span className="ops-prog-bar"><i style={{ width: `${total ? (approved / total) * 100 : 0}%` }} /></span>
          <span className="ops-prog-n">{approved}/{total} approved</span>
        </div>
        <p className="ops-hint">Nothing is created until you approve each.</p>
      </div>

      <div className="ops-list">
        {plan.operations.map((op, i) => (
          <div key={i} className={`ops-op t-${op.type}${done[i] ? " is-done" : ""}${pending[i] ? " is-armed" : ""}`} style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}>
            <span className="ops-badge">{TYPE_LABEL[op.type] ?? op.type}</span>
            <div className="ops-op-x">
              <b>{op.title}{op.isNew ? <span className="ops-new">new</span> : null}</b>
              {[op.who, op.when, op.details].filter(Boolean).length > 0 && <span className="ops-meta">{[op.who, op.when, op.details].filter(Boolean).join(" · ")}</span>}
            </div>
            <div className="ops-act">
              {done[i] ? (
                <span className="ops-check" aria-label="Created"><Icon name="check" /></span>
              ) : pending[i] ? (
                <>
                  <button type="button" className="ops-approve" onClick={() => { setPending((p) => ({ ...p, [i]: false })); createOp(op, i); }}>Approve</button>
                  <button type="button" className="ops-cancel" onClick={() => setPending((p) => ({ ...p, [i]: false }))} aria-label="Cancel"><Icon name="close" /></button>
                </>
              ) : (
                <button type="button" className="ops-create" onClick={() => { haptic(HAPTIC.tap); setPending((p) => ({ ...p, [i]: true })); }}>Create</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {plan.gaps.length > 0 && (
        <div className="ops-gaps">
          <div className="ops-gaps-h"><span className="ops-gaps-dot" />Not built yet · {plan.gaps.length}</div>
          {plan.gaps.map((g, i) => (
            <div key={i} className="ops-gap">
              <div className="ops-op-x"><b>{g.need}</b>{g.why && <span className="ops-meta">{g.why}</span>}</div>
              <button type="button" className="ops-track" onClick={() => trackGap(g, i)} disabled={gapDone[i]}>{gapDone[i] ? <Icon name="check" /> : "Track"}</button>
            </div>
          ))}
        </div>
      )}
      {resolve && (
        <VendorResolve name={resolve.name} candidates={resolve.candidates}
          onUse={(c) => { const { op, i } = resolve; setResolve(null); createOp(op, i, { linkTo: c.id }); }}
          onCreateDistinct={() => { const { op, i } = resolve; setResolve(null); createOp(op, i, { createDistinct: true }); }}
          // A stop/event can exist without a vendor; a vendor/pipeline op can't — no skip for those.
          onSkip={resolve.op.type === "stop" || resolve.op.type === "event"
            ? () => { const { op, i } = resolve; setResolve(null); createOp(op, i, "skip"); }
            : undefined}
          onClose={() => setResolve(null)}
        />
      )}
    </div>
  );
}
