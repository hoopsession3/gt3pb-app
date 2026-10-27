"use client";

import { useMemo, useState } from "react";
import { INPUT_KEYS, INPUT_WORD, SCENARIOS, SCENARIO_WORD, STRUCTURE_WORD, dollars, toInputs, type Kind, type MetricKey, type NodeKey, type Trace } from "@/lib/visionMoney";
import { figuresOf, type PlanCase } from "@/lib/visionCase";
import { READINESS_WORD } from "@/lib/visionScore";
import { LEVEL_WORD, keyRisks } from "@/lib/visionRisks";
import { TOPIC_WORD, domainOf } from "@/lib/visionResearch";
import { EXPLORE_FIGURES, LEVERS, LEVER_WORD, isEdited, leverRange, whatIf, type CasePart, type Edits, type Lever, type PresentMode } from "@/lib/visionPresent";
import type { Layout } from "@/lib/vision";
import type { Plan } from "@/lib/visionPlans";
import { money } from "@/lib/money";
import { CashChart, SC_SWATCH } from "./MoneyCharts";

// A PLAN'S CASE, PRESENTED (R57, phase E). What it takes and what it returns — from the owner-approved baseline, through
// the one engine: startup spending, funding required, break-even, payback, the business's ROI before financing, the
// investor's rate under the structure as defined, the three scenarios side by side, cash on hand month by month, the
// score with what it is and isn't; then what the market says, every finding with its source. Labelled as projections.
//
// IP1 (2026-10-27): in Pitch the case is told in parts, one message a slide (`part`); in Explore a guest moves four levers
// over the approved base — held in this component's state only, never stored or sent, and said to be theirs; in
// Diligence every figure opens to its formula, its worked numbers, what it's made of and the sources behind the case.
const KIND_WORD: Record<Kind, string> = { assumed: "Assumed in the approved case", observed: "From GT3's own sales", computed: "Computed by the engine", simulated: "Simulated", actual: "Actual" };
const isInput = (k: NodeKey) => (INPUT_KEYS as readonly string[]).includes(k);

