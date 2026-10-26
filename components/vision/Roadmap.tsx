"use client";

import { failureWords } from "@/lib/failureWords";
import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAppStable } from "@/components/AppProvider";
import { useConfirm } from "@/components/ConfirmSheet";
import Sheet, { CloseButton, useUnsaved } from "@/components/Sheet";
import { haptic } from "@/lib/haptics";
import {
  ASK_STATES, ASK_WORD, HORIZONS, HORIZON_SUB, HORIZON_WORD, PILLARS, PILLAR_WORD, STATUSES, STATUS_WORD,
  askTotals, board, shortMoney, whenWords, type Ask, type Horizon, type Layout, type Pillar, type Program,
} from "@/lib/vision";
import type { Plan } from "@/lib/visionPlans";

// THE ROADMAP (R52) — what's running now, what's next, what's later: the industry's Now · Next · Later board, every
// program with why it exists and which of the four pillars it serves, and where capital may be needed — what it buys, how
// much, and whether it's open, committed or funded. One tap opens a program; an owner edits it there.
export default function Roadmap({ programs, asks, layouts, plans = [], canEdit, showAsks, onSaved, onOpenStore, onOpenPlans }: {
  programs: Program[]; asks: Ask[]; layouts: Layout[]; plans?: Plan[]; canEdit: boolean; showAsks: boolean; onSaved: () => void;
  onOpenStore?: (layoutId: string) => void; onOpenPlans?: () => void;
}) {
  const [open, setOpen] = useState<Program | "new" | null>(null);
  const cols = useMemo(() => board(programs), [programs]);
  const all = askTotals(asks);
  const byProgram = (id: string) => asks.filter((a) => a.program_id === id);

  return (
    <div className="vz">
      {showAsks && (all.total > 0 || all.unset > 0) && <CapitalBar t={all} />}
      <div className="vz-board grid-cols-1 min-[760px]:grid-cols-3">
        {HORIZONS.map((h) => (
          <section key={h} className="vz-col" aria-label={`${HORIZON_WORD[h]} — ${HORIZON_SUB[h]}`}>
            <div className="vz-col-h"><b>{HORIZON_WORD[h]}</b><span>{HORIZON_SUB[h]}</span></div>
            {cols[h].map((p) => {
              const t = askTotals(byProgram(p.id));
              const when = whenWords(p.start_on, p.target_on);
              return (
                <button key={p.id} type="button" className="vz-card" onClick={() => { haptic("light"); setOpen(p); }} aria-label={`${p.title} — ${STATUS_WORD[p.status]}. Open it.`}>
                  <span className="vz-card-t"><span aria-hidden="true">{p.emoji || "•"}</span><span>{p.title}</span></span>
                  {p.summary && <span className="vz-card-s">{p.summary}</span>}
                  <span className="vz-meta">
                    <span className={p.status === "live" ? "k-tag ok" : "k-tag"}>{STATUS_WORD[p.status]}</span>
                    <span>{p.lane}</span>
                    {when && <span>· {when}</span>}
                    {p.pillars.length > 0 && <span className="vz-dots" aria-label={p.pillars.map((x) => PILLAR_WORD[x]).join(", ")}>{p.pillars.map((x) => <i key={x} className={`pz-${x}`} />)}</span>}
                  </span>
                  {plans.some((x) => x.program_id === p.id) && (() => {
                    const ps = plans.filter((x) => x.program_id === p.id), ph = new Set(ps.map((x) => x.phase)).size;
                    return <span className="vz-card-s">{ps.length} {ps.length === 1 ? "way in" : "ways in"}{ph > 1 ? ` · ${ph} phases` : ""}</span>;
                  })()}
                  {showAsks && (t.total > 0 || t.unset > 0) && (
                    <span className="vz-meta"><span className="k-tag gold">{t.total > 0 ? `Seeking ${shortMoney(t.open)}${t.committed + t.funded > 0 ? ` · ${shortMoney(t.committed + t.funded)} in` : ""}` : "Partners wanted"}</span></span>
                  )}
                </button>
              );
            })}
            {cols[h].length === 0 && <p className="vz-card-s">Nothing here yet.</p>}
            {canEdit && h === "next" && <button type="button" className="btn-sec w-full" onClick={() => setOpen("new")}>+ A program</button>}
          </section>
        ))}
      </div>
      {open && (
        <ProgramSheet key={open === "new" ? "new" : open.id} program={open === "new" ? null : open} asks={open === "new" ? [] : byProgram(open.id)} layouts={layouts}
          plans={open === "new" ? [] : plans.filter((x) => x.program_id === open.id)} onOpenPlans={onOpenPlans}
          canEdit={canEdit} showAsks={showAsks} lanes={[...new Set(programs.map((p) => p.lane))]}
          onClose={() => setOpen(null)} onSaved={() => { setOpen(null); onSaved(); }} onOpenStore={onOpenStore} />
      )}
    </div>
  );
}

