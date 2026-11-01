// IMS8 A2 — A LINK LEAVES NO KEY BEHIND (0468), IN POSTGRES. No investor-link token in the activity log — on create, edit,
// open or revoke; an open writes no line; a link's line is named fields only. The activity log is per business (stamped,
// legacy rows given their business or left unreadable) and append-only by grant. Revocation is final; a link's key,
// maker, business and start never change; its counters move only through its own door. The separate historical cleanup
// takes tokens out of lines already written and says how many. Logs here never print a token.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M = readFileSync(join(ROOT, "supabase/migrations/0468_a_link_leaves_no_key_behind.sql"), "utf8");
const CLEAN = readFileSync(join(ROOT, "supabase/cleanup/0468_audit_tokens.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → ${JSON.stringify(got)?.replace(/[0-9a-f]{40,}/g, "<token>").slice(0, 500)}` : "")); } };
const T1 = "00000000-0000-0000-0000-000000000001", T2 = "0c468000-0000-4000-8000-0000000000b2";
const OWNER = "0c468000-0000-4000-8000-0000000000a1", ADMIN = "0c468000-0000-4000-8000-0000000000a2", OTHER = "0c468000-0000-4000-8000-0000000000a4";

const setup = async (tenants) => {
  const db = await fullSchema({ before: "0468" });
  const q = async (s, p) => (await db.query(s, p)).rows, q1 = async (s, p) => (await q(s, p))[0];
  await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);
  await db.exec(`create or replace function public.two_step_ok() returns boolean language sql stable as $$ select true $$;`);
  if (tenants > 1) await db.exec(`begin; set local gt3.allow_second_tenant = 'on'; insert into public.tenants (id, slug, name) values ('${T2}', 'other-business', 'Other business'); commit;`);
  for (const [id, role, t] of [[OWNER, "owner", T1], [ADMIN, "admin", T1], ...(tenants > 1 ? [[OTHER, "owner", T2]] : [])]) {
    await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}-${id.slice(-2)}@example.test`]);
    await q(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, t]);
  }
  const as = async (uid, sql, p) => {
    await db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
    try { return (await db.query(sql, p)).rows; } catch (e) { return { error: e.message, code: e.code }; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
  };
  const door = async (t) => { await db.exec(`set role anon;`); try { return (await db.query(`select public.vision_shared($1) v`, [t])).rows[0].v; } catch (e) { return { code: e.code }; } finally { await db.exec(`reset role;`); } };
  return { db, q, q1, as, door };
};
const tokenIn = (rows, token) => rows.some((r) => JSON.stringify(r).includes(token));

// ── One business: before 0468 the gap; after it, none ───────────────────────────────────────────────────────────────
{
  const { db, q, q1, as, door } = await setup(1);
  const old = (await as(ADMIN, `insert into public.vision_shares (label) values ('Before 0468') returning id, token`))[0];
  await door(old.token);
  const before = await q(`select old_row, new_row, summary from public.admin_audit where table_name = 'vision_shares'`);
  ok("before 0468 (the gap, measured): the link's token is in the activity log, on create and on open", tokenIn(before, old.token) && before.length === 2, before.length);
  await db.exec(M); await db.exec(M);
  ok("0468 twice: recorded (applied twice), no error", (await q1(`select applied_count::int n from public.schema_migrations where version like '0468%'`)).n === 2);
  ok("the activity log has a business column; rows written before are given their business (one business → it)", (await q1(`select count(*) filter (where tenant_id is null)::int n, count(*)::int a from public.admin_audit`)).n === 0);

  const mark = (await q1(`select coalesce(max(id), 0)::int m from public.admin_audit`)).m;
  const made = (await as(ADMIN, `insert into public.vision_shares (label, program_ids) values ('After 0468', '{}') returning id, token, created_by, show_asks`))[0];
  ok("a link made through the API: its maker stamped, asks off unless said", made.created_by === ADMIN && made.show_asks === false, { by: made.created_by === ADMIN, asks: made.show_asks });
  await door(made.token); await door(made.token);
  ok("an investor's open counts, and writes no activity line", (await q1(`select opens::int o from public.vision_shares where id = $1`, [made.id])).o === 2
    && (await q(`select 1 from public.admin_audit where id > $1 and action = 'UPDATE'`, [mark])).length === 0);
  await as(ADMIN, `update public.vision_shares set label = 'Renamed', plan_ids = '{}' where id = $1`, [made.id]);
  await as(ADMIN, `update public.vision_shares set revoked_at = now() where id = $1`, [made.id]);
  const lines = await q(`select action, old_row, new_row, summary, tenant_id from public.admin_audit where id > $1 and table_name = 'vision_shares' order by id`, [mark]);
  ok("after 0468: create, rename and revoke each write a line — and none holds the token, anywhere", lines.length === 3 && !tokenIn(lines, made.token), lines.length);
  const keys = [...new Set(lines.flatMap((l) => [...Object.keys(l.old_row ?? {}), ...Object.keys(l.new_row ?? {})]))].sort();
  ok("…a link's line is its named fields only: no token, no open counters, nothing unnamed", JSON.stringify(keys) === JSON.stringify(["created_at", "created_by", "expires_at", "id", "label", "layout_ids", "money_plans", "need_plans", "pinned_at", "plan_ids", "program_ids", "research_plans", "revoked_at", "show_asks", "tenant_id"]), keys);
  ok("…the rename line says what changed (label), in words", /label: After 0468 → Renamed/.test(lines[1].summary ?? ""), lines[1].summary);
  ok("…each line belongs to the link's business", lines.every((l) => l.tenant_id === T1));

  // Revocation is final; the record's fixed parts are fixed.
  ok("a turned-off link can't be turned back on (PT403)", (await as(ADMIN, `update public.vision_shares set revoked_at = null where id = $1`, [made.id])).code === "PT403");
  ok("…or changed at all (PT403) — and its door stays shut", (await as(OWNER, `update public.vision_shares set label = 'x' where id = $1`, [made.id])).code === "PT403" && (await door(made.token)).code === "PT404");
  const live = (await as(ADMIN, `insert into public.vision_shares (label) values ('Live') returning id, token`))[0];
  for (const [col, val, what] of [["token", "'" + "f".repeat(64) + "'", "its key"], ["created_by", `'${OWNER}'`, "its maker"], ["created_at", "now() - interval '1 day'", "its start"], ["opens", "99", "its open count"], ["last_opened_at", "now()", "its last open"]])
    ok(`an admin can't change ${what} through the API (PT403)`, (await as(ADMIN, `update public.vision_shares set ${col} = ${val} where id = $1`, [live.id])).code === "PT403");
  ok("…while what a link shows can still be changed by them (until 0472's review)", Array.isArray(await as(ADMIN, `update public.vision_shares set label = 'Live, renamed' where id = $1 returning id`, [live.id])));
  ok("…and the owner can still turn it off at once", Array.isArray(await as(OWNER, `update public.vision_shares set revoked_at = now() where id = $1 returning id`, [live.id])) && (await door(live.token)).code === "PT404");

  // Append-only by grant.
  const g = await q1(`select has_table_privilege('authenticated', 'public.admin_audit', 'insert') i, has_table_privilege('authenticated', 'public.admin_audit', 'update') u,
    has_table_privilege('authenticated', 'public.admin_audit', 'delete') d, has_table_privilege('anon', 'public.admin_audit', 'select') a, has_table_privilege('authenticated', 'public.admin_audit', 'select') s`);
  ok("the activity log is append-only by grant: the signed-in can't insert, update or delete it; anon can't read it; admins still read it", !g.i && !g.u && !g.d && !g.a && g.s, g);
  ok("…and an admin's attempt to rewrite or erase a line is refused", !!(await as(ADMIN, `update public.admin_audit set summary = 'x'`)).error && !!(await as(ADMIN, `delete from public.admin_audit`)).error);

  // The cleanup, on the lines written before 0468 (create + open of 'Before 0468').
  const r = await db.exec(CLEAN);
  const counts = (await db.query(`select count(*) filter (where (old_row ? 'token') or (new_row ? 'token') or summary ~ '(^| · )token: ')::int n from public.admin_audit where table_name = 'vision_shares'`)).rows[0].n;
  ok("the separate cleanup takes the token out of the lines written before 0468 — none left", counts === 0 && !tokenIn(await q(`select old_row, new_row, summary from public.admin_audit`), old.token));
  ok("…and a second run touches nothing", await (async () => { await db.exec(`create temp table c as select md5(string_agg(coalesce(old_row::text,'')||coalesce(new_row::text,'')||coalesce(summary,''), '|' order by id)) h from public.admin_audit;`);
    await db.exec(CLEAN);
    return (await q1(`select (select h from c) = md5(string_agg(coalesce(old_row::text,'')||coalesce(new_row::text,'')||coalesce(summary,''), '|' order by id)) same from public.admin_audit`)).same; })());
  ok("…and it says how many it touched: before > 0, after 0", r.length >= 3 && Number(r.find((x) => x.fields?.some((f) => f.name === "lines_with_a_token_before"))?.rows[0].lines_with_a_token_before) > 0
    && Number(r.find((x) => x.fields?.some((f) => f.name === "lines_with_a_token_after"))?.rows[0].lines_with_a_token_after) === 0);
  await db.close();
}

// ── Two businesses: each reads only its own lines; a legacy line with no business stays unreadable ─────────────────
{
  const { db, q, q1, as } = await setup(2);
  await db.exec(`insert into public.admin_audit (actor, action, table_name, row_pk, summary, old_row, new_row) values (null, 'UPDATE', 'budgets', 'legacy', 'x', '{"a":1}', '{"a":2}')`);
  const t2link = (await as(OTHER, `insert into public.vision_shares (label) values ('Theirs') returning id, token`))[0];
  await db.exec(M);
  ok("two businesses: a legacy line whose row names no business is left unassigned (no guessing)", (await q1(`select tenant_id from public.admin_audit where row_pk = 'legacy'`)).tenant_id === null);
  ok("…lines written before 0468 are given their row's business", (await q1(`select tenant_id from public.admin_audit where row_pk = $1 and action = 'INSERT'`, [t2link.id])).tenant_id === T2);
  await as(ADMIN, `insert into public.vision_shares (label) values ('Ours')`);
  const ours = await as(ADMIN, `select tenant_id, row_pk from public.admin_audit`), theirs = await as(OTHER, `select tenant_id, row_pk from public.admin_audit`);
  ok("an admin reads only their own business's lines", Array.isArray(ours) && ours.length > 0 && ours.every((r) => r.tenant_id === T1), ours.error ?? ours.map((r) => r.tenant_id));
  ok("…the other business's owner only theirs — and neither sees the legacy unassigned line", Array.isArray(theirs) && theirs.length > 0 && theirs.every((r) => r.tenant_id === T2) && ![...ours, ...theirs].some((r) => r.row_pk === "legacy"));
  ok("…and a link's line from the other business never carries its token either", !tokenIn(await q(`select old_row, new_row, summary from public.admin_audit where tenant_id = $1 and id > (select min(id) from public.admin_audit where row_pk = $2 and action = 'INSERT')`, [T2, t2link.id]), t2link.token));
  await db.close();
}

console.log(`IMS8 A2 — A LINK LEAVES NO KEY BEHIND (0468, in Postgres): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