export default function CaseSlide({ plan, c, room, part = "all", mode = "pitch" }: { plan: Plan; c: PlanCase; room: Layout | null; part?: CasePart | "all"; mode?: PresentMode }) {
  const f = useMemo(() => figuresOf(c, room), [c, room]);
  const b = f.models.base, t = f.base, sc = f.scores.base;
  const approved = c.approvedAt ? new Date(c.approvedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
  const [open, setOpen] = useState<MetricKey | null>(null);
  const drill = mode === "diligence";
  const k = (key: MetricKey | null, label: string, value: string, note?: string) => drill && key ? (
    <button key={label} type="button" className={open === key ? "vz-kpi vz-kpi-btn on" : "vz-kpi vz-kpi-btn"} aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)} aria-label={`${label}: ${value}. How it's worked out`}>
      <span>{label}</span><b>{value}</b>{note && <em>{note}</em>}
    </button>
  ) : <div key={label} className="vz-kpi"><span>{label}</span><b>{value}</b>{note && <em>{note}</em>}</div>;
  const show = (p: CasePart) => part === "all" || part === p;
  const risks = keyRisks(c.risks);
  const sub = part === "cash" ? "Cash, month by month — and three ways it could go." : part === "risks" ? "What could go wrong, and what we do about it." : part === "evidence" ? "What the market says, each finding with its source." : "What it takes, and what it returns.";
  return (
    <>
      <p className="vp-eyebrow">The case · {plan.name}</p>
      <h2 className="vp-title">{sub}</h2>
      {show("ask") && (plan.customer || plan.positioning) && <p className="vp-lede">{[plan.customer, plan.positioning].filter(Boolean).join(" ")}</p>}
      {(show("ask") || show("cash")) && !b.ok && <p className="vp-lede">The approved numbers aren&apos;t complete yet — {b.missing.join(", ")}.</p>}
      {mode === "explore" && b.ok && <Explore c={c} room={room} base={t} />}
      {b.ok && show("ask") && mode !== "explore" && (
        <div className={part === "ask" ? "vz-kpis vp-kpis-big grid gap-2 grid-cols-2 min-[900px]:grid-cols-3" : "vz-kpis grid gap-2 grid-cols-2 min-[700px]:grid-cols-4"}>
          {k("startupSpend", "Startup spending", t.startupSpend.display, b.reservePlanned ? `+ ${dollars(b.reservePlanned)} held in reserve` : undefined)}
          {k("requiredFunding", "Funding required", t.requiredFunding.display, "startup + the early months, investor paid")}
          {k("breakEven", "Breaks even", t.breakEven.display)}
          {k("payback", "Pays back its startup", t.payback.display)}
          {k("roiBusiness", "Business ROI, 36 months", t.roiBusiness.display, "before financing and tax")}
          {k(null, "The investor's rate", f.irrPct == null ? (c.structure.kind === "safe" ? "Converts later" : "—") : `${f.irrPct.toFixed(1)}% a year`, STRUCTURE_WORD[c.structure.kind])}
          {part === "all" && k(null, "Investment readiness", sc.total == null ? "—" : `${sc.total} / 100`, `${READINESS_WORD[sc.readiness]} · not a probability`)}
          {part === "all" && k("revenue", "Sales, 36 months", t.revenue.display)}
        </div>
      )}
      {drill && open && <Drill t={t[open]} all={t} c={c} approved={approved} onOpen={setOpen} onClose={() => setOpen(null)} />}
      {b.ok && show("cash") && (
        <>
          <CashChart models={f.models} focus="base" />
          <div className="vz-cmp-wrap" role="region" aria-label="The three scenarios" tabIndex={0}>
            <table className="vz-cmp vz-num">
              <thead><tr><th scope="col"><span className="sr-only">Measure</span></th>{SCENARIOS.map((s) => <th key={s} scope="col"><i className={SC_SWATCH[s]} />{SCENARIO_WORD[s]}</th>)}</tr></thead>
              <tbody>
                <tr><th scope="row">Sales, year 3</th>{SCENARIOS.map((s) => <td key={s}>{f.models[s].ok ? dollars(f.models[s].years[2].revenue) : "—"}</td>)}</tr>
                <tr><th scope="row">Funding required</th>{SCENARIOS.map((s) => <td key={s}>{f.models[s].ok ? dollars(f.models[s].requiredFunding) : "—"}</td>)}</tr>
                <tr><th scope="row">Pays back</th>{SCENARIOS.map((s) => <td key={s}>{f.models[s].ok ? (f.models[s].paybackMonth ? `Month ${f.models[s].paybackMonth}` : "Not in 36") : "—"}</td>)}</tr>
                <tr><th scope="row">The score</th>{SCENARIOS.map((s) => <td key={s}>{f.scores[s].total == null ? "—" : f.scores[s].total}</td>)}</tr>
              </tbody>
            </table>
          </div>
          {part === "cash" && <p className="vz-card-s">Investment readiness {sc.total == null ? "—" : `${sc.total} / 100`} · {READINESS_WORD[sc.readiness]} · not a probability.</p>}
        </>
      )}
      {show("risks") && risks.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="vp-eyebrow">The risks we watch</p>
          {risks.map((r, i) => (
            <p key={i} className="vp-lede">{r.kind === "assumption" ? "Assuming" : "Risk"}: {r.words}{r.likelihood && r.impact ? ` (${LEVEL_WORD[r.likelihood].toLowerCase()} likelihood, ${LEVEL_WORD[r.impact].toLowerCase()} impact)` : ""}{r.mitigation ? ` — ${r.mitigation}` : ""}</p>
          ))}
        </div>
      )}
      {show("evidence") && c.research.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="vp-eyebrow">What the market says · {c.research.length} finding{c.research.length === 1 ? "" : "s"}, each with its source</p>
          {c.research.slice(0, 8).map((r, i) => (
            <p key={i} className="vp-lede">{TOPIC_WORD[r.topic] ?? r.topic}: {r.claim}{r.figure ? ` (${r.figure})` : ""} — <a href={r.source_url} target="_blank" rel="noopener noreferrer">{r.source_title || domainOf(r.source_url)}</a></p>
          ))}
        </div>
      )}
      <p className="vz-card-s">Projections from the plan&apos;s approved numbers{approved ? `, approved ${approved}` : ""} — not a forecast of what will happen, not an offer of securities and not financial advice.</p>
    </>
  );
}

