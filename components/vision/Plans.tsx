"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { failureWords } from "@/lib/failureWords";
import { useAppStable } from "@/components/AppProvider";
import { useConfirm } from "@/components/ConfirmSheet";
import Sheet, { CloseButton, useUnsaved } from "@/components/Sheet";
import { Segmented } from "@/components/controls";
import MoneyPanel from "./MoneyPanel";
import CaseWords from "./CaseWords";
import Advisor from "./Advisor";
import { haptic } from "@/lib/haptics";
import { localToday } from "@/lib/dates";
import { askTotals, shortMoney, type Ask, type Layout, type Program } from "@/lib/vision";
import {
  DEALS, DEAL_WORD, FORMAT, FORMATS, NEED_KINDS, NEED_WORD, PLAN_STATUS, PLAN_STATUSES, compareRows, needsProgress, phases, roomFor, sqftWords,
  waitingOn, wouldLoop, type Dep, type Need, type Plan,
} from "@/lib/visionPlans";

// THE WAYS IN (R53, phase A). Every program can be reached more than one way — a bar inside a gym, our recipe on a
// partner café's menu, a pop-up, a leased or a bought storefront — and each way is a plan of its own: its phase, its
// gate ("go when…"), what it needs (the requirements are its milestones), what it waits on, its size, its deal and its
// room. Phases shows them as the steps they are; Side by side asks every plan the same questions. An owner edits a plan
// in its sheet; the crew read it.
type View = "phases" | "compare";
/** A status's tag, written whole (so the class names are words Tailwind and the CSS audit can read). */
const TAG = { "": "k-tag", ok: "k-tag ok", gold: "k-tag gold", warn: "k-tag warn", crit: "k-tag crit", blue: "k-tag blue" } as const;

