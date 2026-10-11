// WHO IS ON THE PASS — 0375 and 0376, executed from their files against the whole schema (every migration before them,
// in order: scripts/fixtures/schema.full.mjs), acting as each kind of person the way PostgREST does: `set role
// authenticated` with the caller's id in request.jwt.claim.sub, every call by argument name.
//
// The claims:
//   0. Before them, nothing records which device has the Pass open, and a live truck with nobody on the Pass raises
//      nothing — the one Pass alert waits on a ticket ten minutes old.
//   1. crew_heartbeat is the one write: it stamps the tenant and the person itself, refuses anyone not on the crew and
//      anything that is not a device, a screen, an app or a feed, keeps one row per device and screen, and a device
//      that changes hands is whoever is signed in on it now. Nobody writes the table directly.
//   2. The crew read their own business's devices and no one else's (another tenant's crew, a customer, a stranger).
//   3. crew_devices gives the leaders the last ten minutes, with names a manager cannot read from profiles.
//   4. Seven days, then gone: the prune, and its daily job. Deleting an account takes its devices' rows.
//   5. pass_watchdog: during service, no device on the Pass with its feed live for five minutes is ONE critical alert,
//      worded for which it is; quiet between; closes itself when a Pass device is back or service ends; another
//      business's device, another screen or a stale beat is not a watched Pass; the quarter-hour cooldown holds.
//   6. Both run twice cleanly, and nobody but the cron may run the watchdog.
//
// STOOD IN, as Supabase has them and the schema fixture does not: the default grants on a new table, function and
// sequence in public (anon, authenticated, service_role — measured in production, 2026-10-11: 0366, 0367, 0371), and
// usage on schema auth. The push fan-out (0157's trigger) records each alert it would have sent instead of sending it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const F375 = "0375_a_device_on_the_pass_checks_in_every_minute";
const F376 = "0376_nobody_on_the_pass_during_service_is_an_alert";
const sql375 = readFileSync(join(ROOT, `supabase/migrations/${F375}.sql`), "utf8");
const sql376 = readFileSync(join(ROOT, `supabase/migrations/${F376}.sql`), "utf8");

let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";       // GT3, the founding tenant
const T2 = "00000000-0000-0000-0000-0000000000b2";       // another business on the same database
const OWNER = "4ea7b000-0000-4000-8000-0000000000a1";    // Olive, owner
const SERVER = "4ea7b000-0000-4000-8000-0000000000e1";   // Sam, on the pass
const MANAGER = "4ea7b000-0000-4000-8000-0000000000e2";  // Erin, event manager
const MEMBER = "4ea7b000-0000-4000-8000-0000000000c1";   // a customer
const TEMP = "4ea7b000-0000-4000-8000-0000000000e3";     // Tess, on the pass, then leaves
const OTHER = "4ea7b000-0000-4000-8000-0000000000b1";    // Otto, on the other business's pass
const OTHER_OWNER = "4ea7b000-0000-4000-8000-0000000000b9";
const PHONE = "7d1e0c2a-5b6f-4c8d-9e0f-1a2b3c4d5e6f";   // made-up device ids, the shape lib/heartbeat mints
const IPAD = "0a9b8c7d-6e5f-4a3b-8c1d-0e9f8a7b6c5d";
const TEMP_PHONE = "11112222-3333-4444-8555-666677778888";

const db = await fullSchema({ before: "0375" });
const q = (sql, params) => db.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const num = async (sql, params) => Number(Object.values((await one(sql, params)) ?? { n: 0 })[0]);
const raises = async (sql) => { try { await db.exec(sql); return null; } catch (e) { return String(e.message || e); } };

await db.exec(`
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  -- profiles as Supabase holds it: granted to the signed-in role, so what hides a row from it is row-level security.
  grant select on public.profiles to authenticated;
  create table public.test_pushes (alert_id uuid, at timestamptz default now());
  create or replace function supabase_functions.http_request() returns trigger language plpgsql as $$
  begin insert into public.test_pushes (alert_id) values (new.id); return new; end $$;
`);

// The people. Signing up makes the profile (handle_new_user); then each is put where they work.
// A second business is refused unless asked for deliberately (guard_second_tenant) — the way its hint says to.
await db.exec(`begin; set local gt3.allow_second_tenant = 'on';
  insert into public.tenants (id, slug, name) values ('${T2}', 'other-truck', 'Other Truck'); commit;`);
