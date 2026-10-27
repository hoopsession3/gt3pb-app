"use client";

import { useMemo, useState } from "react";
import { INPUT_KEYS, INPUT_WORD, SCENARIOS, SCENARIO_WORD, STRUCTURE_WORD, dollars, type Kind, type MetricKey, type Model, type NodeKey, type Trace } from "@/lib/visionMoney";
import { figuresOf, type PlanCase } from "@/lib/visionCase";
import { READINESS_WORD } from "@/lib/visionScore";
import { LEVEL_WORD, keyRisks } from "@/lib/visionRisks";
import { TOPIC_WORD, domainOf } from "@/lib/visionResearch";
import { EXPLORE_FIGURES, LEVERS, LEVER_WORD, PRESENT_LABEL, approvedOf, askHeadline, cashHeadline, isEdited, leverRange, whatIf, type CasePart, type Edits, type Lever, type PresentMode } from "@/lib/visionPresent";
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
const KIND_WORD: Record<Kind, string> = { assumed: "An assumption in the approved plan", observed: "From GT3's own sales", computed: "Calculated", simulated: "Simulated", actual: "Actual" };
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
  // IP1.2 (the editorial pass): a headline says what the numbers mean, not what the slide contains.
  const sub = !b.ok ? "The numbers aren't finished yet." : part === "cash" ? cashHeadline(b) : part === "risks" ? "What could go wrong, and what we'd do about it." : part === "evidence" ? "What the research says, and where it came from." : askHeadline(b, c.structure.kind);
  return (
    <>
      <p className="vp-eyebrow">The case · {plan.name}</p>
      <h2 className="vp-title">{sub}</h2>
      {show("ask") && (plan.customer || plan.positioning) && <p className="vp-lede">{[plan.customer, plan.positioning].filter(Boolean).join(" ")}</p>}
      {(show("ask") || show("cash")) && !b.ok && <p className="vp-lede">Still missing from the approved plan: {b.missing.join(", ")}.</p>}
      {mode === "explore" && b.ok && <Explore c={c} room={room} base={t} />}
      {b.ok && show("ask") && mode !== "explore" && (
        <div className={part === "ask" ? "vz-kpis vp-kpis-big grid gap-2 grid-cols-2 min-[900px]:grid-cols-3" : "vz-kpis grid gap-2 grid-cols-2 min-[700px]:grid-cols-4"}>
          {k("startupSpend", PRESENT_LABEL.startupSpend!, b.unpriced ? `${t.startupSpend.display}+` : t.startupSpend.display, b.unpriced ? `plus ${b.unpriced} cost${b.unpriced === 1 ? "" : "s"} not yet priced` : undefined)}
          {k("requiredFunding", PRESENT_LABEL.requiredFunding!, t.requiredFunding.display, `opening cost + ${dollars(b.reserveNeeded)} to carry the first months`)}
          {k("breakEven", PRESENT_LABEL.breakEven!, t.breakEven.display, after(t.breakEvenAfter.display, c))}
          {k("payback", PRESENT_LABEL.payback!, t.payback.display, after(t.paybackAfter.display, c))}
          {k("roiBusiness", PRESENT_LABEL.roiBusiness!, t.roiBusiness.display, c.structure.kind === "none" ? "before tax" : `before tax and the investor · ${t.roiAfter.display} after`)}
          {k(f.inv ? "investorReturn" : null, PRESENT_LABEL.investorReturn!, f.irrPct == null ? (c.structure.kind === "safe" ? "Converts later" : "—") : `${f.irrPct.toFixed(1)}% a year`, investorNote(c, f))}
          {part === "all" && k(null, "Investment readiness", sc.total == null ? "—" : `${sc.total} / 100`, `${READINESS_WORD[sc.readiness]} · a checklist score, not a probability`)}
          {part === "all" && k("revenue", PRESENT_LABEL.revenue!, t.revenue.display)}
        </div>
      )}
      {b.ok && show("ask") && <Raising m={b} />}
      {drill && open && <Drill t={t[open]} all={t} c={c} approved={approved} onOpen={setOpen} onClose={() => setOpen(null)} />}
      {b.ok && show("cash") && (
        <>
          <CashChart models={f.models} focus="base" />
          <CashFacts f={f} />
          <div className="vz-cmp-wrap" role="region" aria-label="The three scenarios" tabIndex={0}>
            <table className="vz-cmp vz-num">
              <thead><tr><th scope="col"><span className="sr-only">Measure</span></th>{SCENARIOS.map((s) => <th key={s} scope="col"><i className={SC_SWATCH[s]} />{SCENARIO_WORD[s]}</th>)}</tr></thead>
              <tbody>
                <tr><th scope="row">Sales in year 3</th>{SCENARIOS.map((s) => <td key={s}>{f.models[s].ok ? dollars(f.models[s].years[2].revenue) : "—"}</td>)}</tr>
                <tr><th scope="row">Minimum funding</th>{SCENARIOS.map((s) => <td key={s}>{f.models[s].ok ? dollars(f.models[s].requiredFunding) : "—"}</td>)}</tr>
                <tr><th scope="row">Earns back opening cost</th>{SCENARIOS.map((s) => <td key={s}>{f.models[s].ok ? (f.models[s].paybackMonth ? `Month ${f.models[s].paybackMonth}` : "Not in 3 years") : "—"}</td>)}</tr>
                <tr><th scope="row">Readiness score</th>{SCENARIOS.map((s) => <td key={s}>{f.scores[s].total == null ? "—" : f.scores[s].total}</td>)}</tr>
              </tbody>
            </table>
          </div>
          {part === "cash" && <p className="vz-card-s">Investment readiness: {sc.total == null ? "—" : `${sc.total} out of 100`}, {READINESS_WORD[sc.readiness].toLowerCase()}. It&apos;s a checklist score, not a probability of success. {b.missing.length || b.unpriced ? `The plan still has gaps: ${[...b.missing, b.unpriced ? `${b.unpriced} cost${b.unpriced === 1 ? "" : "s"} not yet priced` : null].filter(Boolean).join(", ")}.` : "Every input is filled in."}{c.research.length ? "" : " No market research has been accepted yet, so demand is an assumption, not a finding."}</p>}
        </>
      )}
      {show("risks") && risks.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="vp-eyebrow">The risks we watch</p>
          {risks.map((r, i) => (
            <p key={i} className="vp-lede">{r.kind === "assumption" ? "We're assuming: " : ""}{sentence(r.words)}{r.likelihood && r.impact ? ` Likelihood ${LEVEL_WORD[r.likelihood].toLowerCase()}, impact ${LEVEL_WORD[r.impact].toLowerCase()}.` : ""}{r.mitigation ? ` What we'd do: ${sentence(r.mitigation)}` : ""}</p>
          ))}
        </div>
      )}
      {show("evidence") && c.research.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="vp-eyebrow">Research · {c.research.length} finding{c.research.length === 1 ? "" : "s"}, each with its source</p>
          {c.research.slice(0, 8).map((r, i) => (
            <p key={i} className="vp-lede">{TOPIC_WORD[r.topic] ?? r.topic}: {r.claim}{r.figure ? ` (${r.figure})` : ""} — <a href={r.source_url} target="_blank" rel="noopener noreferrer">{r.source_title || domainOf(r.source_url)}</a></p>
          ))}
        </div>
      )}
      <p className="vz-card-s">Projections from the plan{approved ? ` approved on ${approved}` : ""}, not results. Not an offer of securities and not financial advice.</p>
    </>
  );
}

