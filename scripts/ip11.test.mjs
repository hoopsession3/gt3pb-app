// IP1.1 — THE INVESTOR EXPERIENCE, VERIFIED (2026-10-27 — Ryan: "An investor can understand the opportunity in Pitch,
// challenge its economics in Explore, and verify every material number in Diligence — on desktop and mobile").
//
//   1 · Every figure on the investor slide, recomputed by hand from the phone check's fixture ("A bar inside a gym") and
//       compared with the engine — to the dollar.
//   2 · The ask, reconciled: raised = startup + reserve + unallocated; the model's minimum is its own, smaller figure.
//   3 · Each "money back" measure says which one it is (before or after the investor; operating or cumulative).
//   4 · Explore can move startup costs and the investor's share — sandboxed; the reserve and unpriced lines never scale.
//   5 · Mobile: the chart answers a tap; a table holds every month; the chart's caption reads as words; prices keep cents.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 600)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const M = loadTs("lib/visionMoney.ts"), C = loadTs("lib/visionCase.ts"), P = loadTs("lib/visionPresent.ts");

// The fixture, as scripts/fixtures/consoleWorld.mjs seeds it (the screenshots' numbers).
const base = { uses: [
  { id: "f1", label: "Bar and cooler", category: "equipment", qty: 1, unitCents: 1800000 },
  { id: "f2", label: "Tap tower", category: "equipment", qty: 2, unitCents: 150000 },
  { id: "f3", label: "Build-out", category: "buildout", qty: 1, unitCents: 900000 },
  { id: "f4", label: "Signage", category: "launch", qty: 1, unitCents: null },
  { id: "f5", label: "Working-capital reserve", category: "reserve", qty: 1, unitCents: 1000000 }],
  ownerCashCents: 500000, ordersPerDay: 90, avgOrderCents: 850, daysOpenPerMonth: 26, hoursOpenPerDay: 10, rampMonths: 6, rampStartPct: 50, growthPctPerYear: 5,
  cogsPct: 30, cardFeePct: 3, staffHoursPerDay: 12, wageCents: 1600, laborBurdenPct: 12, rentCents: 0, rentPctOfSales: 10, otherOpexCents: 60000, marketingCents: 40000 };
const structure = { kind: "rev_share", amountCents: 4000000, sharePct: 6, capMultiple: 1.5 };
const fixture = read("scripts/fixtures/consoleWorld.mjs");
ok("the test's inputs are the fixture's (orders, ticket, costs, the deal)", /ordersPerDay: 90, avgOrderCents: 850/.test(fixture) && /"kind":"rev_share","amountCents":4000000,"sharePct":6,"capMultiple":1\.5/.test(fixture) && /unitCents: 1800000/.test(fixture));

const i = M.toInputs(base), m = M.project(i, structure), t = M.trace(i, structure, m), inv = M.investor(m, structure);