for (const [id, email] of [[OWNER, "olive@example.test"], [SERVER, "sam@example.test"], [MANAGER, "erin@example.test"],
  [MEMBER, "casey@example.test"], [TEMP, "tess@example.test"], [OTHER, "otto@example.test"], [OTHER_OWNER, "oona@example.test"]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
}
for (const [id, name, role, tenant] of [[OWNER, "Olive", "owner", T1], [SERVER, "Sam", "server", T1], [MANAGER, "Erin", "event_manager", T1],
  [MEMBER, "Casey", "member", T1], [TEMP, "Tess", "server", T1], [OTHER, "Otto", "server", T2], [OTHER_OWNER, "Oona", "owner", T2]]) {
  await q(`update public.profiles set display_name = $2, role = $3, tenant_id = $4 where id = $1`, [id, name, role, tenant]);
}

// Act as a person the way PostgREST does, then put the session back.
async function as(uid, sql, params) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  try { return { rows: (await q(sql, params)).rows, error: null, code: null }; }
  catch (e) { return { rows: [], error: String(e.message || e), code: e.code ?? null }; }
  finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
// One beat, as lib/heartbeat beatArgs sends it.
const beat = (uid, device, o = {}) => as(uid,
  `select public.crew_heartbeat(p_device => $1, p_surface => $2, p_app => $3, p_app_build => $4, p_feed => $5,
     p_alerts_on => $6, p_wake_lock => $7) as at`,
  [device, o.surface ?? "pass", o.app ?? "web", o.build === undefined ? "abc1234" : o.build, o.feed ?? "live", o.alertsOn ?? true, o.wake ?? true]);
const rowOf = (tenant, device, surface = "pass") => one(
  `select tenant_id, user_id, app, app_build, feed, alerts_on, wake_lock, last_seen from public.device_heartbeats
    where tenant_id = $1 and device_id = $2 and surface = $3`, [tenant, device, surface]);
const rows = () => num(`select count(*) n from public.device_heartbeats`);

// ── 0 · before 0375 and 0376 ─────────────────────────────────────────────────────────────────────────────────────────
{
  ok("before 0375: nothing records which device has the Pass open", (await one(`select to_regclass('public.device_heartbeats') t`)).t === null);
  await q(`update public.live_status set is_live = true where id = 1`);
  const n = await num(`select public.alert_stale_orders(10) n`);
  const said = await num(`select count(*) n from public.alerts where kind in ('order_stale', 'pass_unwatched')`);
  ok("before 0376: the truck live and nobody on the Pass raises nothing — the one Pass alert waits on a ticket ten minutes old",
    n === 0 && said === 0, { n, said });
  await q(`update public.live_status set is_live = false where id = 1`);
}

await db.exec(sql375);
console.log("0375 executed against the whole schema.");

// ── 1 · its shape, and who may call what ─────────────────────────────────────────────────────────────────────────────
{
  const t = await one(`select relrowsecurity r from pg_class where oid = 'public.device_heartbeats'::regclass`);
  ok("0375: device_heartbeats exists with row-level security on", t?.r === true, t);
  const pk = (await q(`select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = 'public.device_heartbeats'::regclass and i.indisprimary order by array_position(i.indkey::int2[], a.attnum)`)).rows.map((r) => r.attname);
  ok("0375: its key is (tenant_id, device_id, surface) — one row per device and screen", pk.join(",") === "tenant_id,device_id,surface", pk);
  ok("0375: 0134's tenant stamp is on it", (await num(`select count(*) n from pg_trigger where tgrelid = 'public.device_heartbeats'::regclass and tgname = 'stamp_tenant_tg'`)) === 1);
  const pol = (await q(`select policyname, cmd, permissive from pg_policies where tablename = 'device_heartbeats' order by 1`)).rows;
  ok("0375: one policy reads (the crew's), and the tenant isolation is restrictive; none writes",
    pol.length === 2 && pol.some((p) => p.policyname === "device heartbeats staff read" && p.cmd === "SELECT" && p.permissive === "PERMISSIVE")
    && pol.some((p) => p.policyname === "tenant isolation" && p.permissive === "RESTRICTIVE"), pol);
  const g = await one(`select has_table_privilege('anon', 'public.device_heartbeats', 'select') anon_r,
      has_table_privilege('anon', 'public.device_heartbeats', 'insert') anon_w,
      has_table_privilege('authenticated', 'public.device_heartbeats', 'select') auth_r,
      has_table_privilege('authenticated', 'public.device_heartbeats', 'insert') auth_i,
      has_table_privilege('authenticated', 'public.device_heartbeats', 'update') auth_u,
      has_table_privilege('authenticated', 'public.device_heartbeats', 'delete') auth_d,
      has_table_privilege('service_role', 'public.device_heartbeats', 'select') svc`);
  ok("0375: Supabase's default grants taken back by name — anon nothing, authenticated select alone, the service role kept",
    !g.anon_r && !g.anon_w && g.auth_r && !g.auth_i && !g.auth_u && !g.auth_d && g.svc, g);
  const fns = (await q(`select proname, prosecdef, coalesce(proconfig::text, '') cfg,
      has_function_privilege('anon', oid, 'execute') anon, has_function_privilege('authenticated', oid, 'execute') authed
    from pg_proc where proname in ('crew_heartbeat', 'crew_devices', 'prune_device_heartbeats') order by proname`)).rows;
  const by = Object.fromEntries(fns.map((f) => [f.proname, f]));
  ok("0375: each function runs as its definer with search_path pinned", fns.length === 3 && fns.every((f) => f.prosecdef && /search_path=public/.test(f.cfg)), fns);
  ok("0375: a signed-in caller may beat and read the card; anon may do neither", by.crew_heartbeat?.authed && !by.crew_heartbeat?.anon && by.crew_devices?.authed && !by.crew_devices?.anon, by);
  ok("0375: the prune is the cron's alone", by.prune_device_heartbeats && !by.prune_device_heartbeats.authed && !by.prune_device_heartbeats.anon, by.prune_device_heartbeats);
  const args = (await one(`select pg_get_function_identity_arguments('public.crew_heartbeat'::regproc) a`)).a;
  ok("0375: the page names neither the business nor the person — crew_heartbeat takes no tenant and no user",
    !/tenant|user/.test(args) && /p_device text, p_surface text, p_app text, p_app_build text, p_feed text, p_alerts_on boolean, p_wake_lock boolean/.test(args), args);
}

// ── 2 · a beat ───────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const r = await beat(SERVER, PHONE);
  const row = await rowOf(T1, PHONE);
  ok("a crew member's beat is kept and answers the database's time of it", r.error === null && r.rows[0]?.at instanceof Date && row, r);
  ok("…stamped with their business and themselves — the tenant from effective_tenant(), the person from auth.uid()",
    row?.tenant_id === T1 && row?.user_id === SERVER, row);
  ok("…with what it said: the web, its build, the feed live, alerts on, the screen kept on",
    row?.app === "web" && row?.app_build === "abc1234" && row?.feed === "live" && row?.alerts_on === true && row?.wake_lock === true, row);
  ok("…at the database's clock", Math.abs(Date.now() - new Date(row?.last_seen).getTime()) < 60_000, row?.last_seen);

  await q(`update public.device_heartbeats set last_seen = now() - interval '3 minutes'`);
  const again = await beat(SERVER, PHONE, { feed: "down", build: null, wake: false });
  const row2 = await rowOf(T1, PHONE);
  ok("the same device again: still one row, its words and its time moved on",
    again.error === null && (await rows()) === 1 && row2.feed === "down" && row2.app_build === null && row2.wake_lock === false
    && Date.now() - new Date(row2.last_seen).getTime() < 60_000, row2);

  const hands = await beat(MANAGER, PHONE, { feed: "live" });
  ok("a device that changes hands is whoever is signed in on it now (0366's rule) — one row, its person moved",
    hands.error === null && (await rows()) === 1 && (await rowOf(T1, PHONE)).user_id === MANAGER, await rowOf(T1, PHONE));

  const other = await beat(OTHER, PHONE, { feed: "reconnecting" });
  const theirs = await rowOf(T2, PHONE), ours = await rowOf(T1, PHONE);
  ok("another business's crew beating the same device id writes their own row — their tenant, their person — and leaves ours alone",
    other.error === null && theirs?.user_id === OTHER && theirs?.feed === "reconnecting" && ours?.user_id === MANAGER && ours?.feed === "live",
    { theirs, ours });

  await beat(SERVER, PHONE, { surface: "live_ops" });
  ok("another screen on the same device is a row of its own", (await rowOf(T1, PHONE, "live_ops"))?.user_id === SERVER && (await rows()) === 3);

  const long = await beat(SERVER, IPAD, { build: "  1.0 (42) " + "x".repeat(60), app: "ios" });
  const ipad = await rowOf(T1, IPAD);
  ok("a build is trimmed and kept to 40 characters", long.error === null && ipad?.app === "ios" && ipad?.app_build?.length === 40 && ipad.app_build.startsWith("1.0 (42) x"), ipad);
}