/** Where the money stands: funded, committed, open — one bar, the numbers over it. */
export function CapitalBar({ t, dark = false }: { t: ReturnType<typeof askTotals>; dark?: boolean }) {
  const total = Math.max(1, t.total);
  const f = (t.funded / total) * 100, c = (t.committed / total) * 100;
  return (
    <div className={dark ? "flex flex-col gap-2" : "vz-cap mpanel mb-0 flex flex-col gap-2 px-4 py-3.5"} aria-label="Where capital may be needed">
      <div className="vz-cap-n">
        {t.total > 0 ? <><span><b>{shortMoney(t.total)}</b> the plan asks for</span><span><b>{shortMoney(t.open)}</b> open</span></> : <span><b>Partners wanted</b> — the amounts are being set</span>}
        {t.unset > 0 && t.total > 0 && <span>{t.unset} line{t.unset === 1 ? "" : "s"} still to price</span>}
      </div>
      {t.total > 0 && (
        <svg className={dark ? "cap" : undefined} viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true">
          <rect x={0} y={0} width={100} height={4} className={dark ? "bg-dark" : "bg"} />
          <rect x={0} y={0} width={f} height={4} fill="#457a32"><animate attributeName="width" from="0" to={f} dur="0.9s" fill="freeze" /></rect>
          <rect x={f} y={0} width={c} height={4} fill="#c8a661"><animate attributeName="width" from="0" to={c} dur="0.9s" begin="0.3s" fill="freeze" /></rect>
        </svg>
      )}
      {t.total > 0 && (
        <div className="vz-legend">
          <span><i className="vz-f" />Funded {shortMoney(t.funded)}</span>
          <span><i className="vz-c" />Committed {shortMoney(t.committed)}</span>
          <span><i className="vz-o" />Open {shortMoney(t.open)}</span>
        </div>
      )}
    </div>
  );
}

