// IP1.2 — THE EDITORIAL PASS (2026-10-27 — Ryan: "sound like a knowledgeable founder speaking naturally to an investor —
// not an AI system generating a financial report"). Words changed; numbers didn't.
//
//   1 · Headlines say what the numbers mean, worked from the engine's own figures (the phone check's fixture).
//   2 · Every investor label keeps its exact financial meaning: the plain word maps to the same engine figure.
//   3 · The phrases that made it read like a dashboard describing itself are gone from the investor's screens.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 400)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const M = loadTs("lib/visionMoney.ts"), P = { ...loadTs("lib/visionPresent.ts"), ...loadTs("lib/visionHeadline.ts") };

const base = { uses: [{ id: "a", label: "Bar", category: "equipment", qty: 1, unitCents: 1800000 }, { id: "b", label: "Taps", category: "equipment", qty: 2, unitCents: 150000 },
  { id: "c", label: "Build-out", category: "buildout", qty: 1, unitCents: 900000 }, { id: "d", label: "Sign", category: "launch", qty: 1, unitCents: null }, { id: "e", label: "Reserve", category: "reserve", qty: 1, unitCents: 1000000 }],
  ownerCashCents: 500000, ordersPerDay: 90, avgOrderCents: 850, daysOpenPerMonth: 26, hoursOpenPerDay: 10, rampMonths: 6, rampStartPct: 50, growthPctPerYear: 5,
  cogsPct: 30, cardFeePct: 3, staffHoursPerDay: 12, wageCents: 1600, laborBurdenPct: 12, rentCents: 0, rentPctOfSales: 10, otherOpexCents: 60000, marketingCents: 40000 };
const rs = { kind: "rev_share", amountCents: 4000000, sharePct: 6, capMultiple: 1.5 };
const m = M.project(M.toInputs(base), rs), m0 = M.project(M.toInputs(base), { kind: "none" });

// ── 1 · headlines ─────────────────────────────────────────────────────────────────────────────────────────────────
ok("the ask's headline is the bottom line after the investor: month 14", P.askHeadline(m, "rev_share") === "Earns back its opening cost by month 14, after paying the investor.", P.askHeadline(m, "rev_share"));
ok("…and without an investor, the plain payback month", P.askHeadline(m0, "none") === `Earns back its opening cost by month ${m0.paybackMonth}.`, P.askHeadline(m0, "none"));
const slow = M.project(M.toInputs({ ...base, ordersPerDay: 12 }), rs);
ok("a plan that never earns it back says so", /^Doesn't earn back its opening cost within three years once the investor is paid\.$/.test(P.askHeadline(slow, "rev_share")), P.askHeadline(slow, "rev_share"));
ok("the cash headline is the low point: $12,807", P.cashHeadline(m) === "In the base case, cash bottoms out at $12,807 in month 2.", P.cashHeadline(m));  // IP1.4: names its case and its month
ok("…and a shortfall is said as one", /^In the base case, cash runs \$[\d,]+ short in month \d+\.$/.test(P.cashHeadline(M.project(M.toInputs({ ...base, ownerCashCents: 0 }), { kind: "none" }))), P.cashHeadline(M.project(M.toInputs({ ...base, ownerCashCents: 0 }), { kind: "none" })));

// ── 2 · same meaning, plainer words ───────────────────────────────────────────────────────────────────────────────
const L = P.PRESENT_LABEL;
ok("startup spending → cost to open (Σ priced lines but the reserve)", L.startupSpend === "Cost to open");
ok("funding required → minimum funding (opening cost + the cash the first months use)", L.requiredFunding === "Minimum funding" && L.reserveNeeded === "Cash the first months use");
ok("operating break-even → covers its costs from (before the investor; the after-investor month beside it)", L.breakEven === "Covers its costs from" && /after the investor/.test(L.breakEvenAfter));
ok("payback → earns back the opening cost (cumulative operating cash ≥ startup)", L.payback === "Earns back the opening cost");
ok("business ROI → return on the opening cost, 3 years (before tax and the investor, said beside it)", L.roiBusiness === "Return on the opening cost, 3 years");
ok("the investor's rate → investor's annual return (an IRR, said in Diligence with its formula)", L.investorReturn === "Investor's annual return");
const slide = read("components/vision/CaseSlide.tsx");
ok("a revenue share is said as its terms, not dressed as ownership", /% of sales until \$\{dollars\(s\.amountCents \* s\.capMultiple\)\} is repaid/.test(slide));
ok("the money-back headline reads the after-investor month, never the flattering one", /const n = inv \? m\.paybackAfterMonth : m\.paybackMonth/.test(read("lib/visionHeadline.ts")));

// ── 3 · the dashboard voice, gone from the investor's screens ─────────────────────────────────────────────────────
const words = [slide, read("components/vision/Present.tsx"), read("lib/visionPresent.ts"), read("lib/visionHeadline.ts")].join("\n").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join("\n"); // what a viewer reads, not the comments
for (const phrase of ["What it takes, and what it returns", "The model's minimum need", "this plan is alive", "Computed by the engine", "owner-approved baseline", "not a forecast of what will happen", "Held on this screen only", "Working out the case"])
  ok(`no "${phrase}"`, !words.includes(phrase));
ok("the presenter's figures speak in the presenter's words (Explore and Diligence use PRESENT_LABEL)", (slide.match(/PRESENT_LABEL\[/g) ?? []).length >= 3);
ok("\"cash on hand covers it\" only when cash never goes below zero", /lowRow\.closing >= 0 \? "; cash on hand covers it" : ""/.test(slide));
ok("the shared chart no longer points to a table only the presenter has", !/table below/.test(read("components/vision/MoneyCharts.tsx")));

console.log(`IP1.2 — THE EDITORIAL PASS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
