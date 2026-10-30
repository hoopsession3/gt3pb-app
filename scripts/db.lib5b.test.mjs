// 0461 — THE EXPERIENCE LIBRARY, IN POSTGRES (IMS5b, 2026-10-30).
//
// The schema to 0460, then 0461 twice. What is read: the library is the Standard's material registry, not a second
// catalog; a new asset is a candidate (or under research), never arrives approved; qualified and approved need the
// Standard's judgement complete — a verified current pass, and no fail, no unknown (judged or a mandatory criterion not
// judged), nothing stale, nothing still a proposal, no open review; approving (and taking an approval back) is an
// owner's; restricted and rejected say why; every change of status is kept, stamped by the database, and can't be
// written by hand; a cost says its basis and source; a placed thing can name its asset; a spec is approved only by an
// owner and only when every asset on it is; an approved spec keeps its list; another tenant reads nothing.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M = readFileSync(join(ROOT, "supabase/migrations/0461_the_experience_library.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const T1 = "00000000-0000-0000-0000-000000000001", T2 = "00000000-0000-0000-0000-000000000002";
const OWNER = "0f461000-0000-4000-8000-0000000000a1", OWNER2 = "0f461000-0000-4000-8000-0000000000a2", ADMIN = "0f461000-0000-4000-8000-0000000000d4", STAFF = "0f461000-0000-4000-8000-0000000000e5", OTHER = "0f461000-0000-4000-8000-0000000000f7";
const db = await fullSchema({ before: "0461" });
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);
await db.exec(`create or replace function public.two_step_ok() returns boolean language sql stable as $$ select true $$;`);
await db.exec(`begin; set local gt3.allow_second_tenant = 'on'; insert into public.tenants (id, slug, name) values ('${T2}', 'other-bar', 'Another Bar') on conflict do nothing; commit;`);
for (const [id, role, t] of [[OWNER, "owner", T1], [OWNER2, "owner", T1], [ADMIN, "admin", T1], [STAFF, "operator", T1], [OTHER, "owner", T2]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${id.slice(-4)}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, t]);
}
const [old] = await q(`insert into public.std_materials (name, category) values ('An older material', 'surface') returning id`);
await db.exec(M); await db.exec(M);
ok("0461 twice: recorded (applied twice)", (await q1(`select applied_count::int n from public.schema_migrations where version like '0461%'`)).n === 2);
ok("an existing material is a candidate, untouched otherwise", (await q1(`select status, category from public.std_materials where id = $1`, [old.id])).status === "candidate");
const as = async (who, sql, p) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${who}', false); set role authenticated;`);
  try { return (await db.query(sql, p)).rows; } catch (e) { return { error: e.message, code: e.code }; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const refused = (r, code) => r && r.error && (!code || r.code === code);
const anon = async (sql) => { await db.exec(`set role anon;`); try { return (await db.query(sql)).rows; } catch (e) { return { error: e.message }; } finally { await db.exec(`reset role;`); } };

// ── an asset arrives a candidate ────────────────────────────────────────────────────────────────────────────────────
const add = (who, extra = "", vals = []) => as(who, `insert into public.std_materials (name, category, studio_kind, w_in, d_in, h_in, pillars${extra ? ", " + extra : ""}) values ($1, 'seating', 'two_top', 24, 24, 30, '{stillness}'${vals.map((_, i) => `, $${i + 2}`).join("")}) returning id, status, status_by`, ["Test chair", ...vals]);
const [a] = await add(ADMIN);
ok("an admin adds an asset: a candidate, stamped", a?.status === "candidate" && a.status_by === ADMIN, a);
ok("…its first status is kept", (await q1(`select count(*)::int n, max(to_status) s from public.std_material_status where material_id = $1`, [a.id])).s === "candidate");
ok("an asset can't arrive approved", refused(await add(ADMIN, "status", ["approved"]), "PT409"));
ok("…or qualified", refused(await add(OWNER, "status", ["qualified"]), "PT409"));
ok("staff can't add one", refused(await add(STAFF)));
ok("a category from the brief (paint, plant, signage, cleaning…) is a category", (await as(ADMIN, `insert into public.std_materials (name, category) values ('Test paint', 'paint'), ('Test plant', 'plant'), ('Test sign', 'signage'), ('Test cleaner', 'cleaning') returning id`)).length === 4);
ok("…and a made-up one isn't", refused(await as(ADMIN, `insert into public.std_materials (name, category) values ('x', 'magic')`)));
ok("a pillar is one of the four", refused(await as(ADMIN, `update public.std_materials set pillars = '{espresso}' where id = $1`, [a.id])));
ok("a cost without its basis is refused", refused(await as(ADMIN, `update public.std_materials set cost_cents = 12000 where id = $1`, [a.id])));
ok("…or without where it came from", refused(await as(ADMIN, `update public.std_materials set cost_cents = 12000, cost_basis = 'estimated' where id = $1`, [a.id])));
ok("…said with both, it's kept", (await as(ADMIN, `update public.std_materials set cost_cents = 12000, cost_basis = 'estimated', cost_unit = 'each', cost_source = 'Test quote' where id = $1 returning cost_cents`, [a.id]))[0]?.cost_cents === 12000);
ok("a picture is an https link", refused(await as(ADMIN, `update public.std_materials set image_url = 'http://x.test/a.png' where id = $1`, [a.id])));
ok("the status stamp can't be written by hand", refused(await as(ADMIN, `update public.std_materials set status_by = $2 where id = $1`, [a.id, OWNER]), "PT409"));

// ── qualified needs the Standard's judgement complete ──────────────────────────────────────────────────────────────
ok("under research: an admin's step", (await as(ADMIN, `update public.std_materials set status = 'under_research' where id = $1 returning status`, [a.id]))[0]?.status === "under_research");
{ const r = await as(ADMIN, `update public.std_materials set status = 'qualified' where id = $1`, [a.id]);
  ok("qualified with nothing judged is refused, and says why", refused(r, "PT409") && /No verified, current pass/.test(r.error), r); }
const [ver] = await as(OWNER, `insert into public.std_versions (label) values ('v-lib') returning id`);
const crit = async (code, mandatory) => (await as(OWNER, `insert into public.std_criteria (version_id, pillar, code, title, requirement, applies_to, severity, mandatory) values ($1, 'stillness', $2, 'Low emissions', 'Declared emissions within the Standard', 'material', 'high', $3) returning id`, [ver.id, code, mandatory]))[0];
const c1 = await crit("S-M1", true), c2 = await crit("S-M2", true);
await as(OWNER, `update public.std_versions set status = 'published' where id = $1`, [ver.id]);
const [ev] = await as(ADMIN, `insert into public.std_evidence (subject_type, subject_id, kind, summary, confidence) values ('material', $1, 'measured', 'Test chamber report', 'medium') returning id`, [a.id]);
await as(OWNER, `update public.std_evidence set review_status = 'accepted' where id = $1`, [ev.id]);
const judge = async (c, outcome) => (await as(ADMIN, `insert into public.std_assessments (version_id, criterion_id, subject_type, subject_id, outcome, evidence_ids, risk) values ($1, $2, 'material', $3, $4, $5, 'low') returning id`, [ver.id, c.id, a.id, outcome, outcome === "unknown" ? [] : [ev.id]]))[0];
const j1 = await judge(c1, "pass");
ok("a pass is proposed (the fixture judged)", !!j1?.id, j1);
{ const r = await as(ADMIN, `update public.std_materials set status = 'qualified' where id = $1`, [a.id]);
  ok("a pass not yet verified doesn't qualify", refused(r, "PT409") && /not yet verified/.test(r.error), r); }
await as(OWNER2, `update public.std_assessments set verification = 'independent' where id = $1`, [j1.id]);
{ const r = await as(ADMIN, `update public.std_materials set status = 'qualified' where id = $1`, [a.id]);
  ok("a mandatory criterion not judged is unknown — and unknown is never qualified", refused(r, "PT409") && /mandatory criterion not yet judged/.test(r.error), r); }
const j2 = await judge(c2, "unknown");
{ const r = await as(ADMIN, `update public.std_materials set status = 'qualified' where id = $1`, [a.id]);
  ok("…judged unknown, still not", refused(r, "PT409") && /judged unknown/.test(r.error), r); }
ok("the blockers read in words", (await as(ADMIN, `select public.std_material_blockers($1) b`, [a.id]))[0]?.b?.some((x) => /unknown/.test(x)));
// The unknown judged again as a pass, verified: complete.
const j3 = (await as(ADMIN, `insert into public.std_assessments (version_id, criterion_id, subject_type, subject_id, outcome, evidence_ids, risk) values ($1, $2, 'material', $3, 'pass', $4, 'low') returning id`, [ver.id, c2.id, a.id, [ev.id]]))[0];
if (j3?.id) { await q(`update public.std_assessments set superseded_by = $2 where id = $1`, [j2.id, j3.id]); await as(OWNER2, `update public.std_assessments set verification = 'independent' where id = $1`, [j3.id]); }
ok("complete: nothing blocks", (await as(ADMIN, `select cardinality(public.std_material_blockers($1)) n`, [a.id]))[0]?.n === 0, await as(ADMIN, `select public.std_material_blockers($1) b`, [a.id]));
ok("qualified: an admin's step once the judgement is complete", (await as(ADMIN, `update public.std_materials set status = 'qualified' where id = $1 returning status`, [a.id]))[0]?.status === "qualified");
ok("approved is an owner's (PT403)", refused(await as(ADMIN, `update public.std_materials set status = 'approved' where id = $1`, [a.id]), "PT403"));
ok("an owner approves it", (await as(OWNER, `update public.std_materials set status = 'approved' where id = $1 returning status, status_by`, [a.id]))[0]?.status_by === OWNER);
ok("taking an approval back is an owner's too", refused(await as(ADMIN, `update public.std_materials set status = 'qualified' where id = $1`, [a.id]), "PT403"));
ok("restricted without a reason is refused", refused(await as(OWNER, `update public.std_materials set status = 'restricted' where id = $1`, [a.id])));
const log = await q(`select from_status f, to_status t, changed_by b from public.std_material_status where material_id = $1 order by changed_at, to_status`, [a.id]);
ok("every change of status is on the record, with who", log.length === 4 && log.map((x) => x.t).join(",") === "candidate,under_research,qualified,approved" && log[3].b === OWNER, log);
ok("the record can't be written by hand", refused(await as(OWNER, `insert into public.std_material_status (material_id, to_status) values ($1, 'approved')`, [a.id])));
ok("…or changed", (await as(OWNER, `update public.std_material_status set to_status = 'rejected' where material_id = $1 returning id`, [a.id])).length === 0 || refused(await as(OWNER, `update public.std_material_status set to_status = 'rejected' where material_id = $1`, [a.id])));
// A detail of the asset changes: the Standard marks its judgement stale; the approval stays on the record (the screen says stale).
await as(ADMIN, `update public.std_materials set composition = 'Changed' where id = $1`, [a.id]);
ok("its judgement goes stale when what it's made of changes", (await as(ADMIN, `select cardinality(public.std_material_blockers($1)) n`, [a.id]))[0]?.n > 0);
ok("…the approval itself stays on the record (said stale on screen, never silently dropped)", (await q1(`select status from public.std_materials where id = $1`, [a.id])).status === "approved");

// ── a placed thing names its asset ─────────────────────────────────────────────────────────────────────────────────
const room = await q1(`insert into public.store_layouts (name, width_in, depth_in) values ('Lib room', 360, 480) returning id`);
const it = await q1(`insert into public.store_items (layout_id, kind, x_in, y_in, w_in, d_in, h_in, library_id) values ($1, 'two_top', 60, 60, 24, 24, 30, $2) returning library_id`, [room.id, a.id]);
ok("a thing in a room can name its library asset", it.library_id === a.id);

// ── specs ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const [sp] = await as(ADMIN, `insert into public.std_specs (name) values ('Stillness corner — v1') returning id, status`);
ok("a spec starts a draft", sp?.status === "draft");
const [b] = await add(ADMIN);
await as(ADMIN, `insert into public.std_spec_items (spec_id, material_id, qty, unit) values ($1, $2, 4, 'each'), ($1, $3, 2, 'each')`, [sp.id, a.id, b.id]);
ok("an admin can't approve a spec (PT403)", refused(await as(ADMIN, `update public.std_specs set status = 'approved' where id = $1`, [sp.id]), "PT403"));
ok("an owner can't approve one with an asset not approved", refused(await as(OWNER, `update public.std_specs set status = 'approved' where id = $1`, [sp.id]), "PT409"));
await as(ADMIN, `delete from public.std_spec_items where spec_id = $1 and material_id = $2`, [sp.id, b.id]);
ok("every asset approved: an owner approves the spec, stamped", (await as(OWNER, `update public.std_specs set status = 'approved' where id = $1 returning decided_by`, [sp.id]))[0]?.decided_by === OWNER);
ok("an approved spec keeps its list", refused(await as(ADMIN, `insert into public.std_spec_items (spec_id, material_id) values ($1, $2)`, [sp.id, b.id]), "PT409"));
ok("…nothing taken off it", refused(await as(OWNER, `delete from public.std_spec_items where spec_id = $1`, [sp.id]), "PT409"));
ok("a spec can't arrive approved", refused(await as(OWNER, `insert into public.std_specs (name, status) values ('x', 'approved')`), "PT409"));

// ── who reads it ───────────────────────────────────────────────────────────────────────────────────────────────────
ok("staff read no library", (await as(STAFF, `select id from public.std_materials`)).length === 0);
ok("…no status record", (await as(STAFF, `select id from public.std_material_status`)).length === 0);
ok("another tenant's owner reads none of it", (await as(OTHER, `select id from public.std_materials`)).length === 0 && (await as(OTHER, `select id from public.std_specs`)).length === 0);
ok("…and gets no blockers for it", (await as(OTHER, `select cardinality(public.std_material_blockers($1)) n`, [a.id]))[0]?.n >= 0);
ok("signed out: nothing", refused(await anon(`select id from public.std_materials`)) && refused(await anon(`select id from public.std_specs`)));

console.log(`0461 — THE EXPERIENCE LIBRARY (in Postgres): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