/** Explore: the approved base with a guest's what-if over it. State lives here and nowhere else — no storage, no request. */
function Explore({ c, room, base }: { c: PlanCase; room: Layout | null; base: Record<MetricKey, Trace> }) {
  const [edits, setEdits] = useState<Edits>({});
  const mine = useMemo(() => figuresOf(whatIf(c, edits), room), [c, edits, room]);
  const edited = isEdited(edits);
  const say = (l: Lever, v: number) => (l === "cogsPct" || l === "startupPct" || l === "sharePct" ? `${v}%` : l === "ordersPerDay" ? `${v}` : l === "avgOrderCents" ? money(v) : dollars(v));
  return (
    <section className="vp-explore" aria-label="Your what-if">
      <div className="vp-explore-head">
        <p className="vp-eyebrow">{edited ? "Your what-if — not GT3's plan" : "Move a number and watch the plan respond"}</p>
        {edited && <button type="button" className="btn-sec btn-sm" onClick={() => setEdits({})}>Back to the approved case</button>}
      </div>
      <div className="grid gap-3 grid-cols-1 min-[700px]:grid-cols-2">
        {LEVERS.filter((l) => l !== "sharePct" || approvedOf(c, l) != null).map((l) => {
          const was = approvedOf(c, l), r = leverRange(l, was);
          const v = edits[l] ?? was;
          return (
            <label key={l} className="vp-lever">
              <span><b>{LEVER_WORD[l]}</b> {v == null || !r ? "" : say(l, v)}{r && edits[l] != null && edits[l] !== was ? <em> · approved {say(l, was!)}</em> : null}</span>
              {r ? <input type="range" min={r.min} max={r.max} step={r.step} value={v ?? r.min} onChange={(e) => setEdits((x) => ({ ...x, [l]: Number(e.target.value) }))} aria-valuetext={v == null ? undefined : say(l, v)} />
                : <em>{l === "rentCents" && was === 0 ? "No fixed rent in this plan — rent is a share of sales." : "Not set in this plan."}</em>}
            </label>
          );
        })}
      </div>
      <div className="vz-kpis grid gap-2 grid-cols-2 min-[700px]:grid-cols-3 min-[1000px]:grid-cols-5" aria-live="polite">
        {EXPLORE_FIGURES.map((m) => (
          <div key={m} className={edited && mine.base[m].display !== base[m].display ? "vz-kpi moved" : "vz-kpi"}>
            <span>{PRESENT_LABEL[m] ?? base[m].label}</span><b>{mine.models.base.ok ? mine.base[m].display : "—"}</b>{edited && mine.base[m].display !== base[m].display && <em>approved {base[m].display}</em>}
          </div>
        ))}
      </div>
      <p className="vz-card-s">Only you see this. Nothing is saved or sent, and it resets when you leave Explore.</p>
    </section>
  );
}

