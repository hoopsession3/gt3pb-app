// IP1.3 — READINESS INTEGRITY, THE INVESTOR'S TERMS, THE PHONE CHART (2026-10-27 — Ryan: "a clear distinction between
// Investment Readiness Score, Evidence Coverage, Critical Readiness Blockers… without conflating missing evidence with
// demonstrated business weakness. Do not arbitrarily change scoring weights… independent test cases for complete,
// incomplete, conflicting and unsupported evidence… Verify the investor return calculation").
//
//   1 · Readiness: four independent plans — complete, incomplete, conflicting, unsupported — and the gate.
//   2 · Weights unchanged; the score is over what's judged; coverage is the weight that is.
//   3 · Acknowledgements: owners only (they live in the baseline 0449 guards), a written reason, carried to the case.
//   4 · The investor's terms, recomputed by hand: 6%, the $60,000 cap, $43,058 paid, $16,942 owed, month 49, 21.7%.
//   5 · The phone chart and the Pitch/Diligence split.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 600)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const M = loadTs("lib/visionMoney.ts"), S = loadTs("lib/visionScore.ts"), C = loadTs("lib/visionCase.ts");

const NOW = Date.parse("2026-10-27T12:00:00Z"), FRESH = "2026-10-20T00:00:00Z";
const plan = (over = {}) => M.toInputs({ uses: [
  { id: "a", label: "Bar", category: "equipment", qty: 1, unitCents: 2000000, confidence: "quoted" },
  { id: "b", label: "Build", category: "buildout", qty: 1, unitCents: 1000000, confidence: "quoted" },
  { id: "r", label: "Reserve", category: "reserve", qty: 1, unitCents: 1000000 }],
  ordersPerDay: 120, avgOrderCents: 900, daysOpenPerMonth: 26, hoursOpenPerDay: 10, rampMonths: 3, rampStartPct: 70, growthPctPerYear: 3,
  cogsPct: 28, cardFeePct: 3, staffHoursPerDay: 12, wageCents: 1600, laborBurdenPct: 12, rentCents: 300000, rentPctOfSales: 0, otherOpexCents: 50000, marketingCents: 30000, ...over });
const run = (i) => M.project(i, { kind: "none" });
const cons = (i) => run({ ...i, ordersPerDay: Math.round(i.ordersPerDay * 0.8) });
const found = (topic, bearing) => ({ topic, status: "accepted", bearing, retrieved_at: FRESH });
const STRONG = [found("demand", "for"), found("demand", "for"), found("competition", "for"), found("location", "for"), found("trends", "for")];
const ctxOf = (i, extra = {}) => ({ needs: { done: 4, all: 4 }, waitingOn: [], conservative: cons(i), now: NOW, ...extra });