// ── 3 · who may not, and what is not a beat ──────────────────────────────────────────────────────────────────────────
{
  const before = await rows();
  const m = await beat(MEMBER, "c0ffee00-0000-4000-8000-000000000001");
  ok("a customer is refused: 'not authorized', 42501 (a 403, not a server error)", m.error === "not authorized" && m.code === "42501", m);
  const a = await beat(null, "c0ffee00-0000-4000-8000-000000000002");
  ok("a stranger cannot call it at all", /permission denied/i.test(a.error ?? ""), a);
  const bad = [
    ["a device id that is not one", await beat(SERVER, "x"), "That isn't a device id."],
    ["a device id with a space", await beat(SERVER, "aaaa bbbb cccc"), "That isn't a device id."],
    ["a screen that is not one", await beat(SERVER, PHONE, { surface: "Pass!" }), "That isn't a screen."],
    ["an app it does not know", await beat(SERVER, PHONE, { app: "android" }), "That isn't an app."],
    ["a feed it does not know", await beat(SERVER, PHONE, { feed: "LIVE" }), "That isn't a feed."],
  ];
  for (const [what, r, said] of bad) ok(`refused, in words: ${what} — 22023`, r.error === said && r.code === "22023", r);
  ok("…and none of them wrote anything", (await rows()) === before, await rows());
  const ins = await as(SERVER, `insert into public.device_heartbeats (device_id, surface, user_id, app) values ('deadbeef-0000-4000-8000-000000000000', 'pass', '${SERVER}', 'web')`);
  const upd = await as(SERVER, `update public.device_heartbeats set feed = 'live', last_seen = now() + interval '1 day'`);
  const del = await as(SERVER, `delete from public.device_heartbeats`);
  ok("nobody writes the table directly — insert, update and delete are refused even to the crew",
    /permission denied/i.test(ins.error ?? "") && /permission denied/i.test(upd.error ?? "") && /permission denied/i.test(del.error ?? "") && (await rows()) === before,
    { ins: ins.error, upd: upd.error, del: del.error });
}

