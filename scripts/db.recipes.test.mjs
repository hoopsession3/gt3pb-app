// 0476 · RECIPES ARE KEPT IN THE APP (in Postgres). Who may draft, submit, publish, decline and restore a recipe version,
// and who may read what. A crew member drafts and submits; an owner or admin decides; one version is published at a time
// and the one before is kept and can be restored; drafts are the author's (and the deciders') alone; another business
// sees none of it; the signed-out see nothing. No new privileged function.
import { fullSchema } from "./fixtures/schema.full.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}${got !== undefined ? ` → ${JSON.stringify(got).slice(0, 400)}` : ""}`); } };
const T1 = "00000000-0000-0000-0000-000000000001", T2 = "0c476000-0000-4000-8000-0000000000b2";
const ALEX = "0c476000-0000-4000-8000-0000000000a1";   // owner
const RAE = "0c476000-0000-4000-8000-0000000000a2";    // admin
const KAY = "0c476000-0000-4000-8000-0000000000a3";    // crew (server) — the author
const DEV = "0c476000-0000-4000-8000-0000000000a6";    // crew (operator) — another crew member
const SAM = "0c476000-0000-4000-8000-0000000000a4";    // a member
const OLA = "0c476000-0000-4000-8000-0000000000a5";    // owner of another business

const db = await fullSchema({});
const q = async (s, p) => (await db.query(s, p)).rows, q1 = async (s, p) => (await q(s, p))[0];
await db.exec(`grant usage on schema public to anon, authenticated, service_role;
  do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;`);
await db.exec(`begin; set local gt3.allow_second_tenant = 'on'; insert into public.tenants (id, slug, name) values ('${T2}', 'other-business-476', 'Other business') on conflict do nothing; commit;`);
for (const [id, role, t] of [[ALEX, "owner", T1], [RAE, "admin", T1], [KAY, "server", T1], [DEV, "operator", T1], [SAM, "member", T1], [OLA, "owner", T2]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${id.slice(-2)}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, t]);
}
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', '', false); select set_config('request.jwt.claims', '', false);`);
const as = async (who, sql, params) => {
  const role = who ? "authenticated" : "anon", sub = who ?? "";
  await db.exec(`select set_config('request.jwt.claim.sub', '${sub}', false); select set_config('request.jwt.claim.role', '${role}', false);
    select set_config('request.jwt.claims', '${JSON.stringify({ sub, role, aal: "aal1" })}', false); set role ${role};`);
  try { return { rows: (await db.query(sql, params)).rows, code: null }; } catch (e) { return { rows: [], code: e.code ?? "?", error: String(e.message) }; } finally { await root(); }
};
const BODY = (cold) => JSON.stringify({ batch: `Single mix — makes 10.5 fl oz: ${cold} fl oz DUSK cold brew`, amounts: [{ item: "DUSK cold brew", single: cold, large: 85, unit: "fl oz" }] });
const row = async (id) => q1(`select status, version_no, decided_by, published_at, submitted_at, body from public.recipe_versions where id = $1`, [id]);
const published = async () => q(`select id, version_no from public.recipe_versions where tenant_id = $1 and product_key = 'salted_maple' and status = 'published'`, [T1]);

// ── a crew member drafts and submits ─────────────────────────────────────────────────────────────────────────────────
const d1 = await as(KAY, `insert into public.recipe_versions (product_key, body, note) values ('salted_maple', $1::jsonb, 'from the corrected card') returning id, status, created_by`, [BODY(7)]);
ok("a crew member saves a draft correction of a recipe", !d1.code && d1.rows[0]?.status === "draft" && d1.rows[0]?.created_by === KAY, d1);
const V1 = d1.rows[0]?.id;
ok("…she sees her own draft", (await as(KAY, `select id from public.recipe_versions where id = $1`, [V1])).rows.length === 1);
ok("…another crew member does not see it (a draft is the author's)", (await as(DEV, `select id from public.recipe_versions where id = $1`, [V1])).rows.length === 0);
ok("…an admin sees it (the deciders see every draft)", (await as(RAE, `select id from public.recipe_versions where id = $1`, [V1])).rows.length === 1);
ok("…a member sees nothing, and can't draft", (await as(SAM, `select id from public.recipe_versions`)).rows.length === 0
  && !!(await as(SAM, `insert into public.recipe_versions (product_key, body) values ('salted_maple', '{}'::jsonb)`)).code);
ok("…signed out: refused outright (no grant)", (await as(null, `select id from public.recipe_versions`)).code === "42501");
ok("…another business's owner sees none of it", (await as(OLA, `select id from public.recipe_versions`)).rows.length === 0);
ok("a crew member can't save a version as published, or with a decision on it", !!(await as(KAY, `insert into public.recipe_versions (product_key, body, status) values ('salted_maple', '{}'::jsonb, 'published')`)).code
  && !!(await as(KAY, `insert into public.recipe_versions (product_key, body, version_no) values ('salted_maple', '{}'::jsonb, 9)`)).code);
const sub = await as(KAY, `update public.recipe_versions set status = 'submitted', body = $2::jsonb where id = $1 returning status, submitted_at`, [V1, BODY(7)]);
ok("she submits it for review (submitted_at stamped)", !sub.code && sub.rows[0]?.status === "submitted" && !!sub.rows[0]?.submitted_at, sub);
const pub1 = await as(KAY, `update public.recipe_versions set status = 'published' where id = $1`, [V1]);
ok("…and can't publish it herself: only an owner or an admin publishes", pub1.code === "42501" && (await row(V1)).status === "submitted", pub1);
ok("…nor stamp a decision on it", (await as(KAY, `update public.recipe_versions set decided_by = $2 where id = $1`, [V1, KAY])).code === "42501");
ok("…nor move it to another recipe", (await as(KAY, `update public.recipe_versions set product_key = 'rise' where id = $1`, [V1])).code === "42501");