// ── one program: read it, or (an owner) change it ──
type AskDraft = { id?: string; label: string; dollars: string; state: Ask["state"]; note: string; plan: string };
function ProgramSheet({ program, asks, layouts, plans, canEdit, showAsks, lanes, onClose, onSaved, onOpenStore, onOpenPlans }: {
  program: Program | null; asks: Ask[]; layouts: Layout[]; plans: Plan[]; canEdit: boolean; showAsks: boolean; lanes: string[];
  onClose: () => void; onSaved: () => void; onOpenStore?: (layoutId: string) => void; onOpenPlans?: () => void;
}) {
  const { toast } = useAppStable();
  const confirm = useConfirm();
  const p = program;
  const [title, setTitle] = useState(p?.title ?? "");
  const [emoji, setEmoji] = useState(p?.emoji ?? "");
  const [lane, setLane] = useState(p?.lane ?? "Places");
  const [summary, setSummary] = useState(p?.summary ?? "");
  const [why, setWhy] = useState(p?.why ?? "");
  const [pillars, setPillars] = useState<Pillar[]>(p?.pillars ?? []);
  const [horizon, setHorizon] = useState<Horizon>(p?.horizon ?? "next");
  const [status, setStatus] = useState<Program["status"]>(p?.status ?? "idea");
  const [start, setStart] = useState(p?.start_on?.slice(0, 7) ?? "");
  const [target, setTarget] = useState(p?.target_on?.slice(0, 7) ?? "");
  const [layoutId, setLayoutId] = useState(p?.layout_id ?? "");
  const [rows, setRows] = useState<AskDraft[]>(asks.map((a) => ({ id: a.id, label: a.label, dollars: a.amount_cents ? String(a.amount_cents / 100) : "", state: a.state, note: a.note ?? "", plan: a.plan_id ?? "" })));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const snapshot = JSON.stringify([title, emoji, lane, summary, why, pillars, horizon, status, start, target, layoutId, rows]);
  const [first] = useState(snapshot);
  const changed = snapshot !== first;
  useUnsaved(canEdit && changed);
  const t = askTotals(asks);
  const layout = layouts.find((l) => l.id === (p?.layout_id ?? ""));

  const monthToDate = (m: string, end: boolean) => {
    if (!m) return null;
    if (!end) return `${m}-01`;
    const [y, mo] = m.split("-").map(Number);
    return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
  };

  const save = async () => {
    if (!supabase || busy || !title.trim()) return;
    const s = monthToDate(start, false), e = monthToDate(target, true);
    if (s && e && s > e) { setErr("It can't finish before it starts — check the months."); return; }
    const bad = rows.find((r) => r.label.trim() && r.dollars.trim() && !(Number(r.dollars.replace(/[$,]/g, "")) >= 0));
    if (bad) { setErr(`"${bad.label}" — the amount isn't a number.`); return; }
    setBusy(true); setErr(null);
    try {
      const row = { title: title.trim(), emoji: emoji.trim() || null, lane: lane.trim() || "Business", summary: summary.trim() || null, why: why.trim() || null,
        pillars, horizon, status, start_on: s, target_on: e, layout_id: layoutId || null, updated_at: new Date().toISOString() };
      let id = p?.id;
      if (id) { const { error } = await supabase.from("vision_programs").update(row).eq("id", id); if (error) throw error; }
      else {
        const { data, error } = await supabase.from("vision_programs").insert({ ...row, sort: 99 }).select("id").single();
        if (error) throw error;
        id = String((data as { id: string }).id);
      }
      const keep = rows.filter((r) => r.label.trim());
      const gone = asks.filter((a) => a.id && !keep.some((r) => r.id === a.id)).map((a) => a.id!) ;
      if (gone.length) { const { error } = await supabase.from("vision_asks").delete().in("id", gone); if (error) throw error; }
      for (const [k, r] of keep.entries()) {
        const v = { program_id: id, ...(plans.length || r.plan ? { plan_id: r.plan || null } : {}), label: r.label.trim(), amount_cents: Math.round(Number(r.dollars.replace(/[$,]/g, "") || 0) * 100), state: r.state, note: r.note.trim() || null, sort: k + 1 };
        const { error } = r.id ? await supabase.from("vision_asks").update(v).eq("id", r.id) : await supabase.from("vision_asks").insert(v);
        if (error) throw error;
      }
      haptic("success"); toast(p ? "Saved." : `${title.trim()} is on the roadmap.`);
      onSaved();
    } catch (e) {
      setErr(failureWords(e as Error, "Couldn't save"));
      haptic("error");
    } finally { setBusy(false); }
  };
  const del = async () => {
    if (!supabase || !p) return;
    if (!(await confirm({ title: `Take ${p.title} off the roadmap?`, body: "Its asks go with it. The room it links to stays.", confirmLabel: "Take it off", danger: true }))) return;
    const { error } = await supabase.from("vision_programs").delete().eq("id", p.id);
    if (error) { toast(failureWords(error, "Couldn't take it off"), "error"); return; }
    toast(`${p.title} is off the roadmap.`); onSaved();
  };

  return (
    <Sheet open onClose={onClose} label={p?.title ?? "A new program"} dirty={canEdit && changed}
      header={<div className="cp-head"><b>{p ? `${p.emoji ? `${p.emoji} ` : ""}${p.title}` : "A new program"}</b><CloseButton onClick={onClose} /></div>}>
      {!canEdit && p ? (
        <div className="vz">
          <div className="vz-meta"><span className={p.status === "live" ? "k-tag ok" : "k-tag"}>{STATUS_WORD[p.status]}</span><span>{HORIZON_WORD[p.horizon]} · {p.lane}</span>{whenWords(p.start_on, p.target_on) && <span>· {whenWords(p.start_on, p.target_on)}</span>}</div>
          {p.summary && <p className="vz-sub">{p.summary}</p>}
          {p.why && <><b className="font-sans">Why</b><p className="vz-sub">{p.why}</p></>}
          {p.pillars.length > 0 && <div className="vz-pillars">{p.pillars.map((x) => <span key={x} className="k-tag"><i className={`inline-block w-2 h-2 rounded-full pz-${x}`} />{PILLAR_WORD[x]}</span>)}</div>}
          {showAsks && asks.length > 0 && <><CapitalBar t={t} />{asks.map((a, i) => <p key={i} className="vz-card-s"><b>{a.label}</b> — {a.amount_cents ? shortMoney(a.amount_cents) : "amount to be set"} · {ASK_WORD[a.state]}{a.note ? ` · ${a.note}` : ""}</p>)}</>}
          {layout && onOpenStore && <button type="button" className="btn-sec btn-sm" onClick={() => onOpenStore(layout.id)}>See {layout.name} →</button>}
          {plans.length > 0 && onOpenPlans && <button type="button" className="btn-sec btn-sm" onClick={onOpenPlans}>Its {plans.length} {plans.length === 1 ? "way in" : "ways in"} →</button>}
        </div>
      ) : (
        <div className="vz">
          <div className="prod-grid stack-sm mt-0">
            <label className="prod-f mt-0"><span>Name</span><input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="The first store" /></label>
            <label className="prod-f mt-0"><span>Mark</span><input value={emoji} maxLength={8} onChange={(e) => setEmoji(e.target.value)} placeholder="🏛️" aria-label="An emoji for its card" /></label>
          </div>
          <label className="prod-f"><span>Lane</span><input list="vz-lanes" value={lane} maxLength={40} onChange={(e) => setLane(e.target.value)} /></label>
          <datalist id="vz-lanes">{lanes.map((l) => <option key={l} value={l} />)}</datalist>
          <label className="prod-f"><span>What it is</span><textarea rows={2} value={summary} maxLength={400} onChange={(e) => setSummary(e.target.value)} /></label>
          <label className="prod-f"><span>Why — the intention behind it</span><textarea rows={3} value={why} maxLength={2000} onChange={(e) => setWhy(e.target.value)} /></label>
          <div className="vz-pillars" role="group" aria-label="The pillars it serves">
            {PILLARS.map((x) => <button key={x} type="button" className={`k-chip${pillars.includes(x) ? " on" : ""}`} aria-pressed={pillars.includes(x)} onClick={() => setPillars((v) => (v.includes(x) ? v.filter((y) => y !== x) : [...v, x]))}>{PILLAR_WORD[x]}</button>)}
          </div>
          <div className="prod-grid stack-sm mt-0">
            <label className="prod-f"><span>When</span><select value={horizon} onChange={(e) => setHorizon(e.target.value as Horizon)}>{HORIZONS.map((h) => <option key={h} value={h}>{HORIZON_WORD[h]}</option>)}</select></label>
            <label className="prod-f"><span>Status</span><select value={status} onChange={(e) => setStatus(e.target.value as Program["status"])}>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_WORD[s]}</option>)}</select></label>
          </div>
          <div className="prod-grid stack-sm mt-0">
            <label className="prod-f"><span>Starts (month)</span><input type="month" value={start} onChange={(e) => setStart(e.target.value)} /></label>
            <label className="prod-f"><span>Target (month)</span><input type="month" value={target} onChange={(e) => setTarget(e.target.value)} /></label>
          </div>
          {layouts.length > 0 && (
            <label className="prod-f"><span>Its room (the store designer)</span>
              <select value={layoutId} onChange={(e) => setLayoutId(e.target.value)}><option value="">No room</option>{layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          )}
          {plans.length > 0 && onOpenPlans && <button type="button" className="btn-sec btn-sm self-start" onClick={onOpenPlans}>Its {plans.length} {plans.length === 1 ? "way in" : "ways in"} — phases, gates, needs →</button>}
          <b className="font-sans mt-2">Where capital may be needed</b>
          <p className="vz-card-s">What it buys, how much, and where it stands. Leave the amount empty until it&apos;s priced — the card says &ldquo;Partners wanted&rdquo;.</p>
          <div className="vz-asks">
            {rows.map((r, i) => (
              <div key={r.id ?? `n${i}`} className="vz-ask">
                <label className="prod-f"><span>What it buys</span><input value={r.label} maxLength={80} onChange={(e) => setRows((v) => v.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="Build-out" /></label>
                <label className="prod-f"><span>Amount ($)</span><input inputMode="decimal" value={r.dollars} onChange={(e) => setRows((v) => v.map((x, j) => (j === i ? { ...x, dollars: e.target.value } : x)))} placeholder="180000" /></label>
                <label className="prod-f"><span>Stands</span><select value={r.state} onChange={(e) => setRows((v) => v.map((x, j) => (j === i ? { ...x, state: e.target.value as Ask["state"] } : x)))}>{ASK_STATES.map((s) => <option key={s} value={s}>{ASK_WORD[s]}</option>)}</select></label>
                <label className="prod-f"><span>Note</span><input value={r.note} maxLength={400} onChange={(e) => setRows((v) => v.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} /></label>
                {plans.length > 0 && (
                  <label className="prod-f col-span-2"><span>For</span>
                    <select value={r.plan} onChange={(e) => setRows((v) => v.map((x, j) => (j === i ? { ...x, plan: e.target.value } : x)))}>
                      <option value="">The whole program</option>{plans.map((pl) => <option key={pl.id} value={pl.id}>Phase {pl.phase} · {pl.name}</option>)}
                    </select></label>
                )}
                <div className="vz-ask-x"><button type="button" className="btn-ter" onClick={() => setRows((v) => v.filter((_, j) => j !== i))}>Remove</button></div>
              </div>
            ))}
            <button type="button" className="btn-sec btn-sm" onClick={() => setRows((v) => [...v, { label: "", dollars: "", state: "open", note: "", plan: "" }])}>+ What it needs</button>
          </div>
          {err && <p className="load-failed" role="alert">{err}</p>}
          <div className="prod-actions mt-3">
            {p ? <button type="button" className="btn-del" onClick={() => void del()}>Take it off</button> : <span />}
            <button type="button" className="btn-pri" onClick={() => void save()} disabled={busy || !title.trim() || (!!p && !changed)}>{busy ? "Saving…" : p ? "Save" : "Add it"}</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