// ── 4 · who reads it ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  const sees = async (uid) => (await as(uid, `select tenant_id, device_id, surface from public.device_heartbeats order by device_id, surface`));
  const sam = await sees(SERVER);
  ok("the crew read their own business's devices — every one, not only their own", sam.error === null && sam.rows.length === 3
    && sam.rows.every((r) => r.tenant_id === T1), sam);
  const otto = await sees(OTHER);
  ok("another business's crew read only theirs: none of ours", otto.error === null && otto.rows.length === 1 && otto.rows[0].tenant_id === T2, otto);
  const casey = await sees(MEMBER);
  ok("a customer reads none", casey.error === null && casey.rows.length === 0, casey);
  const anon = await sees(null);
  ok("a stranger cannot read it at all", /permission denied/i.test(anon.error ?? ""), anon);
}

// ── 5 · the Devices card's read ─────────────────────────────────────────────────────────────────────────────────────
{
  const card = (uid) => as(uid, `select * from public.crew_devices()`);
  const olive = await card(OWNER);
  const names = olive.rows.map((r) => `${r.display_name}:${r.surface}`);
  ok("crew_devices: the owner sees this business's devices with the name of whoever is on each", olive.error === null
    && olive.rows.length === 3 && olive.rows.every((r) => r.display_name && r.role) && names.includes("Erin:pass") && names.includes("Sam:pass") && names.includes("Sam:live_ops"), olive);
  ok("crew_devices: the Pass's rows first, and each says how many seconds since it checked in",
    olive.rows[0]?.surface === "pass" && olive.rows[olive.rows.length - 1]?.surface === "live_ops"
    && olive.rows.every((r) => Number.isInteger(r.seen_s) && r.seen_s >= 0 && r.seen_s < 60), olive.rows.map((r) => [r.surface, r.seen_s]));
  ok("crew_devices: another business's devices are not in it", olive.rows.every((r) => r.device_id !== PHONE || r.display_name !== "Otto"));
  const erinProfiles = await as(MANAGER, `select display_name from public.profiles where id = $1`, [SERVER]);
  const erin = await card(MANAGER);
  ok("crew_devices: an event manager — who cannot read Sam's profile — gets his name here",
    erinProfiles.error === null && erinProfiles.rows.length === 0 && erin.error === null && erin.rows.some((r) => r.display_name === "Sam"), { erinProfiles, erin: erin.rows.length });
  const sam = await card(SERVER);
  ok("crew_devices: the card is the leaders' — a server is refused", sam.error === "not authorized" && sam.code === "42501", sam);
  ok("crew_devices: a customer is refused, and a stranger cannot call it",
    (await card(MEMBER)).error === "not authorized" && /permission denied/i.test((await card(null)).error ?? ""));
  const oona = await card(OTHER_OWNER);
  ok("crew_devices: the other business's owner sees only theirs", oona.error === null && oona.rows.length === 1 && oona.rows[0].display_name === "Otto", oona);
  await q(`update public.device_heartbeats set last_seen = now() - interval '11 minutes' where tenant_id = $1 and device_id = $2 and surface = 'live_ops'`, [T1, PHONE]);
  await q(`update public.device_heartbeats set last_seen = now() - interval '9 minutes' where tenant_id = $1 and device_id = $2`, [T1, IPAD]);
  const later = (await card(OWNER)).rows;
  ok("crew_devices: the last ten minutes — a device eleven minutes quiet is gone from it, one nine minutes quiet is there, counted",
    later.length === 2 && !later.some((r) => r.surface === "live_ops") && later.some((r) => r.device_id === IPAD && r.seen_s >= 539 && r.seen_s <= 545),
    later.map((r) => [r.device_id.slice(0, 4), r.surface, r.seen_s]));
}

