// R59 — FIVE ASSESSMENTS, EACH EXPLAINED (2026-10-25 — Ryan: "Market Opportunity… Execution Feasibility… Financial
// Attractiveness… Evidence Confidence… Overall Investment Readiness… Why this score? What evidence supports it? What
// assumptions are uncertain? What three actions would most improve the outcome?… not probabilities").
//
//   1 · By hand: each assessment from its written rubric, the weights, the total.
//   2 · The gate: readiness isn't the spreadsheet alone — an unvalidated market or thin evidence is "Needs validation";
//       weak finances or execution, "Not ready".
//   3 · Never invented: the market is judged only from accepted findings a person marked for or against; none → not
//       scored, said, and validating it is the first action.
//   4 · The wiring.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const S = loadTs("lib/visionScore.ts"), M = loadTs("lib/visionMoney.ts");
const NOW = Date.parse("2026-10-25T12:00:00Z"), FRESH = "2026-10-20T00:00:00Z";

const i = M.toInputs({ uses: [{ id: "a", label: "Bar", category: "equipment", qty: 1, unitCents: 2000000, confidence: "quoted" }, { id: "b", label: "Build", category: "buildout", qty: 1, unitCents: 2000000, confidence: "guess" }],
  staffHoursPerDay: 12, hoursOpenPerDay: 10 });
const m = { ok: true, startupSpend: 4000000, paybackMonth: 21, breakEvenMonth: 1, roiBusiness: 1, months: [{ revenue: 100 }], salesLost: 0, capPerMonth: null, traffic: null, requiredFunding: 1, fundingRaised: 1 };
const research = [{ topic: "demand", status: "accepted", bearing: "for", retrieved_at: FRESH }, { topic: "demand", status: "accepted", bearing: "for", retrieved_at: FRESH },
  { topic: "competition", status: "accepted", bearing: "against", retrieved_at: FRESH }, { topic: "costs", status: "proposed", retrieved_at: FRESH }];
const ctx = { needs: { done: 3, all: 6 }, waitingOn: [], conservative: { ok: true, breakEvenMonth: 9 }, now: NOW };

// ── 1 · by hand ─────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const s = S.score(i, m, research, ctx), a = s.assessments;
  ok("market: two findings for, one against → 67 (the channels aren't set — not judged)", a.market.score === 67 && a.market.criteria.find((c) => c.key === "channelsCover").points === null, a.market);
  ok("execution: half the needs (50·30) + nothing waited on (100·25) + staffed every hour (100·20) ÷ 75 → 80; the room not judged", a.execution.score === 80, a.execution.criteria.map((c) => [c.key, c.points]));
  ok("financial: payback month 21 → 50, break-even month 1 → 100, ROI 100% → 50, Conservative holds → 100 → 73", a.financial.score === 73, a.financial.criteria.map((c) => [c.key, c.points]));
  ok("evidence: costs 60, three accepted → 75, all fresh → 100, three of four reviewed → 75 → 74", a.evidence.score === 74, a.evidence.criteria.map((c) => [c.key, c.points]));
  ok("readiness: (67·25 + 80·25 + 73·30 + 74·20) ÷ 100 → 73, and the gate passes: ready to present", s.total === 73 && s.readiness === "ready", [s.total, s.readiness]);
  ok("each assessment says why, the evidence and what's uncertain", Object.values(a).every((x) => x.why.length > 10 && Array.isArray(x.evidence) && Array.isArray(x.uncertain)));
  ok("every criterion writes down its rubric and an action", Object.values(a).every((x) => x.criteria.every((c) => c.rubric.length > 20 && c.action.length > 10)));
  ok("the assessments' weights add to 100, and each one's criteria are weighted", Object.values(S.ASSESS_WEIGHT).reduce((n, w) => n + w, 0) === 100);
  ok("three actions, the biggest gain first, each tied to a criterion", s.actions.length === 3 && s.actions[0].gain >= s.actions[1].gain && s.actions[1].gain >= s.actions[2].gain && s.actions.every((x) => x.text && x.criterion), s.actions);
  ok("it says it isn't a probability, and that the returns are the money's", /not a probability of success/.test(s.says) && /returns are the money's own figures/.test(s.says));
}

// ── 2 · the gate ────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const weak = S.score(i, { ...m, paybackMonth: null, breakEvenMonth: null, roiBusiness: -0.5 }, research, { ...ctx, conservative: { ok: true, breakEvenMonth: null } });
  ok("finances under 40: not ready, whatever else is true", weak.assessments.financial.score === 0 && weak.readiness === "not_ready");
  const thin = S.score(i, m, [], ctx);
  ok("no market research: the market isn't scored, and the plan needs validation", thin.assessments.market.score === null && thin.readiness === "validate", [thin.assessments.market.score, thin.readiness]);
  ok("…and validating the market is among the first actions", thin.actions.some((x) => x.criterion === "demandSupport"));
  ok("no money: not judged yet", S.score(M.BLANK, M.project(M.BLANK)).readiness === "unknown");
}

// ── 3 · never invented ──────────────────────────────────────────────────────────────────────────────────────────────
{
  const unmarked = S.score(i, m, [{ topic: "demand", status: "accepted", bearing: null, retrieved_at: FRESH }], ctx);
  ok("an accepted finding nobody marked for or against doesn't move the market", unmarked.assessments.market.score === null && unmarked.assessments.evidence.criteria.find((c) => c.key === "researchDepth").points === 30);
  const proposed = S.score(i, m, [{ topic: "demand", status: "proposed", bearing: "for", retrieved_at: FRESH }], ctx);
  ok("a proposed finding counts for nothing until accepted", proposed.assessments.market.score === null);
  const old = S.score(i, m, [{ topic: "demand", status: "accepted", bearing: "for", retrieved_at: "2026-06-01T00:00:00Z" }], ctx);
  ok("research older than 90 days lowers its freshness", old.assessments.evidence.criteria.find((c) => c.key === "researchFresh").points === 0);
  const ch = M.toInputs({ ...i, ordersPerDay: 100, avgOrderCents: 900, daysOpenPerMonth: 30, cogsPct: 30, channels: [{ kind: "local", label: "", reach: 1000, convertPct: 5, costCents: 0, startMonth: 1 }], repeatPerMonth: 2, keptPct: 50 });
  const cov = S.score(ch, m, research, ctx).assessments.market.criteria.find((c) => c.key === "channelsCover");
  ok("typed demand checked against the channels set beside it", cov.points !== null && /a day of the 100/.test(cov.says), cov);
}

// ── 4 · the wiring ──────────────────────────────────────────────────────────────────────────────────────────────────
{
  const card = read("components/vision/Research.tsx"), plans = read("components/vision/Plans.tsx"), slide = read("components/vision/CaseSlide.tsx");
  ok("the card: readiness, the four assessments, why/evidence/uncertain, the three actions", /READINESS_WORD\[s\.readiness\]/.test(card) && /Why this score\./.test(card) && /The evidence\./.test(card) && /Uncertain\./.test(card) && /The three things that would raise it most/.test(card));
  ok("the plan's needs and what it waits on reach the assessment", /progress=\{\{ needs: \{ done: needsProgress\(mine\)\.done, all: mine\.length \}, waitingOn: waits\.map/.test(plans));
  ok("the investor's slide shows readiness, not a probability", /Investment readiness/.test(slide) && /not a probability/.test(slide));
}
console.log(`R59 — FIVE ASSESSMENTS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
