// 0462 — GT3 RESEARCHES, A HUMAN DECIDES, IN POSTGRES (IMS6 Phase A1, 2026-10-30).
//
// The schema to 0461, then 0462 twice. What is read, as each role, the way the API would ask: a fact arrives pending and
// is never edited; bulk acceptance takes only low-risk sourced facts — never an inference, never health or safety, never
// a conflict; accepting writes the specification and supersedes what was accepted before; a supplier's new value is a
// pending difference; accepting what an asset is made of marks the Standard's judgements stale (0456's trigger); accepting
// changes no status and no assessment; a variant inherits nothing; the budget is reserved before a run and settled after —
// a partial or missing report is charged in full, a run past its deadline is closed in full, the day's ceiling holds under
// many reservations; only an owner changes the budget; staff, signed-out and another tenant reach none of it; the intake
// files are private to their tenant's owners and admins.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M = readFileSync(join(ROOT, "supabase/migrations/0462_gt3_researches_a_human_decides.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 600)}` : "")); } };
const T1 = "00000000-0000-0000-0000-000000000001", T2 = "00000000-0000-0000-0000-000000000002";
const OWNER = "0f462000-0000-4000-8000-0000000000a1", OWNER2 = "0f462000-0000-4000-8000-0000000000a2", ADMIN = "0f462000-0000-4000-8000-0000000000d4", STAFF = "0f462000-0000-4000-8000-0000000000e5", OTHER = "0f462000-0000-4000-8000-0000000000f7";
const db = await fullSchema({ before: "0462" });
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
await db.exec(`grant usage on schema public to anon, authenticated, service_role; grant usage on schema storage to anon, authenticated;
  grant select, insert, update, delete on storage.objects to anon, authenticated, service_role; alter table storage.objects enable row level security;`);   // as Supabase has it
