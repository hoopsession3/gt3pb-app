"use client";

import { Fragment, useMemo, useState } from "react";
import { INPUT_KEYS, INPUT_WORD, SCENARIOS, SCENARIO_WORD, STRUCTURE_WORD, dollars, toInputs, type Inputs, type Kind, type MetricKey, type Model, type NodeKey, type Scenario, type Trace } from "@/lib/visionMoney";
import { checksOf, figuresOf, monthRows, reserveStatus, swingsOf, type MonthRow, type PlanCase } from "@/lib/visionCase";
import { BLOCKER_STATUS_WORD, BLOCKER_WORD, READINESS_WORD, SCORE_METHOD, STAGE_POLICY, type Score } from "@/lib/visionScore";
import { LEVEL_WORD, keyRisks } from "@/lib/visionRisks";
import { TOPIC_WORD, domainOf } from "@/lib/visionResearch";
import { EXPLORE_FIGURES, LEVERS, LEVER_WORD, PRESENT_LABEL, approvedOf, isEdited, leverRange, whatIf, type CasePart, type Edits, type Lever, type PresentMode } from "@/lib/visionPresent";
import { askHeadline, cashHeadline } from "@/lib/visionHeadline";
import type { Layout } from "@/lib/vision";
import type { Plan } from "@/lib/visionPlans";
import { money } from "@/lib/money";
import { CashChart, SC_SWATCH, Tornado } from "./MoneyCharts";

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
  // IP1.2 (the editorial pass): a headline says what the numbers mean, not what the slide contains. IP1.4: the cash
  // headline names its scenario and its month, worked out from that scenario's own months.
  const sub = !b.ok ? "The numbers aren't finished yet." : part === "cash" ? cashHeadline(b) : part === "risks" ? "What could go wrong, and what we'd do about it." : part === "evidence" ? "What the research says, and where it came from." : mode === "explore" ? "Move the numbers, compare the cases, see what moves the result." : mode === "diligence" ? "Check every number: where it comes from and how it's worked out." : askHeadline(b, c.structure.kind);
  return (
    <>
      <p className="vp-eyebrow">The case · {plan.name}</p>
      <h2 className="vp-title">{sub}</h2>
      {mode === "pitch" && show("ask") && (plan.customer || plan.positioning) && <p className="vp-lede">{[plan.customer, plan.positioning].filter(Boolean).join(" ")}</p>}
      {(show("ask") || show("cash")) && !b.ok && <p className="vp-lede">Still missing from the approved plan: {b.missing.join(", ")}.</p>}
      {/* EXPLORE (IP1.4): the guest's levers, every case side by side, and what moves the result most. */}
      {mode === "explore" && b.ok && <><Explore c={c} room={room} base={t} /><Scenarios f={f} /><Sensitivity c={c} room={room} /></>}
      {mode !== "explore" && b.ok && show("ask") && (
        <div className={part === "ask" ? "vz-kpis vp-kpis-big grid gap-2 grid-cols-2 min-[900px]:grid-cols-3" : "vz-kpis grid gap-2 grid-cols-2 min-[700px]:grid-cols-4"}>
          {k("startupSpend", PRESENT_LABEL.startupSpend!, b.unpriced ? `${t.startupSpend.display}+` : t.startupSpend.display, b.unpriced ? `plus ${b.unpriced} cost${b.unpriced === 1 ? "" : "s"} not yet priced` : undefined)}
          {k("requiredFunding", PRESENT_LABEL.requiredFunding!, t.requiredFunding.display, `opening cost + ${dollars(b.reserveNeeded)} to keep cash above zero`)}
          {k("breakEven", PRESENT_LABEL.breakEven!, t.breakEven.display, after(t.breakEvenAfter.display, c))}
          {k("payback", PRESENT_LABEL.payback!, t.payback.display, after(t.paybackAfter.display, c))}
          {k("roiBusiness", PRESENT_LABEL.roiBusiness!, t.roiBusiness.display, c.structure.kind === "none" ? "before tax" : `before tax and the investor · ${t.roiAfter.display} after`)}
          {k(f.inv ? "investorReturn" : null, PRESENT_LABEL.investorReturn!, f.irrPct == null ? (c.structure.kind === "safe" ? "Converts later" : "—") : `${f.irrPct.toFixed(1)}%`, f.irrPct == null ? investorNote(c, f) : `a year (IRR) · ${investorNote(c, f)}`)}
          {part === "all" && k(null, "Assessed readiness", sc.total == null ? "—" : `${sc.total} / 100`, `${READINESS_WORD[sc.readiness]} · ${sc.coverage}% evidence coverage · ${sc.open ? `${sc.open} blocker${sc.open === 1 ? "" : "s"} to close` : "no blocker to close"}`)}
          {part === "all" && k("revenue", PRESENT_LABEL.revenue!, t.revenue.display)}
        </div>
      )}
      {mode !== "explore" && b.ok && show("ask") && <Raising m={b} />}
      {drill && open && <Drill t={t[open]} all={t} c={c} approved={approved} onOpen={setOpen} onClose={() => setOpen(null)} />}
      {/* PITCH (IP1.4): one picture of cash, the facts beside it, any month on a tap, readiness in a line. */}
      {mode === "pitch" && b.ok && show("cash") && (
        <>
          <Cash f={f} focus="base" />
          <p className="vz-card-s">{readinessLine(sc)}</p>
        </>
      )}
      {/* DILIGENCE (IP1.4): eight sections, each opened on demand — the figures above open to their formulas. */}
      {drill && b.ok && <Diligence plan={plan} c={c} f={f} room={room} approved={approved} />}
      {mode === "pitch" && show("risks") && risks.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="vp-eyebrow">The risks we watch</p>
          {risks.map((r, i) => (
            <p key={i} className="vp-lede">{r.kind === "assumption" ? "We're assuming: " : ""}{sentence(r.words)}{r.likelihood && r.impact ? ` Likelihood ${LEVEL_WORD[r.likelihood].toLowerCase()}, impact ${LEVEL_WORD[r.impact].toLowerCase()}.` : ""}{r.mitigation ? ` What we'd do: ${sentence(r.mitigation)}` : ""}</p>
          ))}
        </div>
      )}
      {mode === "pitch" && show("evidence") && c.research.length > 0 && (
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

/** Cash (IP1.1; IP1.4): the facts beside the chart, any month opened in full on a tap (or with the month buttons), and every
 *  month in a list a phone can read without scrolling sideways. One scenario at a time — the one named. */
function Cash({ f, focus }: { f: ReturnType<typeof figuresOf>; focus: Scenario }) {
  const m = f.models[focus];
  const rows = useMemo(() => monthRows(m), [m]);
  const lowRow = rows.reduce((a, r) => (r.closing < a.closing ? r : a), rows[0]);
  const [at, setAt] = useState<number>(lowRow.m);
  const toInv = m.months.reduce((n, x) => n + x.toInvestor, 0);
  const word = SCENARIO_WORD[focus].toLowerCase();
  const short = m.months.map((x, i) => (x.toInvestor > 0 && x.operating < x.toInvestor ? i + 1 : 0)).filter(Boolean);
  const reserve = reserveStatus(lowRow.closing, m.reservePlanned);
  return (
    <>
      <CashChart models={{ [focus]: m }} focus={focus} onPick={setAt} />
      <div className="vz-kpis grid gap-2 grid-cols-2 min-[700px]:grid-cols-4">
        <div className="vz-kpi"><span>Cash on opening day</span><b>{dollars(rows[0].closing)}</b><em>raised, less the opening cost</em></div>
        <div className="vz-kpi"><span>Lowest point</span><b>{dollars(lowRow.closing)}</b><em>{lowRow.m ? `month ${lowRow.m}` : "opening day"} · {reserve.word}</em></div>
        <div className="vz-kpi"><span>After three years</span><b>{dollars(rows[rows.length - 1].closing)}</b><em>{word} · after investor payments</em></div>
        <div className="vz-kpi"><span>Paid to the investor</span><b>{dollars(toInv)}</b><em>{f.inv?.stillOwed && focus === "base" ? `in three years · ${dollars(f.inv.stillOwed)} still owed` : "in three years"}</em></div>
      </div>
      {focus === "base" && <p className="vz-card-s">{f.models.conservative.ok ? `In the conservative case, the lowest point is ${dollars(Math.min(...monthRows(f.models.conservative).map((r) => r.closing)))}.` : "Downside not modeled: the approved plan has no conservative case yet."}{short.length ? ` In month${short.length === 1 ? "" : "s"} ${listMonths(short)}, the investor's share is more than the business earns${lowRow.closing >= 0 ? "; cash on hand covers it" : ""}.` : ""}</p>}
      <MonthDetail rows={rows} at={at} setAt={setAt} reserve={m.reservePlanned} />
      <details className="vp-table">
        <summary>Month by month</summary>
        <MonthList rows={rows} reserve={m.reservePlanned} />
      </details>
    </>
  );
}

/** One month, in full (IP1.4): what came in, what went out, what the investor was paid, where cash closed — and where that
 *  sits against the reserve. Read from the engine's own monthly schedule (lib/visionCase monthRows). */
function MonthDetail({ rows, at, setAt, reserve }: { rows: MonthRow[]; at: number; setAt: (n: number) => void; reserve: number }) {
  const r = rows[Math.max(0, Math.min(rows.length - 1, at))];
  const st = reserveStatus(r.closing, reserve);
  return (
    <section className="vp-month" aria-label={`${r.m ? `Month ${r.m}` : "Opening day"}, in full`} aria-live="polite">
      <div className="vp-month-h flex items-center justify-between gap-3">
        <button type="button" className="btn-sec" onClick={() => setAt(Math.max(0, r.m - 1))} disabled={r.m === 0} aria-label="The month before">‹</button>
        <b>{r.m ? `Month ${r.m}` : "Opening day"}</b>
        <button type="button" className="btn-sec" onClick={() => setAt(Math.min(rows.length - 1, r.m + 1))} disabled={r.m === rows.length - 1} aria-label="The month after">›</button>
      </div>
      <dl className="vz-dl">
        <dt>Cash at the start</dt><dd>{dollars(r.opening)}</dd>
        <dt>Cash in (sales)</dt><dd>{dollars(r.cashIn)}</dd>
        <dt>Operating costs out</dt><dd>{dollars(r.costs)}</dd>
        <dt>Equipment and build-out</dt><dd>{r.capex ? dollars(r.capex) : "None this month"}</dd>
        <dt>Paid to the investor</dt><dd>{dollars(r.toInvestor)}</dd>
        <dt>Cash at the end</dt><dd><b>{dollars(r.closing)}</b></dd>
        <dt>Against the reserve</dt><dd>{st.word}</dd>
      </dl>
    </section>
  );
}

/** Every month (IP1.4): a table where there's room for it, a list of months on a phone — never a sideways scroll. */
function MonthList({ rows, reserve }: { rows: MonthRow[]; reserve: number }) {
  return (
    <>
      <div className="vp-months-table vz-cmp-wrap" role="region" aria-label="Cash, month by month" tabIndex={0}>
        <table className="vz-cmp vz-num">
          <thead><tr><th scope="col">Month</th><th scope="col">Cash in</th><th scope="col">Costs out</th><th scope="col">Equipment</th><th scope="col">To investor</th><th scope="col">Cash at the end</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.m}><th scope="row">{r.m || "Open"}</th><td>{dollars(r.cashIn)}</td><td>{dollars(r.costs)}</td><td>{dollars(r.capex)}</td><td>{dollars(r.toInvestor)}</td><td>{dollars(r.closing)}</td></tr>)}</tbody>
        </table>
      </div>
      <ol className="vp-months-list" aria-label="Cash, month by month">
        {rows.map((r) => (
          <li key={r.m}>
            <b>{r.m ? `Month ${r.m}` : "Opening day"} · {dollars(r.closing)}</b>
            <span>{r.m ? `in ${dollars(r.cashIn)} · costs ${dollars(r.costs)} · investor ${dollars(r.toInvestor)}` : `raised ${dollars(r.opening)} · opening cost ${dollars(r.capex)}`} · {reserveStatus(r.closing, reserve).word}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

/** Explore (IP1.4): the cases side by side — one card a case, so a phone never scrolls sideways. A case the plan doesn't have
 *  says so; nothing is made up for it. Picking one draws its cash. */
function Scenarios({ f }: { f: ReturnType<typeof figuresOf> }) {
  const have = SCENARIOS.filter((s) => f.models[s].ok);
  const [pick, setPick] = useState<Scenario>("base");
  const rows: [string, (m: Model, s: Scenario) => string][] = [
    ["Sales in year 3", (m) => dollars(m.years[2].revenue)],
    [PRESENT_LABEL.requiredFunding!, (m) => dollars(m.requiredFunding)],
    ["Lowest cash", (m) => { const r = monthRows(m); const lo = r.reduce((a, x) => (x.closing < a.closing ? x : a), r[0]); return `${dollars(lo.closing)}${lo.m ? `, month ${lo.m}` : ""}`; }],
    [PRESENT_LABEL.payback!, (m) => (m.paybackMonth ? `Month ${m.paybackMonth}` : "Not in 3 years")],
    ["Cash after three years", (m) => dollars(m.months[m.months.length - 1].cumulative)],
    ["Assessed readiness score", (_m, s) => (f.scores[s].total == null ? "—" : `${f.scores[s].total} / 100`)],
  ];
  return (
    <section className="flex flex-col gap-2" aria-label="The cases side by side">
      <p className="vp-eyebrow">The cases · {have.length} of 3 modeled</p>
      <div className="vp-scn grid gap-2 grid-cols-1 min-[700px]:grid-cols-3">
        {SCENARIOS.map((s) => f.models[s].ok ? (
          <div key={s} className={pick === s ? "vz-kpi on gap-2" : "vz-kpi gap-2"}>
            <span><i className={SC_SWATCH[s]} /> {SCENARIO_WORD[s]}</span>
            <dl className="vz-dl">{rows.map(([l, v]) => <Fragment key={l}><dt>{l}</dt><dd>{v(f.models[s], s)}</dd></Fragment>)}</dl>
            <button type="button" className="btn-sec btn-sm self-start" aria-pressed={pick === s} onClick={() => setPick(s)}>{pick === s ? "Its cash is below" : "Show its cash"}</button>
          </div>
        ) : (
          <div key={s} className="vz-kpi"><span><i className={SC_SWATCH[s]} /> {SCENARIO_WORD[s]}</span><b>Not modeled</b><em>The approved plan has no {SCENARIO_WORD[s].toLowerCase()} case; nothing is shown for it.</em></div>
        ))}
      </div>
      <p className="vp-eyebrow">{SCENARIO_WORD[pick]} case · cash</p>
      <h3 className="vz-card-s"><b>{cashHeadline(f.models[pick], `${SCENARIO_WORD[pick].toLowerCase()} case`)}</b></h3>
      <Cash key={pick} f={f} focus={pick} />
    </section>
  );
}

/** Explore (IP1.4): what moves the result most — the engine's own swings on the approved base, ±20% on each driver. */
function Sensitivity({ c, room }: { c: PlanCase; room: Layout | null }) {
  const swings = useMemo(() => swingsOf(c, room), [c, room]);
  if (!swings.length) return null;
  return <Tornado swings={swings} pct={20} />;
}

const listMonths = (ms: number[]) => (ms.length <= 2 ? ms.join(" and ") : `${ms.slice(0, -1).join(", ")} and ${ms.at(-1)}`);

/** Pitch (IP1.3; IP1.4): readiness in one line — the stage, the score and its coverage, what's still to close. */
function readinessLine(sc: Score): string {
  if (sc.total == null) return "Investment readiness isn't judged yet.";
  const open = sc.blockers.filter((x) => x.status !== "risk_accepted").map((x) => BLOCKER_WORD[x.key].toLowerCase());
  const accepted = sc.blockers.filter((x) => x.status === "risk_accepted").map((x) => BLOCKER_WORD[x.key].toLowerCase());
  return `${READINESS_WORD[sc.readiness]}. Assessed score ${sc.total} of 100 on what can be judged, with evidence for ${sc.coverage}% of it — a checklist, not a probability. ${open.length ? `Still to close: ${listWords(open)}.` : "Nothing critical left to close."}${accepted.length ? ` Accepted as a risk by the owner: ${listWords(accepted)}.` : ""}`;
}
const listWords = (w: string[]) => (w.length <= 2 ? w.join(" and ") : `${w.slice(0, -1).join(", ")} and ${w.at(-1)}`);

/** Diligence (IP1.4): eight sections, opened one at a time. Every number is the engine's; every claim says where it's from. */
function Diligence({ plan, c, f, room, approved }: { plan: Plan; c: PlanCase; f: ReturnType<typeof figuresOf>; room: Layout | null; approved: string | null }) {
  const b = f.models.base, sc = f.scores.base, i = useMemo(() => toInputs(c.scenarios.base as Partial<Inputs>), [c]);
  const checks = useMemo(() => checksOf(f), [f]);
  const risks = keyRisks(c.risks);
  const left = b.fundingRaised - b.startupSpend - b.reservePlanned;
  const unpricedNames = i.uses.filter((u) => u.category !== "reserve" && u.unitCents == null).map((u) => u.label || "a line");
  const sec = (key: string, title: string, gist: string, body: React.ReactNode) => (
    <details className="vp-sec" key={key}><summary><b>{title}</b><span>{gist}</span></summary><div className="flex flex-col gap-2">{body}</div></details>
  );
  return (
    <section className="flex flex-col gap-2" aria-label="Diligence">
      <p className="vp-eyebrow">Diligence · open a section to check it</p>
      {sec("thesis", "1 · The thesis and the approved plan", approved ? `approved ${approved}` : "not approved yet", <>
        {plan.why && <p className="vp-lede">{plan.why}</p>}
        <dl className="vz-dl">
          {plan.customer && <><dt>Who it&apos;s for</dt><dd>{plan.customer}</dd></>}
          {plan.market && <><dt>The market</dt><dd>{plan.market}</dd></>}
          {plan.positioning && <><dt>How it stands apart</dt><dd>{plan.positioning}</dd></>}
          <dt>Approved</dt><dd>{approved ? `${approved}, by an owner` : "Not yet"}</dd>
        </dl>
      </>)}
      {sec("funds", "2 · Use of funds", `${dollars(b.fundingRaised)} raised · ${dollars(b.requiredFunding)} minimum`, <>
        <dl className="vz-dl">
          <dt>Proposed raise</dt><dd>{dollars(b.fundingRaised)}{c.structure.kind !== "none" ? ` — investor ${dollars(c.structure.amountCents)}, owners ${dollars(Math.max(0, i.ownerCashCents || 0))}` : ""}</dd>
          <dt>Opening costs, priced</dt><dd>{dollars(b.startupSpend)}{b.unpriced ? ` — plus ${b.unpriced} not yet priced (${unpricedNames.join(", ")}): not counted anywhere below` : ""}</dd>
          <dt>Reserve held in cash</dt><dd>{dollars(b.reservePlanned)} — held, not spent</dd>
          <dt>Contingency</dt><dd>No contingency line in the plan</dd>
          <dt>Not yet assigned</dt><dd>{left >= 0 ? `${dollars(left)} — raised but not planned for anything` : `${dollars(-left)} short of the opening cost and the reserve`}</dd>
          <dt>Modeled minimum funding</dt><dd>{dollars(b.requiredFunding)} = opening cost {dollars(b.startupSpend)} + {dollars(b.reserveNeeded)} the early months use. Enough to keep cash above zero — not to keep the reserve.</dd>
          <dt>To end the worst month with the full reserve</dt><dd>{dollars(b.requiredFunding + b.reservePlanned)} = minimum {dollars(b.requiredFunding)} + reserve {dollars(b.reservePlanned)} (arithmetic on the figures above, not a plan input)</dd>
        </dl>
        {(b.unpriced > 0 || left !== 0) && <p className="vz-card-s">Flags: {[b.unpriced ? `${b.unpriced} opening cost${b.unpriced === 1 ? "" : "s"} not yet priced` : null, left > 0 ? `${dollars(left)} not yet assigned to a use` : left < 0 ? "the raise doesn't cover the opening cost and the reserve" : null].filter(Boolean).join("; ")}. Whether the raise is enough is the plan&apos;s to show, not assumed here.</p>}
      </>)}
      {sec("model", "3 · The model, its assumptions and the monthly cash", `${checks.filter((x) => x.agrees).length} of ${checks.length} cross-checks agree`, <>
        <p className="vz-card-s">Every figure above opens to its formula and the plan&apos;s own numbers — tap one. The model is cash-based: sales in, costs out, investor paid; no depreciation, no tax, no owner pay. &ldquo;Covers its costs&rdquo; means a month&apos;s operating cash is positive, not accounting profit.</p>
        <dl className="vz-dl">
          <dt>Orders a day, at full stride</dt><dd>{i.ordersPerDay ?? "—"}</dd>
          <dt>Average order</dt><dd>{i.avgOrderCents != null ? money(i.avgOrderCents) : "—"}</dd>
          <dt>Days open a month</dt><dd>{i.daysOpenPerMonth ?? "—"}</dd>
          <dt>Ramp</dt><dd>{i.rampMonths ? `${i.rampStartPct}% → 100% over ${i.rampMonths} months` : "Full from month 1"}</dd>
          <dt>Sales growth</dt><dd>{i.growthPctPerYear ?? 0}% a year</dd>
          <dt>Cost of goods</dt><dd>{i.cogsPct ?? "—"}% of sales</dd>
          <dt>Card fees</dt><dd>{i.cardFeePct ?? "—"}% of sales</dd>
          <dt>Staff</dt><dd>{i.staffHoursPerDay ?? "—"} hours a day at {i.wageCents != null ? money(i.wageCents) : "—"} an hour, +{i.laborBurdenPct ?? 0}% burden</dd>
          <dt>Rent</dt><dd>{i.rentCents ? `${dollars(i.rentCents)} a month` : ""}{i.rentCents && i.rentPctOfSales ? " + " : ""}{i.rentPctOfSales ? `${i.rentPctOfSales}% of sales` : ""}{!i.rentCents && !i.rentPctOfSales ? "None" : ""}</dd>
          <dt>Other costs · marketing</dt><dd>{i.otherOpexCents != null ? dollars(i.otherOpexCents) : "—"} · {i.marketingCents != null ? dollars(i.marketingCents) : "—"} a month</dd>
        </dl>
        <p className="vz-card-s">Each is an assumption in the approved plan unless the research below supports it.</p>
        <ol className="vz-path" aria-label="Cross-checks">
          {checks.map((x) => <li key={x.label} className="flex-col"><div className="flex justify-between gap-3"><span>{x.label}</span><b>{dollars(x.value)} {x.agrees ? "✓" : "✗"}</b></div><span className="vz-card-s">{x.formula}</span></li>)}
        </ol>
        <Cash f={f} focus="base" />
      </>)}
      {sec("investor", "4 · The investor's economics", f.irrPct == null ? STRUCTURE_WORD[c.structure.kind] : `${f.irrPct.toFixed(1)}% a year (IRR) · modeled`, <Terms c={c} f={f} />)}
      {sec("risks", "5 · Risks and what moves the result", `${risks.length} risk${risks.length === 1 ? "" : "s"} · downside ${f.models.conservative.ok ? "modeled" : "not modeled"}`, <>
        {risks.length ? risks.map((r, n) => <p key={n} className="vz-card-s">{r.kind === "assumption" ? "We're assuming: " : ""}{sentence(r.words)}{r.likelihood && r.impact ? ` Likelihood ${LEVEL_WORD[r.likelihood].toLowerCase()}, impact ${LEVEL_WORD[r.impact].toLowerCase()}.` : ""}{r.mitigation ? ` What we'd do: ${sentence(r.mitigation)}` : ""}</p>) : <p className="vz-card-s">No risks written into the approved plan.</p>}
        {!f.models.conservative.ok && <p className="vz-card-s">Downside not modeled: there&apos;s no conservative case, so no figure here shows what lower sales would do. It&apos;s an open blocker below.</p>}
        <Sensitivity c={c} room={room} />
      </>)}
      {sec("evidence", "6 · Supporting evidence", `${c.research.length} accepted finding${c.research.length === 1 ? "" : "s"} · ${sc.coverage}% coverage`, <>
        {c.research.length ? c.research.map((r, n) => <p key={n} className="vz-card-s">{TOPIC_WORD[r.topic] ?? r.topic} · {r.bearing === "for" ? "for the plan" : r.bearing === "against" ? "against the plan" : "not marked for or against (not counted)"}: {r.claim}{r.figure ? ` (${r.figure})` : ""} — <a href={r.source_url} target="_blank" rel="noopener noreferrer">{r.source_title || domainOf(r.source_url)}</a>{r.retrieved_at ? `, read ${r.retrieved_at.slice(0, 10)}` : ""}</p>) : <p className="vz-card-s">No accepted research yet. Demand, competition, the location and trends are all assumptions in this plan.</p>}
        <p className="vz-card-s">Only findings an owner or admin accepted are shown; proposed and rejected ones aren&apos;t.</p>
      </>)}
      {sec("readiness", "7 · Readiness and what's unresolved", `${READINESS_WORD[sc.readiness]} · ${sc.open} to close`, <Readiness s={sc} />)}
      {sec("approvals", "8 · Approvals and versions", approved ? `approved ${approved}` : "not approved", <>
        <dl className="vz-dl">
          <dt>This case</dt><dd>The baseline an owner approved{approved ? ` on ${approved}` : ""} — not working numbers</dd>
          <dt>Scoring method</dt><dd>{sc.method}</dd>
          <dt>Risks accepted</dt><dd>{sc.blockers.filter((x) => x.acknowledged).length ? sc.blockers.filter((x) => x.acknowledged).map((x) => `${BLOCKER_WORD[x.key]} (${x.acknowledged!.at?.slice(0, 10) ?? "date not recorded"}, review by ${x.acknowledged!.reviewBy})`).join("; ") : "None"}</dd>
          <dt>Earlier approvals</dt><dd>Kept from the next database update on (0458); before it, an approval replaced the one before</dd>
        </dl>
      </>)}
    </section>
  );
}

/** Diligence (IP1.3; IP1.4): readiness taken apart — the stage and the policy that set it, the score and its coverage, every
 *  blocker with where it stands, what closes it and who checks it. Missing evidence is shown as missing, not as a weak
 *  business; an accepted risk is shown as accepted, never as resolved. */
function Readiness({ s }: { s: Score }) {
  return (
    <div className="flex flex-col gap-2">
      <dl className="vz-dl">
        <dt>Stage</dt><dd>{READINESS_WORD[s.readiness]}</dd>
        <dt>Assessed score</dt><dd>{s.total == null ? "—" : `${s.total} / 100`} — on the criteria that can be judged</dd>
        <dt>Evidence coverage</dt><dd>{s.coverage}% of the score&apos;s weight</dd>
        <dt>Critical blockers</dt><dd>{s.open} to close{s.blockers.length - s.open ? `, ${s.blockers.length - s.open} accepted as a risk` : ""}</dd>
      </dl>
      <p className="vz-card-s">A score worked out from what can be assessed isn&apos;t readiness. The stage comes from policy: {s.readiness !== "unknown" ? STAGE_POLICY[s.readiness] : "the money isn't set yet."}</p>
      {s.blockers.length > 0 && (
        <ol className="vz-path" aria-label="Critical blockers">
          {s.blockers.map((x) => (
            <li key={x.key} className="flex-col">
              <div className="flex justify-between gap-3"><span><b className="font-sans">{BLOCKER_WORD[x.key]}</b></span><span className={x.status === "risk_accepted" ? "k-tag" : x.status === "open" || x.status === "acceptance_lapsed" ? "k-tag warn" : "k-tag gold"}>{BLOCKER_STATUS_WORD[x.status]}</span></div>
              <span className="vz-card-s">{x.says} {x.effect}</span>
              <span className="vz-card-s">Closed when: {x.remedy.acceptance}. Checked by: {x.remedy.verifier.toLowerCase()}.</span>
              {x.acknowledged && <span className="vz-card-s">Accepted as a risk by the owner, review by {x.acknowledged.reviewBy}: {x.acknowledged.note}</span>}
            </li>
          ))}
        </ol>
      )}
      <p className="vz-card-s">Scoring method {s.method}. {SCORE_METHOD.summary}</p>
    </div>
  );
}

/** Diligence (IP1.3; IP1.4): the investor's terms, one fact a row — the contract, what's paid and when, what's still owed,
 *  and what the modeled return is (an IRR) and isn't (a promise, or ownership). All from the engine. */
function Terms({ c, f }: { c: PlanCase; f: ReturnType<typeof figuresOf> }) {
  const s = c.structure, inv = f.inv, b = f.models.base;
  if (!inv || s.kind === "none") return <p className="vz-card-s">No investment structure is set in the approved plan.</p>;
  const rate = f.irrPct == null ? null : `${f.irrPct.toFixed(1)}% a year`;
  const monthly = f.irrPct == null ? null : ((Math.pow(1 + f.irrPct / 100, 1 / 12) - 1) * 100).toFixed(2);
  const capAt = inv.says.map((w) => /cap is met in month (\d+)/.exec(w)?.[1]).find(Boolean);
  const lastSales = b.months[b.months.length - 1]?.revenue ?? 0;
  const pays = b.months.map((x) => x.toInvestor);
  const byYear = [0, 1, 2].map((y) => pays.slice(y * 12, y * 12 + 12).reduce((n, x) => n + x, 0));
  const rows: [string, string][] = s.kind === "rev_share" ? [
    ["The investor puts in", dollars(s.amountCents)],
    ["The contract", `${s.sharePct}% of each month's sales until ${dollars(s.amountCents * s.capMultiple)} (${s.capMultiple}× the investment) is repaid. A revenue share — no ownership of the business.`],
    ["Monthly payments", `${dollars(Math.min(...pays))} to ${dollars(Math.max(...pays))} — ${s.sharePct}% of that month's sales`],
    ["Paid by year", byYear.map((v, y) => `year ${y + 1} ${dollars(v)}`).join(" · ")],
    ["Paid in the plan's three years", `${dollars(inv.returned)} (${(inv.returned / s.amountCents).toFixed(2)}× so far)`],
    ["Still owed after month 36", dollars(inv.stillOwed ?? 0)],
    ["Sales assumed after month 36", `${dollars(lastSales)} a month — month 36's, held flat; the plan's growth isn't extended`],
    ["Cap projected to be met", capAt ? `Month ${capAt}, at about ${dollars((lastSales * s.sharePct) / 100)} a month` : "Within the plan's three years"],
  ] : [["The investor puts in", dollars(s.amountCents)], ["The contract", inv.says[0]], ...(inv.ownershipPct != null ? [["Ownership", `${inv.ownershipPct.toFixed(1)}%`] as [string, string]] : []), ["Paid in the plan's three years", dollars(inv.returned)]];
  return (
    <div className="flex flex-col gap-2">
      <dl className="vz-dl vz-dl-stack">{rows.map(([l, v]) => <Fragment key={l}><dt>{l}</dt><dd>{v}</dd></Fragment>)}</dl>
      {rate && <p className="vz-card-s">The modeled return, {rate}, is an internal rate of return (IRR): the yearly rate at which every payment back{capAt ? ` through month ${capAt}` : ""}, discounted to opening day, adds up to the {dollars(s.amountCents)} put in. It works out to {monthly}% a month, compounded to a year — an effective annual rate. It&apos;s a projection from the plan&apos;s sales, not a promised rate: the contract promises only the {s.kind === "rev_share" ? "share and the cap" : "terms above"}.</p>}
    </div>
  );
}