// ── 6 · seven days, then gone; an account deleted takes its rows ─────────────────────────────────────────────────────
{
  await q(`update public.device_heartbeats set last_seen = now() - interval '8 days' where tenant_id = $1 and device_id = $2 and surface = 'live_ops'`, [T1, PHONE]);
  await q(`update public.device_heartbeats set last_seen = now() - interval '6 days' where tenant_id = $1 and device_id = $2`, [T1, IPAD]);
  const before = await rows();
  const n = await num(`select public.prune_device_heartbeats(7) n`);
  ok("the prune takes a row eight days quiet and keeps one six days quiet",
    n === 1 && (await rows()) === before - 1 && !(await rowOf(T1, PHONE, "live_ops")) && !!(await rowOf(T1, IPAD)), { n, rows: await rows() });
  await q(`update public.device_heartbeats set last_seen = now() - interval '12 hours' where tenant_id = $1 and device_id = $2`, [T1, IPAD]);
  ok("…and a mistaken 0 is a day, not everything", (await num(`select public.prune_device_heartbeats(0) n`)) === 0 && !!(await rowOf(T1, IPAD)));
  const job = (await q(`select schedule, command from cron.job where jobname = 'prune-device-heartbeats'`)).rows;
  ok("…daily, from pg_cron, off the top of the hour", job.length === 1 && job[0].schedule === "29 4 * * *" && job[0].command === "select public.prune_device_heartbeats(7)", job);

  await beat(TEMP, TEMP_PHONE);
  const had = !!(await rowOf(T1, TEMP_PHONE));
  const gone = await raises(`delete from auth.users where id = '${TEMP}'`);
  ok("deleting an account takes its devices' rows with it (0353's erasure runs, the cascade does the rest)",
    had && gone === null && !(await rowOf(T1, TEMP_PHONE)), { had, gone });
}