await db.exec(`create or replace function public.two_step_ok() returns boolean language sql stable as $$ select true $$;`);
await db.exec(`begin; set local gt3.allow_second_tenant = 'on'; insert into public.tenants (id, slug, name) values ('${T2}', 'other-bar', 'Another Bar') on conflict do nothing; commit;`);
for (const [id, role, t] of [[OWNER, "owner", T1], [OWNER2, "owner", T1], [ADMIN, "admin", T1], [STAFF, "operator", T1], [OTHER, "owner", T2]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${id.slice(-4)}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, t]);
}
await db.exec(M); await db.exec(M);
ok("0462 twice: recorded (applied twice)", (await q1(`select applied_count::int n from public.schema_migrations where version like '0462%'`)).n === 2);
const as = async (who, sql, p) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${who}', false); set role authenticated;`);
  try { return (await db.query(sql, p)).rows; } catch (e) { return { error: e.message, code: e.code }; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const refused = (r, code) => r && r.error && (!code || r.code === code);
const anon = async (sql, p) => { await db.exec(`set role anon;`); try { return (await db.query(sql, p)).rows; } catch (e) { return { error: e.message, code: e.code }; } finally { await db.exec(`reset role;`); } };
const HASH = (c) => c.repeat(64).slice(0, 64);

// ── an asset, an intake, facts ─────────────────────────────────────────────────────────────────────────────────────
const [a] = await as(ADMIN, `insert into public.std_materials (name, category) values ('Test table', 'furniture') returning id`);
const [it] = await as(ADMIN, `insert into public.std_intakes (kind, input, request_hash) values ('url', 'https://maker.test/table', $1) returning id, status`, [HASH("a")]);
ok("an intake starts queued", it?.status === "queued", it);
ok("a URL intake must be https", refused(await as(ADMIN, `insert into public.std_intakes (kind, input, request_hash) values ('url', 'http://x.test', $1)`, [HASH("b")])));
const fact = (who, field, value, o = {}) => as(who, `insert into public.std_asset_facts (material_id, intake_id, field, value, unit, source_class, source_kind, source_ref, source_title, method, confidence, risk, review, reviewed_by)
  values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id, review, risk, reviewed_by, created_by`,
  [o.material ?? a.id, it.id, field, JSON.stringify(value), o.unit ?? null, o.cls ?? "manufacturer", o.kind ?? "url", o.ref === undefined ? "https://maker.test/table" : o.ref, o.title ?? "Maker spec page", o.method ?? "quoted", o.conf ?? "high", o.risk ?? "low", o.review ?? "pending", o.reviewedBy ?? null]);
const [fw] = await fact(ADMIN, "w_in", 96, { unit: "in", review: "accepted", reviewedBy: OWNER });
ok("a fact arrives pending, whatever it says", fw?.review === "pending" && fw.reviewed_by === null && fw.created_by === ADMIN, fw);
const [fd] = await fact(ADMIN, "d_in", 36, { unit: "in" });
const [fm] = await fact(ADMIN, "maker", "Test Maker");
const [fc] = await fact(ADMIN, "composition", "Solid oak, oil finish", { risk: "low" });
ok("a health or safety field is high risk, whatever it says", fc?.risk === "high", fc);
const [fi] = await fact(ADMIN, "finishes", "Natural oil", { cls: "ai_inference", method: "inferred", ref: null });
ok("an inference is the AI's, said so", refused(await fact(ADMIN, "finishes", "x", { cls: "manufacturer", method: "inferred" })) && refused(await fact(ADMIN, "finishes", "x", { cls: "ai_inference", method: "quoted" })));
ok("a sourced fact names its source", refused(await fact(ADMIN, "supplier", "x", { ref: null })));
ok("a fact is never edited by hand", refused(await as(ADMIN, `update public.std_asset_facts set review = 'accepted' where id = $1`, [fd.id])) || (await q1(`select review from public.std_asset_facts where id = $1`, [fd.id])).review === "pending");
ok("…or deleted", refused(await as(OWNER, `delete from public.std_asset_facts where id = $1`, [fd.id])) || (await q1(`select count(*)::int n from public.std_asset_facts where id = $1`, [fd.id])).n === 1);

// ── review: bulk takes only the safe ───────────────────────────────────────────────────────────────────────────────
ok("bulk acceptance refuses a health or safety field", refused(await as(ADMIN, `select public.std_accept_facts($1, '{}', true)`, [[fw.id, fc.id]]), "PT409"));
ok("…and an inference", refused(await as(ADMIN, `select public.std_accept_facts($1, '{}', true)`, [[fi.id]]), "PT409"));
ok("…and leaves nothing half done", (await q1(`select review from public.std_asset_facts where id = $1`, [fw.id])).review === "pending");
const [fw2] = await fact(ADMIN, "w_in", 94, { cls: "supplier", ref: "https://shop.test/table", title: "Supplier listing", unit: "in" });
ok("two sources disagree: the conflict is listed", (await as(ADMIN, `select values_seen from public.std_fact_conflicts where material_id = $1 and field = 'w_in'`, [a.id]))[0]?.values_seen === 2);
ok("bulk refuses a conflicting field", refused(await as(ADMIN, `select public.std_accept_facts($1, '{}', true)`, [[fw.id]]), "PT409"));
ok("bulk takes the safe rest", (await as(ADMIN, `select public.std_accept_facts($1, '{}', true) n`, [[fd.id, fm.id]]))[0]?.n === 2);
const spec = async () => q1(`select w_in::float w, d_in::float d, maker, composition, finishes, status from public.std_materials where id = $1`, [a.id]);
ok("accepting writes the specification", (await spec()).d === 36 && (await spec()).maker === "Test Maker");
ok("a conflict is decided one at a time: the manufacturer's width", (await as(ADMIN, `select public.std_accept_facts($1) n`, [[fw.id]]))[0]?.n === 1 && (await spec()).w === 96);
await as(ADMIN, `select public.std_reject_facts($1, 'Supplier listing rounds the size')`, [[fw2.id]]);
ok("…the other rejected, with why, kept on the record", (await q1(`select review, review_note from public.std_asset_facts where id = $1`, [fw2.id])).review === "rejected");
ok("an inference accepted on its own is labelled so for good", (await as(ADMIN, `select public.std_accept_facts($1) n`, [[fi.id]]))[0]?.n === 1 && (await q1(`select method, review from public.std_asset_facts where id = $1`, [fi.id])).method === "inferred");
ok("a correction keeps the original value and its source", (await as(ADMIN, `select public.std_accept_facts($1, $2::jsonb) n`, [[fc.id], JSON.stringify({ [fc.id]: "Solid white oak, plant-oil finish" })]))[0]?.n === 1
  && (await q1(`select review, value #>> '{}' v, corrected_value #>> '{}' c from public.std_asset_facts where id = $1`, [fc.id])).v === "Solid oak, oil finish" && (await spec()).composition === "Solid white oak, plant-oil finish");
ok("a reviewed fact stays as reviewed", refused(await as(ADMIN, `select public.std_accept_facts($1)`, [[fd.id]]), "PT409"));
ok("accepting changes no status", (await spec()).status === "candidate");
// A supplier's new value later: a pending difference, the specification untouched; accepted, the old one superseded.
const [fd2] = await fact(ADMIN, "d_in", 38, { cls: "supplier", ref: "https://shop.test/table-v2", unit: "in" });
ok("a supplier's new value is a pending difference — nothing overwritten", fd2?.review === "pending" && (await spec()).d === 36);
await as(OWNER, `select public.std_accept_facts($1)`, [[fd2.id]]);
ok("…accepted, it's the specification and the old fact is superseded", (await spec()).d === 38 && (await q1(`select review from public.std_asset_facts where id = $1`, [fd.id])).review === "superseded");
const cost = (await fact(ADMIN, "cost_cents", 189000, { cls: "supplier", ref: "https://shop.test/table", title: "Supplier listing", unit: "each" }))[0];
await as(ADMIN, `select public.std_accept_facts($1, '{}', true)`, [[cost.id]]);
ok("an accepted price carries its basis and source", (await q1(`select cost_cents, cost_basis, cost_source, cost_unit from public.std_materials where id = $1`, [a.id])).cost_basis === "actual");

// ── staleness: the Standard's own trigger ─────────────────────────────────────────────────────────────────────────
const [ver] = await as(OWNER, `insert into public.std_versions (label) values ('v-a1') returning id`);
const [cr] = await as(OWNER, `insert into public.std_criteria (version_id, pillar, code, title, requirement, applies_to, severity, categories) values ($1, 'stillness', 'S-A1', 'Finish emissions', 'Declared finish emissions', 'material', 'high', '{furniture,seating}') returning id, categories`, [ver.id]);
ok("a criterion names the library categories it applies to", cr?.categories?.join() === "furniture,seating", cr);
await as(OWNER, `update public.std_versions set status = 'published' where id = $1`, [ver.id]);
const [ev] = await as(ADMIN, `insert into public.std_evidence (subject_type, subject_id, kind, summary, confidence) values ('material', $1, 'declared', 'Test spec sheet', 'medium') returning id`, [a.id]);
await as(OWNER, `update public.std_evidence set review_status = 'accepted' where id = $1`, [ev.id]);
const as1r = await as(ADMIN, `insert into public.std_assessments (version_id, criterion_id, subject_type, subject_id, outcome, evidence_ids, risk) values ($1, $2, 'material', $3, 'pass', $4, 'low') returning id`, [ver.id, cr.id, a.id, [ev.id]]); if (as1r.error) console.log("  (assessment fixture:", as1r.error, ")"); const as1 = as1r[0] ?? {};
const [fc2] = await fact(ADMIN, "composition", "Oak veneer on particleboard", { cls: "supplier", ref: "https://shop.test/table-v3" });
await as(OWNER, `select public.std_accept_facts($1)`, [[fc2.id]]);
ok("what it's made of changes → its judgement goes stale", !!(await q1(`select stale_at from public.std_assessments where id = $1`, [as1.id])).stale_at);
ok("accepting never writes an assessment", (await q1(`select count(*)::int n from public.std_assessments where subject_id = $1`, [a.id])).n === 1);

// ── variants inherit nothing ───────────────────────────────────────────────────────────────────────────────────────
const [vr] = await as(ADMIN, `insert into public.std_materials (name, category, family_id) values ('Test table — walnut', 'furniture', $1) returning id, status`, [a.id]);
ok("a variant names its family, starts a candidate, and inherits no judgement", vr?.status === "candidate" && (await as(ADMIN, `select public.std_material_blockers($1) b`, [vr.id]))[0]?.b?.some((x) => /No verified, current pass/.test(x)));
ok("an asset isn't its own family", refused(await as(ADMIN, `update public.std_materials set family_id = id where id = $1`, [a.id])));

const room = await q1(`insert into public.store_layouts (name, width_in, depth_in) values ('A1 room', 360, 480) returning id`);
ok("a placed thing can name its tenant's asset", (await as(ADMIN, `insert into public.store_items (layout_id, kind, x_in, y_in, w_in, d_in, h_in, library_id) values ($1, 'two_top', 60, 60, 24, 24, 30, $2) returning library_id`, [room.id, a.id]))[0]?.library_id === a.id);
const [theirs] = await as(OTHER, `insert into public.std_materials (name, category) values ('Their chair', 'seating') returning id`);
ok("…not another tenant's (a foreign key alone would let it in)", refused(await as(ADMIN, `insert into public.store_items (layout_id, kind, x_in, y_in, w_in, d_in, h_in, library_id) values ($1, 'two_top', 90, 90, 24, 24, 30, $2)`, [room.id, theirs.id])));
ok("…a variant's family is its own tenant's", refused(await as(ADMIN, `insert into public.std_materials (name, category, family_id) values ('x', 'seating', $1)`, [theirs.id])));
ok("…a spec lists only its own tenant's assets", await (async () => { const [sp] = await as(ADMIN, `insert into public.std_specs (name) values ('A1 spec') returning id`); return refused(await as(ADMIN, `insert into public.std_spec_items (spec_id, material_id) values ($1, $2)`, [sp.id, theirs.id])); })());

// ── the budget ─────────────────────────────────────────────────────────────────────────────────────────────────────
const reserve = (who, depth = "standard", intake = it.id) => as(who, `select public.std_research_reserve($1, $2) id`, [intake, depth]);
const [r1] = await reserve(ADMIN);
ok("a run reserves its ceiling (25¢) before it starts", (await q1(`select reserved_cents, charged_cents::float c, outcome from public.std_research_runs where id = $1`, [r1.id])).c === 25);
ok("…and the intake is researching", (await q1(`select status from public.std_intakes where id = $1`, [it.id])).status === "researching");
ok("settled with a full report: charged what it cost", (await as(ADMIN, `select public.std_research_settle($1, $2::jsonb, 7.4, 'done') c`, [r1.id, JSON.stringify({ searches: 3, fetches: 2, input_tokens: 18000, output_tokens: 1500 })]))[0]?.c == 7.4);
ok("…settled once", refused(await as(ADMIN, `select public.std_research_settle($1, '{}'::jsonb, 1, 'done')`, [r1.id]), "PT409"));
const [r2] = await reserve(ADMIN);
ok("a report missing a count is charged in full", (await as(ADMIN, `select public.std_research_settle($1, $2::jsonb, 3, 'done') c`, [r2.id, JSON.stringify({ searches: 1, input_tokens: 9000 })]))[0]?.c == 25 && (await q1(`select outcome from public.std_research_runs where id = $1`, [r2.id])).outcome === "unreported");
const [r3] = await reserve(ADMIN);
await q(`update public.std_research_runs set deadline_at = now() - interval '1 minute' where id = $1`, [r3.id]);
await reserve(ADMIN).then(async (r) => { await as(ADMIN, `select public.std_research_settle($1, $2::jsonb, 1, 'done')`, [r[0].id, JSON.stringify({ searches: 0, fetches: 0, input_tokens: 1, output_tokens: 1 })]); });
ok("a run past its deadline is closed, charged in full", (await q1(`select outcome, charged_cents::float c from public.std_research_runs where id = $1`, [r3.id])).outcome === "unreported");
const r4 = await as(ADMIN, `select public.std_research_settle($1, $2::jsonb, 40, 'done') c`, [(await reserve(ADMIN))[0].id, JSON.stringify({ searches: 5, fetches: 3, input_tokens: 90000, output_tokens: 4000 })]);
ok("an overrun is charged as it was, not hidden", r4[0]?.c == 40, r4);
// Fill the day (300¢): reserve until refused; what was let through fits, and the next wouldn't have.
const spent = async () => Number((await q1(`select coalesce(sum(charged_cents), 0)::float s from public.std_research_runs where started_at >= date_trunc('day', now())`)).s);
let fit = 0, over = null; for (let k = 0; k < 20; k++) { const r = await reserve(ADMIN); if (r.error) { over = r; break; } fit++; }
const day = await spent();
ok("the day's ceiling holds: reservations stop when the next won't fit", fit > 0 && refused(over, "PT429") && day <= 300 && day + 25 > 300, { fit, day, over });
ok("…and a refused reservation leaves no run behind", (await q1(`select count(*)::int n from public.std_research_runs`)).n === fit + 5);
ok("an admin can't raise the budget (PT403)", refused(await as(ADMIN, `update public.std_research_budget set daily_cents = 5000`), "PT403"));
ok("…an owner can", (await as(OWNER, `update public.std_research_budget set daily_cents = 400 returning daily_cents`))[0]?.daily_cents === 400);
ok("nobody inserts a budget or a run by hand", refused(await as(OWNER, `insert into public.std_research_budget (tenant_id, daily_cents) values ($1, 9999)`, [T2])) && refused(await as(ADMIN, `insert into public.std_research_runs (intake_id, depth, reserved_cents, charged_cents, deadline_at) values ($1, 'light', 0, 0, now())`, [it.id])));
ok("…or settles a run as if it cost nothing by editing it", refused(await as(ADMIN, `update public.std_research_runs set charged_cents = 0`)) || (await q1(`select count(*)::int n from public.std_research_runs where charged_cents = 0`)).n === 0);

// ── who reaches it (as the API would ask) ──────────────────────────────────────────────────────────────────────────
for (const [who, name] of [[STAFF, "staff"], [OTHER, "another tenant's owner"]]) {
  ok(`${name}: no facts, intakes or runs`, (await as(who, `select id from public.std_asset_facts`)).length === 0 && (await as(who, `select id from public.std_intakes`)).length === 0 && (await as(who, `select id from public.std_research_runs`)).length === 0);
  ok(`${name}: can't accept`, refused(await as(who, `select public.std_accept_facts($1)`, [[fd2.id]])));
  ok(`${name}: can't reserve`, refused(await as(who, `select public.std_research_reserve($1, 'light')`, [it.id])));
  ok(`${name}: can't add a fact`, refused(await as(who, `insert into public.std_asset_facts (material_id, field, value, source_class, source_kind, source_ref, method) values ($1, 'maker', '"x"', 'manufacturer', 'url', 'https://x.test', 'quoted')`, [a.id])));
}
ok("signed out: none of it", refused(await anon(`select id from public.std_asset_facts`)) && refused(await anon(`select public.std_accept_facts($1)`, [[fd2.id]])) && refused(await anon(`select public.std_research_reserve($1, 'light')`, [it.id])));
ok("a forged claim of being an owner changes nothing (the role is read from the profile)", await (async () => {
  await db.exec(`select set_config('request.jwt.claims', '{"role":"authenticated","user_role":"owner","tenant_id":"${T1}"}', false);`);
  const r = await as(STAFF, `select public.std_accept_facts($1)`, [[fd2.id]]);
  await db.exec(`select set_config('request.jwt.claims', '', false);`);
  return refused(r);
})());
ok("every new function is closed to PUBLIC and anon", (await q1(`select bool_and(not has_function_privilege('anon', p.oid, 'execute')) b from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('std_research_reserve','std_research_settle','std_accept_facts','std_reject_facts','std_fact_guard','std_research_budget_guard')`)).b === true);

// ── the intake files ───────────────────────────────────────────────────────────────────────────────────────────────
const bucket = await q1(`select public, file_size_limit::int s, allowed_mime_types m from storage.buckets where id = 'library-intake'`);
ok("the intake bucket is private, 20 MB, documents and photos only", bucket?.public === false && bucket.s === 20971520 && bucket.m.includes("application/pdf") && !bucket.m.includes("image/svg+xml"), bucket);
const put = (who, path) => as(who, `insert into storage.objects (bucket_id, name) values ('library-intake', $1) returning name`, [path]);
ok("an admin files under their own tenant", (await put(ADMIN, `${T1}/${it.id}/spec.pdf`))[0]?.name?.endsWith("spec.pdf"));
ok("…not under another tenant's", refused(await put(ADMIN, `${T2}/${it.id}/spec.pdf`)));
ok("staff can't file", refused(await put(STAFF, `${T1}/${it.id}/x.pdf`)));
ok("another tenant can't read ours", (await as(OTHER, `select name from storage.objects where bucket_id = 'library-intake'`)).length === 0);
ok("signed out: no file", refused(await anon(`select name from storage.objects where bucket_id = 'library-intake'`)) || (await anon(`select name from storage.objects where bucket_id = 'library-intake'`)).length === 0);

console.log(`0462 — GT3 RESEARCHES, A HUMAN DECIDES (in Postgres): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
