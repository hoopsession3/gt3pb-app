// P1.1 — ASSESSED, THEN VERIFIED, AND A ROOM'S SCORE (2026-10-28 — Ryan: "only owners verify, approve criteria and
// publish standards"; the score "provisional, owners-only, unpublished until you approve the method version"). The
// database (0457, db.p11.test) is the judge; this reads the pure half — a room's determinations worked by hand — and
// that the screen says what the database does.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const R = loadTs("lib/primalRoom.ts");
const S = loadTs("lib/primalScore.ts");

const crit = (id, pillar, applies, extra = {}) => ({ id, version_id: "v", pillar, code: id.toUpperCase(), title: id, requirement: "r", applies_to: applies, severity: "medium", evidence_needed: null, required_measures: [], needs_task_population: false, sort: 0, weight: 1, mandatory: false, models: [], ...extra });
const judged = (cid, type, sid, outcome, extra = {}) => ({ id: `${cid}-${sid}`, version_id: "v", criterion_id: cid, subject_type: type, subject_id: sid, outcome, hazard: null, exposure: null, risk: "unknown", task: null, population: null, evidence_ids: [], notes: null, assessed_by: "a", assessed_at: "2026-10-28", stale_at: null, stale_reason: null, superseded_by: null, verification: "independent", verified_by: "o", verified_at: "2026-10-28", na_reason: null, na_approved_by: null, confidence: "high", ...extra });
const C = [crit("s1", "stillness", "room"), crit("m1", "movement", "object"), crit("f1", "fuel", "material")];
const links = [{ id: "l1", item_id: "desk", material_id: "oak" }, { id: "l2", item_id: "chair", material_id: "foam" }];

// ── a room's determinations, by hand ─────────────────────────────────────────────────────────────────────────────────
{
  const dets = R.roomDeterminations(C, [judged("s1", "room", "R", "pass"), judged("m1", "object", "desk", "pass"), judged("m1", "object", "chair", "fail"), judged("f1", "material", "oak", "pass")], "R", ["desk", "chair"], links);
  const by = Object.fromEntries(dets.map((d) => [d.criterion_id, d]));
  ok("the room's own criterion reads the room's judgement", by.s1.outcome === "pass" && by.s1.verified === "independent");
  ok("two objects under one criterion: the worst stands for both (a chair not met → not met)", by.m1.outcome === "fail");
  ok("a material criterion with one of two materials judged is unknown for the room — never met", by.f1.outcome === "unknown", by.f1);
}
{
  const dets = R.roomDeterminations(C, [judged("s1", "room", "R", "pass", { verification: "proposed" })], "R", [], []);
  ok("a proposed judgement counts as unverified", dets[0].verified === "no");
  const self = R.roomDeterminations(C, [judged("s1", "room", "R", "pass", { verification: "self" })], "R", [], []);
  ok("a self-verified one is said as self", self[0].verified === "self");
  const none = R.roomDeterminations(C, [], "R", [], []);
  ok("nothing judged: the criterion is left out, and the score counts it as not assessed (zero)", none.length === 0 && S.primalScore(R.toScoreCriteria(C), none, "gym_bar").overall === 0);
}
{
  const na = R.roomDeterminations(C, [judged("s1", "room", "R", "not_applicable", { na_reason: "No seating here", na_approved_by: null, verification: "proposed" })], "R", [], []);
  ok("not applicable, not yet approved: scores as unknown", na[0].outcome === "unknown");
  const naOk = R.roomDeterminations(C, [judged("s1", "room", "R", "not_applicable", { na_reason: "No seating here", na_approved_by: "o" })], "R", [], []);
  const sc = S.primalScore(R.toScoreCriteria(C), naOk, "gym_bar");
  ok("approved: excluded with its reason", naOk[0].outcome === "not_applicable" && sc.excluded.some((x) => x.code === "S1" && /No seating/.test(x.reason)), sc.excluded);
  const stale = R.roomDeterminations(C, [judged("s1", "room", "R", "pass", { stale_at: "2026-10-28" })], "R", [], []);
  ok("a stale judgement is stale for the room", stale[0].stale === true && S.primalScore(R.toScoreCriteria(C), stale, "gym_bar").pillars.find((p) => p.pillar === "stillness").score === 0);
}
{
  const sc = R.toScoreCriteria([crit("x", "light", "room", { weight: "2.50", mandatory: true, models: ["kiosk"] })]);
  ok("a criterion's weight, mandatory flag and models reach the score (numeric from the database read as a number)", sc[0].weight === 2.5 && sc[0].mandatory === true && sc[0].models[0] === "kiosk");
  const kiosk = S.primalScore(sc, [], "gym_bar");
  ok("a criterion for another operating model doesn't count here", kiosk.overall === null && kiosk.status === "not_assessed");
}

// ── the screen says what the database does ───────────────────────────────────────────────────────────────────────────
const std = read("components/vision/Standard.tsx"), lib = read("lib/standard.ts"), sql = read("supabase/migrations/0457_assessed_then_verified.sql");
ok("anyone on the Standard proposes; the screen says it counts once an owner verifies it", /Propose a judgement on \{c\.code\}/.test(std) && /Proposed — it counts once an owner verifies it\./.test(std) && /\{v\?\.status === "published" && <button type="button" className="btn-ter self-start" onClick=\{\(\) => setAssess\(c\)\}>/.test(std));
ok("owners verify from Needs attention; their own proposal says it will be self-verified", /Waiting for an owner to verify/.test(std) && /Verify my own — it will say self-verified/.test(std) && /update\(\{ verification: "independent" \}\)/.test(std));
ok("…and the database, not the screen, decides independent or self", /then 'self' else 'independent' end/.test(sql) && /new\.verified_by := auth\.uid\(\);/.test(sql));
ok("not applicable asks for a reason, and the database wants one too", /Why it doesn&apos;t apply \(an owner approves it\)/.test(std) && /not applicable needs a reason/.test(sql));
ok("the words every view uses", /VERIFY_WORD: Record<Verification, string> = \{ proposed: "Proposed — waiting for an owner", independent: "Verified", self: "Self-verified" \}/.test(lib));
ok("the score is owners' and labelled a draft method, not approved", /\.\.\.\(isOwner \? \[\{ key: "score" as const, label: "Score" \}\] : \[\]\)/.test(std) && /Draft method \$\{METHOD\.version\} — not approved, owners only/.test(std) && /if \(section === "score" && isOwner\)/.test(std));
ok("a criterion's weight, mandatory flag and operating models are set when it's written", /Mandatory — not met means not certifiable/.test(std) && /weight: Number\(f\.weight\), mandatory: f\.mandatory, models: f\.models/.test(std));
const held = JSON.parse(read("supabase/held.json")).held.map((h) => h.file);
// 0456 and 0457 applied together (2026-10-28): neither is held, neither is pending.
ok("0456 and 0457 went live together: neither held nor still in the paste file", !held.some((f) => f.startsWith("0456") || f.startsWith("0457")) && !/0456_the_primal_standard_engine\.sql — /.test(read("supabase/APPLY_ALL_PENDING.sql")) && !/^-- 0457_assessed_then_verified\.sql\s*$/m.test(read("supabase/APPLY_ALL_PENDING.sql")));
const pkg = JSON.parse(read("package.json"));
ok("this file runs with every test, and its database half with the database's", /node scripts\/p11\.test\.mjs/.test(pkg.scripts.test) && /node scripts\/db\.p11\.test\.mjs/.test(pkg.scripts["db:test"]));

console.log(`P1.1 — ASSESSED, THEN VERIFIED: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
