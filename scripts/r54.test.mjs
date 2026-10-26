// R54 — THE MONEY, PLAN BY PLAN (2026-10-25 — phase B of the investor-ready vision: "what it costs, how it generates
// revenue, when it can become profitable… Conservative, Base, Upside… investor payouts based on an explicitly defined
// investment structure, not assumed ownership or distributions… flag unrealistic assumptions and financial inconsistencies").
//
//   1 · lib/visionMoney's arithmetic, by hand: a month's sales and costs, the ramp, growth, the startup, cash on hand,
//       break-even (from which month it stays positive), payback, the low point, the years, the gross margin.
//   2 · Nothing guessed: an input not set is named, and the model doesn't run on it.
//   3 · The investor, by the structure as defined: a loan's payment and its rate (the APR, compounded), a revenue share
//       to its cap (past month 36 at month 36's sales — said), equity's payout (none set: said), a SAFE (no cash; at the
//       cap, its share). An IRR is found or is null, never invented.
//   4 · What moves it most; the flags are arithmetic on Ryan's numbers, never benchmarks.
//   5 · GT3's own sales as evidence: paid, not canceled, by channel, repeat guests.
//   6 · The wiring: a plan's case (the plan, then Money), the money for owners only, before 0449 nothing fails.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const M = loadTs("lib/visionMoney.ts");

// A plain plan: 100 orders a day at $8, 30 days, 30% goods, 2% fees, 20 staff hours at $15 (+10%), $3,000 rent, $1,000
// other, $500 marketing, $60,000 to open. No ramp, no growth — every month the same, worked by hand below.
const plain = M.toInputs({ uses: [{ id: "bar", label: "Bar", category: "equipment", qty: 1, unitCents: 6000000 }], ordersPerDay: 100, avgOrderCents: 800, daysOpenPerMonth: 30, hoursOpenPerDay: 12,
  cogsPct: 30, cardFeePct: 2, staffHoursPerDay: 20, wageCents: 1500, laborBurdenPct: 10, rentCents: 300000, otherOpexCents: 100000, marketingCents: 50000 });

// ── 1 · the arithmetic ──────────────────────────────────────────────────────────────────────────────────────────────
{
  const m = M.project(plain);
  const mo = m.months[0];
  // sales 100×30×$8 = $24,000; goods $7,200; fees $480; labor 20×30×$15×1.1 = $9,900; rent $3,000; other $1,000; marketing $500
  ok("a month by hand: $24,000 sales, $7,200 goods, $480 fees, $9,900 labor → $1,920 operating", mo.revenue === 2400000 && mo.cogs === 720000 && mo.fees === 48000 && mo.labor === 990000 && mo.operating === 192000, mo);
  ok("36 months, every one the same without ramp or growth", m.months.length === 36 && m.months.every((x) => x.operating === 192000));
  ok("startup spending $60,000; cash on hand starts below zero by it", m.startupSpend === 6000000 && m.months[0].cumulative === -6000000 + 192000);
  ok("break-even from month 1 (it never loses money)", m.breakEvenMonth === 1);
  ok("pays back its startup in month 32 ($60,000 ÷ $1,920 = 31.25)", m.paybackMonth === 32, m.paybackMonth);
  ok("funding required is the startup alone when no month loses money: $60,000", m.requiredFunding === 6000000 && m.reserveNeeded === 0, m.requiredFunding);
  ok("years: $288,000 sales each; gross margin 70% — card fees are an operating expense, below it", m.years.every((y) => y.revenue === 28800000) && near(m.grossMarginPct, 70, 0.01), m.grossMarginPct);
  ok("business ROI over 36 months: (36 × $1,920 − $60,000) ÷ $60,000", near(m.roiBusiness, (36 * 192000 - 6000000) / 6000000, 1e-9));

  const ramp = M.project({ ...plain, rampMonths: 4, rampStartPct: 50, growthPctPerYear: 10 });
  ok("the ramp: month 1 at 50%, then 62.5%, 75%, 87.5%, full from month 5", [0, 1, 2, 3, 4].map((k) => ramp.months[k].orders).join() === "1500,1875,2250,2625,3000", ramp.months.slice(0, 5).map((x) => x.orders));
  ok("growth: +10% in year 2, +21% in year 3", ramp.months[12].orders === 3300 && ramp.months[24].orders === 3630, [ramp.months[12].orders, ramp.months[24].orders]);
  const loses = M.project({ ...plain, ordersPerDay: 40 });
  ok("losing money every month: no break-even, no payback, and the low point grows past the startup", loses.breakEvenMonth === null && loses.paybackMonth === null && loses.requiredFunding > 6000000 && loses.reserveNeeded > 0);
  const late = M.project({ ...plain, rampMonths: 10, rampStartPct: 20 });
  ok("a slow start: break-even is the first month it stays positive, not the first good month", late.breakEvenMonth > 1 && late.months.slice(late.breakEvenMonth - 1).every((x) => x.operating >= 0) && late.months[late.breakEvenMonth - 2].operating < 0);
}