export default function Plans({ programs, plans, needs, deps, asks, layouts, ready, canEdit, isOwner = false, onSaved, onOpenStore }: {
  programs: Program[]; plans: Plan[]; needs: Need[]; deps: Dep[]; asks: Ask[]; layouts: Layout[]; ready: boolean; canEdit: boolean; isOwner?: boolean;
  onSaved: () => void; onOpenStore: (layoutId: string) => void;
}) {
  const [view, setView] = useState<View>("phases");
  const [open, setOpen] = useState<Plan | { program_id: string; phase: number } | null>(null);
  const withPlans = programs.filter((p) => plans.some((x) => x.program_id === p.id));
  const others = programs.filter((p) => !plans.some((x) => x.program_id === p.id));
  const [newFor, setNewFor] = useState("");
  // A plan's case (R54): the plan, then its money — and, as the phases land, its traffic, its evidence and the investor case.
  const [caseId, setCaseId] = useState<string | null>(null);
  const caseOf = plans.find((x) => x.id === caseId) ?? null;

  if (!ready) {
    return (
      <div className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5">
        <b className="font-sans text-body">Plans arrive with the next database update</b>
        <p className="vz-sub">The ways in — a bar inside a gym, a partner café&apos;s menu, a storefront — each with its phase, its gate and what it needs, need migration 0448. The roadmap and the store work as before.</p>
      </div>
    );
  }

  if (caseOf) {
    return (
      <>
        <PlanCase plan={caseOf} plans={plans} needs={needs} deps={deps} asks={asks} layouts={layouts} canEdit={canEdit} isOwner={isOwner}
          onBack={() => setCaseId(null)} onEdit={() => setOpen(caseOf)} onOpenStore={onOpenStore} onSaved={onSaved} />
        {open && (
          <PlanSheet key={"id" in open ? open.id : "new"} plan={"id" in open ? open : null} draft={"id" in open ? null : open}
            programs={programs} plans={plans} needs={needs} deps={deps} asks={asks} layouts={layouts} canEdit={canEdit}
            onClose={() => setOpen(null)} onSaved={() => { setOpen(null); onSaved(); }} onOpenStore={onOpenStore} />
        )}
      </>
    );
  }

  return (
    <div className="vz">
      <div className="vz-top">
        <p className="vz-sub">Every way in, as its own plan — in the phases they&apos;d happen, each with the gate that says when it goes.</p>
        <Segmented label="Show" kind="choice" value={view} onChange={setView} options={[{ key: "phases", label: "Phases" }, { key: "compare", label: "Side by side" }]} />
      </div>
      {canEdit && <Advisor plans={plans} needs={needs} deps={deps} layouts={layouts} onOpen={setCaseId} />}
      {withPlans.length === 0 && <p className="vz-sub">No plans yet{canEdit ? " — start one below." : "."}</p>}
      {withPlans.map((prog) => {
        const mine = plans.filter((x) => x.program_id === prog.id);
        return (
          <section key={prog.id} className="vz-prog" aria-label={`${prog.title}: its ways in`}>
            <div className="vz-col-h"><b>{prog.emoji ? `${prog.emoji} ` : ""}{prog.title}</b><span>{mine.length} {mine.length === 1 ? "way in" : "ways in"}</span></div>
            {view === "phases" ? (
              <div className="vz-ladder grid-cols-1 min-[760px]:grid-cols-none min-[760px]:grid-flow-col min-[760px]:auto-cols-[minmax(260px,1fr)] min-[760px]:overflow-x-auto">
                {phases(mine).map(({ phase, plans: ps }) => (
                  <div key={phase} className="vz-step">
                    <p className="vz-step-h">Phase {phase}</p>
                    {ps.map((p) => <PlanCard key={p.id} plan={p} needs={needs.filter((n) => n.plan_id === p.id)} waits={waitingOn(p, plans, deps)} asks={asks.filter((a) => a.plan_id === p.id)} layouts={layouts} onOpen={() => { haptic("light"); setCaseId(p.id); }} />)}
                    {canEdit && <button type="button" className="btn-ter self-start" onClick={() => setOpen({ program_id: prog.id, phase })}>+ Another way in, phase {phase}</button>}
                  </div>
                ))}
                {canEdit && (
                  <div className="vz-step">
                    <p className="vz-step-h">Phase {Math.min(9, Math.max(...mine.map((p) => p.phase)) + 1)}</p>
                    <button type="button" className="btn-sec w-full" onClick={() => setOpen({ program_id: prog.id, phase: Math.min(9, Math.max(...mine.map((p) => p.phase)) + 1) })}>+ The next phase</button>
                  </div>
                )}
              </div>
            ) : (
              <Compare plans={mine} all={plans} needs={needs} deps={deps} asks={asks} layouts={layouts} onOpen={(p) => setCaseId(p.id)} />
            )}
          </section>
        );
      })}
      {canEdit && others.length > 0 && (
        <div className="vz-row">
          <select aria-label="A program to plan" value={newFor} onChange={(e) => setNewFor(e.target.value)} className="grow min-w-0 basis-[200px]">
            <option value="">Plan the ways into…</option>
            {others.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
          <button type="button" className="btn-sec btn-sm" disabled={!newFor} onClick={() => setOpen({ program_id: newFor, phase: 1 })}>+ A way in</button>
        </div>
      )}
      {open && (
        <PlanSheet key={"id" in open ? open.id : `new-${open.program_id}-${open.phase}`} plan={"id" in open ? open : null} draft={"id" in open ? null : open}
          programs={programs} plans={plans} needs={needs} deps={deps} asks={asks} layouts={layouts} canEdit={canEdit}
          onClose={() => setOpen(null)} onSaved={() => { setOpen(null); onSaved(); }} onOpenStore={onOpenStore} />
      )}
    </div>
  );
}

function PlanCard({ plan: p, needs, waits, asks, layouts, onOpen }: { plan: Plan; needs: Need[]; waits: Plan[]; asks: Ask[]; layouts: Layout[]; onOpen: () => void }) {
  const f = FORMAT[p.format], st = PLAN_STATUS[p.status], prog = needsProgress(needs), t = askTotals(asks);
  const room = layouts.find((l) => l.id === p.layout_id) ?? null;
  return (
    <button type="button" className="vz-card" onClick={onOpen} aria-label={`${p.name}, phase ${p.phase}, ${st.word}`}>
      <span className="vz-card-t"><span aria-hidden="true">{f.mark}</span><span>{p.name}</span></span>
      <span className="vz-meta"><span className={TAG[st.tone]}>{st.word}</span>{f.name !== p.name && <span>{f.name}</span>}</span>
      <span className="vz-card-s">{sqftWords(p, room)} · {DEAL_WORD[p.deal]}{p.place ? ` · ${p.place}` : ""}</span>
      {prog.all > 0 && (
        <span className="vz-prog-bar" aria-label={`${prog.done} of ${prog.all} needs done`}>
          <svg viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect className="bg" x="0" y="0" width="100" height="6" /><rect className="on" x="0" y="0" width={(100 * prog.done) / prog.all} height="6" /></svg>
          <span>{prog.done} of {prog.all} needs done{prog.late ? ` · ${prog.late} late` : ""}{prog.next ? ` · next: ${prog.next.label}` : ""}</span>
        </span>
      )}
      {waits.length > 0 && <span className="vz-wait">Waits on {waits.map((w) => w.name).join(", ")}</span>}
      {t.total > 0 ? <span className="vz-meta"><span className="k-tag gold">Seeking {shortMoney(t.open)}</span></span> : t.unset > 0 ? <span className="vz-meta"><span className="k-tag gold">Being priced</span></span> : null}
      {p.gate && <span className="vz-gate"><b>Goes when</b> {p.gate}</span>}
    </button>
  );
}

function Compare({ plans, all, needs, deps, asks, layouts, onOpen }: { plans: Plan[]; all: Plan[]; needs: Need[]; deps: Dep[]; asks: Ask[]; layouts: Layout[]; onOpen: (p: Plan) => void }) {
  const ordered = useMemo(() => phases(plans).flatMap((x) => x.plans), [plans]);
  const rows = compareRows(ordered, { layouts, asks, needs, deps, all });
  return (
    <>
    {ordered.length > 1 && <p className="vz-card-s min-[760px]:hidden">Swipe sideways for the other {ordered.length - 1} →</p>}
    <div className="vz-cmp-wrap" role="region" aria-label="The ways in, side by side" tabIndex={0}>
      <table className="vz-cmp">
        <thead><tr><th scope="col"><span className="sr-only">Question</span></th>{ordered.map((p) => <th key={p.id} scope="col"><button type="button" className="btn-ter" onClick={() => onOpen(p)}>{FORMAT[p.format].mark} {p.name}</button></th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.label} className={r.differs ? "differs" : undefined}><th scope="row">{r.label}</th>{r.cells.map((c, i) => <td key={i}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
    </>
  );
}

type NeedDraft = { id?: string; label: string; kind: Need["kind"]; owner: string; due: string; done: string; note: string };
function PlanSheet({ plan, draft, programs, plans, needs, deps, asks, layouts, canEdit, onClose, onSaved, onOpenStore }: {
  plan: Plan | null; draft: { program_id: string; phase: number } | null; programs: Program[]; plans: Plan[]; needs: Need[]; deps: Dep[]; asks: Ask[];
  layouts: Layout[]; canEdit: boolean; onClose: () => void; onSaved: () => void; onOpenStore: (layoutId: string) => void;
}) {
  const { toast } = useAppStable();
  const confirm = useConfirm();
  const p = plan;
  const programId = p?.program_id ?? draft!.program_id;
  const program = programs.find((x) => x.id === programId);
  const mine = needs.filter((n) => p && n.plan_id === p.id);
  const [name, setName] = useState(p?.name ?? "");
  const [format, setFormat] = useState<Plan["format"]>(p?.format ?? "gym_bar");
  const [phase, setPhase] = useState(String(p?.phase ?? draft?.phase ?? 1));
  const [status, setStatus] = useState<Plan["status"]>(p?.status ?? "exploring");
  const [sqft, setSqft] = useState(p?.sqft ? String(p.sqft) : "");
  const [deal, setDeal] = useState<Plan["deal"]>(p?.deal ?? "tbd");
  const [place, setPlace] = useState(p?.place ?? "");
  const [summary, setSummary] = useState(p?.summary ?? "");
  const [why, setWhy] = useState(p?.why ?? "");
  const [gate, setGate] = useState(p?.gate ?? "");
  const [layoutId, setLayoutId] = useState(p?.layout_id ?? "");
  const [shareable, setShareable] = useState(p?.shareable ?? false);
  const [waits, setWaits] = useState<string[]>(deps.filter((d) => p && d.plan_id === p.id).map((d) => d.needs_plan_id));
  const [rows, setRows] = useState<NeedDraft[]>(mine.map((n) => ({ id: n.id, label: n.label, kind: n.kind, owner: n.owner ?? "", due: n.due_on ?? "", done: n.done_on ?? "", note: n.note ?? "" })));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const snapshot = JSON.stringify([name, format, phase, status, sqft, deal, place, summary, why, gate, layoutId, shareable, waits, rows]);
  const [first] = useState(snapshot);
  const changed = snapshot !== first;
  useUnsaved(canEdit && changed);
  const room = layouts.find((l) => l.id === (p?.layout_id ?? "")) ?? null;
  const candidates = plans.filter((x) => x.id !== p?.id);
  const today = localToday();

  const save = async (makeRoom = false) => {
    if (!supabase || busy || !name.trim()) return;
    const ft = sqft.trim() ? Number(sqft.replace(/[,\s]/g, "")) : null;
    if (ft != null && !(ft >= 10 && ft <= 100000)) { setErr("Square feet: a number between 10 and 100,000 — or leave it empty."); return; }
    if (p && waits.some((w) => wouldLoop(deps.filter((d) => d.plan_id !== p.id), p.id, w))) { setErr("That would make a loop — a plan can't wait on something that waits on it."); return; }
    setBusy(true); setErr(null);
    try {
      let lay = layoutId || null;
      if (makeRoom) {
        const size = roomFor(ft);
        const { data, error } = await supabase.from("store_layouts").insert({ name: name.trim().slice(0, 80), ...size }).select("id").single();
        if (error) throw error;
        lay = String((data as { id: string }).id);
      }
      const row = { program_id: programId, name: name.trim(), format, phase: Number(phase), status, sqft: ft, deal, place: place.trim() || null,
        summary: summary.trim() || null, why: why.trim() || null, gate: gate.trim() || null, layout_id: lay, shareable, updated_at: new Date().toISOString() };
      let id = p?.id;
      if (id) { const { error } = await supabase.from("vision_plans").update(row).eq("id", id); if (error) throw error; }
      else {
        const { data, error } = await supabase.from("vision_plans").insert({ ...row, sort: 99 }).select("id").single();
        if (error) throw error;
        id = String((data as { id: string }).id);
      }
      const keep = rows.filter((r) => r.label.trim());
      const gone = mine.filter((n) => n.id && !keep.some((r) => r.id === n.id)).map((n) => n.id!);
      if (gone.length) { const { error } = await supabase.from("vision_plan_needs").delete().in("id", gone); if (error) throw error; }
      for (const [k, r] of keep.entries()) {
        const v = { plan_id: id, label: r.label.trim(), kind: r.kind, owner: r.owner.trim() || null, due_on: r.due || null, done_on: r.done || null, note: r.note.trim() || null, sort: k + 1 };
        const { error } = r.id ? await supabase.from("vision_plan_needs").update({ ...v, updated_at: new Date().toISOString() }).eq("id", r.id) : await supabase.from("vision_plan_needs").insert(v);
        if (error) throw error;
      }
      const had = deps.filter((d) => d.plan_id === id).map((d) => d.needs_plan_id);
      const drop = had.filter((w) => !waits.includes(w)), add = waits.filter((w) => !had.includes(w));
      if (drop.length) { const { error } = await supabase.from("vision_plan_deps").delete().eq("plan_id", id).in("needs_plan_id", drop); if (error) throw error; }
      if (add.length) { const { error } = await supabase.from("vision_plan_deps").insert(add.map((w) => ({ plan_id: id, needs_plan_id: w }))); if (error) throw error; }
      haptic("success"); toast(makeRoom ? `Saved — and a ${sqftWords({ sqft: ft, layout_id: null })} room for it is in The store.` : p ? "Saved." : `${name.trim()} is a way in.`);
      onSaved();
      if (makeRoom && lay) onOpenStore(lay);
    } catch (e) {
      setErr(failureWords(e as Error, "Couldn't save"));
      haptic("error");
    } finally { setBusy(false); }
  };
  const del = async () => {
    if (!supabase || !p) return;
    if (!(await confirm({ title: `Take out ${p.name}?`, body: "Its needs and waits go with it. Its room and its asks stay.", confirmLabel: "Take it out", danger: true }))) return;
    const { error } = await supabase.from("vision_plans").delete().eq("id", p.id);
    if (error) { toast(failureWords(error, "Couldn't take it out"), "error"); return; }
    toast(`${p.name} is out.`); onSaved();
  };

  const title = p ? p.name : `A way into ${program?.title ?? "it"}`;
  return (
    <Sheet open onClose={onClose} label={title} dirty={canEdit && changed}
      header={<div className="cp-head"><b>{p ? `${FORMAT[p.format].mark} ${p.name}` : title}</b><CloseButton onClick={onClose} /></div>}>
      {!canEdit && p ? (
        <div className="vz">
          <div className="vz-meta"><span className={TAG[PLAN_STATUS[p.status].tone]}>{PLAN_STATUS[p.status].word}</span><span>Phase {p.phase} · {FORMAT[p.format].name}</span></div>
          <p className="vz-card-s">{sqftWords(p, room)} · {DEAL_WORD[p.deal]}{p.place ? ` · ${p.place}` : ""}</p>
          {p.summary && <p className="vz-sub">{p.summary}</p>}
          {p.why && <><b className="font-sans">Why</b><p className="vz-sub">{p.why}</p></>}
          {p.gate && <><b className="font-sans">Goes when</b><p className="vz-sub">{p.gate}</p></>}
          {mine.length > 0 && <><b className="font-sans">What it needs</b>{mine.map((n, i) => <p key={i} className="vz-card-s">{n.done_on ? "✓" : "○"} {n.label} · {NEED_WORD[n.kind]}{n.owner ? ` · ${n.owner}` : ""}{n.due_on && !n.done_on ? ` · due ${n.due_on}` : ""}</p>)}</>}
          <PlanAsks asks={asks.filter((x) => x.plan_id === p.id)} />
          {waitingOn(p, plans, deps).length > 0 && <p className="vz-wait">Waits on {waitingOn(p, plans, deps).map((w) => w.name).join(", ")}</p>}
          {room && <button type="button" className="btn-sec btn-sm self-start" onClick={() => onOpenStore(room.id)}>See its room →</button>}
        </div>
      ) : (
        <div className="vz">
          <label className="prod-f mt-0"><span>Name</span><input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="A bar inside a gym" /></label>
          <div className="vz-formats" role="radiogroup" aria-label="The way in">
            {FORMATS.map((f) => (
              <button key={f} type="button" role="radio" aria-checked={format === f} className={`k-chip${format === f ? " on" : ""}`} onClick={() => setFormat(f)}>{FORMAT[f].mark} {FORMAT[f].name}</button>
            ))}
          </div>
          {FORMAT[format].says && <p className="vz-card-s">{FORMAT[format].says}</p>}
          <div className="prod-grid stack-sm mt-0">
            <label className="prod-f"><span>Phase</span><select value={phase} onChange={(e) => setPhase(e.target.value)}>{[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>Phase {n}</option>)}</select></label>
            <label className="prod-f"><span>Status</span><select value={status} onChange={(e) => setStatus(e.target.value as Plan["status"])}>{PLAN_STATUSES.map((s) => <option key={s} value={s}>{PLAN_STATUS[s].word}</option>)}</select></label>
          </div>
          <div className="prod-grid stack-sm mt-0">
            <label className="prod-f"><span>Square feet</span><input inputMode="numeric" value={sqft} onChange={(e) => setSqft(e.target.value)} placeholder={FORMAT[format].room ? "Its size" : "Theirs — leave empty"} /></label>
            <label className="prod-f"><span>Deal</span><select value={deal} onChange={(e) => setDeal(e.target.value as Plan["deal"])}>{DEALS.map((d) => <option key={d} value={d}>{DEAL_WORD[d]}</option>)}</select></label>
          </div>
          <label className="prod-f"><span>Where</span><input value={place} maxLength={200} onChange={(e) => setPlace(e.target.value)} placeholder="A gym, a street, an address" /></label>
          <label className="prod-f"><span>What it is</span><textarea rows={2} value={summary} maxLength={600} onChange={(e) => setSummary(e.target.value)} /></label>
          <label className="prod-f"><span>Why this way in</span><textarea rows={3} value={why} maxLength={2000} onChange={(e) => setWhy(e.target.value)} /></label>
          <label className="prod-f"><span>Goes when — the gate</span><textarea rows={2} value={gate} maxLength={600} onChange={(e) => setGate(e.target.value)} placeholder="What has to be true to go: cups a day, repeat guests, a signed partner…" /></label>

          <b className="font-sans mt-2">What it needs</b>
          <p className="vz-card-s">Its requirements and its milestones at once: financing, the site, permits, equipment, hiring, proof of demand — each with who owns it and when.</p>
          <div className="vz-asks">
            {rows.map((r, i) => {
              const set = (patch: Partial<NeedDraft>) => setRows((v) => v.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <div key={r.id ?? `n${i}`} className="vz-ask">
                  <label className="prod-f col-span-2"><span>Need</span><input value={r.label} maxLength={200} onChange={(e) => set({ label: e.target.value })} placeholder="Health permit for the space" /></label>
                  <label className="prod-f"><span>Kind</span><select value={r.kind} onChange={(e) => set({ kind: e.target.value as Need["kind"] })}>{NEED_KINDS.map((k) => <option key={k} value={k}>{NEED_WORD[k]}</option>)}</select></label>
                  <label className="prod-f"><span>Who</span><input value={r.owner} maxLength={80} onChange={(e) => set({ owner: e.target.value })} /></label>
                  <label className="prod-f"><span>Due</span><input type="date" value={r.due} onChange={(e) => set({ due: e.target.value })} /></label>
                  <label className="prod-f"><span>Done</span><input type="date" value={r.done} max={today} onChange={(e) => set({ done: e.target.value })} /></label>
                  <div className="vz-ask-x">
                    {!r.done && <button type="button" className="btn-ter" onClick={() => set({ done: today })}>Done today</button>}
                    <button type="button" className="btn-ter" onClick={() => setRows((v) => v.filter((_, j) => j !== i))}>Remove</button>
                  </div>
                </div>
              );
            })}
            <button type="button" className="btn-sec btn-sm" onClick={() => setRows((v) => [...v, { label: "", kind: "other", owner: "", due: "", done: "", note: "" }])}>+ A need</button>
          </div>

          <PlanAsks asks={asks.filter((x) => p && x.plan_id === p.id)} editHint />
          {candidates.length > 0 && (
            <>
              <b className="font-sans mt-2">Waits on</b>
              <div className="vz-pillars" role="group" aria-label="The plans it waits on">
                {candidates.map((c) => {
                  const on = waits.includes(c.id);
                  const loops = !on && !!p && wouldLoop(deps.filter((d) => d.plan_id !== p.id), p.id, c.id);
                  return <button key={c.id} type="button" className={`k-chip${on ? " on" : ""}`} aria-pressed={on} disabled={loops} title={loops ? "It already waits on this one" : undefined}
                    onClick={() => setWaits((v) => (on ? v.filter((x) => x !== c.id) : [...v, c.id]))}>{c.name}</button>;
                })}
              </div>
            </>
          )}

          {FORMAT[format].room && (
            <label className="prod-f"><span>Its room (the store designer)</span>
              <select value={layoutId} onChange={(e) => setLayoutId(e.target.value)}><option value="">No room yet</option>{layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          )}
          {FORMAT[format].room && !layoutId && <button type="button" className="btn-sec btn-sm self-start" disabled={busy || !name.trim()} onClick={() => void save(true)}>Save and draw its room{sqft.trim() ? ` (${Number(sqft.replace(/[,\s]/g, "")).toLocaleString("en-US")} sq ft)` : ""}</button>}

          <div className="vz-share-row">
            <span><b className="font-sans">Show it on a link</b><span className="vz-card-s block">Off, it stays a draft: only the crew see it.</span></span>
            <button type="button" role="switch" aria-checked={shareable} aria-label="Show it on a link" className={`k-switch${shareable ? " on" : ""}`} onClick={() => setShareable((v) => !v)}><span className="k-switch-k" /></button>
          </div>

          {err && <p className="load-failed" role="alert">{err}</p>}
          <div className="prod-actions mt-3">
            {p ? <button type="button" className="btn-del" onClick={() => void del()}>Take it out</button> : <span />}
            <button type="button" className="btn-pri" onClick={() => void save()} disabled={busy || !name.trim() || (!!p && !changed)}>{busy ? "Saving…" : p ? "Save" : "Add it"}</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** A plan's share of the program's asks: what it buys and how much — set in the program's sheet (its "For"). */
function PlanAsks({ asks, editHint = false }: { asks: Ask[]; editHint?: boolean }) {
  if (!asks.length && !editHint) return null;
  const t = askTotals(asks);
  return (
    <>
      <b className="font-sans mt-2">Capital for this plan{t.total ? ` · ${shortMoney(t.total)}` : ""}</b>
      {asks.map((a, i) => <p key={a.id ?? i} className="vz-card-s">{a.label} — {a.amount_cents ? shortMoney(a.amount_cents) : "amount to be set"}</p>)}
      {editHint && <p className="vz-card-s">{asks.length ? "" : "None yet. "}Asks are set in the program&apos;s sheet on the roadmap — choose this plan under &ldquo;For&rdquo;.</p>}
    </>
  );
}

/** A plan's case (R54): the steps from the vision to the investment — the plan itself, then its money. Traffic (phase C),
 *  evidence and scores (D) and the investor case (E) join these steps as they land. */
type Step = "plan" | "traffic" | "room" | "money";
function PlanCase({ plan: p, plans, needs, deps, asks, layouts, canEdit, isOwner, onBack, onEdit, onOpenStore, onSaved }: {
  plan: Plan; plans: Plan[]; needs: Need[]; deps: Dep[]; asks: Ask[]; layouts: Layout[]; canEdit: boolean; isOwner: boolean;
  onBack: () => void; onEdit: () => void; onOpenStore: (layoutId: string) => void; onSaved: () => void;
}) {
  const [step, setStep] = useState<Step>("plan");
  const room = layouts.find((l) => l.id === p.layout_id) ?? null;
  const mine = needs.filter((n) => n.plan_id === p.id);
  const waits = waitingOn(p, plans, deps);
  return (
    <div className="vz">
      <div className="vz-top">
        <button type="button" className="btn-ter" onClick={onBack}>‹ All plans</button>
        {canEdit && <button type="button" className="btn-sec btn-sm" onClick={onEdit}>Edit the plan</button>}
      </div>
      <div className="flex flex-col gap-1">
        <p className="vz-step-h">Phase {p.phase} · {FORMAT[p.format].name}</p>
        <h2 className="vz-h">{FORMAT[p.format].mark} {p.name}</h2>
        <div className="vz-meta"><span className={TAG[PLAN_STATUS[p.status].tone]}>{PLAN_STATUS[p.status].word}</span><span>{sqftWords(p, room)} · {DEAL_WORD[p.deal]}{p.place ? ` · ${p.place}` : ""}</span></div>
      </div>
      <Segmented label="The case" kind="choice" value={step} onChange={setStep} options={[{ key: "plan", label: "The plan" }, { key: "traffic", label: "Traffic" }, { key: "room", label: "The room" }, { key: "money", label: "Money" }]} />
      {step === "plan" ? (
        <div className="grid gap-4 grid-cols-1 min-[1100px]:grid-cols-2 min-[1100px]:items-start">
          <div className="flex flex-col gap-2 min-w-0">
            {p.summary && <p className="vz-sub">{p.summary}</p>}
            {p.why && <><b className="font-sans">Why this way in</b><p className="vz-sub">{p.why}</p></>}
            {p.gate && <><b className="font-sans">Goes when</b><p className="vz-sub">{p.gate}</p></>}
            {waits.length > 0 && <p className="vz-wait">Waits on {waits.map((w) => w.name).join(", ")}</p>}
            {room && <button type="button" className="btn-sec btn-sm self-start" onClick={() => onOpenStore(room.id)}>See its room →</button>}
            <CaseWords plan={p} canEdit={canEdit} onSaved={onSaved} />
          </div>
          <div className="flex flex-col gap-2 min-w-0">
            <b className="font-sans">What it needs{mine.length ? ` · ${needsProgress(mine).done} of ${mine.length} done` : ""}</b>
            {mine.length ? mine.map((n, i) => <p key={n.id ?? i} className="vz-card-s">{n.done_on ? "✓" : "○"} {n.label} · {NEED_WORD[n.kind]}{n.owner ? ` · ${n.owner}` : ""}{n.due_on && !n.done_on ? ` · due ${n.due_on}` : ""}</p>) : <p className="vz-card-s">No needs listed yet.</p>}
            <PlanAsks asks={asks.filter((x) => x.plan_id === p.id)} />
          </div>
        </div>
      ) : (
        <MoneyPanel plan={p} asks={asks} canEdit={canEdit} isOwner={isOwner} view={step} room={room} onOpenRoom={room ? () => onOpenStore(room.id) : undefined}
          progress={{ needs: { done: needsProgress(mine).done, all: mine.length }, waitingOn: waits.map((w) => w.name) }} />
      )}
    </div>
  );
}
