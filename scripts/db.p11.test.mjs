// 0457 — ASSESSED, THEN VERIFIED, IN POSTGRES (2026-10-28 — Primal Standard P1.1).
//
// The schema to 0455, then 0456 and 0457 together (the paste they arrive in), 0457 twice. What is read: an owner or an
// admin proposes a judgement and nobody arrives verified; only an owner verifies, and the database — not the screen —
// says whether it was independent or self-verified; a verified judgement stays verified and its words stay as judged;
// not applicable needs a reason and counts only once an owner approves it; a stale judgement is reassessed, not verified;
// a criterion's weight, mandatory flag and operating models are set on a draft and kept once published; the summary
// counts what waits for verification; staff and another tenant reach none of it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M456 = readFileSync(join(ROOT, "supabase/migrations/0456_the_primal_standard_engine.sql"), "utf8");
const M457 = readFileSync(join(ROOT, "supabase/migrations/0457_assessed_then_verified.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };
const T1 = "00000000-0000-0000-0000-000000000001";
const T2 = "00000000-0000-0000-0000-000000000002";
const OWNER = "0c457000-0000-4000-8000-0000000000a1";
const OWNER2 = "0c457000-0000-4000-8000-0000000000a2";
const ADMIN = "0c457000-0000-4000-8000-0000000000d4";
const STAFF = "0c457000-0000-4000-8000-0000000000e5";
const OTHER = "0c457000-0000-4000-8000-0000000000f7";

const db = await fullSchema({ before: "0456" });
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);
await db.exec(`create or replace function public.two_step_ok() returns boolean language sql stable as $$ select true $$;`);
await db.exec(`begin; set local gt3.allow_second_tenant = 'on'; insert into public.tenants (id, slug, name) values ('${T2}', 'other-bar', 'Another Bar') on conflict do nothing; commit;`);
for (const [id, role, t] of [[OWNER, "owner", T1], [OWNER2, "owner", T1], [ADMIN, "admin", T1], [STAFF, "operator", T1], [OTHER, "owner", T2]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${id.slice(-4)}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, t]);
}
await db.exec(M456);
await db.exec(M457);
await db.exec(M457);
ok("0457 twice: recorded (applied twice)", (await q1(`select applied_count::int n from public.schema_migrations where version like '0457%'`)).n === 2);