/** Diligence: a figure, opened — what it is, its formula with the plan's own numbers, what it's made of, the sources. */
function Drill({ t, all, c, approved, onOpen, onClose }: { t: Trace; all: Record<MetricKey, Trace>; c: PlanCase; approved: string | null; onOpen: (k: MetricKey) => void; onClose: () => void }) {
  return (
    <section className="vp-drill" aria-label={`${PRESENT_LABEL[t.key] ?? t.label}, how it's worked out`}>
      <div className="vp-explore-head"><p className="vp-eyebrow">{PRESENT_LABEL[t.key] ?? t.label} · {t.display}</p><button type="button" className="btn-sec btn-sm" onClick={onClose}>Close</button></div>
      <p className="vp-lede">{t.says}</p>
      <p className="vz-card-s">{KIND_WORD[t.kind]} · {t.period}</p>
      <div className="vz-formula"><span>How it&apos;s worked out</span><code>{t.formula}</code><span>With this plan&apos;s numbers</span><code>{t.worked}</code></div>
      {t.path && <ol className="vz-path" aria-label="Step by step">{t.path.map((s) => <li key={s.label}><span>{s.label}</span><b>{s.value}</b></li>)}</ol>}
      <div className="flex flex-wrap gap-2">
        {t.madeOf.map((m) => isInput(m) ? <span key={m} className="k-tag">{INPUT_WORD[m as keyof typeof INPUT_WORD]}</span>
          : <button key={m} type="button" className="btn-sec btn-sm" onClick={() => onOpen(m as MetricKey)}>{PRESENT_LABEL[m as MetricKey] ?? all[m as MetricKey].label} · {all[m as MetricKey].display}</button>)}
      </div>
      <p className="vz-card-s">From the plan approved{approved ? ` on ${approved}` : ""}. {c.research.length ? `${c.research.length} accepted research finding${c.research.length === 1 ? "" : "s"} support it:` : "No market research has been accepted for it yet."}</p>
      {c.research.slice(0, 8).map((r, i) => <p key={i} className="vz-card-s">{TOPIC_WORD[r.topic] ?? r.topic}: <a href={r.source_url} target="_blank" rel="noopener noreferrer">{r.source_title || domainOf(r.source_url)}</a>{r.retrieved_at ? ` · retrieved ${r.retrieved_at.slice(0, 10)}` : ""}</p>)}
    </section>
  );
}

/** What the investor receives, in the engine's own words — and whether the rate leans on months past 36. */
function investorNote(c: PlanCase, f: ReturnType<typeof figuresOf>): string {
  if (!f.inv) return STRUCTURE_WORD[c.structure.kind];
  const s = c.structure;
  // The engine's own sentence says when the cap is met past month 36 — read, never recomputed here.
  const capAt = f.inv.says.map((w) => /cap is met in month (\d+)/.exec(w)?.[1]).find(Boolean);
  if (s.kind === "rev_share") return `${s.sharePct}% of sales until ${dollars(s.amountCents * s.capMultiple)} is repaid${capAt ? ` — around month ${capAt}, if year-3 sales hold` : ""}`;
  return `${STRUCTURE_WORD[s.kind]} · ${f.inv.says[0]}`;
}