// ── 7 · 0375 runs twice ──────────────────────────────────────────────────────────────────────────────────────────────
{
  const before = await rows();
  ok("0375 run again: no error", (await raises(sql375)) === null);
  ok("…the rows kept, one changelog line, one prune job, recorded twice",
    (await rows()) === before
    && (await num(`select count(*) n from public.changelog where title = 'Live Ops shows which devices are on the Pass'`)) === 1
    && (await num(`select count(*) n from cron.job where jobname = 'prune-device-heartbeats'`)) === 1
    && (await num(`select applied_count n from public.schema_migrations where version = '${F375}'`)) === 2);
}

// ── 8 · the watchdog ─────────────────────────────────────────────────────────────────────────────────────────────────
await db.exec(sql376);
console.log("0376 executed against the whole schema.\n");
await q(`delete from public.device_heartbeats`);

const run = async () => num(`select public.pass_watchdog() n`);
const lines = async () => (await q(`select id, title, body, severity, category, link, subject_id, target_user_id, ack_at, ack_by,
    created_at, last_seen_at, xmin::text as x from public.alerts where kind = 'pass_unwatched' order by created_at, id`)).rows;
const open = async () => (await lines()).filter((l) => l.ack_at === null);
const pushes = async () => num(`select count(*) n from public.test_pushes p join public.alerts a on a.id = p.alert_id where a.kind = 'pass_unwatched'`);
// Time passing: the beats and this kind's alerts move back together, as the clock moving forward would have them.
const later = (mins) => db.exec(`
  update public.device_heartbeats set last_seen = last_seen - interval '${mins} minutes' where true;
  update public.alerts set created_at = created_at - interval '${mins} minutes', last_seen_at = last_seen_at - interval '${mins} minutes',
                           ack_at = ack_at - interval '${mins} minutes'
   where kind = 'pass_unwatched';`);
const truck = (live) => q(`update public.live_status set is_live = $1 where id = 1`, [live]);

{
  const fns = await one(`select prosecdef d, coalesce(proconfig::text, '') c, has_function_privilege('anon', oid, 'execute') a,
      has_function_privilege('authenticated', oid, 'execute') b from pg_proc where proname = 'pass_watchdog'`);
  ok("0376: the watchdog runs as its definer with search_path pinned, and no browser may run it — not anon, not a signed-in one",
    fns?.d === true && /search_path=public/.test(fns?.c) && fns?.a === false && fns?.b === false, fns);
  const job = (await q(`select schedule, command from cron.job where jobname = 'pass-watchdog'`)).rows;
  ok("0376: it runs every minute from pg_cron", job.length === 1 && job[0].schedule === "* * * * *" && job[0].command === "select public.pass_watchdog()", job);
  const asSam = await as(SERVER, `select public.pass_watchdog()`);
  ok("0376: a crew member calling it is refused before it runs", /permission denied/i.test(asSam.error ?? ""), asSam);
}

// No service: nothing to watch.
ok("no service, nobody on the Pass: nothing", (await run()) === 0 && (await lines()).length === 0);

// ── the truck goes live and nobody is on the Pass ──
await truck(true);
{
  const n = await run();
  const o = await open();
  ok("the truck live, no device on the Pass: ONE critical line, rung once", n === 1 && o.length === 1 && (await pushes()) === 1, { n, o, pushes: await pushes() });
  const l = o[0];
  ok("…kind pass_unwatched, about the whole Pass (no subject), for everyone (no target), in the order lane, linking Live Ops",
    l?.severity === "critical" && l?.category === "order" && l?.subject_id === null && l?.target_user_id === null && l?.link === "/crew?s=now", l);
  ok("…saying so plainly: \"Nobody is on the Pass\", what is live, and the two ways to answer it",
    l?.title === "Nobody is on the Pass"
    && /^The truck is live, and no phone or iPad has had the Pass open for five minutes — nobody is watching for new orders\. Open the Pass on the phone or iPad at the window, or go offline if service is over\.$/.test(l?.body ?? ""), l?.body);
  const x0 = l?.x;
  await run();
  await run();
  const o2 = await open();
  ok("run again and again: still the one line, no second ring — and the line not even rewritten (quiet between)",
    o2.length === 1 && o2[0].id === l.id && o2[0].x === x0 && (await pushes()) === 1 && (await lines()).length === 1, { x0, now: o2[0]?.x });
  await later(6);
  const seenWas = (await open())[0].last_seen_at;
  await run();
  const o3 = await open();
  ok("five minutes on and still true: the same line, refreshed — when it was last true moves, nobody's phone rings",
    o3.length === 1 && o3[0].id === l.id && o3[0].last_seen_at > seenWas && (await pushes()) === 1, o3);
}

