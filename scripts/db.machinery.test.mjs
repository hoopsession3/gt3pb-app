// 0381 — ONLY THE DATABASE CALLS ITS OWN MACHINERY, executed from its file against the whole schema (every migration
// before it, in order: scripts/fixtures/schema.full.mjs), acting as each kind of person the way PostgREST does.
//
// The finding, as a sentence: Postgres grants every new function to PUBLIC, anon and authenticated are in PUBLIC, and
// "revoke … from anon, authenticated" leaves that grant standing — so a SECURITY DEFINER function written to be called
// only by the database's own triggers and cron jobs could be called as an RPC by anyone holding the app's anon key.
// credit_wallet (the loyalty ledger's writer, "revoked" in 0229) is the sharpest case: points for anyone, at will.
//
// The defect is shown first on the schema as production has it (no change needed to make it so: the fixture keeps
// Postgres's PUBLIC grant, which is all production needed), then closed, then everything that must keep working is run:
// the award_points trigger still credits through credit_wallet, cron jobs still run as the owner, the server's service
// role keeps every closed function, the functions row-level policies call stay callable by everyone they judge, and the
// two crew screens' counts answer the crew and nobody else.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIG = (f) => readFileSync(join(ROOT, "supabase/migrations", f), "utf8");
const F381 = "0381_only_the_database_calls_its_own_machinery.sql";
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0c1a0000-0000-4000-8000-0000000000a1", SERVER = "0c1a0000-0000-4000-8000-0000000000a4",
  MEMBER = "0c1a0000-0000-4000-8000-0000000000a5", VICTIM = "0c1a0000-0000-4000-8000-0000000000a6";

const t0 = Date.now();
const db = await fullSchema({ before: "0381" });
console.log(`the schema before 0381 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
// As a person, through PostgREST's roles: { rows, error }. role "service_role" acts as the server.
const as = async (uid, sql, params, role) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${role ?? (uid ? "authenticated" : "anon")};`);
  try { return { rows: (await db.query(sql, params)).rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e) }; }
  finally { await root(); }
};
const denied = (r) => /permission denied for function/i.test(r.error || "");

await db.exec(`
  grant usage on schema public to anon, authenticated, service_role;
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
`);
for (const [id, role] of [[OWNER, "owner"], [SERVER, "server"], [MEMBER, "member"], [VICTIM, "member"]]) {
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}-${id.slice(-2)}@example.test`]);
  await db.query(`update public.profiles set role = $2, tenant_id = $3, display_name = $4 where id = $1`, [id, role, T1, `Made-up ${role}`]);
}
const points = async (uid) => Number((await q(`select coalesce(sum(points), 0) n from public.loyalty_ledger where user_id = $1`, [uid]))[0].n);

// Every function 0381 names, every overload, as regprocedure text.
const NAMED = ["credit_wallet", "claw_wallet", "alert_autoexpire", "archive_stale_stops", "brew_due_alerts", "founder_digest_alert",
  "goal_checkin_nudges", "os_audit_nudge", "purge_webhook_events", "release_expired_holds", "stop_recap_alerts", "task_due_alerts",
  "tidy_acked_alerts", "active_event_id", "catalog_cogs_pct", "prune_client_errors", "resolve_customer", "bump_client_error",
  "progress_kpis", "office_next_delivery"];
const fns = async (where) => (await q(`select p.oid::regprocedure::text f from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and ${where} order by 1`)).map((r) => r.f);
const named = await fns(`p.proname = any($$${"{" + NAMED.join(",") + "}"}$$::text[])`);
const triggers = await fns(`p.prosecdef and p.prorettype = 'trigger'::regtype`);
const can = async (role, f) => (await q(`select has_function_privilege($1, $2, 'execute') ok`, [role, f]))[0].ok;
const callableByApi = async () => Number((await q(`select count(*) n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and p.prosecdef
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`))[0].n);
ok("every function 0381 names exists here (20 names)", NAMED.every((n) => named.some((f) => f.startsWith(`${n}(`))), named);

// ── BEFORE 0381: the machinery answers anyone ───────────────────────────────────────────────────────────────────────
const before = await callableByApi();
{
  const r = await as(null, `select public.credit_wallet($1, 5000, 1000, gen_random_uuid(), 'cup')`, [VICTIM]);
  ok("before 0381: anon — the anon key and nothing else — can call credit_wallet…", !r.error, r.error);
  ok("…and it writes 5,000 points to the account it names", (await points(VICTIM)) === 5000, await points(VICTIM));
  const r2 = await as(MEMBER, `select public.tidy_acked_alerts(0)`);
  ok("before 0381: a signed-in customer can run the alert-history cleanup with keep_days = 0", !r2.error, r2.error);
  const granted = (await Promise.all(triggers.map((f) => can("anon", f)))).filter(Boolean).length;
  ok(`before 0381: trigger functions are granted to anon too, callable or not (${granted} of ${triggers.length})`, granted > 0, granted);
}

// ── 0381 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
await db.exec(MIG(F381));
const after = await callableByApi();
ok(`0381 closes ${named.length + triggers.length} functions' worth of grants: the API-callable definer count falls (${before} → ${after})`,
  after < before && before - after >= named.length, { before, after });