const as = async (who, sql, p) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${who}', false); set role authenticated;`);
  try { return (await db.query(sql, p)).rows; } catch (e) { return { error: e.message, code: e.code }; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const refused = (r, code) => r && r.error && (!code || r.code === code);

// ── criteria: weight, mandatory, operating models — on a draft ───────────────────────────────────────────────────
const [ver] = await as(OWNER, `insert into public.std_versions (label) values ('v1.0') returning id`);
const crit = async (code, pillar, applies, extra = {}) => (await as(OWNER, `insert into public.std_criteria (version_id, pillar, code, title, requirement, applies_to, severity, weight, mandatory, models)
  values ($1, $2, $3, $3, 'Requirement', $4, $5, $6, $7, $8) returning id`, [ver.id, pillar, code, applies, extra.severity ?? "medium", extra.weight ?? 1, extra.mandatory ?? false, extra.models ?? []]))[0];
ok("a weight of zero is refused", refused(await as(OWNER, `insert into public.std_criteria (version_id, pillar, code, title, requirement, applies_to, weight) values ($1, 'light', 'LZ', 't', 'r', 'room', 0)`, [ver.id])));
ok("an operating model that isn't one is refused", refused(await as(OWNER, `insert into public.std_criteria (version_id, pillar, code, title, requirement, applies_to, models) values ($1, 'light', 'LQ', 't', 'r', 'room', array['spaceship'])`, [ver.id])));
const cRoom = await crit("S1", "stillness", "room", { weight: 2, mandatory: true, models: ["gym_bar", "storefront_lease"] });
const cRoom2 = await crit("L1", "light", "room");
const cNa = await crit("M1", "movement", "room", { models: ["kiosk"] });
ok("an owner sets weight, mandatory and models on a draft", !!(cRoom && cRoom2 && cNa) && (await q1(`select weight::float w, mandatory m, models from public.std_criteria where id = $1`, [cRoom.id])).w === 2);
ok("an admin can't set them", refused(await as(ADMIN, `update public.std_criteria set weight = 5 where id = $1`, [cRoom.id]), "PT403"));
await as(OWNER, `update public.std_versions set status = 'published' where id = $1`, [ver.id]);
ok("published, they're kept as published", refused(await as(OWNER, `update public.std_criteria set mandatory = false where id = $1`, [cRoom.id]), "PT409"));

const room = await q1(`insert into public.store_layouts (name, width_in, depth_in) values ('Studio A', 360, 480) returning id`);
const propose = (who, c, outcome, extra = {}) => as(who, `insert into public.std_assessments (version_id, criterion_id, subject_type, subject_id, outcome, na_reason, confidence, verification, verified_by, verified_at)
  values ($1, $2, 'room', $3, $4, $5, $6, $7, $8, $9) returning id, verification, verified_by, assessed_by`, [ver.id, c.id, room.id, outcome, extra.na ?? null, extra.confidence ?? null, extra.verification ?? "proposed", extra.verifiedBy ?? null, extra.verifiedAt ?? null]);

// ── proposed: by an owner or an admin; nobody arrives verified ──────────────────────────────────────────────────────
const [p1] = await propose(ADMIN, cRoom, "unknown", { confidence: "low" });
ok("an admin proposes a judgement", p1?.verification === "proposed" && p1.assessed_by === ADMIN, p1);
ok("staff can't propose one", refused(await propose(STAFF, cRoom2, "unknown")));
{ const r = await propose(ADMIN, cRoom2, "unknown", { verification: "independent", verifiedBy: OWNER, verifiedAt: "2026-10-28T00:00:00Z" });
  ok("a judgement can't arrive verified — the database makes it a proposal", Array.isArray(r) && r[0].verification === "proposed" && r[0].verified_by === null, r); }
ok("a confidence that isn't low, medium or high is refused", refused(await propose(ADMIN, cRoom2, "unknown", { confidence: "certain" })));

// ── verified: only by an owner; the database says whose ─────────────────────────────────────────────────────────────
ok("an admin can't verify (PT403)", refused(await as(ADMIN, `update public.std_assessments set verification = 'independent' where id = $1`, [p1.id]), "PT403"));
{ const r = await as(OWNER, `update public.std_assessments set verification = 'self', verified_by = $2 where id = $1 returning verification, verified_by, verified_at is not null v`, [p1.id, ADMIN]);
  ok("an owner verifies another's proposal — independent, whatever the screen asked, and in the owner's name", Array.isArray(r) && r[0].verification === "independent" && r[0].verified_by === OWNER && r[0].v, r); }
ok("a verified judgement stays verified", refused(await as(OWNER2, `update public.std_assessments set verification = 'proposed', verified_by = null, verified_at = null where id = $1`, [p1.id]), "PT409"));
await as(OWNER2, `update public.std_assessments set verification = 'independent' where id = $1`, [p1.id]);
ok("…and verifying it again changes nothing — still the first owner's", (await q1(`select verified_by from public.std_assessments where id = $1`, [p1.id])).verified_by === OWNER);
ok("…nor can another owner put their name on it", refused(await as(OWNER2, `update public.std_assessments set verified_by = $2 where id = $1`, [p1.id, OWNER2]), "PT409"));
ok("…and its outcome is kept as judged", refused(await as(OWNER, `update public.std_assessments set outcome = 'pass' where id = $1`, [p1.id]), "PT409"));
ok("…nor its confidence", refused(await as(OWNER, `update public.std_assessments set confidence = 'high' where id = $1`, [p1.id]), "PT409"));
const [p2] = await propose(OWNER, cRoom2, "unknown");
{ const r = await as(OWNER, `update public.std_assessments set verification = 'independent' where id = $1 returning verification, verified_by`, [p2.id]);
  ok("an owner verifying their own proposal is labelled self-verified — never independent", Array.isArray(r) && r[0].verification === "self" && r[0].verified_by === OWNER, r); }

// ── not applicable: a reason, and an owner's approval ───────────────────────────────────────────────────────────────
ok("not applicable without a reason is refused", refused(await propose(ADMIN, cNa, "not_applicable")));
const [na] = await propose(ADMIN, cNa, "not_applicable", { na: "This room has no counter — the kiosk criterion doesn't reach it." });
const naRow = await q1(`select na_reason, na_approved_by from public.std_assessments where id = $1`, [na.id]);
ok("with a reason it's proposed, not yet approved", !!naRow.na_reason && naRow.na_approved_by === null, naRow);
await as(OWNER, `update public.std_assessments set verification = 'independent' where id = $1`, [na.id]);
ok("the verifying owner is its approver", (await q1(`select na_approved_by from public.std_assessments where id = $1`, [na.id])).na_approved_by === OWNER);
ok("a reason can't ride on another outcome", refused(await propose(ADMIN, cRoom2, "unknown", { na: "No reason needed" })) || (await q1(`select count(*)::int n from public.std_assessments where na_reason is not null and outcome <> 'not_applicable'`)).n === 0);

// ── stale is reassessed, not verified ────────────────────────────────────────────────────────────────────────────────
const [p3] = await propose(ADMIN, cRoom2, "unknown");
await q(`update public.std_assessments set stale_at = now(), stale_reason = 'The room changed.' where id = $1`, [p3.id]);
ok("a stale proposal can't be verified", refused(await as(OWNER, `update public.std_assessments set verification = 'independent' where id = $1`, [p3.id]), "PT409"));

// ── the summary counts what waits ────────────────────────────────────────────────────────────────────────────────────
const [p4] = await propose(ADMIN, cRoom, "unknown");
const s = await q1(`select unverified::int u, not_applicable::int n from public.std_subject_summary where subject_id = $1`, [room.id]);
ok("the summary counts the judgements waiting for verification and the not-applicable apart", s && s.u >= 1 && s.n === 1, s);
ok("a new proposal replaces the verified one it reassesses — the old one stays in history", (await q1(`select superseded_by = $2 r from public.std_assessments where id = $1`, [p1.id, p4.id])).r === true);

// ── who reaches it ──────────────────────────────────────────────────────────────────────────────────────────────────
for (const [who, name] of [[STAFF, "an operator"], [OTHER, "another tenant's owner"]]) {
  const r = await as(who, `select count(*)::int a from public.std_assessments`);
  ok(`${name} reads no judgement`, Array.isArray(r) && r[0].a === 0, r);
  ok(`${name} verifies none`, (await as(who, `update public.std_assessments set verification = 'independent' where id = $1 returning id`, [p4.id])).length === 0 || refused(await as(who, `update public.std_assessments set verification = 'independent' where id = $1`, [p4.id])));
}

console.log(`0457 — ASSESSED, THEN VERIFIED (in Postgres): ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