// ── 2 · nothing guessed ─────────────────────────────────────────────────────────────────────────────────────────────
{
  const m = M.project(M.BLANK);
  ok("a blank plan names what's missing, and doesn't run", !m.ok && m.months.length === 0 && m.missing.length === 6 && m.missing.includes("orders a day") && m.missing.includes("the wage"), m.missing);
  ok("BLANK sets no demand, price, cost of goods, staff or wage", ["ordersPerDay", "avgOrderCents", "daysOpenPerMonth", "cogsPct", "staffHoursPerDay", "wageCents"].every((k) => M.BLANK[k] === null));
  ok("the flags of a blank plan: set what's missing", M.flags(M.BLANK, m, { kind: "none" })[0].words.startsWith("Set "));
  const src = read("lib/visionMoney.ts");
  ok("no benchmark lives in the engine (no 'industry', no 'typical', no 'average for')", !/industry (average|standard|benchmark)|typical(ly)? (coffee|caf)|average for /i.test(src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")));
}

// ── 3 · the investor ────────────────────────────────────────────────────────────────────────────────────────────────
{
  ok("a loan's payment, amortized: $100,000 at 12% over 12 months is $8,884.88", near(M.loanPayment(10000000, 12, 12), 888488, 1));
  ok("…at 0% it's the principal over the months", M.loanPayment(120000, 0, 12) === 10000);
  ok("an IRR found: 12 payments of 10 on 100 is about 41% a year", near(M.irr([-100, ...Array(12).fill(10)]), 0.413, 0.002));
  ok("…and none where there is none (no money back)", M.irr([-100, 0, 0]) === null && M.irr([100, 10]) === null);
  const loan = { kind: "loan", amountCents: 6000000, aprPct: 9, termMonths: 60 };
  const lv = M.investor(M.project(plain, loan), loan);
  ok("a 5-year loan rates at its APR compounded (9% → 9.38%), not cut short at month 36", near(lv.irrPct, 9.38, 0.02), lv.irrPct);
  ok("…what's still owed after 36 months is said", lv.stillOwed > 0 && lv.says[0].includes("60 monthly payments"));
  const rs = { kind: "rev_share", amountCents: 6000000, sharePct: 5, capMultiple: 1.5 };
  const mrs = M.project(plain, rs), rv = M.investor(mrs, rs);
  ok("a revenue share pays its % of sales each month ($1,200 of $24,000)", mrs.months[0].toInvestor === 120000);
  ok("…until the cap; past month 36 the rate assumes month 36's sales — and says so", rv.says.some((x) => x.includes("Past month 36")) && rv.stillOwed === 9000000 - 36 * 120000, rv);
  const capped = M.investor(M.project(plain, { ...rs, sharePct: 50 }), { ...rs, sharePct: 50 });
  ok("…and stops at the cap ($90,000)", capped.returned === 9000000 && capped.stillOwed === 0, capped.returned);
  const eq = { kind: "equity", amountCents: 6000000, ownershipPct: 20, payoutPct: 0 };
  const ev = M.investor(M.project(plain, eq), eq);
  ok("equity with no payout set: no cash in 36 months, and it says the return depends on terms you'd set", ev.returned === 0 && ev.says.some((x) => /No payout is set/.test(x)));
  const eq2 = { ...eq, payoutPct: 50 };
  ok("equity with a payout: ownership × payout × the month's profit ($1,920 × 20% × 50% = $192)", M.project(plain, eq2).months[0].toInvestor === 19200);
  const safe = { kind: "safe", amountCents: 5000000, capCents: 100000000, discountPct: 20 };
  const sv = M.investor(M.project(plain, safe), safe);
  ok("a SAFE: no cash, no rate — at the cap, about 5% of the company, said", sv.returned === 0 && sv.irrPct === null && sv.multiple === null && sv.says.some((x) => x.includes("5.0%")));
  ok("no structure: the business's returns stand alone", M.investor(M.project(plain), { kind: "none" }).says[0].includes("No investment structure"));
}

// ── 4 · what moves it, and the flags ────────────────────────────────────────────────────────────────────────────────
{
  const sw = M.sensitivity(plain, 20);
  ok("sensitivity: largest swing first; orders and the average order move it equally here", sw[0].span >= sw[sw.length - 1].span && sw.slice(0, 2).map((x) => x.driver).sort().join() === "Average order,Orders a day", sw.map((x) => x.driver));
  ok("…more orders help, more rent hurts", sw.find((x) => x.driver === "Orders a day").up > 0 && sw.find((x) => x.driver === "Rent").up < 0);
  const m = M.project(plain);
  ok("nobody there: open 12 hours on 10 staff hours", M.flags({ ...plain, staffHoursPerDay: 10 }, M.project({ ...plain, staffHoursPerDay: 10 }), { kind: "none" }).some((f) => f.level === "stop" && /nobody's there for 2/.test(f.words)));
  ok("goods and fees take every dollar", M.flags({ ...plain, cogsPct: 98 }, M.project({ ...plain, cogsPct: 98 }), { kind: "none" }).some((f) => /take every dollar/.test(f.words)));
  const short = { kind: "loan", amountCents: 3000000, aprPct: 0, termMonths: 60 };
  ok("short: raising $30,000 against a $60,000 start", M.flags(plain, M.project(plain, short), short).some((f) => f.level === "stop" && f.words.startsWith("Short by")));
  ok("no uses of funds: asked what the money buys", M.flags({ ...plain, uses: [] }, M.project({ ...plain, uses: [] }), { kind: "none" }).some((f) => /what does the money buy/.test(f.words)));
  ok("scenarios out of order are named", M.flags(plain, m, { kind: "none" }, 0, { conservative: M.project({ ...plain, ordersPerDay: 200 }), upside: M.project({ ...plain, ordersPerDay: 50 }) }).some((f) => /out of order/.test(f.words)));
  const d = M.derive(plain, -20, 10);
  ok("Conservative from Base: demand down 20%, costs up 10% — Ryan's numbers, moved by his percentages", d.ordersPerDay === 80 && d.cogsPct === 33 && d.uses[0].unitCents === 6600000 && d.rentCents === 330000);
  ok("money said one way: $12,400, −$3,100, $1.2M", M.dollars(1240000) === "$12,400" && M.dollars(-310000) === "−$3,100" && M.dollars(120000000) === "$1.2M");
}

// ── 5 · our own sales ───────────────────────────────────────────────────────────────────────────────────────────────
{
  const L = (channel, day, cents, extra = {}) => ({ channel, day, totalCents: cents, isPaid: true, canceled: false, customerId: null, ...extra });
  const o = M.observed([L("cup", "2026-10-01", 800, { customerId: "a" }), L("cup", "2026-10-01", 1000, { customerId: "a" }), L("cup", "2026-10-02", 900, { customerId: "b" }),
    L("delivery", "2026-10-03", 4100), L("cup", "2026-10-02", 700, { canceled: true }), L("cup", "2026-10-02", 700, { isPaid: false })]);
  const all = o.find((x) => x.channel === "all"), cup = o.find((x) => x.channel === "cup");
  ok("paid, not canceled: 4 orders on 3 days", all.orders === 4 && all.activeDays === 3 && all.from === "2026-10-01" && all.through === "2026-10-03", all);
  ok("the truck's cups: average $9, 1.5 a day they sold, half the guests came back", cup.avgOrderCents === 900 && cup.ordersPerActiveDay === 1.5 && cup.repeatPct === 50, cup);
  ok("no orders: nothing to average", M.observed([]).find((x) => x.channel === "all").avgOrderCents === null);
}

// ── 6 · the wiring ──────────────────────────────────────────────────────────────────────────────────────────────────
{
  const panel = read("components/vision/MoneyPanel.tsx"), plans = read("components/vision/Plans.tsx"), sql = read("supabase/migrations/0449_the_money_plan_by_plan.sql");
  ok("a plan opens its case: the plan, then Money", /function PlanCase/.test(plans) && /key: "money", label: "Money"/.test(plans) && /setCaseId\(p\.id\)/.test(plans));
  ok("the money is the owners': the crew are told so, and 0449's only policy is admin", /if \(!canEdit\) return/.test(panel) && /"vision money admin"/.test(sql) && !/vision staff read/.test(sql));
  ok("before 0449 the panel says the money arrives with it — nothing fails", /arrives-with: 0449/.test(panel) && /"not-yet"/.test(panel));
  ok("our sales are offered, never filled in silently (a button to use the average order)", /Use \{dollars\(o\.avgOrderCents\)\} as the average order/.test(panel));
  ok("projections are labelled as projections — not a forecast, not advice", /not a forecast of what will happen, and not financial advice/.test(panel));
  ok("the structure carries the attorney and accountant line", /securities attorney and an accountant/.test(panel));
  ok("one axis: the cash chart draws one scale; the scenario hues are validated", /Cash on hand/.test(read("components/vision/MoneyCharts.tsx")) && /\.sc-cons\{--sc:#3987e5\}/.test(read("components/vision/vision.css")));
}

// ── 7 · traceable (the 2026-10-25 audit: "click any financial number… where did it come from, what makes it up, how was it
//        calculated, what happens if I change it, what else does it affect") — one engine, one dependency map ─────────
{
  // the map: every node it names exists, and it has no loop (a figure can't be made of itself)
  const nodes = new Set([...M.INPUT_KEYS, ...M.METRICS]);
  ok("the map names only real inputs and figures", M.METRICS.every((k) => M.DEPS[k].every((d) => nodes.has(d))));
  const loops = M.METRICS.filter((k) => { const seen = new Set(), st = [...M.DEPS[k]]; while (st.length) { const n = st.pop(); if (n === k) return true; if (seen.has(n) || M.INPUT_KEYS.includes(n)) continue; seen.add(n); st.push(...M.DEPS[n]); } return false; });
  ok("…and no figure is made of itself", loops.length === 0, loops);
  const loan = { kind: "loan", amountCents: 7000000, aprPct: 9, termMonths: 60 };
  const T = M.trace(plain, loan);
  ok("every figure is traced: a label, what it says, a formula, the plan's own numbers in it, a period", M.METRICS.every((k) => T[k] && T[k].label && T[k].says && T[k].formula && T[k].worked && T[k].period && T[k].key === k));
  ok("what a figure feeds is the map read backwards", M.METRICS.every((k) => T[k].feeds.every((f) => M.DEPS[f].includes(k))));
  ok("ROI goes back to what the money buys and every operating input — not the investor", ["uses", "demand", "cogsPct", "cardFeePct", "labor", "rent"].every((x) => M.upstreamInputs("roiBusiness").includes(x)) && !M.upstreamInputs("roiBusiness").includes("structure"));
  ok("…the ROI after the investor does go back to the structure", M.upstreamInputs("roiAfter").includes("structure"));
  ok("drill paths: revenue → orders → days → ramp → growth → transactions → average order → mix", T.revenue.path.map((s) => s.label).join("|").startsWith("Orders a day") && T.revenue.path.some((s) => /Product mix/.test(s.label)));
  ok("…gross margin → sales → goods → gross profit → margin; ROI → basis → flows → return → horizon → result", T.grossMargin.path.length === 4 && T.roiBusiness.path.map((s) => s.label).join() === "Investment basis,Cash flows,Return,Horizon,Result");
  ok("ROI says it's business-level, before financing and tax — not the investor's", /before financing and before tax/.test(T.roiBusiness.says) && /Not the investor's return/.test(T.roiBusiness.says));

  // the itemized startup: quantity × unit; the reserve held, not spent; an unpriced line listed, never given a number
  const it = M.toInputs({ ...plain, uses: [
    { id: "a", label: "Espresso-free bar", category: "equipment", qty: 2, unitCents: 1250000, source: "Vendor quote", on: "2026-10-20", confidence: "quoted" },
    { id: "b", label: "Build-out", category: "buildout", qty: 1, unitCents: 500000 },
    { id: "c", label: "Signage", category: "launch", qty: 1, unitCents: null },
    { id: "d", label: "Reserve", category: "reserve", qty: 1, unitCents: 1000000 }] });
  const im = M.project(it);
  ok("startup = Σ quantity × unit cost: 2 × $12,500 + $5,000 = $30,000", im.startupSpend === 3000000, im.startupSpend);
  ok("the $10,000 reserve is held, not spent — not in startup spending", im.reservePlanned === 1000000);
  ok("an unpriced line is counted as unpriced, in no total — and flagged", im.unpriced === 1 && M.flags(it, im, { kind: "none" }).some((f) => f.about === "startupSpend" && /priced/.test(f.words)));
  ok("the trace shows the sum, line by line", M.trace(it, { kind: "none" }).startupSpend.worked.startsWith("$25,000 + $5,000 = $30,000"), M.trace(it, { kind: "none" }).startupSpend.worked);
  const legacy = M.toLines([{ label: "Bar", kind: "equipment", cents: 3000000 }, { label: "Cushion", kind: "working_capital", cents: 1000000 }]);
  ok("R54's first saves read whole: one of each at its amount, 'working capital' now the reserve", legacy[0].qty === 1 && legacy[0].unitCents === 3000000 && legacy[1].category === "reserve" && M.project(M.toInputs({ ...plain, uses: legacy })).startupSpend === 3000000);

  // funding required counts what the investor is paid; card fees sit below gross margin
  const thin = M.toInputs({ ...plain, ordersPerDay: 70 });
  const free = M.project(thin), paying = M.project(thin, { kind: "loan", amountCents: 7000000, aprPct: 9, termMonths: 36 });
  ok("funding required = startup + the early months' need, investor payments counted", paying.requiredFunding === paying.startupSpend + paying.reserveNeeded && paying.reserveNeeded > free.reserveNeeded);
  const fee = M.project(M.toInputs({ ...plain, cardFeePct: 4 }));
  ok("card fees move operating expenses, not the gross margin", fee.grossMarginPct === M.project(plain).grossMarginPct && M.trace(M.toInputs({ ...plain, cardFeePct: 4 }), { kind: "none" }).operatingExpenses.value > T.operatingExpenses.value);
  ok("every flag points at a figure (or at none) on the map", M.flags(it, im, loan, 9000000).every((f) => f.about === null || M.METRICS.includes(f.about)));
  ok("the roadmap's ask reconciles against funding required", M.flags(plain, M.project(plain), { kind: "none" }, 9000000).some((f) => f.about === "requiredFunding" && /roadmap asks for \$90,000/.test(f.words)));

  // THE END-TO-END, as the audit's ten steps: open the startup, change an equipment line, watch everything that follows
  // move, see it against the baseline, go back, and the other scenarios untouched.
  const baseline = { scenarios: { conservative: M.derive(plain, -20, 10), base: plain, upside: M.derive(plain, 20, -10) }, structure: loan };
  const B = M.trace(baseline.scenarios.base, loan);
  ok("e2e 1 · the startup card opens to its lines", B.startupSpend.display === "$60,000" && B.startupSpend.worked.startsWith("$60,000"));
  const moved = { ...baseline.scenarios.base, uses: baseline.scenarios.base.uses.map((l) => (l.id === "bar" ? { ...l, qty: 2, unitCents: 3500000 } : l)) };
  const N = M.trace(moved, loan);
  ok("e2e 2 · two bars at $35,000 each: startup $70,000", N.startupSpend.value === 7000000);
  const because = M.changedInputs(baseline.scenarios.base, moved, loan, loan);
  ok("e2e 3 · the change is the uses of funds, and nothing else", because.join() === "uses", because);
  const ch = M.compare(B, N, because), keys = ch.map((c) => c.key);
  ok("e2e 4 · startup, funding required, the gap, payback and both ROIs move", ["startupSpend", "requiredFunding", "fundingGap", "payback", "roiBusiness", "roiAfter"].every((k) => keys.includes(k)), keys);
  ok("e2e 5 · …each because of the uses of funds, each with what it was", ch.every((c) => c.because.join() === "uses" && c.before !== c.after));
  ok("e2e 6 · sales, goods and margin don't move — they aren't made of it", !keys.includes("revenue") && !keys.includes("grossMargin") && !keys.includes("cogs"));
  ok("e2e 7 · what moved is exactly what the map says is downstream of it", keys.every((k) => M.downstream(["uses"]).has(k)));
  ok("e2e 8 · back to the baseline: nothing differs", M.compare(B, M.trace(baseline.scenarios.base, baseline.structure), M.changedInputs(baseline.scenarios.base, baseline.scenarios.base, loan, loan)).length === 0);
  const after = { ...baseline.scenarios, base: moved };
  ok("e2e 9 · scenario isolation: Conservative and Upside are as they were", JSON.stringify(after.conservative) === JSON.stringify(baseline.scenarios.conservative) && M.project(after.upside, loan).startupSpend === M.project(baseline.scenarios.upside, loan).startupSpend);
  ok("e2e 10 · the investor's figures follow the structure, not the bar: their rate doesn't move", N.investorReturn.display === B.investorReturn.display);

  // the screen: every KPI a button to its drill; approve and restore confirm first; only an owner approves
  const panel = read("components/vision/MoneyPanel.tsx"), page = read("app/vision/page.tsx");
  ok("each KPI is a button that opens its figure", /className=\{was != null \? "vz-kpi vz-kpi-btn moved" : "vz-kpi vz-kpi-btn"\}/.test(panel) && /onClick=\{\(\) => onOpen\(t\.key\)\}/.test(panel));
  ok("the drill shows the formula, the numbers, the path, the lines, made of, feeds, and what moved", ["How it&apos;s worked out", "With this plan&apos;s numbers", "vz-path", "The lines", "Made of", "Feeds", "Since {refWord}"].every((w) => panel.includes(w)));
  ok("approve, restore and remaking the scenarios each ask first (and, since R62, setting the roadmap's ask)", (panel.match(/await confirm\(/g) ?? []).length === 4 && /title: "Make these the approved baseline\?"/.test(panel) && /title: "Go back to the approved baseline\?"/.test(panel) && /title: "Replace Conservative and Upside\?"/.test(panel));
  ok("only an owner sees 'Make this the baseline' — and 0449 refuses anyone else", /\{isOwner && <button[^>]*>Make this the baseline/.test(panel.replace(/\n/g, " ")) || /isOwner && <button type="button" className="btn-sec btn-sm" onClick=\{\(\) => void approve\(\)\}/.test(panel));
  ok("…the page says who's an owner", /isOwner=\{roleOf\(profile\) === "owner"\}/.test(page));
  ok("the total of a line is shown, never typed", /= \$\{dollars\(tot\)\}/.test(panel) && !/label="Amount"/.test(panel));
}

console.log(`R54 — THE MONEY, PLAN BY PLAN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