// ── 1 · four plans ────────────────────────────────────────────────────────────────────────────────────────────────
const iC = plan(), mC = run(iC);
const complete = S.score(iC, mC, STRONG, ctxOf(iC));
{
  ok("complete: the money works and the Conservative case runs", mC.ok && cons(iC).ok);
  ok("complete: no critical blocker, ready to present", complete.blockers.length === 0 && complete.readiness === "ready", [complete.readiness, complete.blockers.map((b) => b.key), complete.total]);
  ok("complete: coverage counts only the judged weight (the room and the channels aren't set here)", complete.coverage < 100 && complete.coverage > 80, complete.coverage);
}
const iI = plan({ uses: [...plan().uses, { id: "s", label: "Signage", category: "launch", qty: 1, unitCents: null }] }), mI = run(iI);
const incomplete = S.score(iI, mI, [], ctxOf(iI, { conservative: null }));
{
  const keys = incomplete.blockers.map((b) => b.key);
  ok("incomplete: no research, no downside, a cost unpriced — three blockers, each named", ["demand_unvalidated", "no_downside", "costs_unpriced"].every((k) => keys.includes(k)), keys);
  ok("incomplete: held at needs validation", incomplete.readiness === "validate");
  ok("incomplete: missing evidence lowers coverage, not the score — the market and the downside are left out, not zeroed",
    incomplete.coverage < complete.coverage && incomplete.assessments.market.criteria.find((c) => c.key === "demandSupport").points === null && incomplete.assessments.financial.criteria.find((c) => c.key === "conservativeHolds").points === null, [incomplete.coverage, complete.coverage]);
  const same = S.score(iC, mC, [], ctxOf(iC, { conservative: null }));
  ok("…the same business with and without research: the market isn't counted as a zero against it", same.total >= complete.total - 25 && same.total > 0, [same.total, complete.total]);
  ok("each blocker says what it does to the result", incomplete.blockers.every((b) => b.says.length > 20 && b.effect.length > 20));
  ok("a missing input is a blocker too, and nothing is scored", S.score(plan({ avgOrderCents: null }), run(plan({ avgOrderCents: null })), [], ctxOf(iC)).total === null);
}
const conflicting = S.score(iC, mC, [found("demand", "for"), found("demand", "for"), found("competition", "against"), found("location", "against")], ctxOf(iC));
{
  const b = conflicting.blockers.find((x) => x.key === "evidence_against");
  ok("conflicting: findings against are a blocker of their own, with the count", b && /2 accepted findings weigh against the plan, 2 for it/.test(b.says), b);
  ok("conflicting: the market scores the share for (50), and the plan waits", conflicting.assessments.market.criteria[0].points === 50 && conflicting.readiness !== "ready");
}
const unsupported = S.score(iC, mC, [found("demand", null), found("competition", "neutral"), found("costs", "for")], ctxOf(iC));
{
  const b = unsupported.blockers.find((x) => x.key === "demand_unvalidated");
  ok("unsupported: accepted findings that don't say for or against don't validate demand", b && /none marked for or against/.test(b.says) && /2 on the market left unmarked/.test(b.says), b?.says);
  ok("unsupported: the market isn't scored from them", unsupported.assessments.market.criteria[0].points === null);
}
{
  const weak = S.score(plan({ avgOrderCents: 300 }), run(plan({ avgOrderCents: 300 })), STRONG, ctxOf(plan({ avgOrderCents: 300 })));
  ok("demonstrated weakness is still weakness: a plan that loses money is not ready, whatever its evidence", weak.readiness === "not_ready", [weak.readiness, weak.assessments.financial.score]);
}

// ── 2 · weights and the arithmetic ───────────────────────────────────────────────────────────────────────────────
{
  ok("assessment weights unchanged: 25 · 25 · 30 · 20", JSON.stringify(S.ASSESS_WEIGHT) === JSON.stringify({ market: 25, execution: 25, financial: 30, evidence: 20 }));
  const src = read("lib/visionScore.ts");
  ok("criterion weights unchanged (70/30 · 30/25/25/20 · 35/25/20/20 · 35/35/15/15)", [70, 30].every((w) => new RegExp(`weight: ${w}, about`).test(src)) && (src.match(/weight: \d+, about/g) ?? []).map((x) => +x.match(/\d+/)[0]).join() === "70,30,30,25,25,20,35,25,20,20,35,35,15,15");
  // By hand: each judged criterion at (its weight ÷ its assessment's criteria weight) × the assessment's weight.
  const s = incomplete, A = s.assessments;
  let num = 0, den = 0;
  for (const k of Object.keys(A)) { const cw = A[k].criteria.reduce((n, c) => n + c.weight, 0); for (const c of A[k].criteria) if (c.points != null) { const w = (c.weight / cw) * S.ASSESS_WEIGHT[k]; num += c.points * w; den += w; } }
  ok("the score by hand: Σ points × weight ÷ Σ judged weight", s.total === Math.round(num / den), [s.total, num / den]);
  ok("coverage by hand: judged weight ÷ 100", s.coverage === Math.round(den), [s.coverage, den]);
}

