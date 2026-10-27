// IP1.4 — THE CASH NARRATIVE, DILIGENCE THAT VERIFIES, READINESS BY POLICY (2026-10-28 — Ryan: "Reconcile the displayed
// $32,193 funding requirement, $15,000 opening cash, $30,000 startup spending, $10,000 reserve and $12,807 minimum cash…
// Reserve requirements are explicitly distinguished from zero-cash survival… Acknowledgment alone must not count as
// resolution… Define these classifications through explicit governance criteria, not an arbitrary score threshold").
//
//   1 · The verification matrix, recomputed by hand from the phone check's plan — every figure on the cash screen.
//   2 · The schedule: month 0 to 36, each closing = opening + in − out − investor; the reserve said apart from zero.
//   3 · The headline comes from the scenario shown, its own low point and month — another case, another sentence.
//   4 · Blocker lifecycle: open → in remediation (a need) → pending verification (need done) → risk accepted (reason +
//       review date) → lapsed; an accepted risk stays listed. Stages by policy; the method versioned.
//   5 · The screens: Pitch one picture; Explore the cases as cards (no sideways table) and the swings; Diligence's eight
//       sections; a month on a tap or a button; the tap that turns a slide never fires on what's being read.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 600)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const M = loadTs("lib/visionMoney.ts"), C = loadTs("lib/visionCase.ts"), S = loadTs("lib/visionScore.ts"), H = loadTs("lib/visionHeadline.ts");
const usd = (c) => Math.round(c / 100);

// The phone check's plan, as the fixture seeds it.
const src = read("scripts/fixtures/consoleWorld.mjs"), at = src.indexOf("const money = ");
const world = new Function(`return (${src.slice(at + 14, src.indexOf(";\n", at))});`)();
const structure = { kind: "rev_share", amountCents: 4000000, sharePct: 6, capMultiple: 1.5 };
const c = C.toCase({ baseline: { scenarios: world, structure }, approved_at: "2026-10-27T00:00:00Z" });
const f = C.figuresOf(c), b = f.models.base, rows = C.monthRows(b);

// ── 1 · the matrix ───────────────────────────────────────────────────────────────────────────────────────────────────
{
  ok("raised $45,000 = investor $40,000 + owners $5,000", usd(b.fundingRaised) === 45000);
  ok("opening cost $30,000 (one line not priced, not counted)", usd(b.startupSpend) === 30000 && b.unpriced === 1);
  ok("reserve held $10,000 — cash kept, not spent", usd(b.reservePlanned) === 10000);
  ok("cash on opening day $15,000 = $45,000 − $30,000 (the reserve is inside it)", usd(rows[0].closing) === 15000);
  const low = rows.reduce((a, r) => (r.closing < a.closing ? r : a), rows[0]);
  ok("lowest cash $12,807 in month 2", usd(low.closing) === 12807 && low.m === 2, [usd(low.closing), low.m]);
  ok("minimum funding $32,193 = $30,000 + $2,193 the early months use", usd(b.requiredFunding) === 32193 && usd(b.reserveNeeded) === 2193);
  ok("raised − minimum = the lowest cash ($12,807): the same headroom, two ways", Math.abs((b.fundingRaised - b.requiredFunding) - low.closing) <= 1);
  ok("to end the worst month with the full reserve: $32,193 + $10,000 = $42,193", usd(b.requiredFunding + b.reservePlanned) === 42193);
  ok("the low point sits $2,807 above the reserve — the reserve is never touched", C.reserveStatus(low.closing, b.reservePlanned).word === "$2,807 above the $10,000 reserve", C.reserveStatus(low.closing, b.reservePlanned));
  ok("cash after three years $143,714, after investor payments", usd(rows[36].closing) === 143714);
  ok("paid to the investor $43,058; $16,942 still owed", usd(rows.reduce((n, r) => n + r.toInvestor, 0)) === 43058 && usd(f.inv.stillOwed) === 16942);
  ok("payback month 11 before the investor's share, 14 after — the same months that pay the investor", b.paybackMonth === 11 && b.paybackAfterMonth === 14);
  ok("every cross-check Diligence shows agrees", C.checksOf(f).length === 6 && C.checksOf(f).every((x) => x.agrees), C.checksOf(f).filter((x) => !x.agrees));
}

