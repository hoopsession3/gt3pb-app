"use client";

import { useMemo } from "react";
import { SCENARIOS, SCENARIO_WORD, STRUCTURE_WORD, dollars } from "@/lib/visionMoney";
import { figuresOf, type PlanCase } from "@/lib/visionCase";
import { READINESS_WORD } from "@/lib/visionScore";
import { LEVEL_WORD, keyRisks } from "@/lib/visionRisks";
import { TOPIC_WORD, domainOf } from "@/lib/visionResearch";
import type { Layout } from "@/lib/vision";
import type { Plan } from "@/lib/visionPlans";
import { CashChart, SC_SWATCH } from "./MoneyCharts";

// A PLAN'S CASE, PRESENTED (R57, phase E). What it takes and what it returns — from the owner-approved baseline, through
// the one engine: startup spending, funding required, break-even, payback, the business's ROI before financing, the
// investor's rate under the structure as defined, the three scenarios side by side, cash on hand month by month, the
// score with what it is and isn't; then what the market says, every finding with its source. Labelled as projections.
export default function CaseSlide({ plan, c, room }: { plan: Plan; c: PlanCase; room: Layout | null }) {
  const f = useMemo(() => figuresOf(c, room), [c, room]);
  const b = f.models.base, t = f.base, sc = f.scores.base;
  const approved = c.approvedAt ? new Date(c.approvedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
  const k = (label: string, value: string, note?: string) => <div className="vz-kpi"><span>{label}</span><b>{value}</b>{note && <em>{note}</em>}</div>;
  return (
    <>
      <p className="vp-eyebrow">The case · {plan.name}</p>
      <h2 className="vp-title">What it takes, and what it returns.</h2>
      {(plan.customer || plan.positioning) && <p className="vp-lede">{[plan.customer, plan.positioning].filter(Boolean).join(" ")}</p>}
      {!b.ok ? <p className="vp-lede">The approved numbers aren&apos;t complete yet — {b.missing.join(", ")}.</p> : (
        <>
          <div className="vz-kpis grid gap-2 grid-cols-2 min-[700px]:grid-cols-4">
            {k("Startup spending", t.startupSpend.display, b.reservePlanned ? `+ ${dollars(b.reservePlanned)} held in reserve` : undefined)}
            {k("Funding required", t.requiredFunding.display, "startup + the early months, investor paid")}
            {k("Breaks even", t.breakEven.display)}
            {k("Pays back its startup", t.payback.display)}
            {k("Business ROI, 36 months", t.roiBusiness.display, "before financing and tax")}
            {k("The investor's rate", f.irrPct == null ? (c.structure.kind === "safe" ? "Converts later" : "—") : `${f.irrPct.toFixed(1)}% a year`, STRUCTURE_WORD[c.structure.kind])}
            {k("Investment readiness", sc.total == null ? "—" : `${sc.total} / 100`, `${READINESS_WORD[sc.readiness]} · not a probability`)}
            {k("Sales, 36 months", t.revenue.display)}
          </div>
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
        </>
      )}
      {keyRisks(c.risks).length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="vp-eyebrow">The risks we watch</p>
          {keyRisks(c.risks).map((r, i) => (
            <p key={i} className="vp-lede">{r.kind === "assumption" ? "Assuming" : "Risk"}: {r.words}{r.likelihood && r.impact ? ` (${LEVEL_WORD[r.likelihood].toLowerCase()} likelihood, ${LEVEL_WORD[r.impact].toLowerCase()} impact)` : ""}{r.mitigation ? ` — ${r.mitigation}` : ""}</p>
          ))}
        </div>
      )}
      {c.research.length > 0 && (
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
