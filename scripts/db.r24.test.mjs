// R24 — THE WATCHER IS WATCHED, AND THE PUSH WEBHOOKS COUNTED (0430), IN POSTGRES (2026-10-18 — the 10/10 audit, database
// F8 and F6, operations F11 and F19; Ryan: "Keep working to improve to a 10").
//
// The whole schema is loaded — every migration, pg_cron's tables as the fixture stands them in, each cron.schedule a row
// in cron.job — then 0430 again (a second paste changes nothing). public.ops_alive is asked as the app's server asks it
// (lib/opsWatch's lists): every job the migrations made is there; one unscheduled, or switched off, is counted; one whose
// migration isn't in the ledger is not; cron_watch's last finish is read from its successful runs only. The push webhooks
// the dashboard made are stood in as it makes them (a trigger calling supabase_functions.http_request): all on is none
// off; one switched off, one dropped, each counted. Nobody but the server may ask. Every row is made up.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";
import { routeLoader } from "./fixtures/moneyWorld.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M430 = readFileSync(join(ROOT, "supabase/migrations/0430_the_watcher_is_watched_and_the_push_hooks_counted.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };

const t0 = Date.now();
const db = await fullSchema();
console.log(`the whole schema loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
await db.exec(M430);
const q = async (s, p) => (await db.query(s, p)).rows;
const { CRON_JOBS, PUSH_HOOKS } = routeLoader({})("lib/opsWatch.ts");
const JOBS = CRON_JOBS.map(([j]) => j), FROM = CRON_JOBS.map(([, m]) => m);
// Asked as the server: the service role, the way PostgREST calls it.
const asServer = async () => {
  await db.exec("set role service_role");
  try { return (await q("select public.ops_alive($1, $2, $3) as a", [JOBS, FROM, [...PUSH_HOOKS]]))[0].a; } finally { await db.exec("reset role"); }
};

ok("0430 a second time changes nothing — and records itself once", (await q("select count(*)::int as n from public.schema_migrations where version = '0430_the_watcher_is_watched_and_the_push_hooks_counted'"))[0].n === 1);
const fresh = await asServer();
ok(`every job the migrations made is in cron.job and on — none missing of the ${JOBS.length} lib/cronJobs names`, fresh.missing === 0 && fresh.active >= JOBS.length, fresh);
ok("…and cron_watch has never finished here: no time, not a made-up one", fresh.watched_at === null, fresh);

// cron_watch's runs: a failed one is no finish; a succeeded one is.
const watchId = (await q("select jobid from cron.job where jobname = 'cron-watch'"))[0].jobid;
await db.query("insert into cron.job_run_details (jobid, status, start_time, end_time) values ($1, 'failed', now() - interval '3 minutes', now() - interval '3 minutes')", [watchId]);
ok("a run of cron_watch that failed is not a finish", (await asServer()).watched_at === null);
await db.query("insert into cron.job_run_details (jobid, status, start_time, end_time) values ($1, 'succeeded', now() - interval '12 minutes', now() - interval '12 minutes')", [watchId]);
const watched = await asServer();
ok("one that succeeded is: its end, twelve minutes ago", watched.watched_at !== null && Math.abs(Date.now() - Date.parse(watched.watched_at) - 12 * 60_000) < 120_000, watched);
// another job's success is not cron_watch's
const otherId = (await q("select jobid from cron.job where jobname = 'tidy-audit-log'"))[0].jobid;
await db.query("insert into cron.job_run_details (jobid, status, start_time, end_time) values ($1, 'succeeded', now(), now())", [otherId]);
ok("another job's success is not the watcher's", Math.abs(Date.now() - Date.parse((await asServer()).watched_at) - 12 * 60_000) < 120_000);

// A job unscheduled, and one switched off: each counted.
await db.exec("select cron.unschedule('tidy-audit-log'); update cron.job set active = false where jobname = 'founder-digest';");
ok("a job unscheduled and one switched off are two missing", (await asServer()).missing === 2, await asServer());
// A job whose migration is not in the ledger (not pasted yet) is not missing.
await db.exec("select cron.unschedule('message-sent-sweep'); delete from public.schema_migrations where version = '0429_a_text_is_sent_once_for_what_happened';");
ok("a job whose migration isn't in the ledger yet is not counted missing", (await asServer()).missing === 2, await asServer());
ok("…and a job the app doesn't name is not counted either way", (await q("select (public.ops_alive('{}', '{}', '{}') ->> 'missing')::int as n"))[0].n === 0);

// The push webhooks. The migrations make three (0373/0380's escalation, 0394's, 0399's — copies of the alerts one); the
// dashboard made the rest, which a database built from the migrations does not have: counted off until they are there.
const made = PUSH_HOOKS.filter((h) => /alerts_push_escalation|cup_reminders_push|pack_notices_push/.test(h));
const dashboard = PUSH_HOOKS.filter((h) => !made.includes(h));
ok(`the migrations' own three are there and on; the dashboard's ${dashboard.length} are counted off on a database built from the migrations (database F6, said)`,
  made.length === 3 && (await asServer()).hooks_off === dashboard.length, { off: (await asServer()).hooks_off, dashboard: dashboard.length });
// …stood in as the dashboard makes a Database Webhook: an AFTER trigger on the table, each row, calling http_request.
for (const h of dashboard) {
  const [table, name] = h.split(".");
  const when = /_update$/.test(name) ? "update" : "insert";
  await db.exec(`create trigger ${name} after ${when} on public.${table} for each row execute function supabase_functions.http_request()`);
}
ok("every push webhook there and on: none off", (await asServer()).hooks_off === 0, await asServer());
await db.exec("alter table public.orders disable trigger push_orders_insert; drop trigger push_live_status_update on public.live_status;");
ok("one switched off and one dropped: two off — a push that never goes is counted", (await asServer()).hooks_off === 2, await asServer());
await db.exec("alter table public.orders enable trigger push_orders_insert;");
ok("switched back on: one off", (await asServer()).hooks_off === 1);
await db.exec("create trigger push_live_status_update after update on public.events for each row execute function supabase_functions.http_request()");
ok("a trigger of the right name on the wrong table is not the webhook", (await asServer()).hooks_off === 1);

// Nobody but the server.
const priv = (await q(`select has_function_privilege('anon', 'public.ops_alive(text[], text[], text[])', 'execute') as anon,
  has_function_privilege('authenticated', 'public.ops_alive(text[], text[], text[])', 'execute') as authed,
  has_function_privilege('service_role', 'public.ops_alive(text[], text[], text[])', 'execute') as server,
  (select count(*)::int from pg_proc p, aclexplode(p.proacl) a where p.proname = 'ops_alive' and a.grantee = 0) as public_grants,
  (select bool_or(c like 'search_path=%') from pg_proc p, unnest(p.proconfig) c where p.proname = 'ops_alive') as path,
  (select prosecdef from pg_proc where proname = 'ops_alive') as definer`))[0];
ok("only the app's server may ask — no one with no session, no one signed in, no grant to PUBLIC; a definer with its path pinned",
  priv.anon === false && priv.authed === false && priv.server === true && priv.public_grants === 0 && priv.path === true && priv.definer === true, priv);
for (const role of ["anon", "authenticated"]) {
  await db.exec(`set role ${role}`);
  let refused = false;
  try { await q("select public.ops_alive('{}', '{}', '{}')"); } catch (e) { refused = /permission denied/.test(String(e.message)); }
  await db.exec("reset role");
  ok(`${role} asking is refused`, refused);
}
ok("what it answers is counts and a time — never a job's or trigger's name, command or definition",
  JSON.stringify(Object.keys(await asServer()).sort()) === JSON.stringify(["active", "hooks_off", "missing", "watched_at"]));

await db.close();
console.log(`\nR24 — THE WATCHER IS WATCHED, AND THE PUSH WEBHOOKS COUNTED (0430): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