/** Explore: the approved base with a guest's what-if over it. State lives here and nowhere else — no storage, no request. */
function Explore({ c, room, base }: { c: PlanCase; room: Layout | null; base: Record<MetricKey, Trace> }) {
  const approvedIn = useMemo(() => toInputs(c.scenarios.base), [c]);
  const [edits, setEdits] = useState<Edits>({});
  const mine = useMemo(() => figuresOf(whatIf(c, edits), room), [c, edits, room]);
  const edited = isEdited(edits);
  const say = (l: Lever, v: number) => (l === "cogsPct" ? `${v}%` : l === "ordersPerDay" ? `${v}` : l === "avgOrderCents" ? money(v) : dollars(v));
  return (
    <section className="vp-explore" aria-label="Your what-if">
      <div className="vp-explore-head">
        <p className="vp-eyebrow">{edited ? "Your what-if — not GT3's plan" : "Move a number to see what changes"}</p>
        {edited && <button type="button" className="btn-sec btn-sm" onClick={() => setEdits({})}>Back to the approved case</button>}
      </div>
      <div className="grid gap-3 grid-cols-1 min-[700px]:grid-cols-2">
        {LEVERS.map((l) => {
          const was = approvedIn[l] as number | null, r = leverRange(l, was);
          const v = edits[l] ?? was;
          return (
            <label key={l} className="vp-lever">
              <span><b>{LEVER_WORD[l]}</b> {v == null || !r ? "" : say(l, v)}{r && edits[l] != null && edits[l] !== was ? <em> · approved {say(l, was!)}</em> : null}</span>
              {r ? <input type="range" min={r.min} max={r.max} step={r.step} value={v ?? r.min} onChange={(e) => setEdits((x) => ({ ...x, [l]: Number(e.target.value) }))} aria-valuetext={v == null ? undefined : say(l, v)} />
                : <em>{l === "rentCents" && was === 0 ? "No fixed rent in the approved case — nothing to move." : "Not set in the approved case — nothing to move from."}</em>}
            </label>
          );
        })}
      </div>
      <div className="vz-kpis grid gap-2 grid-cols-2 min-[700px]:grid-cols-4" aria-live="polite">
        {EXPLORE_FIGURES.map((m) => (
          <div key={m} className={edited && mine.base[m].display !== base[m].display ? "vz-kpi moved" : "vz-kpi"}>
            <span>{base[m].label}</span><b>{mine.models.base.ok ? mine.base[m].display : "—"}</b>{edited && mine.base[m].display !== base[m].display && <em>approved {base[m].display}</em>}
          </div>
        ))}
      </div>
      <p className="vz-card-s">Held on this screen only — nothing is saved or sent, and it&apos;s gone when you leave Explore.</p>
    </section>
  );
}

/** Diligence: a figure, opened — what it is, its formula with the plan's own numbers, what it's made of, the sources. */
function Drill({ t, all, c, approved, onOpen, onClose }: { t: Trace; all: Record<MetricKey, Trace>; c: PlanCase; approved: string | null; onOpen: (k: MetricKey) => void; onClose: () => void }) {
  return (
    <section className="vp-drill" aria-label={`${t.label}, how it's worked out`}>
      <div className="vp-explore-head"><p className="vp-eyebrow">{t.label} · {t.display}</p><button type="button" className="btn-sec btn-sm" onClick={onClose}>Close</button></div>
      <p className="vp-lede">{t.says}</p>
      <p className="vz-card-s">{KIND_WORD[t.kind]} · {t.period}</p>
      <div className="vz-formula"><span>How it&apos;s worked out</span><code>{t.formula}</code><span>With this plan&apos;s numbers</span><code>{t.worked}</code></div>
      {t.path && <ol className="vz-path" aria-label="Step by step">{t.path.map((s) => <li key={s.label}><span>{s.label}</span><b>{s.value}</b></li>)}</ol>}
      <div className="flex flex-wrap gap-2">
        {t.madeOf.map((m) => isInput(m) ? <span key={m} className="k-tag">{INPUT_WORD[m as keyof typeof INPUT_WORD]}</span>
          : <button key={m} type="button" className="btn-sec btn-sm" onClick={() => onOpen(m as MetricKey)}>{all[m as MetricKey].label} · {all[m as MetricKey].display}</button>)}
      </div>
      <p className="vz-card-s">From the owner-approved baseline{approved ? ` of ${approved}` : ""}. {c.research.length ? `${c.research.length} accepted finding${c.research.length === 1 ? "" : "s"} stand behind the case:` : "No accepted research is attached to this case yet."}</p>
      {c.research.slice(0, 8).map((r, i) => <p key={i} className="vz-card-s">{TOPIC_WORD[r.topic] ?? r.topic}: <a href={r.source_url} target="_blank" rel="noopener noreferrer">{r.source_title || domainOf(r.source_url)}</a>{r.retrieved_at ? ` · retrieved ${r.retrieved_at.slice(0, 10)}` : ""}</p>)}
    </section>
  );
}