{
  const r = await as(null, `select public.credit_wallet($1, 5000, 1000, gen_random_uuid(), 'cup')`, [VICTIM]);
  ok("after 0381: anon calling credit_wallet is refused — permission denied", denied(r), r);
  const m = await as(MEMBER, `select public.credit_wallet($1, 5000, 1000, gen_random_uuid(), 'cup')`, [MEMBER]);
  ok("after 0381: …and so is a signed-in customer crediting themselves", denied(m), m);
  ok("…and no points moved", (await points(VICTIM)) === 5000 && (await points(MEMBER)) === 0);
  for (const [who, sql] of [
    [MEMBER, `select public.claw_wallet('${VICTIM}', gen_random_uuid(), 'cup')`],
    [MEMBER, `select public.tidy_acked_alerts(0)`],
    [null, `select public.purge_webhook_events()`],
    [null, `select public.release_expired_holds()`],
    [null, `select public.resolve_customer(null, '5555550100', null, 'Made-up')`],
    [null, `select public.bump_client_error('made-up')`],
    [MEMBER, `select public.progress_kpis()`],
    [MEMBER, `select * from public.office_next_delivery('charlotte')`],
    [SERVER, `select public.os_audit_nudge()`],
  ]) {
    const r = await as(who, sql);
    ok(`after 0381: ${who ? "a signed-in person" : "anon"} — ${sql.replace(/\(.*$/, "(…)").replace("select ", "").replace("* from ", "")} — is refused`, denied(r), r.error);
  }
}
{
  const leaks = [];
  for (const f of named) for (const role of ["anon", "authenticated"]) if (await can(role, f)) leaks.push(`${role}: ${f}`);
  ok("after 0381: no named function, in any overload, is executable by anon or authenticated", leaks.length === 0, leaks);
  const kept = [];
  for (const f of named) if (!(await can("service_role", f))) kept.push(f);
  ok("after 0381: the service role keeps every one of them (the server's resolve_customer, progress_kpis, …)", kept.length === 0, kept);
  const open = [];
  for (const f of triggers) for (const role of ["anon", "authenticated"]) if (await can(role, f)) open.push(`${role}: ${f}`);
  ok("after 0381: no SECURITY DEFINER trigger function is granted to anon or authenticated", open.length === 0, open.slice(0, 5));
}

