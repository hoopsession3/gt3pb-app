// S1.1c — FINDINGS GROUPED, UNKNOWNS COUNTED (2026-10-26 — the spatial audit: "eliminate excessive repeated overlays…
// grouped issue summaries"; finding H1: a score that leaves unjudged parts out of its total).
//
//   1 · Grouping by hand: errors one by one; touching warnings as one finding with every id; separate clusters apart.
//   2 · The plan readiness score: an unjudged assessment counts as zero, and the coverage says how much is judged.
//   3 · The wiring: only errors drawn by default, solid; a chosen finding highlights its whole group.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const V = loadTs("lib/vision.ts"), S = loadTs("lib/visionScore.ts"), M = loadTs("lib/visionMoney.ts");

// ── 1 · grouping ──────────────────────────────────────────────────────────────────────────────────────────────────
{
  const t = (id, x, y) => ({ id, kind: "two_top", label: null, x_in: x, y_in: y, rot: 0, w_in: 24, d_in: 24, h_in: 30, why: null, pillars: [], sort: 0 });
  // A row of five tables 36 in apart centre to centre (12 in between), another pair far away, and two overlapping.
  const room = { width_in: 600, depth_in: 600, items: [t("a", 60, 60), t("b", 96, 60), t("c", 132, 60), t("d", 168, 60), t("e", 204, 60), t("f", 400, 400), t("g", 436, 400), t("h", 60, 300), t("i", 70, 300)] };
  const raw = V.issues(room), grouped = V.groupIssues(raw);
  const warns = grouped.filter((x) => x.level === "warn"), errors = grouped.filter((x) => x.level === "error");
  ok("raw: one warning per tight pair (the noise)", raw.filter((x) => x.level === "warn").length >= 5, raw.length);
  ok("grouped: the row of five is one finding naming all five", warns.some((w) => ["a", "b", "c", "d", "e"].every((id) => w.ids.includes(id)) && /5 things closer than 36 in/.test(w.words)), warns);
  ok("…the pair far away is its own finding", warns.some((w) => w.ids.length === 2 && w.ids.includes("f") && w.ids.includes("g")), warns);
  ok("the overlap stays an error, on its own", errors.length === 1 && errors[0].ids.includes("h") && errors[0].ids.includes("i"), errors);
  ok("nothing is lost: every id flagged before is in some finding after", raw.flatMap((x) => x.ids).every((id) => grouped.some((g) => g.ids.includes(id))));
  ok("a room with nothing wrong stays empty", V.groupIssues([]).length === 0);
}

// ── 2 · the readiness score ───────────────────────────────────────────────────────────────────────────────────────
{
  const NOW = Date.parse("2026-10-25T12:00:00Z"), FRESH = "2026-10-20T00:00:00Z";
  const i = M.toInputs({ uses: [{ id: "a", label: "Bar", category: "equipment", qty: 1, unitCents: 2000000, confidence: "quoted" }, { id: "b", label: "Build", category: "buildout", qty: 1, unitCents: 2000000, confidence: "guess" }], staffHoursPerDay: 12, hoursOpenPerDay: 10 });
  const m = { ok: true, startupSpend: 4000000, paybackMonth: 21, breakEvenMonth: 1, roiBusiness: 1, months: [{ revenue: 100 }], salesLost: 0, capPerMonth: null, traffic: null, requiredFunding: 1, fundingRaised: 1 };
  const ctx = { needs: { done: 3, all: 6 }, waitingOn: [], conservative: { ok: true, breakEvenMonth: 9 }, now: NOW };
  const all = S.score(i, m, [{ topic: "demand", status: "accepted", bearing: "for", retrieved_at: FRESH }, { topic: "demand", status: "accepted", bearing: "for", retrieved_at: FRESH }, { topic: "competition", status: "accepted", bearing: "against", retrieved_at: FRESH }, { topic: "costs", status: "proposed", retrieved_at: FRESH }], ctx);
  const none = S.score(i, m, [], ctx);
  // IP1.3 supersedes S1.1c's zero (Ryan, 2026-10-27: "without conflating missing evidence with demonstrated business
  // weakness"): the score is over what's judged, coverage is the weight that is, and the blockers hold the gate.
  ok("all four judged: the total as before (73); coverage counts criteria — the channels and the room aren't judged (86%)", all.total === 73 && all.coverage === 86, [all.total, all.coverage]);
  const unjudged = Object.keys(none.assessments).filter((k) => none.assessments[k].score == null);
  ok("no research: the market isn't judged, and it isn't counted as a zero", unjudged.includes("market") && none.total != null && none.total > 0, { total: none.total, unjudged });
  ok("…coverage says the market's weight is missing", none.coverage <= 100 - S.ASSESS_WEIGHT.market, none.coverage);
  ok("…and unknowns can't make a plan ready: unvalidated demand is a critical blocker", none.readiness !== "ready" && none.blockers.some((b) => b.key === "demand_unvalidated" && !b.acknowledged), [none.readiness, none.blockers.map((b) => b.key)]);
  ok("the words name the score, the coverage and the blockers", /on what can be judged/.test(all.says) && /evidence for \d+% of the weight/.test(all.says) && /critical blocker/.test(none.says));
}

// ── 3 · wiring ────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const des = read("components/vision/StoreDesigner.tsx"), plan = read("components/vision/PlanView.tsx"), css = read("lib/../components/vision/studio.css");
  ok("only errors are drawn on the plan by default", /new Set\(found\.filter\(\(f\) => f\.level === "error"\)/.test(des));
  ok("errors are a solid red outline (no longer dashed like a warning)", /\.it\.bad rect\.body\{stroke:#b82420;stroke-width:3\}/.test(css));
  ok("choosing a finding highlights its whole group, in gold", /const look = \(f: Finding\) => \{ pick\(f\.ids\[0\]\); setFocus\(f\.ids\);/.test(des) && /focus\.includes\(it\.id\) \? " focus"/.test(plan) && /\.it\.focus rect\.body\{stroke:#c8902f/.test(css));
  ok("picking something else clears the highlight", /setFocus\(\[\]\); setFocusPath\(null\); \};/.test(des));
  ok("on a phone the findings count is the Evaluate label, not a chip over the dock (upright full screen: the findings mark in the dock row, IMS3)", /full && size !== "phone" && !upright && found\.length > 0 && !item/.test(des));
  ok("the findings come from the shared spatial engine (which groups them), as the room's operating model", /runSpatial\(settled, PROFILES\[model\]\)/.test(des) && /groupIssues\(issues\(l\)\)/.test(read("lib/spatial/evaluate.ts")));
  ok("a chosen route finding draws the way it measured", /focusPath && focusPath\.length > 1 && <polyline className="route"/.test(plan));
}

console.log(`S1.1c — FINDINGS GROUPED, UNKNOWNS COUNTED: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
