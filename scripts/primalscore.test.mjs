// THE PRIMAL SIGNIFICANCE SCORE — DRAFT METHOD 0.1, WORKED BY HAND (2026-10-26 — the scoring brief: "do not treat
// missing evidence as passing… do not normalize unknown criteria away… prevent mandatory failures from receiving
// certified status… do not publish an official score until the methodology is approved").
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const S = loadTs("lib/primalScore.ts");

const c = (id, pillar, extra = {}) => ({ id, pillar, code: id.toUpperCase(), title: id, mandatory: false, severity: "medium", ...extra });
const d = (id, outcome, extra = {}) => ({ criterion_id: id, outcome, verified: "independent", evidenced: true, confidence: "high", ...extra });
// Two criteria in each pillar.
const C = [c("s1", "stillness"), c("s2", "stillness"), c("l1", "light"), c("l2", "light"), c("f1", "fuel"), c("f2", "fuel"), c("m1", "movement"), c("m2", "movement")];

// ── by hand ───────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const all = S.primalScore(C, C.map((x) => d(x.id, "pass")), "brick_and_mortar", "1.0");
  ok("everything met, verified, evidenced: 100, verified, coverage 100%", all.overall === 100 && all.status === "verified" && all.coverage === 100, [all.overall, all.status, all.coverage]);
  // Stillness: one met, one with conditions → (1 + 0.5) / 2 = 75. Light: one met, one unknown → 50. Fuel and movement: 100.
  const mixed = S.primalScore(C, [d("s1", "pass"), d("s2", "conditional"), d("l1", "pass"), d("f1", "pass"), d("f2", "pass"), d("m1", "pass"), d("m2", "pass")], "brick_and_mortar");
  const p = Object.fromEntries(mixed.pillars.map((x) => [x.pillar, x.score]));
  ok("with conditions is half: stillness (1 + ½) ÷ 2 = 75", p.stillness === 75, p);
  ok("an unknown counts as zero, not as absent: light 1 ÷ 2 = 50 (not 100)", p.light === 50, p);
  ok("overall: (75 + 50 + 100 + 100) ÷ 4 = 81.3", mixed.overall === 81.3, mixed.overall);
  ok("an unknown makes it provisional, and coverage 7 of 8 = 88%", mixed.status === "provisional" && mixed.coverage === 88, [mixed.status, mixed.coverage]);
}

// ── missing evidence never passes ─────────────────────────────────────────────────────────────────────────────────
{
  const noEv = S.primalScore(C, C.map((x) => d(x.id, "pass", x.id === "f1" ? { evidenced: false } : {})), "brick_and_mortar");
  ok("a 'pass' without accepted, in-date evidence scores zero and lowers coverage", noEv.pillars.find((x) => x.pillar === "fuel").score === 50 && noEv.coverage === 88 && noEv.status === "provisional", [noEv.pillars.find((x) => x.pillar === "fuel"), noEv.coverage]);
  const stale = S.primalScore(C, C.map((x) => d(x.id, "pass", x.id === "m1" ? { stale: true } : {})), "brick_and_mortar");
  ok("a stale judgement scores zero until reassessed", stale.pillars.find((x) => x.pillar === "movement").score === 50 && stale.status === "provisional");
  const none = S.primalScore(C, [], "brick_and_mortar");
  ok("nothing assessed: 0, not 'not assessed' and never a pass — coverage 0%", none.overall === 0 && none.coverage === 0 && none.status === "provisional", [none.overall, none.coverage, none.status]);
  ok("no criteria at all: no score", S.primalScore([], [], "kiosk").overall === null && S.primalScore([], [], "kiosk").status === "not_assessed");
}

// ── gates ─────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const Cm = C.map((x) => (x.id === "f2" ? { ...x, mandatory: true } : x));
  const fails = S.primalScore(Cm, Cm.map((x) => d(x.id, x.id === "f2" ? "fail" : "pass")), "brick_and_mortar");
  ok("a mandatory failure: not certifiable, however high the rest (87.5)", fails.status === "not_certifiable" && fails.overall === 87.5 && fails.gates.some((g) => /F2 is mandatory/.test(g)), [fails.status, fails.overall, fails.gates]);
  const Cs = C.map((x) => (x.id === "s1" ? { ...x, severity: "safety_critical" } : x));
  const unk = S.primalScore(Cs, Cs.filter((x) => x.id !== "s1").map((x) => d(x.id, "pass")), "brick_and_mortar");
  ok("a safety-critical unknown: not certifiable", unk.status === "not_certifiable" && unk.gates.some((g) => /S1 is safety-critical and unknown/.test(g)), unk.gates);
}

// ── verification ──────────────────────────────────────────────────────────────────────────────────────────────────
{
  const prop = S.primalScore(C, C.map((x) => d(x.id, "pass", x.id === "l2" ? { verified: "no" } : {})), "brick_and_mortar");
  ok("one proposal not yet verified: the number holds, the status is provisional", prop.overall === 100 && prop.status === "provisional");
  const self = S.primalScore(C, C.map((x) => d(x.id, "pass", { verified: "self" })), "brick_and_mortar");
  ok("self-verified counts as verified — and says so (Ryan's decision: labelled everywhere)", self.status === "verified" && self.selfVerified === true);
}

// ── applicability ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  const Ca = [...C, c("x1", "light", { models: ["brick_and_mortar"] })];
  const kiosk = S.primalScore(Ca, C.map((x) => d(x.id, "pass")), "kiosk");
  ok("a criterion for storefronts only doesn't count at a kiosk", kiosk.overall === 100 && !kiosk.pillars.some((p) => p.criteria.some((r) => r.criterion.id === "x1")));
  const store = S.primalScore(Ca, C.map((x) => d(x.id, "pass")), "brick_and_mortar");
  ok("…but at a storefront it does, and unassessed it costs points", store.pillars.find((p) => p.pillar === "light").score === 66.7, store.pillars.find((p) => p.pillar === "light").score);
  const na = S.primalScore(C, C.map((x) => d(x.id, x.id === "m2" ? "not_applicable" : "pass", x.id === "m2" ? { naReason: "No seating in a kiosk", naApprovedBy: "owner-1" } : {})), "brick_and_mortar");
  ok("not applicable with a reason and an approver: removed from both sides, and listed", na.overall === 100 && na.excluded.length === 1 && /No seating/.test(na.excluded[0].reason));
  const naBare = S.primalScore(C, C.map((x) => d(x.id, x.id === "m2" ? "not_applicable" : "pass")), "brick_and_mortar");
  ok("not applicable without a reason or approver: stays in, as unknown (zero)", naBare.pillars.find((p) => p.pillar === "movement").score === 50 && naBare.excluded.length === 0);
}

// ── what raises it, and the version ───────────────────────────────────────────────────────────────────────────────
{
  const s = S.primalScore(C, C.filter((x) => x.id !== "l2").map((x) => d(x.id, "pass")), "brick_and_mortar", "1.0");
  ok("the first thing to do is the one worth the most: L2, +12.5 overall", s.next[0].code === "L2" && s.next[0].gain === 12.5, s.next);
  ok("the method's version is on every score, and it isn't approved", s.method.version === "0.1-draft" && s.method.approved === false && s.standardVersion === "1.0");
  ok("equal pillar weights, adding to 100, until approved otherwise", Object.values(S.PILLAR_WEIGHT).every((w) => w === 25));
  const src = read("lib/primalScore.ts");
  ok("the method writes down its rules", /An unknown is never dropped from the total/.test(src) && /Gates override the number/.test(src));
}

console.log(`PRIMAL SIGNIFICANCE SCORE (draft 0.1): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
