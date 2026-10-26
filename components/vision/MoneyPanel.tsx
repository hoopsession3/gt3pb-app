"use client";

import { useCallback, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { useAppStable } from "@/components/AppProvider";
import Sheet, { CloseButton, useUnsaved } from "@/components/Sheet";
import { useConfirm } from "@/components/ConfirmSheet";
import { Segmented } from "@/components/controls";
import { failureWords } from "@/lib/failureWords";
import { isMissingRelation, isMissingTable } from "@/lib/schemaSkew";
import { haptic } from "@/lib/haptics";
import { readLedger, CHANNEL_WORD, type Channel } from "@/lib/orderLedger";
import { askTotals, type Ask } from "@/lib/vision";
import type { Plan } from "@/lib/visionPlans";
import {
  CATEGORIES, CATEGORY_WORD, CONFIDENCES, CONFIDENCE_WORD, INPUT_KEYS, INPUT_WORD, SCENARIOS, SCENARIO_WORD, STRUCTURE_WORD,
  changedInputs, compare, derive, downstream, dollars, flags, investor, lineTotal, observed, project, sensitivity, toInputs, trace, upstreamInputs,
  type Category, type Change, type Context, type Confidence, type Flag, type Inputs, type Kind, type MetricKey, type Model, type NodeKey, type Observed,
  type Scenario, type Structure, type Trace, type UseLine,
} from "@/lib/visionMoney";
import { CashChart, SC_SWATCH, Tornado } from "./MoneyCharts";
import Num from "./Num";
import { RoomView, TrafficView } from "./TrafficRoom";
import type { Layout } from "@/lib/vision";
import { ASSUMED_SERVE_SEC, capacity } from "@/lib/visionRoom";
import { score } from "@/lib/visionScore";
import type { Research } from "@/lib/visionResearch";
import { ResearchPanel, ScoreCard } from "./Research";
import ActualPanel from "./Actual";
import MixEditor from "./Mix";
import Said from "@/components/Said";

// A PLAN'S MONEY (R54, 0449 vision_plan_money), traceable (the 2026-10-25 audit — Ryan: "I want to click any financial
// number in GT3 and answer: where did this number come from? What makes it up? How was it calculated? What happens if I
// change it? What else in the business does it affect?"). One engine (lib/visionMoney) computes every figure here and
// traces it: each card opens what it is, its formula with the plan's own numbers in it, what it's made of and what it
// feeds. Startup spending is itemized — quantity × unit cost, the source, the date, how sure — and its total is those
// lines, nothing typed beside them. The working numbers are what-ifs against the baseline an owner approved: every
// figure that moved says what it was; going back is one confirmed step, and only an owner approves a new baseline.
// Owners and admins only: rent, wages and terms are the business's own.
type Snap = { scenarios: Record<Scenario, Inputs>; structure: Structure };
type Saved = Snap & { baseline: Snap | null; baselineAt: string | null };
const snapOf = (raw: { scenarios?: Record<string, unknown>; structure?: Structure } | null | undefined): Snap => ({
  scenarios: { conservative: toInputs(raw?.scenarios?.conservative as Partial<Inputs>), base: toInputs(raw?.scenarios?.base as Partial<Inputs>), upside: toInputs(raw?.scenarios?.upside as Partial<Inputs>) },
  structure: raw?.structure ?? { kind: "none" },
});
const KIND_WORD: Record<Kind, string> = { assumed: "Assumed", observed: "From our sales", computed: "Computed", simulated: "Simulated", actual: "Actual" };
const KIND_TAG: Record<Kind, string> = { assumed: "k-tag", observed: "k-tag ok", computed: "k-tag gold", simulated: "k-tag blue", actual: "k-tag ok" };
const isInput = (k: NodeKey): k is (typeof INPUT_KEYS)[number] => (INPUT_KEYS as readonly string[]).includes(k);
let lineSeq = 0;

export type MoneyView = "traffic" | "room" | "money";
export default function MoneyPanel({ plan, asks, canEdit, isOwner = false, view = "money", room = null, onOpenRoom, progress }: {
  plan: Plan; asks: Ask[]; canEdit: boolean; isOwner?: boolean; view?: MoneyView; room?: Layout | null; onOpenRoom?: () => void;
  /** What the assessment needs beyond the money (R59): the plan's needs done, and the unfinished plans it waits on. */
  progress?: { needs: { done: number; all: number }; waitingOn: string[] };
}) {
  const load = useCallback(async (): Promise<Saved | "not-yet"> => {
    if (!supabase) throw new Error("Supabase client not configured");
    const { data, error } = await supabase.from("vision_plan_money").select("scenarios, structure, baseline, baseline_at").eq("plan_id", plan.id).maybeSingle();
    if (error) throw new Error(error.message);
    const row = data as { scenarios?: Record<string, unknown>; structure?: Structure; baseline?: { scenarios?: Record<string, unknown>; structure?: Structure } | null; baseline_at?: string | null } | null;
    return { ...snapOf(row), baseline: row?.baseline ? snapOf(row.baseline) : null, baselineAt: row?.baseline_at ?? null };
  }, [plan.id]);
  const state = useAsyncData(load, [plan.id]);
  if (!canEdit) return <p className="vz-sub">A plan&apos;s money — its costs, rent, wages and terms — is the owners&apos;. Ask an owner to walk you through it.</p>;
  if (state.status === "loading" || !state.data) return state.status === "error" ? <p className="load-failed">{failureWords(state.error as Error, "Couldn't read the money")}</p> : <p className="vz-sub">Reading the money…</p>;
  if (state.data === "not-yet") return <p className="vz-sub">The money arrives with the next database update (0449). The plan, its phases and its room work as before.</p>;
  return <Money key={plan.id} plan={plan} asks={asks} saved={state.data} isOwner={isOwner} view={view} room={room} onOpenRoom={onOpenRoom} progress={progress} />;
}

const KPIS: MetricKey[] = ["startupSpend", "reservePlanned", "requiredFunding", "fundingGap", "breakEven", "payback", "grossMargin", "roiBusiness", "roiAfter"];
const NEEDS_MODEL = new Set<MetricKey>(["requiredFunding", "fundingGap", "breakEven", "payback", "grossMargin", "roiBusiness", "roiAfter"]);

function Money({ plan, asks, saved, isOwner, view, room, onOpenRoom, progress }: { plan: Plan; asks: Ask[]; saved: Saved; isOwner: boolean; view: MoneyView; room: Layout | null; onOpenRoom?: () => void; progress?: { needs: { done: number; all: number }; waitingOn: string[] } }) {
  const { toast } = useAppStable();
  const confirm = useConfirm();
  const [scen, setScen] = useState<Record<Scenario, Inputs>>(saved.scenarios);
  const [structure, setStructure] = useState<Structure>(saved.structure);
  const [baseline, setBaseline] = useState<{ snap: Snap; at: string | null } | null>(saved.baseline ? { snap: saved.baseline, at: saved.baselineAt } : null);
  const [opened] = useState<Snap>(() => ({ scenarios: saved.scenarios, structure: saved.structure }));
  const [on, setOn] = useState<Scenario>("base");
  const [busy, setBusy] = useState(false);
  const [drill, setDrill] = useState<MetricKey | null>(null);
  const [showChanges, setShowChanges] = useState(false);
  const [fromSales, setFromSales] = useState<number | null>(null);
  const [first, setFirst] = useState(() => JSON.stringify([saved.scenarios, saved.structure]));
  const dirty = JSON.stringify([scen, structure]) !== first;
  useUnsaved(dirty);
  const i = scen[on];
  const set = (patch: Partial<Inputs>) => setScen((s) => ({ ...s, [on]: { ...s[on], ...patch } }));
  // The room's counter, read live from the plan's room as drawn, at each scenario's own seconds an order.
  const ctxOf = useCallback((x: Inputs): Context => ({ counterPerHour: room ? capacity(room, x.serveSec ?? ASSUMED_SERVE_SEC).counterPerHour : null }), [room]);
  const models = useMemo(() => ({ conservative: project(scen.conservative, structure, ctxOf(scen.conservative)), base: project(scen.base, structure, ctxOf(scen.base)), upside: project(scen.upside, structure, ctxOf(scen.upside)) }), [scen, structure, ctxOf]);
  const m = models[on];
  const [synced, setSynced] = useState<number | null>(null);   // the ask as just set here, until the roadmap is read again
  const asked = synced ?? askTotals(asks.filter((a) => a.plan_id === plan.id)).total;
  const inv = m.ok ? investor(m, structure) : null;
  const swings = useMemo(() => sensitivity(i, 20, ctxOf(i)), [i, ctxOf]);
  const found = flags(i, m, structure, asked || null, on === "base" ? models : undefined);
  const traces = useMemo(() => trace(i, structure, m), [i, structure, m]);
  // The plan's research (0450): what the market says; only accepted findings count in the score.
  const loadResearch = useCallback(async (): Promise<Research[] | "not-yet"> => {
    if (!supabase) return [];
    // arrives-with: 0450
    const { data, error } = await supabase.from("vision_research").select("id, plan_id, topic, claim, figure, source_url, source_title, published, status, bearing, retrieved_at").eq("plan_id", plan.id).order("retrieved_at", { ascending: false }).limit(200);
    if (error && (isMissingTable(error) || isMissingRelation(error))) return "not-yet";
    if (error) throw new Error(error.message);
    return (data ?? []) as Research[];
  }, [plan.id]);
  const rs = useAsyncData(loadResearch, [plan.id]);
  const research = useMemo(() => (Array.isArray(rs.data) ? rs.data : []), [rs.data]);
  const scores = useMemo(() => {
    const ctx = { needs: progress?.needs, waitingOn: progress?.waitingOn, conservative: models.conservative };
    return { conservative: score(scen.conservative, models.conservative, research, { ...ctx, conservative: null }), base: score(scen.base, models.base, research, ctx), upside: score(scen.upside, models.upside, research, { ...ctx, conservative: null }) };
  }, [scen, models, research, progress]);
  // The what-if is against the approved baseline — or, before there is one, against the numbers as this was opened.
  const ref = baseline?.snap ?? opened;
  const refWord = baseline ? "the approved baseline" : "when you opened this";
  const refTraces = useMemo(() => trace(ref.scenarios[on], ref.structure, project(ref.scenarios[on], ref.structure, ctxOf(ref.scenarios[on]))), [ref, on, ctxOf]);
  const because = useMemo(() => changedInputs(ref.scenarios[on], i, ref.structure, structure, ctxOf(ref.scenarios[on]), ctxOf(i)), [ref, on, i, structure, ctxOf]);
  const changes = useMemo(() => compare(refTraces, traces, because), [refTraces, traces, because]);
  const moved = new Map(changes.map((c) => [c.key, c]));
  const baselineBase = useMemo(() => (baseline ? project(baseline.snap.scenarios.base, baseline.snap.structure, ctxOf(baseline.snap.scenarios.base)) : null), [baseline, ctxOf]);
  const offBaseline = !!baseline && JSON.stringify([scen, structure]) !== JSON.stringify([baseline.snap.scenarios, baseline.snap.structure]);

  const write = async (row: Record<string, unknown>, words: string, fail: string): Promise<boolean> => {
    if (!supabase || busy) return false;
    setBusy(true);
    const { error } = await supabase.from("vision_plan_money").upsert({ plan_id: plan.id, ...row, updated_at: new Date().toISOString() }, { onConflict: "plan_id" });
    setBusy(false);
    if (error) { toast(failureWords(error, fail), "error"); haptic("error"); return false; }
    haptic("success"); toast(words); return true;
  };
  const save = async () => { if (await write({ scenarios: scen, structure }, "Saved — the plan's working numbers.", "Couldn't save the money")) setFirst(JSON.stringify([scen, structure])); };
  const approve = async () => {
    if (!(await confirm({ title: "Make these the approved baseline?", body: baseline ? "The baseline approved before is replaced by these numbers — all three scenarios and the structure. What-ifs are measured against it from now on." : "All three scenarios and the structure, as they stand. What-ifs are measured against it from now on.", confirmLabel: "Approve the baseline" }))) return;
    const snap = { scenarios: scen, structure };
    if (await write({ scenarios: scen, structure, baseline: snap }, "Approved — this is the baseline now.", "Couldn't approve the baseline")) { setBaseline({ snap, at: new Date().toISOString() }); setFirst(JSON.stringify([scen, structure])); }
  };
  const restore = async () => {
    if (!baseline) return;
    if (!(await confirm({ title: "Go back to the approved baseline?", body: `The working numbers — ${changes.length} figure${changes.length === 1 ? "" : "s"} moved in ${SCENARIO_WORD[on]} — are replaced by the approved ones. The baseline itself doesn't change.`, confirmLabel: "Back to the baseline", danger: true }))) return;
    const b = baseline.snap;
    if (await write({ scenarios: b.scenarios, structure: b.structure }, "Back to the baseline.", "Couldn't go back to the baseline")) { setScen(b.scenarios); setStructure(b.structure); setFirst(JSON.stringify([b.scenarios, b.structure])); }
  };
  // One capital picture (R62 — the audit's gap 4): the roadmap's ask for this plan made the money's funding required, so
  // the roadmap, Present and the plan say one number. Asks first; one ask is set to it, none gets one, several are left to
  // Ryan (which one is which is his to say).
  const mine = asks.filter((a) => a.plan_id === plan.id);
  const syncAsk = async () => {
    if (!supabase || busy || !m.ok) return;
    if (mine.length > 1) { toast("This plan has several asks — set them on the roadmap so they add to the funding required.", "error"); return; }
    if (!(await confirm({ title: `Make the roadmap's ask ${dollars(m.requiredFunding)}?`, body: `The funding the ${SCENARIO_WORD[on]} numbers require: ${dollars(m.startupSpend)} to open and ${dollars(m.reserveNeeded)} for the early months. The roadmap and Present will show it.`, confirmLabel: "Make it the ask" }))) return;
    setBusy(true);
    const w = mine.length === 1 && mine[0].id
      ? await supabase.from("vision_asks").update({ amount_cents: m.requiredFunding }).eq("id", mine[0].id)
      : await supabase.from("vision_asks").insert({ program_id: plan.program_id, plan_id: plan.id, label: `${plan.name} — funding required`, amount_cents: m.requiredFunding, state: "open", note: `From the plan's money (${SCENARIO_WORD[on]})`, sort: 50 });
    setBusy(false);
    if (w.error) { toast(failureWords(w.error, "Couldn't set the ask"), "error"); return; }
    setSynced(m.requiredFunding); haptic("success"); toast("The roadmap's ask is the plan's funding required now.");
  };
  const makeBoth = async (c: Inputs, u: Inputs) => {
    if (!(await confirm({ title: "Replace Conservative and Upside?", body: "Both are remade from Base by your percentages — what's typed in them now is replaced. Nothing is saved until you press Save.", confirmLabel: "Make both from Base" }))) return;
    setScen((s) => ({ ...s, conservative: c, upside: u }));
  };

  return (
    <div className="vz">
      <div className="vz-top">
        <Segmented label="Scenario" kind="choice" value={on} onChange={pick(setOn)} options={SCENARIOS.map((s) => ({ key: s, label: SCENARIO_WORD[s] }))} />
        <div className="flex flex-wrap gap-2">
          {offBaseline && <button type="button" className="btn-sec btn-sm" onClick={() => void restore()} disabled={busy}>Back to the baseline</button>}
          {isOwner && <button type="button" className="btn-sec btn-sm" onClick={() => void approve()} disabled={busy}>Make this the baseline</button>}
          <button type="button" className={dirty ? "btn-pri btn-sm" : "btn-sec btn-sm"} onClick={() => void save()} disabled={!dirty || busy}>{busy ? "Saving…" : dirty ? "Save" : "Saved"}</button>
        </div>
      </div>
      <div className="vz-base-line flex flex-wrap items-center gap-2">
        <p className="vz-card-s">{baseline ? `Baseline approved ${baseline.at ? new Date(baseline.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}${offBaseline ? ` · ${changes.length} figure${changes.length === 1 ? "" : "s"} in ${SCENARIO_WORD[on]} moved from it` : " · the working numbers are the baseline"}` : `No approved baseline yet${isOwner ? " — approve one when the numbers are right" : " — an owner approves one"}. What-ifs are measured against the numbers as you opened them.`}</p>
        {changes.length > 0 && <button type="button" className="btn-ter" aria-expanded={showChanges} onClick={() => setShowChanges((v) => !v)}>{showChanges ? "Hide what changed" : "Show what changed"}</button>}
      </div>
      {showChanges && changes.length > 0 && <Changes changes={changes} refWord={refWord} onOpen={setDrill} />}
      {view === "traffic" && <TrafficView i={i} set={set} model={m} onOpen={setDrill} />}
      {view === "room" && <RoomView i={i} set={set} room={room} model={m} onOpenRoom={onOpenRoom} onOpen={setDrill} />}
      {view === "money" && <div className="vz-money grid gap-4 grid-cols-1 min-[1100px]:grid-cols-[minmax(0,400px)_minmax(0,1fr)] min-[1100px]:items-start">
        <div className="flex flex-col gap-3 min-w-0">
          <Lines i={i} set={set} on={on} m={m} onOpen={setDrill} />
          <Inputs_ i={i} set={set} fromSales={fromSales} />
          <MixEditor i={i} set={set} />
          {on === "base" && <Derive base={scen.base} onMake={(c, u) => void makeBoth(c, u)} />}
          <StructureForm s={structure} set={setStructure} raised={asked} i={i} setI={set} />
          <Evidence onUse={(cents) => { set({ avgOrderCents: cents }); setFromSales(cents); }} />
          <ResearchPanel planId={plan.id} items={research} ready={rs.data !== "not-yet"} onChanged={rs.reload} every={plan.research_every_days ?? 0} lastAt={plan.research_last_at ?? null} />
          <ActualPanel plan={plan} model={baselineBase ?? models.base} against={baseline ? "the approved baseline's Base" : "the working Base (no baseline approved yet)"} />
        </div>
        <div className="flex flex-col gap-3 min-w-0">
          <ScoreCard s={scores[on]} onOpen={setDrill} />
          <div className="vz-kpis grid gap-2 grid-cols-2 min-[700px]:grid-cols-3">
            {KPIS.filter((k) => m.ok || !NEEDS_MODEL.has(k)).map((k) => <Kpi key={k} t={traces[k]} was={moved.get(k)?.before ?? null} onOpen={setDrill} />)}
          </div>
          {!m.ok && <p className="vz-sub">Set {m.missing.join(", ")} to see {SCENARIO_WORD[on]}&apos;s money over 36 months.</p>}
          {m.ok && m.requiredFunding > 0 && Math.abs(asked - m.requiredFunding) > 100 && mine.length <= 1 && !(synced !== null && mine.length === 0) && (
            <button type="button" className="btn-sec btn-sm self-start" onClick={() => void syncAsk()} disabled={busy}>{mine.length ? `Make the roadmap's ask ${dollars(m.requiredFunding)} (it says ${dollars(asked)})` : `Put ${dollars(m.requiredFunding)} on the roadmap as this plan's ask`}</button>
          )}
          {m.ok && found.length > 0 && <div className="flex flex-col gap-1" role="list" aria-label="Where the numbers disagree">{found.map((f, k) => (
            <div key={k} role="listitem" className={f.level === "stop" ? "vz-issue error flex flex-wrap items-baseline justify-between gap-2" : "vz-issue warn flex flex-wrap items-baseline justify-between gap-2"}>
              <span>{f.words}</span>{f.about && <button type="button" className="btn-ter vz-why" onClick={() => setDrill(f.about)}>Why</button>}
            </div>))}</div>}
          {m.ok && (
            <>
              <CashChart models={models} focus={on} />
              <Years m={m} onOpen={setDrill} />
              {inv && <Investor v={inv} t={traces} onOpen={setDrill} />}
              <Tornado swings={swings} pct={20} />
              <Compare models={models} structure={structure} scores={scores} />
            </>
          )}
          <p className="vz-card-s">Projections from the numbers you set — not a forecast of what will happen, and not financial advice. Have an accountant check them before they go to an investor.</p>
        </div>
      </div>}
      {drill && <Drill t={traces[drill]} all={traces} i={i} m={m} flagsAbout={found.filter((f) => f.about === drill)} change={moved.get(drill) ?? null} refWord={refWord} onOpen={setDrill} onClose={() => setDrill(null)} />}
    </div>
  );
}
const pick = (f: (s: Scenario) => void) => (s: Scenario) => { haptic("selection"); f(s); };

function Kpi({ t, was, onOpen }: { t: Trace; was: string | null; onOpen: (k: MetricKey) => void }) {
  return (
    <button type="button" className={was != null ? "vz-kpi vz-kpi-btn moved" : "vz-kpi vz-kpi-btn"} onClick={() => onOpen(t.key)} aria-label={`${t.label}: ${t.display}${was != null ? `, was ${was}` : ""}. How it's worked out`}>
      <span>{t.label}</span><b>{t.display}</b>{was != null && <em>was {was}</em>}
    </button>
  );
}

function Changes({ changes, refWord, onOpen }: { changes: Change[]; refWord: string; onOpen: (k: MetricKey) => void }) {
  return (
    <div className="vz-cmp-wrap" role="region" aria-label={`What moved since ${refWord}`} tabIndex={0}>
      <table className="vz-cmp vz-num">
        <thead><tr><th scope="col">Figure</th><th scope="col">Was</th><th scope="col">Now</th><th scope="col">Because of</th></tr></thead>
        <tbody>{changes.map((c) => (
          <tr key={c.key}><th scope="row"><button type="button" className="btn-ter" onClick={() => onOpen(c.key)}>{c.label}</button></th><td>{c.before}</td><td>{c.after}</td><td>{c.because.map((b) => INPUT_WORD[b]).join("; ") || "—"}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/** A figure, opened: what it is, how it's worked out with the plan's own numbers, what it's made of, what it feeds. */
function Drill({ t, all, i, m, flagsAbout, change, refWord, onOpen, onClose }: {
  t: Trace; all: Record<MetricKey, Trace>; i: Inputs; m: Model; flagsAbout: Flag[]; change: Change | null; refWord: string; onOpen: (k: MetricKey) => void; onClose: () => void;
}) {
  const lines = t.key === "startupSpend" ? i.uses.filter((l) => l.category !== "reserve") : t.key === "reservePlanned" ? i.uses.filter((l) => l.category === "reserve") : null;
  const moves = [...downstream([t.key])];
  const roots = upstreamInputs(t.key);
  return (
    <Sheet open onClose={onClose} label={t.label} header={<div className="cp-head"><b>{t.label}</b><CloseButton onClick={onClose} /></div>}>
      <div className="vz">
        <div className="vz-drill-v"><b>{t.display}</b><span className={KIND_TAG[t.kind]}>{KIND_WORD[t.kind]}</span><span className="vz-card-s">{t.period}</span></div>
        <p className="vz-sub">{t.says}</p>
        <div className="vz-formula"><span>How it&apos;s worked out</span><code>{t.formula}</code><span>With this plan&apos;s numbers</span><code>{t.worked}</code></div>
        {t.path && (
          <ol className="vz-path" aria-label="Step by step">{t.path.map((s) => <li key={s.label}><span>{s.label}</span><b>{s.value}</b></li>)}</ol>
        )}
        {lines && (
          <div className="flex flex-col gap-1">
            <b className="font-sans">The lines</b>
            {lines.length === 0 ? <p className="vz-card-s">No lines yet.</p> : (
              <div className="vz-cmp-wrap" role="region" aria-label="The lines that make it up" tabIndex={0}>
                <table className="vz-cmp vz-num">
                  <thead><tr><th scope="col">Line</th><th scope="col">Qty × unit</th><th scope="col">Total</th><th scope="col">Source · how sure</th></tr></thead>
                  <tbody>{lines.map((l) => { const tot = lineTotal(l); return (
                    <tr key={l.id}><th scope="row">{l.label || "(no name)"}<br /><span className="vz-card-s">{CATEGORY_WORD[l.category]}</span></th>
                      <td>{l.unitCents == null ? "—" : `${l.qty ?? 1} × ${dollars(l.unitCents)}`}</td><td>{tot == null ? "Not priced yet" : dollars(tot)}</td>
                      <td>{[l.source, l.on, l.confidence ? CONFIDENCE_WORD[l.confidence] : null].filter(Boolean).join(" · ") || "—"}{l.notes ? <><br /><span className="vz-card-s">{l.notes}</span></> : null}</td></tr>); })}</tbody>
                </table>
              </div>
            )}
            <p className="vz-line-total">Σ lines = {dollars(lines.reduce((n, l) => n + Math.max(0, lineTotal(l) ?? 0), 0))} · the figure = {t.display}{lines.some((l) => lineTotal(l) == null) ? ` · ${lines.filter((l) => lineTotal(l) == null).length} not priced, not counted` : ""}</p>
            {t.key === "reservePlanned" && m.ok && <p className="vz-card-s">The early months need {dollars(m.reserveNeeded)} (the deepest the running net cash goes, investor payments counted).</p>}
          </div>
        )}
        {flagsAbout.map((f, k) => <p key={k} className={f.level === "stop" ? "vz-issue error" : "vz-issue warn"}>{f.words}</p>)}
        {change && <p className="vz-card-s">Since {refWord}: {change.before} → {change.after}{change.because.length ? `, because ${change.because.map((b) => INPUT_WORD[b].toLowerCase()).join("; ")} changed` : ""}.</p>}
        <div className="flex flex-col gap-1">
          <b className="font-sans">Made of</b>
          <div className="flex flex-wrap gap-2">{t.madeOf.map((k) => isInput(k) ? <span key={k} className="k-tag">{INPUT_WORD[k]}</span> : <button key={k} type="button" className="btn-sec btn-sm" onClick={() => onOpen(k)}>{all[k].label} · {all[k].display}</button>)}</div>
          <p className="vz-card-s">All the way back, it comes from: {roots.map((r) => INPUT_WORD[r]).join("; ") || "—"}.</p>
        </div>
        <div className="flex flex-col gap-1">
          <b className="font-sans">Feeds</b>
          {t.feeds.length ? <div className="flex flex-wrap gap-2">{t.feeds.map((k) => <button key={k} type="button" className="btn-sec btn-sm" onClick={() => onOpen(k)}>{all[k].label} · {all[k].display}</button>)}</div> : <p className="vz-card-s">Nothing else — it&apos;s a result.</p>}
          {moves.length > t.feeds.length && <p className="vz-card-s">Change it, and {moves.length} figures move in all.</p>}
        </div>
      </div>
    </Sheet>
  );
}

/** What the money buys, line by line: quantity × unit cost is the total — never typed beside it. */
function Lines({ i, set, on, m, onOpen }: { i: Inputs; set: (p: Partial<Inputs>) => void; on: Scenario; m: Model; onOpen: (k: MetricKey) => void }) {
  const put = (id: string, patch: Partial<UseLine>) => set({ uses: i.uses.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const blank = (category: Category): UseLine => ({ id: `n${Date.now().toString(36)}${++lineSeq}`, label: "", category, qty: 1, unitCents: null, source: null, on: null, confidence: null, notes: null });
  return (
    <details className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5" open>
      <summary className="font-sans font-bold text-subhead cursor-pointer py-2">What the money buys · {dollars(m.startupSpend)} to open{m.reservePlanned ? ` + ${dollars(m.reservePlanned)} held` : ""}</summary>
      <div className="flex flex-wrap gap-2"><button type="button" className="btn-ter" onClick={() => onOpen("startupSpend")}>How {dollars(m.startupSpend)} adds up</button>{m.reservePlanned > 0 && <button type="button" className="btn-ter" onClick={() => onOpen("reservePlanned")}>The reserve</button>}</div>
      {i.uses.map((u) => { const tot = lineTotal(u); return (
        <div key={`${on}-${u.id}`} className="vz-ask">
          <label className="prod-f col-span-2"><span>Line</span><input value={u.label} maxLength={80} onChange={(e) => put(u.id, { label: e.target.value })} /></label>
          <label className="prod-f col-span-2"><span>Category</span><select value={u.category} onChange={(e) => put(u.id, { category: e.target.value as Category })}>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_WORD[c]}</option>)}</select></label>
          <Num label="Quantity" value={u.qty} set={(v) => put(u.id, { qty: v })} />
          <Num label="Unit cost" unit="$" cents value={u.unitCents} set={(v) => put(u.id, { unitCents: v })} />
          <p className="vz-line-total col-span-2">{tot == null ? "Not priced yet — not in any total" : `${u.qty ?? 1} × ${dollars(u.unitCents!)} = ${dollars(tot)}`}</p>
          <label className="prod-f col-span-2"><span>Vendor or source</span><input value={u.source ?? ""} maxLength={120} onChange={(e) => put(u.id, { source: e.target.value || null })} /></label>
          <label className="prod-f"><span>As of</span><input type="date" value={u.on ?? ""} onChange={(e) => put(u.id, { on: e.target.value || null })} /></label>
          <label className="prod-f"><span>How sure</span><select value={u.confidence ?? ""} onChange={(e) => put(u.id, { confidence: (e.target.value || null) as Confidence | null })}><option value="">Not said</option>{CONFIDENCES.map((c) => <option key={c} value={c}>{CONFIDENCE_WORD[c]}</option>)}</select></label>
          <label className="prod-f col-span-2"><span>Notes</span><textarea rows={2} value={u.notes ?? ""} maxLength={240} onChange={(e) => put(u.id, { notes: e.target.value || null })} /></label>
          <div className="vz-ask-x"><button type="button" className="btn-ter" onClick={() => set({ uses: i.uses.filter((x) => x.id !== u.id) })}>Remove</button></div>
        </div>); })}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-sec btn-sm" onClick={() => set({ uses: [...i.uses, blank("equipment")] })}>+ A startup line</button>
        <button type="button" className="btn-sec btn-sm" onClick={() => set({ uses: [...i.uses, blank("reserve")] })}>+ Reserve held</button>
      </div>
    </details>
  );
}

function Inputs_({ i, set, fromSales }: { i: Inputs; set: (p: Partial<Inputs>) => void; fromSales: number | null }) {
  const z = (v: number | null) => v ?? 0;
  return (
    <>
      <details className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5" open>
        <summary className="font-sans font-bold text-subhead cursor-pointer py-2">Demand</summary>
        <div className="prod-grid stack-sm mt-0">
          <Num label="Orders a day, at full stride" value={i.ordersPerDay} set={(v) => set({ ordersPerDay: v })} />
          <Num label="Average order" unit="$" cents value={i.avgOrderCents} set={(v) => set({ avgOrderCents: v })} />
        </div>
        {fromSales != null && i.avgOrderCents === fromSales && <p className="vz-card-s">The average order is our sales&apos; — observed, from a truck and drops, not a storefront.</p>}
        <div className="prod-grid stack-sm mt-0">
          <Num label="Days open a month" value={i.daysOpenPerMonth} set={(v) => set({ daysOpenPerMonth: v })} />
          <Num label="Hours open a day" value={i.hoursOpenPerDay} set={(v) => set({ hoursOpenPerDay: v })} />
        </div>
        <div className="prod-grid stack-sm mt-0">
          <Num label="Months to full stride" value={i.rampMonths} set={(v) => set({ rampMonths: z(v) })} />
          <Num label="Opens at" unit="% of full" value={i.rampStartPct} set={(v) => set({ rampStartPct: v ?? 100 })} />
        </div>
        <Num label="Growth after that" unit="% a year" value={i.growthPctPerYear} set={(v) => set({ growthPctPerYear: z(v) })} />
      </details>
      <details className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5" open>
        <summary className="font-sans font-bold text-subhead cursor-pointer py-2">Costs</summary>
        <div className="prod-grid stack-sm mt-0">
          <Num label="Cost of goods" unit="% of sales" value={i.cogsPct} set={(v) => set({ cogsPct: v })} />
          <Num label="Card fees" unit="% of sales" value={i.cardFeePct} set={(v) => set({ cardFeePct: z(v) })} />
        </div>
        <p className="vz-card-s">Cost of goods is ingredients, packaging and other direct costs — in gross margin. Card fees are an operating expense, below it.</p>
        <div className="prod-grid stack-sm mt-0">
          <Num label="Staff hours a day" value={i.staffHoursPerDay} set={(v) => set({ staffHoursPerDay: v })} />
          <Num label="Wage" unit="$ an hour" cents value={i.wageCents} set={(v) => set({ wageCents: v })} />
        </div>
        <Num label="Payroll taxes & benefits" unit="% on top of wages" value={i.laborBurdenPct} set={(v) => set({ laborBurdenPct: z(v) })} />
        <div className="prod-grid stack-sm mt-0">
          <Num label="Rent" unit="$ a month" cents value={i.rentCents || null} set={(v) => set({ rentCents: z(v) })} />
          <Num label="…or a share of sales" unit="%" value={i.rentPctOfSales || null} set={(v) => set({ rentPctOfSales: z(v) })} />
        </div>
        <div className="prod-grid stack-sm mt-0">
          <Num label="Everything else" unit="$ a month" cents value={i.otherOpexCents || null} set={(v) => set({ otherOpexCents: z(v) })} />
          <Num label="Marketing" unit="$ a month" cents value={i.marketingCents || null} set={(v) => set({ marketingCents: z(v) })} />
        </div>
      </details>
    </>
  );
}

function Derive({ base, onMake }: { base: Inputs; onMake: (c: Inputs, u: Inputs) => void }) {
  const [demand, setDemand] = useState("20"), [cost, setCost] = useState("10");
  const d = Number(demand) || 0, c = Number(cost) || 0;
  return (
    <div className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5">
      <b className="font-sans text-subhead">Conservative and Upside, from Base</b>
      <p className="vz-card-s">Starting points you then edit: Conservative with demand down and costs up by your percentages; Upside the other way.</p>
      <div className="prod-grid stack-sm mt-0">
        <label className="prod-f"><span>Demand moves (%)</span><input inputMode="decimal" value={demand} onChange={(e) => setDemand(e.target.value)} /></label>
        <label className="prod-f"><span>Costs move (%)</span><input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></label>
      </div>
      <button type="button" className="btn-sec btn-sm self-start" onClick={() => onMake(derive(base, -d, c), derive(base, d, -c))}>Make both from Base</button>
    </div>
  );
}

function StructureForm({ s, set, raised, i, setI }: { s: Structure; set: (s: Structure) => void; raised: number; i: Inputs; setI: (p: Partial<Inputs>) => void }) {
  const amount = s.kind === "none" ? raised : s.amountCents;
  const choose = (k: Structure["kind"]) => {
    if (k === "none") set({ kind: "none" });
    else if (k === "loan") set({ kind: "loan", amountCents: amount, aprPct: s.kind === "loan" ? s.aprPct : 0, termMonths: s.kind === "loan" ? s.termMonths : 60 });
    else if (k === "rev_share") set({ kind: "rev_share", amountCents: amount, sharePct: s.kind === "rev_share" ? s.sharePct : 0, capMultiple: s.kind === "rev_share" ? s.capMultiple : 1 });
    else if (k === "equity") set({ kind: "equity", amountCents: amount, ownershipPct: s.kind === "equity" ? s.ownershipPct : 0, payoutPct: s.kind === "equity" ? s.payoutPct : 0 });
    else set({ kind: "safe", amountCents: amount, capCents: s.kind === "safe" ? s.capCents : 0, discountPct: s.kind === "safe" ? s.discountPct : 0 });
  };
  return (
    <div className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5">
      <b className="font-sans text-subhead">The funding</b>
      <Num label="The owners' own money in" unit="$" cents value={i.ownerCashCents || null} set={(v) => setI({ ownerCashCents: v ?? 0 })} />
      <label className="prod-f"><span>How an investor is paid</span><select value={s.kind} onChange={(e) => choose(e.target.value as Structure["kind"])}>{(Object.keys(STRUCTURE_WORD) as Structure["kind"][]).map((k) => <option key={k} value={k}>{STRUCTURE_WORD[k]}</option>)}</select></label>
      {s.kind !== "none" && <Num label="Amount invested" unit="$" cents value={s.amountCents || null} set={(v) => set({ ...s, amountCents: v ?? 0 })} />}
      {s.kind === "loan" && <div className="prod-grid stack-sm mt-0"><Num label="Rate" unit="% a year" value={s.aprPct} set={(v) => set({ ...s, aprPct: v ?? 0 })} /><Num label="Term" unit="months" value={s.termMonths} set={(v) => set({ ...s, termMonths: Math.max(1, Math.round(v ?? 1)) })} /></div>}
      {s.kind === "rev_share" && <div className="prod-grid stack-sm mt-0"><Num label="Share of sales" unit="%" value={s.sharePct} set={(v) => set({ ...s, sharePct: v ?? 0 })} /><Num label="Until paid" unit="× the investment" value={s.capMultiple} set={(v) => set({ ...s, capMultiple: v ?? 1 })} /></div>}
      {s.kind === "equity" && <div className="prod-grid stack-sm mt-0"><Num label="Ownership" unit="%" value={s.ownershipPct} set={(v) => set({ ...s, ownershipPct: v ?? 0 })} /><Num label="Profit paid out" unit="%" value={s.payoutPct} set={(v) => set({ ...s, payoutPct: v ?? 0 })} /></div>}
      {s.kind === "safe" && <div className="prod-grid stack-sm mt-0"><Num label="Valuation cap" unit="$" cents value={s.capCents || null} set={(v) => set({ ...s, capCents: v ?? 0 })} /><Num label="Discount" unit="%" value={s.discountPct} set={(v) => set({ ...s, discountPct: v ?? 0 })} /></div>}
      <p className="vz-card-s">Each structure has legal and tax consequences — a securities attorney and an accountant should review the terms before they&apos;re offered to anyone.</p>
    </div>
  );
}

const YEAR_ROWS: [MetricKey, string, (y: Model["years"][number]) => number][] = [
  ["revenue", "Sales", (y) => y.revenue], ["cogs", "Cost of goods", (y) => y.cogs], ["grossProfit", "Gross profit", (y) => y.grossProfit],
  ["operatingExpenses", "Operating expenses", (y) => y.operatingExpenses], ["operatingCash", "Operating cash", (y) => y.operating],
  ["investorPayments", "To the investor", (y) => y.toInvestor], ["netCash", "Net cash", (y) => y.net],
];
function Years({ m, onOpen }: { m: Model; onOpen: (k: MetricKey) => void }) {
  return (
    <div className="vz-cmp-wrap" role="region" aria-label="The three years" tabIndex={0}>
      <table className="vz-cmp vz-num">
        <thead><tr><th scope="col"><span className="sr-only">Line</span></th>{m.years.map((y) => <th key={y.year} scope="col">Year {y.year}</th>)}</tr></thead>
        <tbody>{YEAR_ROWS.map(([k, l, f]) => <tr key={k}><th scope="row"><button type="button" className="btn-ter" onClick={() => onOpen(k)}>{l}</button></th>{m.years.map((y) => <td key={y.year}>{dollars(f(y))}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Investor({ v, t, onOpen }: { v: ReturnType<typeof investor>; t: Record<MetricKey, Trace>; onOpen: (k: MetricKey) => void }) {
  if (v.kind === "none") return <p className="vz-card-s">{v.says[0]}</p>;
  return (
    <div className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5">
      <b className="font-sans text-subhead">The investor&apos;s side · {STRUCTURE_WORD[v.kind]}</b>
      <div className="vz-kpis grid gap-2 grid-cols-2 min-[700px]:grid-cols-4">
        <div className="vz-kpi"><span>Invested</span><b>{dollars(v.amount)}</b></div>
        <Kpi t={t.investorPayments} was={null} onOpen={onOpen} />
        <Kpi t={t.investorReturn} was={null} onOpen={onOpen} />
        <Kpi t={t.ownership} was={null} onOpen={onOpen} />
      </div>
      <p className="vz-card-s">Cash back in year 1: {v.cashOnCashY1Pct == null ? "—" : `${v.cashOnCashY1Pct.toFixed(1)}%`} of the investment. This is the investor&apos;s return — the business&apos;s own ROI is above, before financing.</p>
      {v.says.map((s, k) => <p key={k} className="vz-card-s">{s}</p>)}
    </div>
  );
}

function Compare({ models, structure, scores }: { models: Record<Scenario, Model>; structure: Structure; scores: Record<Scenario, ReturnType<typeof score>> }) {
  const rows: [string, (m: Model) => string][] = [
    ["Year 3 sales", (m) => (m.ok ? dollars(m.years[2].revenue) : "—")],
    ["Funding required", (m) => (m.ok ? dollars(m.requiredFunding) : "—")],
    ["Breaks even", (m) => (m.ok ? (m.breakEvenMonth ? `Month ${m.breakEvenMonth}` : "Not in 36") : "—")],
    ["Payback", (m) => (m.ok ? (m.paybackMonth ? `Month ${m.paybackMonth}` : "Not in 36") : "—")],
    ["Business ROI", (m) => (m.ok && m.roiBusiness != null ? `${(m.roiBusiness * 100).toFixed(0)}%` : "—")],
    ["Investor IRR", (m) => { if (!m.ok || structure.kind === "none") return "—"; const r = investor(m, structure).irrPct; return r == null ? "—" : `${r.toFixed(1)}%`; }],
  ];
  return (
    <div className="vz-cmp-wrap" role="region" aria-label="The scenarios side by side" tabIndex={0}>
      {/* The score is the plan's, per scenario — the same rubric on each scenario's numbers. */}
      <table className="vz-cmp vz-num">
        <thead><tr><th scope="col"><span className="sr-only">Measure</span></th>{SCENARIOS.map((s) => <th key={s} scope="col"><i className={SC_SWATCH[s]} />{SCENARIO_WORD[s]}</th>)}</tr></thead>
        <tbody>{rows.map(([l, f]) => <tr key={l}><th scope="row">{l}</th>{SCENARIOS.map((s) => <td key={s}>{f(models[s])}</td>)}</tr>)}
          <tr><th scope="row">The score</th>{SCENARIOS.map((s) => <td key={s}>{scores[s].total == null ? "—" : `${scores[s].total} / 100`}</td>)}</tr></tbody>
      </table>
    </div>
  );
}

/** GT3's own sales, last 90 days: evidence beside the inputs — offered, never filled in silently. */
function Evidence({ onUse }: { onUse: (avgOrderCents: number) => void }) {
  const [obs, setObs] = useState<Observed[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const read = async () => {
    if (!supabase || busy) return;
    setBusy(true); setErr(null);
    try {
      const from = new Date(Date.now() - 90 * 86400000).toISOString();
      const { lines, failed } = await readLedger(supabase, { fromIso: from });
      setObs(observed(lines));
      if (failed.length) setErr(`Couldn't read ${failed.map((c) => CHANNEL_WORD[c]).join(", ")} — those aren't counted.`);
    } catch (e) { setErr(failureWords(e as Error, "Couldn't read the sales")); } finally { setBusy(false); }
  };
  return (
    <div className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5">
      <b className="font-sans text-subhead">What our own sales say</b>
      <p className="vz-card-s">The last 90 days of paid orders — the truck, drops, delivery, offices, the shop. Real, but not a storefront&apos;s: use them as evidence, not as the plan.</p>
      {!obs ? <button type="button" className="btn-sec btn-sm self-start" onClick={() => void read()} disabled={busy}>{busy ? "Reading…" : "Read our sales"}</button> : (
        <div className="k-rows">
          {obs.filter((o) => o.orders > 0).map((o) => (
            <div key={o.channel} className="vz-obs">
              <b>{o.channel === "all" ? "All channels" : CHANNEL_WORD[o.channel as Channel] ?? o.channel}</b>
              <span>{o.orders.toLocaleString("en-US")} orders on {o.activeDays} days{o.avgOrderCents ? ` · average ${dollars(o.avgOrderCents)}` : ""}{o.ordersPerActiveDay ? ` · ${o.ordersPerActiveDay} a day they sold` : ""}{o.repeatPct != null ? ` · ${o.repeatPct}% came back` : ""}</span>
              {o.avgOrderCents != null && <button type="button" className="btn-ter self-start" onClick={() => onUse(o.avgOrderCents!)}>Use {dollars(o.avgOrderCents)} as the average order</button>}
            </div>
          ))}
          {obs.every((o) => o.orders === 0) && <p className="vz-card-s">No paid orders in the last 90 days to learn from.</p>}
        </div>
      )}
      {err && <Said as="p" className="vz-issue warn">{err}</Said>}
    </div>
  );
}
