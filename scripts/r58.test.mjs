// R58 — ACTUAL AGAINST THE PLAN, AND FLOW'S ASSUMPTIONS SAID (2026-10-25 — the financial traceability audit's gaps 8 and
// 10: "no actual-vs-projected for a live plan"; Flow's timings were labelled only for the order time).
//
//   1 · The real months by hand: month 1 is the opening day to the same day a month later; paid, not canceled, the
//       plan's own channel; a month still running is "so far" and left out of the to-date comparison.
//   2 · Against the baseline: each month beside its projection; to date over complete months only.
//   3 · Flow says every timing it assumes, from the settings it runs on.
//   4 · The wiring.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 600)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const A = loadTs("lib/visionActual.ts"), M = loadTs("lib/visionMoney.ts");

const L = (day, cents, extra = {}) => ({ channel: "cup", day, totalCents: cents, isPaid: true, canceled: false, ...extra });
const lines = [L("2026-08-15", 1000), L("2026-09-14", 2000), L("2026-09-15", 4000), L("2026-10-20", 8000),
  L("2026-08-20", 500, { canceled: true }), L("2026-08-21", 700, { isPaid: false }), L("2026-08-22", 9999, { channel: "shop" })];
{
  const ms = A.actualMonths(lines, "cup", "2026-08-15", "2026-10-25");
  ok("three months from Aug 15: Aug 15–Sep 15, Sep 15–Oct 15, Oct 15– (so far)", ms.length === 3 && ms[0].from === "2026-08-15" && ms[0].through === "2026-09-15" && ms[2].from === "2026-10-15" && !ms[2].complete && ms[1].complete, ms);
  ok("month 1: Aug 15 and Sep 14 — $30; the canceled, the unpaid and the shop's aren't counted", ms[0].revenueCents === 3000 && ms[0].orders === 2);
  ok("month 2 starts on the 15th: $40; month 3 so far: $80", ms[1].revenueCents === 4000 && ms[2].revenueCents === 8000);
  ok("the 31st opens: the next month ends on the last day it has", A.actualMonths([], "cup", "2026-01-31", "2026-04-01")[1].from === "2026-02-28");
  ok("not opened yet: no months", A.actualMonths(lines, "cup", "2026-11-01", "2026-10-25").length === 0);
  const model = { ok: true, months: Array.from({ length: 36 }, () => ({ revenue: 3500 })) };
  const vs = A.againstPlan(ms, model);
  ok("each month beside its projection: −$5, +$5, so far", vs.rows[0].diff === -500 && vs.rows[1].diff === 500 && !vs.rows[2].complete);
  ok("to date over the two complete months only: $70 against $70, even", vs.toDate.months === 2 && vs.toDate.actual === 7000 && vs.toDate.projected === 7000 && vs.toDate.diff === 0);
  ok("against the real engine's months", A.againstPlan(ms, M.project(M.toInputs({ ordersPerDay: 1, avgOrderCents: 100, daysOpenPerMonth: 30, cogsPct: 30, staffHoursPerDay: 1, wageCents: 100 }))).rows[0].projected === 3000);
}
{
  const fb = read("components/vision/FlowBar.tsx");
  ok("Flow says every timing it assumes, from its settings", /export function assumptionsWords\(st = DEFAULTS\)/.test(fb) && /st\.pickupSec/.test(fb) && /st\.staySec\[0\]/.test(fb) && /st\.stayShare/.test(fb) && /st\.grabShare/.test(fb) && /not yet measured/.test(fb));
  const sql = read("supabase/migrations/0452_actual_against_the_plan.sql"), panel = read("components/vision/Actual.tsx"), money = read("components/vision/MoneyPanel.tsx");
  ok("0452: when it opened, which channel; nothing set by default; the five channels only", /add column if not exists opened_on date/.test(sql) && /actual_channel in \('cup','pickup','delivery','office','shop'\)/.test(sql));
  ok("the panel compares against the approved baseline when there is one", /model=\{baselineBase \?\? models\.base\}/.test(money) && /the approved baseline's Base/.test(money));
  ok("…reads the ledger and says when it read only the latest orders", /readLedger\(supabase/.test(panel) && /older months may be short/.test(panel));
  ok("…and marks a running month as so far", /\(so far\)/.test(panel));
}
console.log(`R58 — ACTUAL AGAINST THE PLAN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
