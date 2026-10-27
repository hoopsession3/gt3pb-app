// IP1 — THE PRESENTER'S THREE WAYS (2026-10-27 — Ryan: "Yes, build IP1": Pitch tightening, an Explore sandbox — what-ifs
// in the viewer's browser only, never saved — and Diligence drill-down to each figure's formula and sources, inside the
// existing presenter, no migration).
//
//   1 · Pitch: a case is told in parts, one message a slide; risks and evidence only when there are some.
//   2 · Explore: the what-if is the approved case with four levers over its base, through the one engine — untouched it
//       equals the approved case to the cent; moved, it never changes the approved case; it's never stored or sent.
//   3 · Diligence: every figure a guest can open has its formula, worked numbers and what it's made of.
//   4 · The wiring and the words: modes only with a case; the slide keeps its place; no haptics on slides; no claims the
//       Standard can't back ("nothing toxic"); the projector's type grows.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 600)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const P = loadTs("lib/visionPresent.ts"), C = loadTs("lib/visionCase.ts"), M = loadTs("lib/visionMoney.ts");

const base = { uses: [{ id: "bar", label: "Bar", category: "equipment", qty: 1, unitCents: 3000000, confidence: "quoted" }, { id: "r", label: "Reserve", category: "reserve", qty: 1, unitCents: 1000000 }],
  ordersPerDay: 90, avgOrderCents: 850, daysOpenPerMonth: 26, hoursOpenPerDay: 10, rampMonths: 6, rampStartPct: 50, cogsPct: 30, cardFeePct: 3,
  staffHoursPerDay: 12, wageCents: 1600, laborBurdenPct: 12, rentCents: 450000, rentPctOfSales: 0, otherOpexCents: 60000, marketingCents: 40000, ownerCashCents: 500000 };
const structure = { kind: "rev_share", amountCents: 4000000, sharePct: 6, capMultiple: 1.5 };
const stored = { baseline: { scenarios: { conservative: M.derive(M.toInputs(base), -20, 10), base, upside: M.derive(M.toInputs(base), 20, -10) }, structure }, approved_at: "2026-10-25T12:00:00Z" };
const research = [{ topic: "demand", claim: "The gym has 2,400 members.", figure: "2,400", source_url: "https://gym.example/members", retrieved_at: "2026-10-20T00:00:00Z" }];
const c = C.toCase(stored, research);

// ── 1 · Pitch ─────────────────────────────────────────────────────────────────────────────────────────────────────
{
  ok("a case with risks and research: four parts, in order", JSON.stringify(P.caseParts(c, 2)) === JSON.stringify(["ask", "cash", "risks", "evidence"]));
  ok("no risks, no research: the ask and the cash only", JSON.stringify(P.caseParts({ research: [] }, 0)) === JSON.stringify(["ask", "cash"]));
  ok("every part has words", P.caseParts(c, 1).every((p) => P.PART_WORD[p]?.length > 5));
}