// ── WHAT MUST KEEP WORKING ───────────────────────────────────────────────────────────────────────────────────────────
{
  // A finished cup credits its customer through award_points → credit_wallet. The trigger runs as its owner, so the
  // revoke must not reach it: an owner closing the order from the app (authenticated) is the real path.
  const order = (await q(`insert into public.orders (user_id, customer, items, total_cents, paid, status)
    values ($1, 'Made-up member', '{rise}', 600, true, 'ready') returning id`, [MEMBER]))[0].id;
  const done = await as(OWNER, `update public.orders set status = 'done' where id = $1 returning id`, [order]);
  ok("a finished order still credits its customer through the award_points trigger (as the owner, from the app)",
    !done.error && done.rows.length === 1 && (await points(MEMBER)) >= 1, { error: done.error, points: await points(MEMBER) });
  const voided = await as(OWNER, `update public.orders set status = 'void' where id = $1 returning id`, [order]);
  ok("…and a void claws it back through claw_wallet, the same way", !voided.error && (await points(MEMBER)) === 0, { error: voided.error, points: await points(MEMBER) });
}
{
  const r = await q(`select public.tidy_acked_alerts(30) n`);
  ok("a cron job still runs as the database's own role (what pg_cron is)", Number.isFinite(Number(r[0]?.n)), r);
  const s = await as(null, `select public.resolve_customer(null, '5555550101', null, 'Made-up')`, [], "service_role");
  ok("the server (service role) still resolves a customer at checkout", !s.error && s.rows[0]?.resolve_customer, s);
}
{
  const a = await as(null, `select public.is_staff() s, public.effective_tenant() t`);
  ok("the functions policies call stay callable by anon (a policy judging a guest runs them as the guest)", !a.error, a.error);
  const m = await as(MEMBER, `select count(*) n from public.products`);
  ok("…and a customer's ordinary read, judged by those policies, still works", !m.error, m.error);
}
{
  await q(`insert into public.funnel_events (funnel, step, session) values ('order', 'opened', 'made-up-a'), ('order', 'paid', 'made-up-a')`);
  const member = await as(MEMBER, `select * from public.funnel_counts(14)`);
  ok("funnel_counts: a signed-in customer gets no counts", !member.error && member.rows.length === 0, member);
  const crew = await as(SERVER, `select * from public.funnel_counts(14)`);
  ok("funnel_counts: the crew gets them", !crew.error && crew.rows.length === 2, crew);
}
{
  await q(`insert into public.content_items (title, status, scheduled_for) values ('Made-up post', 'draft', now() - interval '2 days')`);
  const anon = await as(null, `select public.stale_content_count() n`);
  ok("stale_content_count: anon is refused", denied(anon), anon);
  const member = await as(MEMBER, `select public.stale_content_count() n`);
  ok("stale_content_count: a signed-in customer gets 0", !member.error && member.rows[0]?.n === 0, member);
  const crew = await as(SERVER, `select public.stale_content_count() n`);
  ok("stale_content_count: the crew gets the count", !crew.error && crew.rows[0]?.n >= 1, crew);
}
{
  const own = await fns(`p.proname = any('{cancel_own_reservation,cancel_own_delivery,set_order_eta}'::text[])`);
  const anonCan = [], authCan = [];
  for (const f of own) { if (await can("anon", f)) anonCan.push(f); if (await can("authenticated", f)) authCan.push(f); }
  ok("a person's own three (cancel a reservation or a delivery, set an ETA) are closed to anon…", own.length === 3 && anonCan.length === 0, { own, anonCan });
  ok("…and kept for the signed-in person, as their migrations meant", authCan.length === 3, authCan);
}

// ── A SECOND RUN, AND THE LEDGER ───────────────────────────────────────────────────────────────────────────────────
ok("0381 run twice: no error", await db.exec(MIG(F381)).then(() => true, () => false));
ok("0381 run twice: nothing reopened", (await callableByApi()) === after);
ok("0381 records itself by its own name",
  (await q(`select 1 from public.schema_migrations where version = '0381_only_the_database_calls_its_own_machinery'`)).length === 1);

console.log(`0381 (only the database calls its own machinery): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
