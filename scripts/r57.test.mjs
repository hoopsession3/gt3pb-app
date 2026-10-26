// R57 — THE INVESTOR CASE (2026-10-25 — phase E of the investor-ready vision: "investor presentation with expiring share
// links"; the traceability audit: the presentation must read the same engine as the Money screen).
//
//   1 · A case is the approved baseline, read whole, through the one engine — the slide's figures are the Money
//       screen's figures for the same numbers, to the cent.
//   2 · Its research: accepted findings only reach it, each with an https source.
//   3 · The wiring: a case slide per plan after its ways in; on a link only what an owner chose (0451), nothing by
//       default; adding the money asks first; the presenter in the room reads the owners' cases; labelled as projections.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 600)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const C = loadTs("lib/visionCase.ts"), M = loadTs("lib/visionMoney.ts"), S = loadTs("lib/visionScore.ts");

const base = { uses: [{ id: "bar", label: "Bar", category: "equipment", qty: 1, unitCents: 3000000, confidence: "quoted" }, { id: "r", label: "Reserve", category: "reserve", qty: 1, unitCents: 1000000 }],
  ordersPerDay: 90, avgOrderCents: 850, daysOpenPerMonth: 26, hoursOpenPerDay: 10, rampMonths: 6, rampStartPct: 50, cogsPct: 30, cardFeePct: 3,
  staffHoursPerDay: 12, wageCents: 1600, laborBurdenPct: 12, rentPctOfSales: 10, otherOpexCents: 60000, marketingCents: 40000, ownerCashCents: 500000 };
const structure = { kind: "rev_share", amountCents: 4000000, sharePct: 6, capMultiple: 1.5 };
const stored = { baseline: { scenarios: { conservative: M.derive(M.toInputs(base), -20, 10), base, upside: M.derive(M.toInputs(base), 20, -10) }, structure }, approved_at: "2026-10-25T12:00:00Z" };
const research = [{ topic: "demand", claim: "The gym has 2,400 members.", figure: "2,400", source_url: "https://gym.example/members", retrieved_at: "2026-10-20T00:00:00Z" },
  { topic: "competition", claim: "No café within half a mile.", source_url: "http://not-https.example", retrieved_at: "2026-10-20T00:00:00Z" }];

// ── 1 · the same engine ─────────────────────────────────────────────────────────────────────────────────────────────
{
  const c = C.toCase(stored, research);
  ok("a case: the three scenarios read whole, the structure, when it was approved", c && c.scenarios.base.ordersPerDay === 90 && c.scenarios.base.uses[0].unitCents === 3000000 && c.structure.kind === "rev_share" && c.approvedAt === "2026-10-25T12:00:00Z");
  ok("no baseline, no case", C.toCase({ baseline: null }) === null && C.toCase(undefined) === null);
  const f = C.figuresOf(c);
  const screen = M.project(M.toInputs(base), structure);
  ok("the slide's figures are the Money screen's: startup, funding required, payback, ROI", f.models.base.startupSpend === screen.startupSpend && f.models.base.requiredFunding === screen.requiredFunding && f.models.base.paybackMonth === screen.paybackMonth && f.models.base.roiBusiness === screen.roiBusiness);
  ok("…the startup is the spending, the reserve held apart: $30,000 + $10,000", f.base.startupSpend.display === "$30,000" && f.models.base.reservePlanned === 1000000);
  ok("…the traced displays are the engine's own", f.base.requiredFunding.display === M.trace(M.toInputs(base), structure, screen).requiredFunding.display);
  ok("…the investor's rate under the structure as defined", f.irrPct === M.investor(screen, structure).irrPct);
  ok("…each scenario scored on the same rubric, with the case's research counted", f.scores.base.total === S.score(M.toInputs(base), screen, [{ topic: "demand", status: "accepted", bearing: null, retrieved_at: "2026-10-20T00:00:00Z" }], { conservative: f.models.conservative }).total);
  ok("the case doesn't change when the working numbers do — it is the baseline", JSON.stringify(C.toCase(stored, research).scenarios.base) === JSON.stringify(c.scenarios.base));
}

// ── 2 · research ────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const c = C.toCase(stored, research);
  ok("only https sources reach the case", c.research.length === 1 && c.research[0].source_url === "https://gym.example/members");
}

// ── 3 · the wiring ──────────────────────────────────────────────────────────────────────────────────────────────────
{
  const sql = read("supabase/migrations/0451_the_investor_case.sql"), present = read("components/vision/Present.tsx"), slide = read("components/vision/CaseSlide.tsx"),
    shares = read("components/vision/Shares.tsx"), app = read("components/vision/VisionApp.tsx"), rd = read("lib/visionRead.ts");
  ok("0451: per link, per plan, nothing by default", /money_plans uuid\[\] not null default '\{\}'/.test(sql) && /research_plans uuid\[\] not null default '\{\}'/.test(sql));
  ok("…only an owner chooses (PT403 for anyone else)", /not public\.is_owner\(\)/.test(sql) && /errcode = 'PT403'/.test(sql));
  ok("…the link reads the baseline only — never the working numbers", /'baseline', m\.baseline/.test(sql) && !/'scenarios', m\.scenarios/.test(sql) && /m\.baseline is not null/.test(sql));
  ok("…and accepted research only", /r\.status = 'accepted'/.test(sql));
  ok("…vision_shared keeps its expiry and its shareable plans", /expires_at is null or expires_at > now\(\)/.test(sql) && /v\.shareable/.test(sql));
  ok("the presenter: a case slide per plan with a case, after its ways in", /out\.push\(\{ kind: "case", id: pl\.id \}\)/.test(present) && /vision\.cases\?\.\[pl\.id\]/.test(present));
  ok("…loaded only when reached (the engine and the chart are their own chunk)", /const CaseSlide = dynamic\(\(\) => import\("\.\/CaseSlide"\)/.test(present));
  ok("…the slide reads the one engine and says what it is", /figuresOf\(c, room\)/.test(slide) && /not a forecast of what will happen, not an offer of securities and not financial advice/.test(slide) && /not a probability/.test(slide));
  ok("the owner chooses per link; adding the money asks first", /isOwner && canCase && <CaseChooser/.test(shares) && /await confirm\(\{ title: `Show \$\{added\.join/.test(shares));
  ok("…a plan without an approved baseline can't be given", /disabled=\{!has\}/.test(shares));
  ok("in the room, the owners and admins present the cases", /readCases\(supabase\)/.test(app) && /withCases=\{canEdit\}/.test(app));
  ok("before 0451 the link shows no case and the chooser hides", /arrives-with: 0451/.test(shares) && /setCanCase\(false\)/.test(shares) && /toCase\(r\.money/.test(rd));
}

console.log(`R57 — THE INVESTOR CASE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