// ── 3 · acknowledgements ─────────────────────────────────────────────────────────────────────────────────────────
{
  const acked = S.score(iC, mC, [], ctxOf(iC, { acknowledged: [{ key: "demand_unvalidated", note: "Pre-sales at the gym start in November; we present with that said." }] }));
  ok("an acknowledgement with a reason closes that blocker", acked.open === 0 && acked.blockers[0].acknowledged?.note.startsWith("Pre-sales"));
  ok("…an empty reason doesn't", S.score(iC, mC, [], ctxOf(iC, { acknowledged: [{ key: "demand_unvalidated", note: "  " }] })).open === 1);
  ok("…and acknowledging never changes the score or the coverage", acked.total === S.score(iC, mC, [], ctxOf(iC)).total && acked.coverage === S.score(iC, mC, [], ctxOf(iC)).coverage);
  const D = loadTs("lib/visionCaseData.ts");
  const c = D.toCase({ baseline: { scenarios: {}, structure: { kind: "none" }, acknowledged: [{ key: "no_downside", note: "Run next week", at: "2026-10-27" }, { key: 4 }, "x", { key: "evidence_against", note: "" }] } });
  ok("the case reads acknowledgements from the baseline, and only well-formed ones with a reason", c.acknowledged.length === 1 && c.acknowledged[0].key === "no_downside", c.acknowledged);
  const panel = read("components/vision/MoneyPanel.tsx"), mig = read("supabase/migrations/0449_the_money_plan_by_plan.sql");
  ok("they're written into the approved baseline, which only an owner can change (0449's guard)", /baseline: \{ \.\.\.baseline\.snap, acknowledged: next \}/.test(panel) && /Only an owner can approve a baseline\./.test(mig));
  ok("the button is offered to owners on Base, against the approved numbers only", /onAcknowledge=\{on === "base" && isOwner && baseline && !offBaseline \? acknowledge : undefined\}/.test(panel));
  ok("a new baseline clears them, and says so", /setAcks\(\[\]\)/.test(panel) && /acknowledge again for the new numbers/.test(panel));
  ok("the score card shows score, coverage and blockers apart, with each owner's reason", /Evidence coverage/.test(read("components/vision/Research.tsx")) && /Critical blockers/.test(read("components/vision/Research.tsx")) && /Owner&apos;s reason/.test(read("components/vision/Research.tsx")));
}