// ── 2 · the schedule ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  ok("37 rows: opening day and months 1–36", rows.length === 37 && rows[0].m === 0 && rows[36].m === 36);
  ok("opening day: the raise in, the opening cost out as equipment and build-out", rows[0].opening === b.fundingRaised && rows[0].capex === b.startupSpend && rows[0].closing === b.fundingRaised - b.startupSpend);
  ok("every month: closing = opening + cash in − costs − investor (to the cent)", rows.slice(1).every((r) => Math.abs(r.opening + r.cashIn - r.costs - r.toInvestor - r.closing) <= 1));
  ok("costs are every operating cash cost — goods, card fees, staff, rent, other, marketing", rows.slice(1).every((r, k) => { const x = b.months[k]; return Math.abs(r.costs - (x.cogs + x.fees + x.labor + x.rent + x.opex + x.marketing)) <= 1; }));
  ok("the running cash drifts by cents only (the engine rounds each month): under $1 over 36 months", Math.abs(rows[36].closing - rows[0].closing - b.months.reduce((n, x) => n + x.net, 0)) < 100);
  ok("…and each month opens where the one before closed", rows.slice(1).every((r, k) => Math.abs(r.opening - rows[k].closing) <= 1));
  ok("no equipment after opening day (the plan has none)", rows.slice(1).every((r) => r.capex === 0));
  ok("the reserve is said apart from zero: into the reserve, and below zero, are different words", /into the \$10,000 reserve/.test(C.reserveStatus(500000, 1000000).word) && /below zero/.test(C.reserveStatus(-1, 1000000).word));
}

// ── 3 · the headline follows the case shown ──────────────────────────────────────────────────────────────────────────
{
  ok("base: the low point and its month", H.cashHeadline(b) === "In the base case, cash bottoms out at $12,807 in month 2.", H.cashHeadline(b));
  const lean = M.project(M.toInputs({ ...world.base, ordersPerDay: 60 }), structure);
  const lr = C.monthRows(lean), ll = lr.reduce((a, r) => (r.closing < a.closing ? r : a), lr[0]);
  const h = H.cashHeadline(lean, "conservative case");
  ok("another case: its own low point and month, worked out — not the base's", h.includes("conservative case") && (ll.closing < 0 ? h.includes(`month ${ll.m}`) : h.includes(`$${usd(ll.closing).toLocaleString("en-US")}`)) && h !== H.cashHeadline(b), h);
  ok("the Explore headline is the picked case's", /cashHeadline\(f\.models\[pick\], `\$\{SCENARIO_WORD\[pick\]\.toLowerCase\(\)\} case`\)/.test(read("components/vision/CaseSlide.tsx")));
}