// ── a device comes onto the Pass, its feed live ──
{
  const p0 = await pushes();
  await beat(SERVER, PHONE, { feed: "live" });
  const n = await run();
  const all = await lines();
  ok("a device on the Pass with its feed live: the line closes itself — by the mechanism (ack_by null), kept for history, no ring",
    n === 0 && (await open()).length === 0 && all.length === 1 && all[0].ack_at !== null && all[0].ack_by === null && (await pushes()) === p0, all);
  await later(4.5);
  ok("…and a beat four and a half minutes old still counts", (await run()) === 0 && (await open()).length === 0);
}

// ── it goes quiet again, inside the quarter hour of the ring ──
{
  const p0 = await pushes();
  // The live beat is now five and a half minutes old. The line rang 6 + 4.5 + 1 = eleven and a half minutes ago.
  await later(1);
  const n = await run();
  ok("the Pass deaf again eleven and a half minutes after the ring: it counts as unwatched, but the cooldown holds — no new line, no ring",
    n === 1 && (await open()).length === 0 && (await pushes()) === p0, { n, open: (await open()).length });
  await later(4);                                             // fifteen and a half
  await run();
  const o = await open();
  ok("…and past the quarter hour it rings again: a new line, a new ring",
    o.length === 1 && (await lines()).length === 2 && (await pushes()) === p0 + 1, { open: o.length, lines: (await lines()).length });
  ok("…saying who had the Pass last, and when (ET)",
    o[0]?.title === "Nobody is on the Pass"
    && /The last to have it open was Sam \(in a browser\), at (\w{3}, \w{3} \d{1,2}, )?\d{1,2}:\d{2} [AP]M ET\. Open the Pass/.test(o[0]?.body ?? ""), o[0]?.body);
}

// ── on the Pass, but not hearing ──
{
  const p0 = await pushes();
  const was = (await open())[0];
  await beat(SERVER, PHONE, { feed: "down" });
  await run();
  const o = await open();
  ok("a device has the Pass open and its feed is down: the same line, re-worded at once — \"The Pass isn't hearing orders\", who, and how — no new ring",
    o.length === 1 && o[0].id === was.id && o[0].title === "The Pass isn't hearing orders" && (await pushes()) === p0
    && /^The truck is live, and the Pass is open on Sam in a browser \(feed down\) — a new order may not reach it\. Close the Pass and open it again on that device, or check its signal\.$/.test(o[0].body),
    o[0]);
  await beat(OWNER, IPAD, { feed: "reconnecting", app: "ios", build: "1.0 (42)" });
  await run();
  const o2 = await open();
  ok("…two devices on it, neither live: both named, the newest first, words rewritten as they change",
    o2.length === 1 && o2[0].id === was.id && /open on Olive in the app \(reconnecting\), Sam in a browser \(feed down\) —/.test(o2[0].body), o2[0]?.body);
  await beat(SERVER, PHONE, { feed: "unknown" });
  await run();
  ok("…a Pass that has not said how its feed is, is not hearing: \"feed not reported\"", /Sam in a browser \(feed not reported\)/.test((await open())[0]?.body ?? ""), (await open())[0]?.body);
  await beat(SERVER, PHONE, { feed: "signed-out" });
  await run();
  ok("…nor one that is signed out", /Sam in a browser \(signed out\)/.test((await open())[0]?.body ?? ""));
}

