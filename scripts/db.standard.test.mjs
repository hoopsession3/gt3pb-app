// 0456 — THE PRIMAL STANDARD ENGINE, IN POSTGRES (2026-10-26 — Primal Standard P1).
//
// The whole schema to 0455 is loaded, then 0456, twice. What is read: only owners write the Standard and a published
// version (and its criteria) never changes; evidence arrives submitted, can't be self-verified and is kept once reviewed;
// unknown, illustrative, expired or contradicted evidence never makes a pass; light can't pass on lumens alone; an
// ergonomic criterion needs its task and population; a prohibited claim can never be supported; moving an object,
// substituting a material or changing one marks the judgements that depended on it stale, and a reassessment replaces
// them; a watch-list material opens a review, not a verdict; the summary never hides a safety-critical fail; staff,
// customers, signed-out callers and another tenant reach none of it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M456 = readFileSync(join(ROOT, "supabase/migrations/0456_the_primal_standard_engine.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };
const T1 = "00000000-0000-0000-0000-000000000001";
const T2 = "00000000-0000-0000-0000-000000000002";
const OWNER = "0c456000-0000-4000-8000-0000000000a1";
const OWNER2 = "0c456000-0000-4000-8000-0000000000a2";
const ADMIN = "0c456000-0000-4000-8000-0000000000d4";
const STAFF = "0c456000-0000-4000-8000-0000000000e5";
const CUSTOMER = "0c456000-0000-4000-8000-0000000000c6";
const OTHER = "0c456000-0000-4000-8000-0000000000f7";

const db = await fullSchema({ before: "0456" });
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);
await db.exec(`create or replace function public.two_step_ok() returns boolean language sql stable as $$ select true $$;`);
await db.exec(`begin; set local gt3.allow_second_tenant = 'on'; insert into public.tenants (id, slug, name) values ('${T2}', 'other-bar', 'Another Bar') on conflict do nothing; commit;`);
for (const [id, role, t] of [[OWNER, "owner", T1], [OWNER2, "owner", T1], [ADMIN, "admin", T1], [STAFF, "operator", T1], [CUSTOMER, "member", T1], [OTHER, "owner", T2]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${id.slice(-4)}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, t]);
}
await db.exec(M456);
await db.exec(M456);
ok("0456 twice: recorded (applied twice)", (await q1(`select applied_count::int n from public.schema_migrations where version like '0456%'`)).n === 2);