// ── 4 · the lifecycle and the stages ─────────────────────────────────────────────────────────────────────────────────
{
  const i = M.toInputs(world.base), m = M.project(i, structure), NOW = Date.parse("2026-10-28T12:00:00Z");
  const sc = (ctx) => S.score(i, m, [], { conservative: null, now: NOW, ...ctx });
  const key = "no_downside", note = S.needNoteFor(key);
  ok("open: nothing started", sc({}).blockers.find((x) => x.key === key).status === "open");
  ok("in remediation: a need tagged for it", sc({ needList: [{ label: "Create the downside case", owner: "Ryan", due_on: "2026-11-15", done_on: null, note }] }).blockers.find((x) => x.key === key).status === "in_remediation");
  const pend = sc({ needList: [{ label: "Create the downside case", owner: "Ryan", due_on: null, done_on: "2026-11-02", note }] }).blockers.find((x) => x.key === key);
  ok("pending verification: the need is done but the cause is still true — still listed", pend.status === "pending_verification" && pend.need.owner === "Ryan");
  const acc = sc({ acknowledged: [{ key, note: "Conservative case runs next week", reviewBy: "2026-11-30" }] });
  ok("risk accepted: reason + review date; still listed, not counted as open", acc.blockers.find((x) => x.key === key).status === "risk_accepted" && acc.blockers.some((x) => x.key === key));
  ok("…lapses after its review date", sc({ acknowledged: [{ key, note: "x", reviewBy: "2026-10-01" }] }).blockers.find((x) => x.key === key).status === "acceptance_lapsed");
  ok("…and without a review date it isn't an acceptance at all", sc({ acknowledged: [{ key, note: "no date" }] }).blockers.find((x) => x.key === key).status === "open");
  ok("every blocker carries what closes it and who checks it", sc({}).blockers.every((x) => x.remedy.acceptance.length > 10 && x.remedy.verifier.length > 3 && x.remedy.action.length > 3));
  const all = { reviewBy: "2026-12-31", note: "Disclosed to investors" };
  const allAcc = sc({ acknowledged: sc({}).blockers.map((x) => ({ key: x.key, ...all })) });
  ok("stage: every blocker accepted → investor discussion, limitations disclosed — never complete", allAcc.readiness === "discussion" && allAcc.blockers.length === 3);
  ok("stage: one not accepted → internal review", sc({}).readiness === "internal");
  ok("stage: none at all → diligence complete", (() => { const c2 = M.toInputs({ ...world.base, uses: world.base.uses.filter((u) => u.unitCents != null) }); const m2 = M.project(c2, structure);
    return S.score(c2, m2, [{ topic: "demand", status: "accepted", bearing: "for", retrieved_at: "2026-10-20T00:00:00Z" }], { conservative: m2, now: NOW }).readiness === "complete"; })());
  ok("stage: a weakness the numbers show → not ready, whatever is accepted", (() => { const w = M.toInputs({ ...world.base, avgOrderCents: 200 }); return S.score(w, M.project(w, structure), [], { conservative: null, now: NOW }).readiness === "not_ready"; })());
  ok("no score threshold decides the stage", !/total < 70|evidence\.score \?\? 0\) < 50/.test(read("lib/visionScore.ts")));
  ok("the method is versioned and its history kept", S.SCORE_METHOD.version === "2026-10-28.1" && S.SCORE_METHOD.changes.length >= 2 && sc({}).method === S.SCORE_METHOD.version);
  const panel = read("components/vision/MoneyPanel.tsx");
  ok("remediation starts as one of the plan's needs, tagged to the blocker — no second task list", /from\("vision_plan_needs"\)\.insert\(\{ plan_id: plan\.id, label: REMEDY\[key\]\.action, kind: NEED_FOR\[key\], note: needNoteFor\(key\)/.test(panel));
  ok("the actions go where the remedy is done", /id="vz-research"/.test(panel) && /id="vz-derive"/.test(panel) && /id="vz-lines"/.test(panel));
  ok("the plan's needs reach the score", /needList: mine\.map\(\(n\) => \(\{ label: n\.label, owner: n\.owner, due_on: n\.due_on, done_on: n\.done_on, note: n\.note \}\)\)/.test(read("components/vision/Plans.tsx")));
  ok("no vague labels left on the owner's money: 'The score', 'Funding required', 'Business ROI' are gone from the comparison", !/"Funding required"|>The score<|"Business ROI"/.test(panel));
}

// ── 5 · the screens ──────────────────────────────────────────────────────────────────────────────────────────────────
{
  const slide = read("components/vision/CaseSlide.tsx"), pres = read("components/vision/Present.tsx"), css = read("components/vision/vision.css");
  ok("Pitch: one picture of cash and its facts — no comparison table", /mode === "pitch" && b\.ok && show\("cash"\)/.test(slide) && !/aria-label="The three scenarios"/.test(slide));
  ok("Explore: the levers, the cases, the swings", /<Explore c=\{c\} room=\{room\} base=\{t\} \/><Scenarios f=\{f\} \/><Sensitivity c=\{c\} room=\{room\} \/>/.test(slide));
  ok("…a case the plan lacks says 'Not modeled' and nothing else", /<b>Not modeled<\/b>/.test(slide));
  const secs = [...slide.matchAll(/sec\("(\w+)", "(\d) · /g)].map((m) => m[2]);
  ok("Diligence: eight sections, in order, each opened on demand", secs.join() === "1,2,3,4,5,6,7,8" && /<details className="vp-sec"/.test(slide), secs);
  ok("use of funds flags the unpriced line and the unassigned money, and doesn't assume the raise is enough", /not yet priced/.test(slide) && /not yet assigned to a use/.test(slide) && /Whether the raise is enough is the plan&apos;s to show, not assumed here\./.test(slide));
  ok("the return says what it is: an IRR, an effective annual rate, not a promise, not ownership", /internal rate of return \(IRR\)/.test(slide) && /an effective annual rate/.test(slide) && /no ownership of the business/.test(slide));
  ok("a month opens on a tap, or with the month buttons", /onPick=\{setAt\}/.test(slide) && /aria-label="The month before"/.test(slide) && /aria-label="The month after"/.test(slide) && /onPick\?\.\(v\)/.test(read("components/vision/MoneyCharts.tsx")));
  ok("…showing in, costs, equipment, investor, closing and the reserve", ["Cash at the start", "Cash in (sales)", "Operating costs out", "Equipment and build-out", "Paid to the investor", "Cash at the end", "Against the reserve"].every((w) => slide.includes(w)));
  ok("every month: a table where it fits, a list on a phone — never both, never sideways", /@media \(max-width:759px\)\{\.vp-months-table\{display:none\}\}/.test(css) && /@media \(min-width:760px\)\{ol\.vp-months-list\{display:none\}\}/.test(css));
  ok("a tap on what's being read never turns the slide", /details, \.vp-drill, \.vp-explore, \.vz-chart, \.vz-cmp-wrap, \.vp-month, \.vp-scn/.test(pres));
  ok("the tap hint shows once, on the first slide", /\{at === 0 && <p className="vp-tap">/.test(pres));
  ok("the investor's figure no longer wraps on a phone: the rate stands alone, 'a year (IRR)' beneath it", /`\$\{f\.irrPct\.toFixed\(1\)\}%`, f\.irrPct == null \? investorNote\(c, f\) : `a year \(IRR\)/.test(slide));
}

console.log(`IP1.4 — CASH, DILIGENCE, READINESS BY POLICY: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