/** "Month 3 after the investor's share" — or nothing when there's no investor. */
function after(display: string, c: PlanCase): string {
  return c.structure.kind === "none" ? "" : `${display.toLowerCase()} after the investor's share`;
}

const sentence = (w: string) => { const t = w.trim(); return /[.!?]$/.test(t) ? t : `${t}.`; };

/** The ask, reconciled (IP1.1 — the audit's "Funding required $32,193 next to + $10,000 reserve" read as $42,193): what's
 *  raised, what it's planned for, what's left over, and the model's own minimum — one line, from the engine's figures. */
function Raising({ m }: { m: Model }) {
  const uses = m.startupSpend + m.reservePlanned, left = m.fundingRaised - uses;
  if (m.fundingRaised <= 0) return null;
  return (
    <p className="vp-raise">
      We&apos;re raising <b>{dollars(m.fundingRaised)}</b>. {dollars(m.startupSpend)} opens it, {dollars(m.reservePlanned)} is held in reserve{left > 0 ? `, and ${dollars(left)} isn't yet assigned` : left < 0 ? `, which leaves us ${dollars(-left)} short of the plan` : ""}. The plan needs at least {dollars(m.requiredFunding)}.
    </p>
  );
}

/** Cash, in facts and in a table (IP1.1): opening, the lowest point and when, closing, what the investor is paid and is still
 *  owed, the downside's lowest point — and every month, readable without a pointer. A positive close is never the story. */
function CashFacts({ f }: { f: ReturnType<typeof figuresOf> }) {
  const b = f.models.base;
  const open = b.months[0].cumulative - b.months[0].net;
  let low = open, lowAt = 0;
  b.months.forEach((x, i) => { if (x.cumulative < low) { low = x.cumulative; lowAt = i + 1; } });
  const toInv = b.months.reduce((n, x) => n + x.toInvestor, 0);
  const cons = f.models.conservative;
  const consLow = cons.ok ? Math.min(cons.months[0].cumulative - cons.months[0].net, ...cons.months.map((x) => x.cumulative)) : null;
  const short = b.months.map((x, i) => (x.toInvestor > 0 && x.operating < x.toInvestor ? i + 1 : 0)).filter(Boolean);
  return (
    <>
      <div className="vz-kpis grid gap-2 grid-cols-2 min-[700px]:grid-cols-4">
        <div className="vz-kpi"><span>Cash on opening day</span><b>{dollars(open)}</b><em>after paying to open</em></div>
        <div className="vz-kpi"><span>Lowest point</span><b>{dollars(low)}</b><em>{lowAt ? `month ${lowAt}` : "opening day"}</em></div>
        <div className="vz-kpi"><span>After three years</span><b>{dollars(b.months[b.months.length - 1].cumulative)}</b><em>base case</em></div>
        <div className="vz-kpi"><span>Paid to the investor</span><b>{dollars(toInv)}</b><em>{f.inv?.stillOwed ? `in three years · ${dollars(f.inv.stillOwed)} still owed` : "in three years"}</em></div>
      </div>
      <p className="vz-card-s">{consLow == null ? "There's no downside case in this plan yet." : `In the conservative case, the lowest point is ${dollars(consLow)}.`}{short.length ? ` In month${short.length === 1 ? "" : "s"} ${listMonths(short)}, the investor's share is more than the business earns; cash on hand covers it.` : ""}</p>
      <details className="vp-table">
        <summary>Month by month</summary>
        <div className="vz-cmp-wrap" role="region" aria-label="Cash, month by month" tabIndex={0}>
          <table className="vz-cmp vz-num">
            <thead><tr><th scope="col">Month</th><th scope="col">Sales</th><th scope="col">Operating</th><th scope="col">To investor</th><th scope="col">Net</th><th scope="col">Cash</th></tr></thead>
            <tbody>{b.months.map((x, i) => <tr key={i}><th scope="row">{i + 1}</th><td>{dollars(x.revenue)}</td><td>{dollars(x.operating)}</td><td>{dollars(x.toInvestor)}</td><td>{dollars(x.net)}</td><td>{dollars(x.cumulative)}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </>
  );
}

const listMonths = (ms: number[]) => (ms.length <= 2 ? ms.join(" and ") : `${ms.slice(0, -1).join(", ")} and ${ms.at(-1)}`);