const as = async (who, sql, p) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${who}', false); set role authenticated;`);
  try { return (await db.query(sql, p)).rows; } catch (e) { return { error: e.message, code: e.code }; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const refused = (r, code) => r && r.error && (!code || r.code === code);

// ── versions and criteria: owners only, published is final ────────────────────────────────────────────────────────
ok("an admin can't start a version of the Standard (PT403)", refused(await as(ADMIN, `insert into public.std_versions (label) values ('v1.0') returning id`), "PT403"));
const [ver] = await as(OWNER, `insert into public.std_versions (label, summary) values ('v1.0', 'First') returning id`);
ok("an owner can", !!ver?.id);
ok("an empty version can't be published", refused(await as(OWNER, `update public.std_versions set status = 'published' where id = $1`, [ver.id]), "PT409"));
const crit = async (code, pillar, applies, extra = {}) => (await as(OWNER, `insert into public.std_criteria (version_id, pillar, code, title, requirement, applies_to, severity, required_measures, needs_task_population)
  values ($1, $2, $3, $3, 'Requirement', $4, $5, $6, $7) returning id`, [ver.id, pillar, code, applies, extra.severity ?? "medium", extra.measures ?? [], extra.tp ?? false]))[0];
ok("light can't be judged on lumens alone (PT422)", refused(await as(OWNER, `insert into public.std_criteria (version_id, pillar, code, title, requirement, applies_to, required_measures) values ($1, 'light', 'L0', 't', 'r', 'room', array['lumens'])`, [ver.id]), "PT422"));
ok("an admin can't write a criterion", refused(await as(ADMIN, `insert into public.std_criteria (version_id, pillar, code, title, requirement, applies_to) values ($1, 'light', 'LX', 't', 'r', 'room')`, [ver.id]), "PT403"));
const cLight = await crit("L1", "light", "room", { measures: ["cct", "flicker_pct"], severity: "high" });
const cDesk = await crit("M1", "movement", "object", { tp: true });
const cSafe = await crit("F1", "fuel", "material", { severity: "safety_critical" });
const cObj = await crit("S1", "stillness", "object");
ok("criteria written to the draft", !!(cLight && cDesk && cSafe && cObj));
await as(OWNER, `update public.std_versions set status = 'published' where id = $1`, [ver.id]);
const pub = await q1(`select status, published_at is not null p from public.std_versions where id = $1`, [ver.id]);
ok("published by an owner, stamped", pub.status === "published" && pub.p);
ok("a published version's words never change", refused(await as(OWNER, `update public.std_versions set summary = 'Edited' where id = $1`, [ver.id]), "PT409"));
ok("…nor its criteria", refused(await as(OWNER, `update public.std_criteria set requirement = 'Softer' where id = $1`, [cLight.id]), "PT409"));
ok("…nor can a criterion be added to it", refused(await as(OWNER, `insert into public.std_criteria (version_id, pillar, code, title, requirement, applies_to) values ($1, 'fuel', 'F9', 't', 'r', 'material')`, [ver.id]), "PT409"));
ok("…nor deleted", refused(await as(OWNER, `delete from public.std_versions where id = $1`, [ver.id]), "PT409"));

// ── a room, an object, a material ─────────────────────────────────────────────────────────────────────────────────
const room = await q1(`insert into public.store_layouts (name, width_in, depth_in) values ('Studio A', 360, 480) returning id`);
const desk = await q1(`insert into public.store_items (layout_id, kind, label, x_in, y_in, w_in, d_in, h_in) values ($1, 'desk', 'Standing desk', 60, 60, 60, 30, 40) returning id`, [room.id]);
const [oak] = await as(ADMIN, `insert into public.std_materials (name, category) values ('Oiled oak', 'surface') returning id`);
ok("an admin adds a material", !!oak?.id);
const [foam] = await as(ADMIN, `insert into public.std_materials (name, category, watch_list) values ('Foam pad', 'textile', array['flame retardant (declared)']) returning id`);
const rv = await q(`select status, reason from public.std_reviews where subject_id = $1`, [foam.id]);
ok("a watch-list material opens a review — not a verdict", rv.length === 1 && rv[0].status === "open" && /not a verdict/.test(rv[0].reason) && (await q(`select 1 from public.std_assessments where subject_id = $1`, [foam.id])).length === 0, rv);
await as(ADMIN, `insert into public.std_item_materials (item_id, material_id, role) values ($1, $2, 'top')`, [desk.id, oak.id]);

// ── evidence: submitted first, never self-verified ────────────────────────────────────────────────────────────────
ok("evidence can't arrive already accepted", refused(await as(OWNER, `insert into public.std_evidence (subject_type, subject_id, kind, summary, review_status) values ('room', $1, 'measured', 's', 'accepted')`, [room.id]), "PT409"));
const ev = async (who, subjectType, subjectId, kind, extra = {}) => (await as(who, `insert into public.std_evidence (subject_type, subject_id, kind, summary, measures, bearing, expires_on, criterion_id)
  values ($1, $2, $3, 'Evidence', $4, $5, $6, $7) returning id`, [subjectType, subjectId, kind, JSON.stringify(extra.measures ?? {}), extra.bearing ?? "supports", extra.expires ?? null, extra.criterion ?? null]))[0];
const eLumens = await ev(ADMIN, "room", room.id, "measured", { measures: { lumens: 4000 } });
const eLight = await ev(OWNER, "room", room.id, "measured", { measures: { cct: 2700, flicker_pct: 1 } });
ok("an admin can't accept evidence (PT403)", refused(await as(ADMIN, `update public.std_evidence set review_status = 'accepted' where id = $1`, [eLumens.id]), "PT403"));
ok("an owner can't accept their own evidence (PT403)", refused(await as(OWNER, `update public.std_evidence set review_status = 'accepted' where id = $1`, [eLight.id]), "PT403"));
ok("another owner can", Array.isArray(await as(OWNER2, `update public.std_evidence set review_status = 'accepted' where id = $1 returning id`, [eLight.id])));
await as(OWNER2, `update public.std_evidence set review_status = 'accepted' where id = $1`, [eLumens.id]);
ok("accepted evidence is kept as reviewed", refused(await as(OWNER, `update public.std_evidence set measures = '{"cct":5000}' where id = $1`, [eLight.id]), "PT409"));
ok("…and isn't deleted", refused(await as(OWNER, `delete from public.std_evidence where id = $1`, [eLight.id]), "PT409"));

// ── assessments: unknown never passes ─────────────────────────────────────────────────────────────────────────────
const assess = (who, c, subjectType, subjectId, outcome, extra = {}) => as(who, `insert into public.std_assessments (version_id, criterion_id, subject_type, subject_id, outcome, evidence_ids, task, population, risk)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`, [ver.id, c.id, subjectType, subjectId, outcome, extra.evidence ?? [], extra.task ?? null, extra.population ?? null, extra.risk ?? "unknown"]);
ok("an admin can't assess (PT403)", refused(await assess(ADMIN, cLight, "room", room.id, "unknown"), "PT403"));
ok("no evidence can't pass", refused(await assess(OWNER, cLight, "room", room.id, "pass"), "PT422"));
ok("lumens alone can't pass a light criterion", refused(await assess(OWNER, cLight, "room", room.id, "pass", { evidence: [eLumens.id] }), "PT422"));
const aLight = await assess(OWNER, cLight, "room", room.id, "pass", { evidence: [eLight.id] });
ok("the right measurements, accepted, pass", Array.isArray(aLight) && aLight.length === 1, aLight);
const eDraft = await ev(ADMIN, "object", desk.id, "measured", { measures: { height_in: 40 } });
ok("submitted (unreviewed) evidence can't pass", refused(await assess(OWNER, cObj, "object", desk.id, "pass", { evidence: [eDraft.id] }), "PT422"));
const eIll = await ev(ADMIN, "object", desk.id, "illustrative");
await as(OWNER2, `update public.std_evidence set review_status = 'accepted' where id = $1`, [eIll.id]);
ok("illustrative evidence can't pass, even accepted", refused(await assess(OWNER, cObj, "object", desk.id, "pass", { evidence: [eIll.id] }), "PT422"));
const eOld = await ev(ADMIN, "object", desk.id, "measured", { expires: "2020-01-01" });
await as(OWNER2, `update public.std_evidence set review_status = 'accepted' where id = $1`, [eOld.id]);
ok("expired evidence can't pass", refused(await assess(OWNER, cObj, "object", desk.id, "pass", { evidence: [eOld.id] }), "PT422"));
const eDesk = await ev(ADMIN, "object", desk.id, "observed");
await as(OWNER2, `update public.std_evidence set review_status = 'accepted' where id = $1`, [eDesk.id]);
ok("ergonomics needs the task and the population", refused(await assess(OWNER, cDesk, "object", desk.id, "pass", { evidence: [eDesk.id] }), "PT422"));
ok("…named, it passes", Array.isArray(await assess(OWNER, cDesk, "object", desk.id, "pass", { evidence: [eDesk.id], task: "Standing laptop work, 20 min", population: "Adults 5'2\"–6'4\"" })));
ok("unknown needs no evidence — it's honest", Array.isArray(await assess(OWNER, cObj, "object", desk.id, "unknown")));
const eAgainst = await ev(ADMIN, "object", desk.id, "observed", { bearing: "contradicts", criterion: cObj.id });
await as(OWNER2, `update public.std_evidence set review_status = 'accepted' where id = $1`, [eAgainst.id]);
ok("conflicting evidence can't pass", refused(await assess(OWNER, cObj, "object", desk.id, "pass", { evidence: [eDesk.id] }), "PT422"));
ok("…conditional is allowed, with the conflict visible", Array.isArray(await assess(OWNER, cObj, "object", desk.id, "conditional", { evidence: [eDesk.id] })));
{ const r = await as(OWNER, `update public.std_assessments set outcome = 'fail' where id = $1`, [aLight[0].id]); ok("a recorded judgement can't be edited", refused(r, "PT409"), r); }
ok("…nor deleted", refused(await as(OWNER, `delete from public.std_assessments where id = $1`, [aLight[0].id]), "PT409"));
ok("a reassessment replaces the one before", (await q(`select count(*)::int n from public.std_assessments where subject_id = $1 and criterion_id = $2 and superseded_by is null`, [desk.id, cObj.id]))[0].n === 1);

// ── stale ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const staleOf = async (id) => (await q1(`select stale_at is not null s, stale_reason r from public.std_assessments where subject_id = $1 and superseded_by is null order by assessed_at desc limit 1`, [id]));
await as(ADMIN, `update public.store_items set x_in = 90 where id = $1`, [desk.id]);
ok("moving an object marks the room's judgement stale", (await staleOf(room.id)).s, await staleOf(room.id));
const dStale0 = await q1(`select count(*) filter (where stale_at is not null)::int n from public.std_assessments where subject_id = $1 and superseded_by is null`, [desk.id]);
ok("…but not the object's own (it didn't change)", dStale0.n === 0, dStale0);
await as(ADMIN, `update public.std_item_materials set material_id = $1 where item_id = $2`, [foam.id, desk.id]);
const dStale = await q1(`select count(*) filter (where stale_at is not null)::int n, count(*)::int t from public.std_assessments where subject_id = $1 and superseded_by is null`, [desk.id]);
ok("a material substitution marks the object's judgements stale", dStale.n === dStale.t && dStale.t > 0, dStale);
ok("a stale flag can't be cleared by hand", refused(await as(OWNER, `update public.std_assessments set stale_at = null where subject_id = $1`, [desk.id]), "PT409"));
const re = await assess(OWNER, cLight, "room", room.id, "pass", { evidence: [eLight.id] });
ok("reassessing clears it: the new one is current and fresh", Array.isArray(re) && !(await staleOf(room.id)).s);
const eFoam = await ev(ADMIN, "material", foam.id, "declared");
await as(OWNER2, `update public.std_evidence set review_status = 'accepted' where id = $1`, [eFoam.id]);
await assess(OWNER, cSafe, "material", foam.id, "conditional", { evidence: [eFoam.id] });
await as(ADMIN, `update public.std_materials set composition = 'Changed by maker' where id = $1`, [foam.id]);
ok("a material's details changing marks its own judgement stale", (await staleOf(foam.id)).s);
await as(OWNER2, `update public.std_evidence set review_status = 'rejected' where id = $1`, [eLight.id]);
ok("rejecting accepted evidence marks what relied on it stale", (await staleOf(room.id)).s);

// ── the summary can't hide a failure ──────────────────────────────────────────────────────────────────────────────
await assess(OWNER, cSafe, "material", oak.id, "fail", { risk: "high" });
const sum = await q1(`select * from public.std_subject_summary where subject_id = $1`, [oak.id]);
ok("a safety-critical fail shows in the summary", sum?.critical_fail === true && Number(sum.fails) === 1, sum);
await as(OWNER2, `update public.std_versions set status = 'published' where id = $1`, [ver.id]).catch(() => {});
const serious = await q1(`select serious_unknown from public.std_subject_summary where subject_id = $1`, [room.id]);
ok("the summary carries serious unknowns separately", serious && typeof serious.serious_unknown !== "undefined");

// ── claims ────────────────────────────────────────────────────────────────────────────────────────────────────────
const [cl] = await as(ADMIN, `insert into public.std_claims (subject_type, text, kind) values ('gt3', 'Our studio is toxin-free.', 'marketing') returning id`);
ok("anyone on the team can write a claim — it starts unverified", !!cl?.id);
ok("a prohibited claim can never be supported", refused(await as(OWNER, `update public.std_claims set status = 'supported', evidence_ids = array[$2::uuid] where id = $1`, [cl.id, eDesk.id]), "PT422"));
ok("…the words are caught however they're written", (await q1(`select public.std_prohibited_claim('Supports positive GENE expression') a, public.std_prohibited_claim('Non-toxic finishes') b, public.std_prohibited_claim('A secure, quiet room') c`)).a === true);
ok("…and 'secure' isn't mistaken for 'cure'", (await q1(`select public.std_prohibited_claim('A secure, quiet room') c`)).c === false);
const [sci] = await as(ADMIN, `insert into public.std_claims (subject_type, subject_id, text, kind) values ('room', $1, 'Light flicker below 1% at the bench.', 'scientific') returning id`, [room.id]);
const eDecl = await ev(ADMIN, "room", room.id, "declared");
await as(OWNER2, `update public.std_evidence set review_status = 'accepted' where id = $1`, [eDecl.id]);
ok("a scientific claim needs measured or observed evidence", refused(await as(OWNER, `update public.std_claims set status = 'supported', evidence_ids = array[$2::uuid] where id = $1`, [sci.id, eDecl.id]), "PT422"));
const eMeas = await ev(ADMIN, "room", room.id, "measured", { measures: { flicker_pct: 0.5 } });
await as(OWNER2, `update public.std_evidence set review_status = 'accepted' where id = $1`, [eMeas.id]);
ok("…with it, an owner supports it", Array.isArray(await as(OWNER, `update public.std_claims set status = 'supported', evidence_ids = array[$2::uuid] where id = $1 returning id`, [sci.id, eMeas.id])));
ok("an admin can't verify a claim", refused(await as(ADMIN, `update public.std_claims set status = 'not_supported' where id = $1`, [cl.id]), "PT403"));
ok("a supported claim keeps its words", refused(await as(ADMIN, `update public.std_claims set text = 'Light flicker below 1% everywhere.' where id = $1`, [sci.id]), "PT409"));
const [asp] = await as(ADMIN, `insert into public.std_claims (text, kind) values ('We hope the room helps people slow down.', 'aspiration') returning id`);
ok("an aspiration stays an aspiration", refused(await as(OWNER, `update public.std_claims set status = 'supported', evidence_ids = array[$2::uuid] where id = $1`, [asp.id, eMeas.id]), "PT422"));

// ── who reaches it ────────────────────────────────────────────────────────────────────────────────────────────────
for (const [who, name] of [[STAFF, "an operator"], [CUSTOMER, "a member"], [OTHER, "another tenant's owner"]]) {
  const r = await as(who, `select (select count(*) from public.std_versions)::int v, (select count(*) from public.std_evidence)::int e, (select count(*) from public.std_assessments)::int a, (select count(*) from public.std_materials)::int m, (select count(*) from public.std_subject_summary)::int s`);
  ok(`${name} reads none of it`, Array.isArray(r) && r[0].v === 0 && r[0].e === 0 && r[0].a === 0 && r[0].m === 0 && r[0].s === 0, r);
  { const r = await as(who, `insert into public.std_evidence (subject_type, subject_id, kind, summary) values ('room', $1, 'measured', 'x') returning id, tenant_id`, [room.id]); ok(`${name} can't submit evidence`, refused(r), r); }
}
await db.exec(`set role anon;`);
let anonRead; try { anonRead = (await db.query(`select count(*) from public.std_evidence`)).rows; } catch (e) { anonRead = { error: e.message }; } finally { await db.exec(`reset role;`); }
ok("signed out reaches nothing", !!anonRead.error);
const audited = await q1(`select count(*)::int n from public.admin_audit where table_name like 'std_%'`).catch(() => ({ n: -1 }));
ok("every change is in the activity log", audited.n > 0, audited);

console.log(`0456 — THE PRIMAL STANDARD ENGINE (in Postgres): ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