// ── 2 · Explore ───────────────────────────────────────────────────────────────────────────────────────────────────
{
  const before = JSON.stringify(c);
  const same = P.whatIf(c, {});
  ok("untouched, the what-if is the approved case itself", same === c);
  const f0 = C.figuresOf(c), f1 = C.figuresOf(P.whatIf(c, { ordersPerDay: 90 }));
  ok("…and a lever left at its approved value gives the approved figures, to the cent", f1.models.base.requiredFunding === f0.models.base.requiredFunding && JSON.stringify(f1.models.base.years) === JSON.stringify(f0.models.base.years));
  const more = C.figuresOf(P.whatIf(c, { ordersPerDay: 130 }));
  ok("more orders a day: more sales, through the one engine", more.models.base.years[2].revenue > f0.models.base.years[2].revenue);
  ok("…equal to running project() on the same numbers directly", more.models.base.requiredFunding === M.project(M.toInputs({ ...base, ordersPerDay: 130 }), structure).requiredFunding);
  const rent = C.figuresOf(P.whatIf(c, { rentCents: 900000 }));
  ok("double the rent: more funding required", rent.models.base.requiredFunding > f0.models.base.requiredFunding);
  ok("the approved case is never changed by a what-if", JSON.stringify(c) === before);
  ok("only the base moves — the other scenarios stay approved", JSON.stringify(P.whatIf(c, { cogsPct: 40 }).scenarios.conservative) === JSON.stringify(c.scenarios.conservative));
  ok("only the four levers: anything else is ignored", P.whatIf(c, { uses: [], ownerCashCents: 0 }) === c && P.whatIf(c, { ordersPerDay: NaN }) === c);
  ok("ranges: half to one and a half times the approved value", JSON.stringify(P.leverRange("ordersPerDay", 90)) === JSON.stringify({ min: 45, max: 135, step: 1 }) && P.leverRange("cogsPct", 30).min === 15 && P.leverRange("cogsPct", 30).max === 45);
  ok("…money snaps to sensible steps", P.leverRange("avgOrderCents", 850).step === 25 && P.leverRange("rentCents", 450000).min === 225000);
  ok("no approved value: no lever (never an invented one)", P.leverRange("rentCents", null) === null && P.leverRange("ordersPerDay", undefined) === null);
  const slide = read("components/vision/CaseSlide.tsx");
  const ex = slide.slice(slide.indexOf("function Explore("), slide.indexOf("function Drill("));
  ok("Explore holds the what-if in React state only: no storage, no fetch, no Supabase", /useState<Edits>/.test(ex) && !/localStorage|sessionStorage|indexedDB|fetch\(|supabase|\.rpc\(|\.from\(/.test(ex));
  ok("…labelled as theirs, with the way back", /Your what-if — not GT3&apos;s plan|Your what-if — not GT3's plan/.test(ex) && /Back to the approved case/.test(ex) && /nothing is saved or sent/.test(ex));
  ok("…and leaving Explore drops it (the slide is keyed by the mode)", /key=\{`\$\{s\.id\}:\$\{mode\}`\}/.test(read("components/vision/Present.tsx")));
  ok("…the levers come first, under the title (Explore replaces the approved figures with its own before-and-after)", slide.indexOf('mode === "explore" && b.ok && <Explore') < slide.indexOf('b.ok && show("ask") && mode !== "explore"'));
  ok("the cash chart's caption reads as words (it said \"monthapos;s\" on the slide)", !/apos;s net cash<\/span>|month<span>/.test(read("components/vision/MoneyCharts.tsx")) && /plus each month&apos;s net cash/.test(read("components/vision/MoneyCharts.tsx")));
  ok("…each lever says its approved value beside the moved one", /approved \{say\(l, was!\)\}/.test(ex));
}

// ── 3 · Diligence ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  const t = C.figuresOf(c).base;
  for (const k of P.DILIGENCE_FIGURES) ok(`${k}: a formula, its worked numbers, what it's made of`, t[k] && t[k].formula.length > 3 && t[k].worked.length > 1 && t[k].madeOf.length > 0, t[k]);
  const slide = read("components/vision/CaseSlide.tsx");
  ok("figures open only in Diligence, and say how they're worked out", /const drill = mode === "diligence"/.test(slide) && /How it's worked out/.test(slide) && /aria-expanded=\{open === key\}/.test(slide));
  ok("the drill names the sources behind the case, each a link", /function Drill\(/.test(slide) && /accepted finding/.test(slide) && /href=\{r\.source_url\}/.test(slide));
}

// ── 4 · wiring and words ──────────────────────────────────────────────────────────────────────────────────────────
{
  const pres = read("components/vision/Present.tsx"), css = read("components/vision/vision.css");
  ok("the three ways appear only when there's a case to show", /\{hasCase && \(/.test(pres) && /role="radiogroup" aria-label="How to show it"/.test(pres));
  ok("Pitch tells each case in parts; the other two keep it whole", /mode === "pitch" \? toldInParts\(base, vision\.cases\) : base/.test(pres) && /part=\{mode === "pitch" \? s\.part : "all"\}/.test(pres));
  ok("changing the way keeps the place", /const idx = next\.findIndex\(same\)/.test(pres));
  ok("the phone check shows the presenter on a 1080p projector, and opens Explore and Diligence", /key: "projector", w: 1920, h: 1080/.test(read("scripts/smoke.console.mjs")) && /key: "vision-explore"/.test(read("scripts/smoke.console.mjs")) && /key: "vision-diligence"/.test(read("scripts/smoke.console.mjs")));
  ok("no haptics on slides", !/haptic\(/.test(pres));
  ok("a lever keeps its arrow keys (they don't change the slide)", /closest\?\.\("input, select, textarea"\)/.test(pres));
  ok("no claim the Standard can't back", !/nothing toxic/i.test(pres) && !/toxin/i.test(pres) && !/toxic/i.test(read("components/vision/CaseSlide.tsx")));
  ok("the projector's type grows with the screen on the ask", /\.vp-kpis-big \.vz-kpi b\{font-size:clamp\(24px,3\.2vw,44px\)\}/.test(css));
  ok("the modes control is a 32-px target on a row of its own, so the bar never crowds on a phone", /\.vp-modes button\{min-height:32px/.test(css) && /\{hasCase && \(\n\s*<div className="vp-modes"/.test(pres));
}

console.log(`IP1 — PITCH · EXPLORE · DILIGENCE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
