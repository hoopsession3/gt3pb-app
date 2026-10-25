// R54b — ONE MEANING OF PAYBACK, BREAK-EVEN AND ROI (2026-10-25 — the traceability audit's gap 9; Ryan: "Yes, as its own
// patch"). lib/finance says each once; the plan's money, the operator deal and an event's projection call it.
//
//   1 · The definitions, by hand.
//   2 · Before and after: each engine's old rule, kept here verbatim, against the shared one — over thousands of cases, the
//       same numbers. The one deliberate change: a plan with no startup spending has nothing to pay back (it said month 1).
//   3 · The wiring: no engine keeps a loop of its own.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 500)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const F = loadTs("lib/finance.ts"), M = loadTs("lib/visionMoney.ts"), D = loadTs("lib/dealExplainer.ts");

// ── 1 · by hand ─────────────────────────────────────────────────────────────────────────────────────────────────────
ok("payback: $100 in, $30 a month back → month 4", F.paybackMonth([30, 30, 30, 30, 30], 100) === 4);
ok("…exactly covered counts: $90 in → month 3", F.paybackMonth([30, 30, 30], 90) === 3);
ok("…nothing put in → nothing to pay back", F.paybackMonth([30], 0) === null);
ok("…not covered within the flows → null", F.paybackMonth([10, 10], 100) === null);
ok("steady: ⌈$100 ÷ $30⌉ = 4; nothing back → never (Infinity); nothing in → null", F.steadyPaybackMonths(10000, 3000) === 4 && F.steadyPaybackMonths(10000, 0) === Infinity && F.steadyPaybackMonths(0, 3000) === null);
ok("break-even: the month from which it stays ≥ 0, not the first good month", F.breakEvenMonth([-5, 3, -1, 2, 4]) === 4 && F.breakEvenMonth([1, 2]) === 1 && F.breakEvenMonth([2, -1]) === null);
ok("break-even in units: $500 fixed at $4 a unit = 125", F.breakEvenUnits(50000, 400) === 125 && F.breakEvenUnits(50000, 0) === null);
ok("ROI: $150 back on $100 = 50%; no basis → null", F.roi(150, 100) === 0.5 && F.roi(150, 0) === null);

// ── 2 · before and after ────────────────────────────────────────────────────────────────────────────────────────────
// The rules as they were written in each engine before this patch (R54's visionMoney, R38's dealExplainer, economics).
const oldSustained = (fl) => { let at = null; for (let k = fl.length - 1; k >= 0 && fl[k] >= 0; k--) at = k + 1; return at; };
const oldRecovered = (fl, s) => { let r = -s; for (let k = 0; k < fl.length; k++) { r += fl[k]; if (r >= 0) return k + 1; } return null; };
const oldDeal = (c0, m0) => { const c = Math.max(0, Math.round(Number(c0) || 0)); if (c <= 0) return null; const m = Math.round(Number(m0) || 0); if (m <= 0) return Infinity; return Math.ceil(c / m); };
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
let same = 0, diff = [];
for (let t = 0; t < 4000; t++) {
  const fl = Array.from({ length: 36 }, (_, k) => Math.round((rnd() - 0.45) * 400000 + k * 3000));
  const s = Math.round(rnd() * 3000000) + 1;
  if (oldSustained(fl) === F.breakEvenMonth(fl) && oldRecovered(fl, s) === F.paybackMonth(fl, s)) same++; else diff.push({ fl: fl.slice(0, 4), s });
}
ok("plan money: break-even and payback, 4,000 cases, the same months", same === 4000, diff.slice(0, 2));
let dealSame = 0;
for (let t = 0; t < 4000; t++) { const c = Math.round((rnd() - 0.1) * 5000000), m = Math.round((rnd() - 0.1) * 300000); if (oldDeal(c, m) === D.paybackMonths(c, m)) dealSame++; }
ok("operator deal: payback, 4,000 cases, the same months", dealSame === 4000, dealSame);
ok("…and a steady flow's payback is the plan's rule over that flow", [[600000, 25000], [100, 7], [999, 1000]].every(([c, m]) => F.steadyPaybackMonths(c, m) === F.paybackMonth(Array(2000).fill(m), c)));
let roiSame = 0;
for (let t = 0; t < 2000; t++) { const rev = Math.round(rnd() * 900000), cost = Math.round(rnd() * 900000) * (t % 9 ? 1 : 0); const was = cost > 0 ? (rev - cost) / cost : 0; if (was === (F.roi(rev, cost) ?? 0)) roiSame++; }
ok("event: ROI on its whole cost, 2,000 cases, the same", roiSame === 2000, roiSame);
const blank = M.toInputs({ ordersPerDay: 50, avgOrderCents: 900, daysOpenPerMonth: 26, cogsPct: 30, staffHoursPerDay: 10, wageCents: 1500 });
const zm = M.project(blank);
ok("the one change: no startup spending → nothing to pay back (it said month 1), and the screen says so", zm.paybackMonth === null && M.trace(blank, { kind: "none" }).payback.display === "Nothing to earn back");

// ── 3 · the wiring ──────────────────────────────────────────────────────────────────────────────────────────────────
const vm = read("lib/visionMoney.ts"), de = read("lib/dealExplainer.ts"), ec = read("lib/economics.ts");
ok("the plan's money calls the shared rules", /from "\.\/finance"/.test(vm) && /breakEvenMonth\(months\.map/.test(vm) && /paybackMonth\(months\.map/.test(vm) && /roi\(totOp, startupSpend\)/.test(vm));
ok("the deal calls them", /steadyPaybackMonths\(cents\(contributionCents\), monthlyCents\)/.test(de) && !/Math\.ceil\(c \/ m\)/.test(de));
ok("the event calls them", /breakEvenUnits_\(fixedPlusLabor, contribPerUnit\)/.test(ec) && /roi\(revenueCents, totalCostCents\)/.test(ec));

console.log(`R54b — ONE MEANING OF PAYBACK, BREAK-EVEN AND ROI: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
