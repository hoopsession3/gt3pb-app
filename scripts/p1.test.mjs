// P1 — THE PRIMAL STANDARD ENGINE, THE SCREEN'S RULES (2026-10-26). The database (0456, db.standard.test) is the judge;
// these check the screen says the same thing before anyone presses: evidence states, what can carry a pass, the
// prohibited words (the same list as the database's), the measurements, the summary that can't hide a failure, and the
// wiring (owners and admins only, the tab, the arrives-with).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const S = loadTs("lib/standard.ts");
const today = "2026-10-26";

// ── evidence states ───────────────────────────────────────────────────────────────────────────────────────────────
ok("submitted is 'not reviewed yet', whatever its kind", S.evidenceState({ review_status: "submitted", kind: "measured", expires_on: null }, today) === "unreviewed");
ok("expired accepted evidence says expired", S.evidenceState({ review_status: "accepted", kind: "measured", expires_on: "2026-01-01" }, today) === "expired");
ok("accepted, in date: its kind", S.evidenceState({ review_status: "accepted", kind: "observed", expires_on: "2027-01-01" }, today) === "observed");
const acc = (kind, extra = {}) => ({ review_status: "accepted", kind, expires_on: null, bearing: "supports", measures: {}, ...extra });
ok("illustrative never carries a pass", !S.canCarryPass(acc("illustrative"), today));
ok("contradicting evidence never carries a pass", !S.canCarryPass(acc("measured", { bearing: "contradicts" }), today));
ok("measured, accepted, supporting does", S.canCarryPass(acc("measured"), today));

// ── what blocks a pass ────────────────────────────────────────────────────────────────────────────────────────────
const light = { required_measures: ["cct", "flicker_pct"], needs_task_population: false };
ok("no evidence → unknown is the honest outcome", S.passBlockers(light, [], 0, "", "", today).some((x) => /unknown/.test(x)));
ok("lumens alone → the missing measurements are named", S.passBlockers(light, [acc("measured", { measures: { lumens: 4000 } })], 0, "", "", today).some((x) => /cct, flicker_pct/.test(x)));
ok("the right measurements → nothing blocks", S.passBlockers(light, [acc("measured", { measures: { cct: 2700, flicker_pct: 1 } })], 0, "", "", today).length === 0);
ok("conflict blocks a pass", S.passBlockers(light, [acc("measured", { measures: { cct: 2700, flicker_pct: 1 } })], 1, "", "", today).some((x) => /conflicts/.test(x)));
ok("ergonomics needs the task and population", S.passBlockers({ required_measures: [], needs_task_population: true }, [acc("observed")], 0, "", "", today).some((x) => /task/.test(x)));

// ── prohibited words: the screen's list matches the database's ─────────────────────────────────────────────────────
for (const t of ["Our finishes are non-toxic", "A toxin-free studio", "Chemical free bar", "zero physiological stress", "Detox water", "Prevents disease", "Supports positive gene expression", "Guaranteed posture", "It cures fatigue"])
  ok(`prohibited: "${t}"`, S.isProhibited(t));
for (const t of ["A secure, quiet room", "Low-VOC finish, declared by the maker", "Measured flicker under 1%", "We hope the room helps people slow down"])
  ok(`allowed: "${t}"`, !S.isProhibited(t));
const sql = read("supabase/migrations/0456_the_primal_standard_engine.sql");
for (const word of ["toxin", "detox", "genome", "gene expression", "chemical", "guaranteed"]) ok(`the database refuses "${word}" too`, sql.includes(word));

// ── measurements ──────────────────────────────────────────────────────────────────────────────────────────────────
const m = S.parseMeasures("cct=2700, flicker_pct: 0.5, note=warm, bad pair");
ok("measurements read: numbers stay numbers", m.measures.cct === 2700 && m.measures.flicker_pct === 0.5 && m.measures.note === "warm", m);
ok("…and a bad pair is named, not guessed", m.bad.length === 1 && m.bad[0] === "bad pair", m.bad);

// ── the summary can't hide a failure ──────────────────────────────────────────────────────────────────────────────
const base = { passes: 9, conditionals: 0, fails: 0, unknowns: 0, stale: 0, critical_fail: false, serious_unknown: false };
ok("nine passes and one safety-critical fail says the fail", /Safety-critical/.test(S.summaryWords({ ...base, fails: 1, critical_fail: true }).word));
ok("a serious unknown is said before the passes", /Serious unknown/.test(S.summaryWords({ ...base, unknowns: 1, serious_unknown: true }).word));
ok("stale is said before met", /stale/.test(S.summaryWords({ ...base, stale: 2 }).word));
ok("nothing assessed says so", S.summaryWords(null).word === "Not assessed");

// ── wiring ────────────────────────────────────────────────────────────────────────────────────────────────────────
const app = read("components/vision/VisionApp.tsx"), screen = read("components/vision/Standard.tsx");
ok("the Standard tab is owners' and admins' only", /canEdit \? \[[^\]]*key: "standard"/.test(app) && /tab === "standard" && canEdit && <Standard/.test(app));
// 0456 applied (2026-10-28): the Standard is read plainly; no path is kept for before it.
ok("0456 is in: the Standard reads plainly — no path kept for before it", !/arrives-with: 0456/.test(screen) && !/arrives with the next database update \(0456\)/.test(screen));
ok("nobody is offered a review of their own evidence", /e\.submitted_by === d\.me/.test(screen));
// P1.1: and not applicable only with its reason.
ok("a pass is offered only when nothing blocks it", /disabled=\{!about \|\| blockers\.length > 0 \|\| \(outcome === "not_applicable" && !naReason\.trim\(\)\)\}/.test(screen));
ok("only owners see publish, assess and claim support", (screen.match(/isOwner &&/g) ?? []).length >= 6);
ok("illustrative is labelled as not evidence", /Illustrative — not evidence/.test(read("lib/standard.ts")));

console.log(`P1 — THE STANDARD'S SCREEN RULES: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