// ── 1 · by hand ───────────────────────────────────────────────────────────────────────────────────────────────────
{
  ok("startup spending: 18,000 + 2 × 1,500 + 9,000 = $30,000; the reserve and the unpriced sign aren't in it", m.startupSpend === 3000000 && m.unpriced === 1);
  ok("reserve planned: $10,000", m.reservePlanned === 1000000);
  // Month 1 by hand: ramp starts at 50% → 45 orders × 26 days = 1,170; × $8.50 = $9,945.
  ok("month 1 sales by hand: 45 a day × 26 days × $8.50 = $9,945", m.months[0].orders === 1170 && m.months[0].revenue === 994500, [m.months[0].orders, m.months[0].revenue]);
  // Month 1 costs by hand: COGS 30% = 2,983.50; fees 3% = 298.35; rent 10% = 994.50; labor 12 h × $16 × 26 × 1.12 = 5,591.04;
  // other 600; marketing 400 → operating = 9,945 − 2,983.50 − 298.35 − 994.50 − 5,591.04 − 600 − 400 = −922.39.
  ok("month 1 operating cash by hand: −$922.39", m.months[0].operating === -92239, m.months[0].operating);
  ok("the investor's month 1: 6% × $9,945 = $596.70", m.months[0].toInvestor === 59670, m.months[0].toInvestor);
  ok("net month 1: −922.39 − 596.70 = −$1,519.09", m.months[0].net === -151909);
  const lowest = Math.min(...m.months.reduce((a, x) => (a.push((a.at(-1) ?? 0) + x.net), a), []));
  ok("early cash need = −(lowest running net) = $2,193", Math.abs(m.reserveNeeded + lowest) <= 1 && Math.round(m.reserveNeeded / 100) === 2193, [m.reserveNeeded, lowest]);
  ok("the model's minimum need = 30,000 + 2,193 = $32,193", m.requiredFunding === m.startupSpend + m.reserveNeeded && Math.round(m.requiredFunding / 100) === 32193);
  ok("operating break-even month 2 (month 1 −$922, month 2 +$22); after the investor month 3", m.breakEvenMonth === 2 && m.breakEvenAfterMonth === 3);
  ok("startup payback month 11 before the investor, month 14 after", m.paybackMonth === 11 && m.paybackAfterMonth === 14);
  ok("business ROI 473% before financing, 329% after", t.roiBusiness.display === "473%" && t.roiAfter.display === "329%", [t.roiBusiness.display, t.roiAfter.display]);
  ok("36 months' sales $717,631", t.revenue.display === "$717,631", t.revenue.display);
  ok("the investor's rate 21.7% a year — and it says it counts months past 36 (cap met in month 49)", inv.irrPct.toFixed(1) === "21.7" && inv.says.some((w) => /Past month 36/.test(w) && /month 49/.test(w)), inv.says);
  ok("in 2 of 36 months the payment is more than the business makes", m.months.filter((x) => x.toInvestor > 0 && x.operating < x.toInvestor).length === 2);
  ok("no double counting: operating − investor = net, every month", m.months.every((x) => x.net === x.operating - x.toInvestor));
  ok("a unit price keeps its cents in the trace ($8.50, never $9)", /× \$8\.50 =/.test(t.revenue.worked), t.revenue.worked);
}