// ── what is not a watched Pass ──
{
  await beat(OTHER, PHONE, { feed: "live" });
  ok("another business's device, live on its own Pass, does not watch ours", (await run()) === 1 && (await open()).length === 1);
  await beat(SERVER, IPAD, { surface: "live_ops", feed: "live" });
  ok("a live beat from another screen is not the Pass", (await run()) === 1 && (await open()).length === 1);
  await q(`update public.device_heartbeats set feed = 'live', last_seen = now() - interval '5 minutes 30 seconds' where tenant_id = $1 and surface = 'pass'`, [T1]);
  ok("a live beat five and a half minutes old is not a watched Pass", (await run()) === 1 && (await open()).length === 1);
  await beat(SERVER, PHONE, { feed: "live" });
  ok("…and a fresh one is: the line closes", (await run()) === 0 && (await open()).length === 0);
}

// ── an event, and service ending ──
{
  await truck(false);
  ok("the truck offline and no event: nothing to watch, and nothing open", (await run()) === 0 && (await open()).length === 0);
  const theirs = (await one(`insert into public.events (title, day, is_live, tenant_id) values ('Other Fair', current_date, true, $1) returning id`, [T2])).id;
  await later(20);
  ok("another business's live event is not our service", (await run()) === 0 && (await open()).length === 0);
  await q(`update public.events set is_live = false where id = $1`, [theirs]);
  const ev = (await one(`insert into public.events (title, day, is_live) values ('Harvest Pour', current_date, true) returning id`)).id;
  const p0 = await pushes();
  await run();
  const o = await open();
  ok("an event live and nobody on the Pass for twenty minutes: it rings, and says which event",
    o.length === 1 && (await pushes()) === p0 + 1 && o[0].title === "Nobody is on the Pass" && /^Harvest Pour is live, and no phone or iPad/.test(o[0].body), o[0]?.body);
  await truck(true);
  await run();
  ok("…the truck live too: both said", /^The truck is live and Harvest Pour is on, and no phone or iPad/.test((await open())[0]?.body ?? ""), (await open())[0]?.body);
  await truck(false);
  await q(`update public.events set is_live = false where id = $1`, [ev]);
  const n = await run();
  const all = await lines();
  ok("service over: the line closes itself, by the mechanism", n === 0 && (await open()).length === 0
    && all.every((l) => l.ack_at !== null) && all.filter((l) => l.ack_by !== null).length === 0, all.map((l) => [l.ack_at !== null, l.ack_by]));
}

// ── closed by hand, and the lane owner's copy ──
{
  await truck(true);
  await later(20);
  await run();
  const rung = (await open())[0];
  await q(`update public.alerts set ack_at = now(), ack_by = $2 where id = $1`, [rung.id, OWNER]);
  const p0 = await pushes();
  await later(5);
  await run();
  ok("a line closed by hand, the Pass still unwatched: not reopened five minutes after it rang", (await open()).length === 0 && (await pushes()) === p0);
  await later(10.5);
  await run();
  ok("…but a quarter hour after it rang, it is", (await open()).length === 1 && (await pushes()) === p0 + 1);
  // The lane owner's copy (0174 escalate_unacked_criticals): the same kind, targeted. The run that closes the line
  // closes it too — it is about the same Pass.
  await q(`insert into public.alerts (severity, category, kind, subject_id, title, body, link, target_user_id)
           values ('critical', 'order', 'pass_unwatched', null, 'Unacked 30m — Nobody is on the Pass', 'Escalated to you as the lane owner.', '/crew?s=now', $1)`, [OWNER]);
  await beat(SERVER, PHONE, { feed: "live" });
  ok("the Pass back: the line and the lane owner's copy both close", (await run()) === 0 && (await open()).length === 0);
}

// ── 0376 runs twice ──
{
  await later(20);
  await q(`delete from public.device_heartbeats`);
  await run();
  const before = { lines: (await lines()).length, pushes: await pushes(), open: (await open()).length };
  ok("0376 run again: no error", (await raises(sql376)) === null);
  ok("…the open line untouched, no ring, one changelog line, one job, recorded twice",
    (await lines()).length === before.lines && (await pushes()) === before.pushes && (await open()).length === 1 && before.open === 1
    && (await num(`select count(*) n from public.changelog where title = 'An alert when nobody is on the Pass'`)) === 1
    && (await num(`select count(*) n from cron.job where jobname = 'pass-watchdog'`)) === 1
    && (await num(`select applied_count n from public.schema_migrations where version = '${F376}'`)) === 2, before);
  await truck(false);
  await run();
}

await db.close();
console.log(`0375 + 0376 (who is on the Pass): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