// ── an admin publishes; the next one retires it; an owner restores it ───────────────────────────────────────────────
const p1 = await as(RAE, `update public.recipe_versions set status = 'published' where id = $1 returning version_no, decided_by, published_at`, [V1]);
ok("an admin publishes it: version 1, the admin named as the decider, the time stamped", !p1.code && p1.rows[0]?.version_no === 1 && p1.rows[0]?.decided_by === RAE && !!p1.rows[0]?.published_at, p1);
ok("…every crew member now reads the published version", (await as(DEV, `select id from public.recipe_versions where id = $1 and status = 'published'`, [V1])).rows.length === 1);
ok("…a published version can't be edited in place, even by an admin: a correction is a new draft", (await as(ALEX, `update public.recipe_versions set body = '{}'::jsonb where id = $1`, [V1])).code === "22023");
ok("…and the author can no longer change it", (await as(KAY, `update public.recipe_versions set body = '{}'::jsonb where id = $1 returning id`, [V1])).rows.length === 0 && JSON.stringify((await row(V1)).body).includes("10.5"));
const d2 = await as(DEV, `insert into public.recipe_versions (product_key, body, status, based_on) values ('salted_maple', $1::jsonb, 'submitted', $2) returning id`, [BODY(8), V1]);
const V2 = d2.rows[0]?.id;
const p2 = await as(ALEX, `update public.recipe_versions set status = 'published' where id = $1 returning version_no`, [V2]);
ok("an owner publishes the next one: version 2 — and version 1 is retired, kept, not deleted", !p2.code && p2.rows[0]?.version_no === 2 && (await row(V1)).status === "retired", { p2, v1: await row(V1) });
ok("…exactly one version is published at a time", (await published()).length === 1 && (await published())[0].id === V2);
ok("…the retired one stays readable by the crew (the history)", (await as(KAY, `select id from public.recipe_versions where id = $1`, [V1])).rows.length === 1);
const r1 = await as(ALEX, `update public.recipe_versions set status = 'published' where id = $1 returning version_no`, [V1]);
ok("restore: the owner publishes version 1 again — it keeps its number, version 2 is retired", !r1.code && r1.rows[0]?.version_no === 1 && (await row(V2)).status === "retired" && (await published())[0]?.id === V1, r1);
ok("…a crew member can't restore one", (await as(KAY, `update public.recipe_versions set status = 'published' where id = $1 returning id`, [V2])).rows.length === 0 && (await published())[0]?.id === V1);

// ── declined, discarded ──────────────────────────────────────────────────────────────────────────────────────────────
const d3 = await as(KAY, `insert into public.recipe_versions (product_key, body, status) values ('salted_maple', $1::jsonb, 'submitted') returning id`, [BODY(9)]);
const dec = await as(RAE, `update public.recipe_versions set status = 'declined' where id = $1 returning decided_by`, [d3.rows[0]?.id]);
ok("an admin declines a submission; the author sees it declined", !dec.code && dec.rows[0]?.decided_by === RAE && (await as(KAY, `select status from public.recipe_versions where id = $1`, [d3.rows[0]?.id])).rows[0]?.status === "declined");
const d4 = await as(KAY, `insert into public.recipe_versions (product_key, body) values ('salted_maple', '{}'::jsonb) returning id`);
ok("the author discards her own unsent draft", (await as(KAY, `delete from public.recipe_versions where id = $1 returning id`, [d4.rows[0]?.id])).rows.length === 1);
ok("…but no one deletes a published or retired version", (await as(ALEX, `delete from public.recipe_versions where id = $1 returning id`, [V2])).rows.length === 0 && !!(await row(V2)));

// ── no new privileged function ──────────────────────────────────────────────────────────────────────────────────────
const g = await q1(`select prosecdef, has_function_privilege('authenticated', oid, 'execute') x from pg_proc where proname = 'recipe_versions_guard'`);
const callable = await q1(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')) and p.prorettype <> 'trigger'::regtype`);
ok("the guard is a trigger the API can't call (EXECUTE revoked), and pins its search_path: no new callable privileged function", g?.x === false && (await q1(`select proconfig from pg_proc where proname = 'recipe_versions_guard'`)).proconfig?.some((c) => /search_path/.test(c)), g);
ok("…the callable SECURITY DEFINER count is the approved 140", callable.n === 140, callable);
ok("the policies wrap their helpers (asked once a query)", (await q(`select count(*)::int n from pg_policies where tablename = 'recipe_versions' and (qual ~ '(?<!SELECT )is_staff\\(\\)' or qual ~ '(?<!SELECT )is_admin\\(\\)')`))[0].n === 0);

// 0477: the API role keeps select, insert, update and delete — no TRUNCATE (it skips row-level security), TRIGGER or REFERENCES.
const priv = async (role, p) => (await q1(`select has_table_privilege($1, 'public.recipe_versions', $2) x`, [role, p])).x;
ok("0477: signed in, the table can be read and written row by row, never truncated, triggered or referenced",
  (await priv("authenticated", "SELECT")) && (await priv("authenticated", "INSERT")) && (await priv("authenticated", "UPDATE")) && (await priv("authenticated", "DELETE"))
  && !(await priv("authenticated", "TRUNCATE")) && !(await priv("authenticated", "TRIGGER")) && !(await priv("authenticated", "REFERENCES")));
ok("0477: signed out, nothing at all", !(await priv("anon", "SELECT")) && !(await priv("anon", "TRUNCATE")));

console.log(`0476 — RECIPES ARE KEPT IN THE APP (in Postgres): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