// ── 4 · the investor's terms, by hand ────────────────────────────────────────────────────────────────────────────
{
  const base = { uses: [
    { id: "f1", label: "Bar and cooler", category: "equipment", qty: 1, unitCents: 1800000 }, { id: "f2", label: "Tap tower", category: "equipment", qty: 2, unitCents: 150000 },
    { id: "f3", label: "Build-out", category: "buildout", qty: 1, unitCents: 900000 }, { id: "f4", label: "Signage", category: "launch", qty: 1, unitCents: null },
    { id: "f5", label: "Working-capital reserve", category: "reserve", qty: 1, unitCents: 1000000 }],
    ownerCashCents: 500000, ordersPerDay: 90, avgOrderCents: 850, daysOpenPerMonth: 26, hoursOpenPerDay: 10, rampMonths: 6, rampStartPct: 50, growthPctPerYear: 5,
    cogsPct: 30, cardFeePct: 3, staffHoursPerDay: 12, wageCents: 1600, laborBurdenPct: 12, rentCents: 0, rentPctOfSales: 10, otherOpexCents: 60000, marketingCents: 40000 };
  const st = { kind: "rev_share", amountCents: 4000000, sharePct: 6, capMultiple: 1.5 };
  const m = M.project(M.toInputs(base), st), inv = M.investor(m, st);
  const cap = st.amountCents * st.capMultiple;
  ok("the cap: 1.5 × $40,000 = $60,000", cap === 6000000);
  let paid = 0; const flows = m.months.map((x) => { const p = Math.min(cap - paid, x.revenue * 0.06); paid += p; return p; });
  ok("paid by month 36: 6% of each month's sales = $43,058", Math.round(paid / 100) === 43058 && Math.round(inv.returned / 100) === 43058, [paid, inv.returned]);
  ok("still owed: $60,000 − $43,058 = $16,942", Math.round((cap - paid) / 100) === 16942 && Math.round(inv.stillOwed / 100) === 16942);
  const pay = m.months[35].revenue * 0.06; let left = cap - paid, mo = 36; const tail = [];
  while (left > 0.005) { mo++; const p = Math.min(left, pay); tail.push(p); left -= p; }
  ok("payoff: month-36 sales held flat, about $1,316 a month to the investor → the cap is met in month 49", mo === 49 && Math.round(pay / 100) === 1316 && inv.says.some((w) => /cap is met in month 49/.test(w)), [mo, pay]);
  const cf = [-st.amountCents, ...flows, ...tail], npv = (r) => cf.reduce((n, c, t) => n + c / Math.pow(1 + r, t), 0);
  let lo = 0, hi = 0.2; for (let k = 0; k < 200; k++) { const mid = (lo + hi) / 2; if (npv(mid) > 0) lo = mid; else hi = mid; }
  ok("21.7%: a monthly IRR of 1.65% on −$40,000 then each payment to month 49, compounded to a year", ((Math.pow(1 + lo, 12) - 1) * 100).toFixed(1) === "21.7" && inv.irrPct.toFixed(1) === "21.7" && (lo * 100).toFixed(2) === "1.65", [lo, inv.irrPct]);
  ok("…an effective annual rate, not 12 × monthly (which would read 19.8%)", (lo * 1200).toFixed(1) === "19.8");
  ok("a revenue share carries no ownership", inv.ownershipPct === null);
  // The phone check's plan through the case (one scenario, no research): what the investor's slide now says.
  const src = read("scripts/fixtures/consoleWorld.mjs"), at = src.indexOf("const money = ");
  const world = new Function(`return (${src.slice(at + 14, src.indexOf(";\n", at))});`)();
  const fc = C.figuresOf(C.toCase({ baseline: { scenarios: world, structure: st }, approved_at: "2026-10-27T00:00:00Z" })).scores.base;
  ok("the test plan's readiness: 62 on what's judged (60 before), 51% evidence coverage (shown as 100% before), 3 blockers open",
    fc.total === 62 && fc.coverage === 51 && fc.open === 3 && fc.readiness === "validate" && fc.blockers.map((x) => x.key).join() === "demand_unvalidated,no_downside,costs_unpriced", [fc.total, fc.coverage, fc.blockers.map((x) => x.key)]);
  const slide = read("components/vision/CaseSlide.tsx");
  ok("Diligence says the terms apart: the contract, paid, owed, the projected month, the modelled rate", /function Terms\(/.test(slide) && /A revenue share — no ownership of the business\./.test(slide) && /Still owed after month 36/.test(slide) && /internal rate of return/.test(slide) && /not a promised rate/.test(slide));
  ok("…and says the payoff month doesn't extend the plan's growth", /The plan&apos;s growth isn&apos;t extended past month 36\.|The plan's growth isn't extended past month 36\./.test(slide));
}

const base0 = { uses: [{ id: "f1", label: "Bar and cooler", category: "equipment", qty: 1, unitCents: 1800000 }, { id: "f2", label: "Tap tower", category: "equipment", qty: 2, unitCents: 150000 }, { id: "f3", label: "Build-out", category: "buildout", qty: 1, unitCents: 900000 }, { id: "f4", label: "Signage", category: "launch", qty: 1, unitCents: null }, { id: "f5", label: "Working-capital reserve", category: "reserve", qty: 1, unitCents: 1000000 }],
  ownerCashCents: 500000, ordersPerDay: 90, avgOrderCents: 850, daysOpenPerMonth: 26, hoursOpenPerDay: 10, rampMonths: 6, rampStartPct: 50, growthPctPerYear: 5, cogsPct: 30, cardFeePct: 3, staffHoursPerDay: 12, wageCents: 1600, laborBurdenPct: 12, rentCents: 0, rentPctOfSales: 10, otherOpexCents: 60000, marketingCents: 40000 };
const st0 = { kind: "rev_share", amountCents: 4000000, sharePct: 6, capMultiple: 1.5 };

// ── 5 · the phone chart; Pitch and Diligence ─────────────────────────────────────────────────────────────────────
{
  const chart = read("components/vision/MoneyCharts.tsx"), css = read("components/vision/vision.css"), slide = read("components/vision/CaseSlide.tsx");
  ok("the chart is drawn at its box's width, so its labels stay 12px on a phone", /new ResizeObserver/.test(chart) && /const W = w,/.test(chart));
  ok("the low label goes where no line crosses it (under, above, then higher with a leader), with a halo as the last guard", /export function lowSpot\(/.test(chart) && /textAnchor=\{spot\.anchor\}/.test(chart) && /\.vz-chart \.low text\{paint-order:stroke/.test(css));
  // The label's spot, run on the phone check's own curve at a phone's, a laptop's and a projector's chart widths.
  const { createRequire } = await import("node:module");
  const ts = createRequire(import.meta.url)("typescript");
  const fn = chart.slice(chart.indexOf("export function lowSpot("), chart.indexOf("export function Tornado("));
  const lowSpot = new Function(`${ts.transpileModule(fn.replace("export ", ""), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText}; return lowSpot;`)();
  const curve = [1500000, ...M.project(M.toInputs(base0), st0).months.map((x) => x.cumulative)];
  for (const w of [338, 370, 640]) {
    const narrow = w < 480, H = narrow ? 240 : 260, L = narrow ? 52 : 80, R = narrow ? 84 : 92, T = 16, B = 34;
    const lo = Math.min(0, ...curve), hi = Math.max(0, ...curve), pad = (hi - lo) * 0.06, y0 = lo - pad, y1 = hi + pad;
    const x = (m) => L + ((w - L - R) * m) / 36, y = (v) => T + ((H - T - B) * (y1 - v)) / (y1 - y0);
    const v = Math.min(...curve), m = curve.indexOf(v), rows = narrow ? ["Lowest $12,807", `month ${m}`] : [`Lowest $12,807, month ${m}`], tw = Math.max(...rows.map((r) => r.length)) * 7, th = rows.length * 14;
    const sp = lowSpot(x(m), y(v), tw, th, [curve.map((p, k) => [x(k), y(p)])], y(0), { L, R: w - R, T, B: H - B });
    const x0 = sp.anchor === "end" ? sp.x - tw : sp.x, x1 = x0 + tw, top = sp.y - 11, bot = sp.y - 11 + th;
    const crossed = curve.some((p, k) => { if (!k) return false; for (let t = 0; t <= 1; t += 0.05) { const sx = x(k - 1) + (x(k) - x(k - 1)) * t, sy = y(curve[k - 1]) + (y(p) - y(curve[k - 1])) * t; if (sx >= x0 && sx <= x1 && sy >= top && sy <= bot) return true; } return false; });
    ok(`at ${w}px the low label clears the line, the zero line and the plot's edges`, !crossed && !(y(0) >= top && y(0) <= bot) && top >= T && bot <= H - B, { sp, top, bot, zero: y(0) });
  }
  ok("tap to read a month still works", /onPointerDown=\{\(e\) => pick\(e\.clientX, e\.currentTarget\)\}/.test(chart));
  ok("Pitch says readiness in one line; the method and every blocker are in Diligence", /\{part === "cash" && <p className="vz-card-s">\{readinessLine\(sc\)\}<\/p>\}/.test(slide) && /\{drill && b\.ok && <><Readiness s=\{sc\} \/><Terms c=\{c\} f=\{f\} \/><\/>\}/.test(slide));
  ok("Pitch drops the scenario table when there's only one scenario to show", /part === "all" \|\| SCENARIOS\.filter\(\(s\) => f\.models\[s\]\.ok\)\.length > 1/.test(slide));
  ok("the material caveats stay in Pitch: what's open is named", /Still open: /.test(slide) && /a checklist, not a probability/.test(slide));
}

console.log(`IP1.3 — READINESS, TERMS, THE PHONE CHART: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