// ── 2 · the ask, reconciled ───────────────────────────────────────────────────────────────────────────────────────
{
  ok("raised $45,000 = investor $40,000 + owners $5,000", m.fundingRaised === 4500000);
  const left = m.fundingRaised - m.startupSpend - m.reservePlanned;
  ok("raised = startup $30,000 + reserve $10,000 + $5,000 not yet allocated", left === 500000);
  const slide = read("components/vision/CaseSlide.tsx");
  ok("the ask slide says it in one line, from the engine's figures", /function Raising\(/.test(slide) && /isn't yet assigned/.test(slide) && /The plan needs at least/.test(slide));
  ok("\"Funding required\" is called what it is: minimum funding, opening cost plus what the first months use", /requiredFunding: "Minimum funding"/.test(read("lib/visionPresent.ts")) && /opening cost \+ \$\{dollars\(b\.reserveNeeded\)\} to carry the first months/.test(slide));
  ok("an unpriced line shows on the startup figure itself", /not yet priced/.test(slide) && /t\.startupSpend\.display\}\+/.test(slide));
}

// ── 3 · which measure is which ────────────────────────────────────────────────────────────────────────────────────
{
  const slide = read("components/vision/CaseSlide.tsx");
  ok("break-even and payback give the after-investor month beside the before", /after\(t\.breakEvenAfter\.display, c\)/.test(slide) && /after\(t\.paybackAfter\.display, c\)/.test(slide) && /after the investor's share/.test(slide));
  ok("ROI says before tax and the investor, and gives the after figure", /before tax and the investor · \$\{t\.roiAfter\.display\} after/.test(slide));
  ok("the investor's rate says what the investor receives, and when it leans past month 36", /function investorNote\(/.test(slide) && /if year-3 sales hold/.test(slide) && /cap is met in month/.test(slide));
  ok("the investor's rate opens to its formula in Diligence", /k\(f\.inv \? "investorReturn" : null/.test(slide));
  ok("readiness is a checklist score, not a probability; gaps and missing research are said", /not a probability of success/.test(slide) && /The plan still has gaps/.test(slide) && /No market research has been accepted yet/.test(slide));
}

// ── 4 · Explore, wider and still sandboxed ────────────────────────────────────────────────────────────────────────
{
  const c = C.toCase({ baseline: { scenarios: { base, conservative: base, upside: base }, structure }, approved_at: "2026-10-27T00:00:00Z" });
  const before = JSON.stringify(c);
  const up = P.whatIf(c, { startupPct: 120 });
  const lines = up.scenarios.base.uses;
  ok("startup costs at 120%: every priced line × 1.2; the reserve and the unpriced line untouched", lines[0].unitCents === 2160000 && lines[2].unitCents === 1080000 && lines[3].unitCents === null && lines[4].unitCents === 1000000);
  ok("…the other scenarios stay as approved", JSON.stringify(up.scenarios.conservative) === JSON.stringify(c.scenarios.conservative));
  const f = C.figuresOf(up);
  ok("…and the engine sees $36,000 of startup spending", f.models.base.startupSpend === 3600000);
  const sh = P.whatIf(c, { sharePct: 8 });
  ok("the investor's share at 8%: only the structure's percentage changes", sh.structure.sharePct === 8 && sh.structure.capMultiple === 1.5 && JSON.stringify(sh.scenarios) === JSON.stringify(c.scenarios));
  ok("…and a higher share pays the investor more", C.figuresOf(sh).irrPct > C.figuresOf(c).irrPct);
  ok("the share lever exists only under a revenue share", P.approvedOf({ ...c, structure: { kind: "loan", amountCents: 1, aprPct: 8, termMonths: 12 } }, "sharePct") === null && P.approvedOf(c, "sharePct") === 6);
  ok("100% startup and the approved share are no change at all", P.whatIf(c, { startupPct: 100, sharePct: 6 }) === c);
  ok("the approved case is never changed by a what-if", JSON.stringify(c) === before);
  ok("Explore shows the investor's rate before and after", P.EXPLORE_FIGURES.includes("investorReturn"));
}

// ── 5 · mobile, the chart and the words ───────────────────────────────────────────────────────────────────────────
{
  const chart = read("components/vision/MoneyCharts.tsx"), pres = read("components/vision/Present.tsx"), slide = read("components/vision/CaseSlide.tsx");
  ok("the chart answers a tap, not only a hover", /onPointerDown=\{\(e\) => pick\(/.test(chart) && /e\.pointerType === "mouse"/.test(chart));
  ok("…and a tap on it, or on the table, never turns the slide", /\.vz-chart, \.vz-cmp-wrap/.test(pres) && /summary/.test(pres));
  ok("the chart marks its lowest point and says when", /Lowest \{dollars\(v\)\}/.test(chart));
  ok("every month is in a table, without a pointer", /<summary>Month by month<\/summary>/.test(slide) && /aria-label="Cash, month by month"/.test(slide));
  ok("opening, lowest, month-36 cash and what the investor is paid are said beside the chart", /Cash on opening day/.test(slide) && /Lowest point/.test(slide) && /After three years/.test(slide) && /Paid to the investor/.test(slide));
  ok("a missing downside is said, not hidden", /There's no downside case in this plan yet\./.test(slide));
  ok("the chart's caption reads as words (it once said \"monthapos;s\")", /plus each month&apos;s cash in and out/.test(chart) && !/apos;s net cash<\/span>|month<span>/.test(chart));
  ok("unit prices keep their cents wherever a price is shown", /money\(i\.avgOrderCents!\)/.test(read("lib/visionMoney.ts")) && /money\(l\.priceCents\)/.test(read("components/vision/Mix.tsx")));
}

console.log(`IP1.1 — THE INVESTOR EXPERIENCE, VERIFIED: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
