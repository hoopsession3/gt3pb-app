// R61 — THE PLAN'S CASE IN WORDS, AND THE ADVISOR (2026-10-25 — Ryan: "target customer, addressable market, competitive
// positioning… risks, assumptions, mitigation strategies, supporting evidence"; "a proactive AI strategic advisor… if
// projected traffic exceeds service capacity… if rent makes a location financially unattractive… if an initiative depends
// on another unfinished milestone… prioritize actionable insights over notifications and dashboard clutter").
//
//   1 · Risks ranked by Ryan's own likelihood × impact; an assumption proved wrong first; unrated last.
//   2 · The advisor by hand: a dependency before execution, rent that decides break-even, demand past the counter, an
//       assumption proved wrong — stops first, by what they'd move; no benchmark anywhere.
//   3 · The wiring.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const K = loadTs("lib/visionRisks.ts"), A = loadTs("lib/visionAdvisor.ts"), M = loadTs("lib/visionMoney.ts");

const R = (o) => K.toRisk({ plan_id: "p", kind: "risk", words: "x", status: "open", sort: 0, ...o });
{
  const rs = [R({ words: "low-low", likelihood: "low", impact: "low" }), R({ words: "unrated" }), R({ words: "high-med", likelihood: "high", impact: "medium" }), R({ words: "wrong", kind: "assumption", status: "wrong" }), R({ words: "handled", likelihood: "high", impact: "high", status: "handled" })];
  const top = K.keyRisks(rs, 4).map((r) => r.words);
  ok("ranked: proved wrong, then high × medium (6), then low × low (1), unrated last; handled left out", top.join() === "wrong,high-med,low-low,unrated", top);
  ok("likelihood × impact", K.weight({ likelihood: "high", impact: "high" }) === 9 && K.weight({ likelihood: null, impact: "high" }) === null);
  ok("read safely: unknown values fall to safe ones", K.toRisk({ plan_id: "p", kind: "vibes", likelihood: "huge", status: "?" }).kind === "risk" && K.toRisk({ plan_id: "p", likelihood: "huge" }).likelihood === null);
}
{
  // $24,000 sales a month, $7,200 goods, $9,000 labor, $9,000 rent → −$1,200 every month; without the rent, +$7,800.
  const i = M.toInputs({ uses: [{ id: "a", label: "Bar", category: "equipment", qty: 1, unitCents: 3000000, confidence: "quoted" }], ordersPerDay: 100, avgOrderCents: 800, daysOpenPerMonth: 30, hoursOpenPerDay: 10,
    cogsPct: 30, staffHoursPerDay: 20, wageCents: 1500, rentCents: 900000, capToRoom: true });
  const plan = { id: "p1", name: "The gym bar", status: "go", layout_id: "room", research_every_days: 0 };
  const st = { plan, i, structure: { kind: "none" }, ctx: { counterPerHour: 5 }, research: [], progress: {}, risks: [R({ plan_id: "p1", words: "People pay $8", kind: "assumption", status: "wrong" })], status: "go", waitingOn: ["The kiosk"] };
  const adv = A.advise([st], Date.parse("2026-10-25T12:00:00Z"));
  const stops = adv.filter((a) => a.level === "stop").map((a) => a.words);
  ok("a dependency before execution: marked go, waits on the kiosk — first", /marked go but waits on The kiosk/.test(adv[0].words), adv[0]);
  const uncapped = A.advise([{ ...st, i: M.toInputs({ ...i, capToRoom: false }) }]).filter((a) => a.level === "stop").map((a) => a.words);
  ok("rent that decides it (uncapped): without it, it would break even from month 1", uncapped.some((w) => /rent is what keeps it from breaking even — without it, it would from month 1/.test(w)), uncapped);
  ok("…but not when the counter's cap is what stops it — the rent isn't the deciding cost then", !stops.some((w) => /rent is what keeps it/.test(w)));
  ok("demand past the counter: 50 an hour × 10 × 30 = 1,500 of 3,000 a month — half can't be taken", stops.some((w) => /can't take 50% of the orders/.test(w)), stops);
  ok("an assumption proved wrong", stops.some((w) => /assumption proved wrong: People pay \$8/.test(w)));
  ok("stops before looks, then by what they'd move", adv.findIndex((a) => a.level === "look") > stops.length - 1 && adv.slice(0, stops.length).every((a, k, xs) => k === 0 || xs[k - 1].gain >= a.gain));
  ok("each line is an action, the plan, and why", adv.every((a) => a.action && a.plan === "The gym bar" && a.words));
  const fine = A.advise([{ ...st, i: M.toInputs({ ...i, rentCents: 0, capToRoom: false }), status: "exploring", waitingOn: [], risks: [], plan: { ...plan, layout_id: null } }]);
  ok("a plan with nothing wrong: no stops — only its next best step", fine.every((a) => a.level === "look") && fine.length >= 1, fine);
  ok("no benchmark: rent is flagged only when it decides break-even", !/%\s*of sales is (high|too)/i.test(read("lib/visionAdvisor.ts")));
}
{
  const plans = read("components/vision/Plans.tsx"), words = read("components/vision/CaseWords.tsx"), slide = read("components/vision/CaseSlide.tsx"), sql = read("supabase/migrations/0454_the_plans_case_in_words.sql");
  ok("0454: who it's for, the market, how it stands apart; risks and assumptions with their ratings, plan and status", /add column if not exists customer text/.test(sql) && /kind in \('risk','assumption'\)/.test(sql) && /status in \('open','handled','validated','wrong'\)/.test(sql));
  ok("…the crew read them, owners and admins write them", /"vision staff read" on public\.vision_plan_risks for select/.test(sql) && /"vision admin write" on public\.vision_plan_risks/.test(sql));
  ok("…and a link shows the risks only with the case an owner chose", /'risks', case when v\.id = any\(s\.money_plans\)/.test(sql));
  ok("the plan step carries the case in words; the advisor sits atop the plans for owners and admins", /<CaseWords plan=\{p\}/.test(plans) && /\{canEdit && <Advisor /.test(plans));
  ok("a market number belongs with its source, and the screen says so", /a number belongs with its source, in the research/.test(words));
  ok("the investor's slide: who it's for, how it stands apart, the risks we watch", /plan\.customer \|\| plan\.positioning/.test(slide) && /The risks we watch/.test(slide));
}
console.log(`R61 — THE CASE IN WORDS, AND THE ADVISOR: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
