// 0399 — A PACK HEARS ABOUT ITS DAY, executed from its file against the whole schema (every migration before it, in
// order: scripts/fixtures/schema.full.mjs), acting as the crew, a member and the server the way PostgREST does.
//
// The finding, as a sentence (R5 of the customer audit): nothing reminded a member the evening before their pickup, and
// when the crew moved or canceled their pack, or changed their stop's hours or place, the member heard nothing.
//
// The world is first made to look like production (the alert fan-out is a dashboard webhook called push_alerts_insert),
// so 0399 is seen to find its door by what it calls. Pushes are counted at that door, supabase_functions.http_request:
// PGlite has no pg_net, so the stand-in records each call instead of making it.
// NOT MODELED: pg_cron (each run is the function called by hand, at a time given), the push function's sending
// (scripts/push.policy.test.mjs runs its words).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SQL399 = readFileSync(join(ROOT, "supabase/migrations/0399_a_pack_hears_about_its_day.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0c399000-0000-4000-8000-0000000000c1", SAM = "0c399000-0000-4000-8000-0000000000a1", ALEX = "0c399000-0000-4000-8000-0000000000a2";

const t0 = Date.now();
const db = await fullSchema({ before: "0399" });
console.log(`the schema before 0399 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
const as = async (uid, sql, params) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e) }; }
  finally { await root(); }
};
// Supabase's own table grants (the fixture keeps none): what a role may touch is then RLS's to say, as in production.
await db.exec(`
  grant usage on schema public to anon, authenticated, service_role;
  grant select on all tables in schema public to anon, authenticated;
  grant update on public.drop_orders, public.stops to authenticated;
  create table public.test_pushes (n bigserial primary key, tbl text, op text, trig text, row_id uuid, at timestamptz default now());
  create or replace function supabase_functions.http_request() returns trigger language plpgsql security definer as $$
  begin
    insert into public.test_pushes (tbl, op, trig, row_id) values (TG_TABLE_NAME, TG_OP, TG_NAME, new.id);
    return new;
  end $$;
`);
for (const [id, role] of [[OWNER, "owner"], [SAM, "member"], [ALEX, "member"]]) {
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}-${id.slice(-2)}@example.test`]);
  await db.query(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, T1]);
}

// A made-up week, in Eastern days relative to today: D is five days out, D+1 the day after. Each stop 11am–2pm.
const D = `(date_trunc('day', now() at time zone 'America/New_York') + interval '5 days')`;
const at = (plusDays, h) => `((${D} + interval '${plusDays} days' + interval '${h} hours') at time zone 'America/New_York')`;
const stop = async (name, plusDays, h = 11) => (await q1(`insert into public.stops (name, status, starts_at, ends_at, address, location_text)
  values ($1, 'upcoming', ${at(plusDays, h)}, ${at(plusDays, h + 3)}, '202 Scuffletown Rd, Simpsonville, SC', '202 Scuffletown Rd') returning id`, [name])).id;
const WX = await stop("WineXpress", 0), NEXT = await stop("Next day", 1);
const dayOf = async (id) => (await q1(`select to_char((starts_at at time zone 'America/New_York')::date, 'YYYY-MM-DD') d from public.stops where id = $1`, [id])).d;
const DAY0 = await dayOf(WX), DAY1 = await dayOf(NEXT);
const pack = async (user, day, extra = {}) => (await q1(`insert into public.drop_orders (user_id, name, size, glass, mix, total_cents, drop_date, paid, stage, picked_up)
  values ($1, 'A member', 6, 'return', '{"RISE":6}', 3000, $2::date, $3, 'reserved', $4) returning id`, [user, day, extra.paid ?? false, extra.picked ?? false])).id;
const P1 = await pack(SAM, DAY0), P2 = await pack(ALEX, DAY0, { paid: true }), P4 = await pack(ALEX, DAY0), PPICK = await pack(SAM, DAY0, { picked: true }), P3 = await pack(SAM, DAY1);

// ── THE WORLD AS PRODUCTION HAS IT ───────────────────────────────────────────────────────────────────────────────────
const fanout = (await q(`select tgname from pg_trigger where tgrelid = 'public.alerts'::regclass and tgname in ('alerts_push_fanout', 'push_alerts_insert')`)).map((r) => r.tgname);
if (fanout.includes("alerts_push_fanout")) await db.exec(`alter trigger alerts_push_fanout on public.alerts rename to push_alerts_insert;`);
ok("production, as measured: the alert fan-out is push_alerts_insert", (await q(`select 1 from pg_trigger where tgname = 'push_alerts_insert'`)).length === 1);
ok("before 0399: a pack's member hears nothing — there is nowhere to keep a notice", (await q(`select 1 from information_schema.tables where table_name = 'pack_notices'`)).length === 0);

await db.exec(SQL399);
const notices = async (pack) => q(`select kind, user_id, due_at, sent_at, for_day::text for_day from public.pack_notices where pack_id = $1 order by created_at`, [pack]);
const waiting = async () => q(`select pack_id, kind from public.pack_notices where sent_at is null order by kind, pack_id`);
const pushes = async () => q(`select trig from public.test_pushes where tbl = 'pack_notices' order by n`);

// ── THE DOOR ─────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const t = await q(`select t.tgname, pg_get_triggerdef(t.oid) d from pg_trigger t where t.tgrelid = 'public.pack_notices'::regclass and not t.tgisinternal`);
  const fan = await q1(`select pg_get_triggerdef(oid) d from pg_trigger where tgname = 'push_alerts_insert'`);
  const callOf = (d) => (/EXECUTE FUNCTION .*$/.exec(d ?? "") ?? [""])[0];
  // Names and booleans only in what this prints: a webhook's definition carries its address and its header.
  const facts = { one: t.length === 1, name: t[0]?.tgname === "pack_notices_push", sameCall: callOf(t[0]?.d) === callOf(fan?.d) && callOf(fan?.d) !== "",
    onSent: /AFTER UPDATE OF sent_at/.test(t[0]?.d ?? ""), noAddressInFile: !/https?:\/\/|Bearer/i.test(SQL399.replace(/--.*$/gm, "")) };
  ok("the door is made from the fan-out's own call — the same function, the same arguments, no address or key in the file", Object.values(facts).every(Boolean), facts);
  ok("the run is on the cron, every five minutes", (await q(`select schedule, command from cron.job where jobname = 'release-pack-notices'`)).map((r) => `${r.schedule}|${r.command}`).join() === "*/5 * * * *|select public.release_pack_notices()");
}

// ── THE CREW'S CHANGE TO A PACK ──────────────────────────────────────────────────────────────────────────────────────
{
  const m1 = await as(OWNER, `update public.drop_orders set drop_date = $2::date where id = $1`, [P1, DAY1]);
  const n1 = await notices(P1);
  ok("the crew move a pack to another day: its member is told — one 'pack_moved', to them, due in a couple of minutes",
    m1.error === null && n1.length === 1 && n1[0].kind === "pack_moved" && n1[0].user_id === SAM && n1[0].sent_at === null
    && (await q1(`select ($1::timestamptz - now()) between interval '1 minute' and interval '3 minutes' ok`, [n1[0].due_at])).ok, { m1, n1 });
  await as(OWNER, `update public.drop_orders set drop_date = $2::date where id = $1`, [P1, DAY0]);
  await as(OWNER, `update public.drop_orders set drop_date = $2::date where id = $1`, [P1, DAY1]);
  ok("…moved twice more before it went: still one notice waiting (its time moved; the words are read when it goes)", (await notices(P1)).length === 1);

  await q(`update public.drop_orders set drop_date = $2::date where id = $1`, [P3, DAY0]);   // the server: a member's own route
  ok("a change the server makes — the member's own Move, the stop-cancel route — queues nothing here", (await notices(P3)).length === 0);
  await q(`update public.drop_orders set drop_date = $2::date where id = $1`, [P3, DAY1]);

  const c = await as(OWNER, `update public.drop_orders set canceled_at = now() where id = $1`, [P2]);
  const n2 = await notices(P2);
  ok("the crew cancel a pack: its member is told ('pack_canceled'), at once", c.error === null && n2.length === 1 && n2[0].kind === "pack_canceled" && n2[0].user_id === ALEX, { c, n2 });
  await as(OWNER, `update public.drop_orders set picked_up = true where id = $1`, [P1]);
  ok("a pack picked up: nothing more waits to go about it", (await notices(P1)).length === 0);
  await q(`update public.drop_orders set picked_up = false where id = $1`, [P1]);
}

// ── A STOP'S HOURS OR PLACE ──────────────────────────────────────────────────────────────────────────────────────────
{
  await q(`delete from public.pack_notices`);
  const h = await as(OWNER, `update public.stops set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour' where id = $1`, [WX]);
  const w = await waiting();
  ok("the crew move a stop's hours: each live pack there is told ('pickup_changed') — not one canceled, picked up, or at another stop",
    h.error === null && w.length === 1 && w[0].pack_id === P4 && w[0].kind === "pickup_changed" && (await notices(PPICK)).length === 0, { h, w });
  await as(OWNER, `update public.stops set address = '202 Scuffletown Rd., Simpsonville, SC' where id = $1`, [WX]);
  ok("…a comma added to its street is not a new place: nothing more", (await waiting()).length === 1);
  await as(OWNER, `update public.stops set address = '9 Main St, Greer, SC', location_text = '9 Main St' where id = $1`, [WX]);
  ok("…a new street, before the first notice went: still one waiting, and it will say how things stand", (await waiting()).length === 1);
  await as(OWNER, `update public.stops set name = 'WineXpress Greer' where id = $1`, [WX]);
  ok("…its name alone changed: nothing more", (await waiting()).length === 1);

  await q(`delete from public.pack_notices`);
  await q(`delete from public.alerts where title = 'Packs moved with their stop'`);
  const d = await as(OWNER, `update public.stops set starts_at = starts_at + interval '1 day', ends_at = ends_at + interval '1 day' where id = $1`, [WX]);
  const w2 = await waiting();
  const day = (await q1(`select drop_date::text d from public.drop_orders where id = $1`, [P4])).d;
  ok("a stop moved to another day takes its packs (0397) and tells them once — 'pickup_changed', no 'pack_moved' as well",
    d.error === null && day === DAY1 && w2.length === 1 && w2[0].pack_id === P4 && w2[0].kind === "pickup_changed", { d, day, w2 });
  const alert = await q1(`select body from public.alerts where title = 'Packs moved with their stop'`);
  ok("…and the crew are told the members hear it, not asked to call round", /told by push and email/.test(alert?.body ?? "") && !/Let the customers know/.test(alert?.body ?? ""), alert);
  await as(OWNER, `update public.stops set starts_at = starts_at - interval '1 day', ends_at = ends_at - interval '1 day' where id = $1`, [WX]);
  await q(`delete from public.pack_notices`);
  await as(OWNER, `update public.stops set canceled_at = now(), cancel_reason = 'Rained out', starts_at = starts_at + interval '2 hours' where id = $1`, [WX]);
  ok("a stop called off queues nothing here — it tells its people itself (app/api/crew/stops/cancel)", (await waiting()).length === 0);
  await q(`update public.stops set canceled_at = null, cancel_reason = null, starts_at = starts_at - interval '2 hours' where id = $1`, [WX]);
}

// ── THE RUN ──────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  await db.exec(`delete from public.pack_notices; delete from public.test_pushes;`);
  await as(OWNER, `update public.drop_orders set drop_date = $2::date where id = $1`, [P1, DAY0]);   // pack_moved, P1
  const etAt = (plusDays, hhmm) => q1(`select ((date_trunc('day', now() at time zone 'America/New_York') + interval '${plusDays} days' + interval '${hhmm}')
    at time zone 'America/New_York') t`).then((r) => r.t);
  const night = await etAt(1, "23 hours"), morning = await etAt(1, "10 hours");
  ok("at night (11pm Eastern) nothing goes — it waits", (await q1(`select public.release_pack_notices($1) n`, [night])).n === 0 && (await pushes()).length === 0);
  const r = (await q1(`select public.release_pack_notices($1) n`, [morning])).n;
  const p = await pushes();
  ok("in the morning (10am Eastern) what is due goes — once, through the door", r === 1 && p.length === 1 && p[0].trig === "pack_notices_push" && (await notices(P1))[0]?.sent_at !== null, { r, p });
  ok("…and a second run sends nothing again", (await q1(`select public.release_pack_notices($1) n`, [morning])).n === 0 && (await pushes()).length === 1);

  // The evening before: a pack picked up the day after tomorrow, asked tomorrow at 5pm, 6:30pm, and again at 7pm.
  const EVE = await stop("Eve", -3);   // D-3 = two days from today
  const DAYEVE = await dayOf(EVE);
  const PE = await pack(SAM, DAYEVE), PEC = await pack(ALEX, DAYEVE);
  await q(`update public.drop_orders set canceled_at = now() where id = $1`, [PEC]);
  const five = await etAt(1, "17 hours"), half6 = await etAt(1, "18 hours 30 minutes"), seven = await etAt(1, "19 hours");
  ok("at 5pm the evening before: no reminder yet", (await q1(`select public.release_pack_notices($1) n`, [five])).n === 0 && (await notices(PE)).length === 0);
  const r6 = (await q1(`select public.release_pack_notices($1) n`, [half6])).n;
  const ne = await notices(PE);
  ok("at 6:30pm: the reminder is made and goes — for that day, to the member; none for a canceled pack",
    r6 === 1 && ne.length === 1 && ne[0].kind === "pickup_tomorrow" && ne[0].for_day === DAYEVE && ne[0].sent_at !== null && (await notices(PEC)).length === 0, { r6, ne });
  ok("…and at 7pm it is not made or sent again", (await q1(`select public.release_pack_notices($1) n`, [seven])).n === 0 && (await notices(PE)).length === 1);

  // Let go: a notice about a pack canceled since it was queued (its cancel is the one that goes), and one past its day.
  await q(`delete from public.pack_notices`);
  await as(OWNER, `update public.drop_orders set drop_date = $2::date where id = $1`, [P4, DAY1]);
  await q(`update public.drop_orders set canceled_at = now() where id = $1`, [P4]);   // canceled by the server after
  ok("a pack canceled after a move was queued: the move notice is let go", (await notices(P4)).length === 0);
}

// ── WHO MAY ──────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  ok("a member cannot read the notices", (await as(SAM, `select * from public.pack_notices`)).error !== null || (await as(SAM, `select * from public.pack_notices`)).rows.length === 0);
  ok("…nor run the release, nor queue one", /permission denied/.test((await as(SAM, `select public.release_pack_notices()`)).error || "")
    && /permission denied/.test((await as(SAM, `select public.queue_pack_notice($1, 'pack_moved', now())`, [P1])).error || ""));
  ok("…nor may the crew (only the cron and the triggers run them)", /permission denied/.test((await as(OWNER, `select public.release_pack_notices()`)).error || ""));
}

// ── AN ERASED MEMBER ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  await q(`delete from public.pack_notices`);
  await as(OWNER, `update public.drop_orders set drop_date = $2::date where id = $1`, [P3, DAY0]);
  const before = (await notices(P3)).length;
  // nothing of theirs still on its way (0353 waits for that) — written as the stage, which no notice watches
  await q(`update public.drop_orders set stage = 'picked_up' where user_id = $1`, [SAM]);
  let err = null;
  try { await q(`delete from auth.users where id = $1`, [SAM]); } catch (e) { err = String(e.message || e); }
  ok("an erased member's notices go with the account (0353's erasure)", before === 1 && err === null && (await q(`select 1 from public.pack_notices where user_id = $1`, [SAM])).length === 0, { before, err });
}

// ── A SECOND RUN, AND NO DOOR ────────────────────────────────────────────────────────────────────────────────────────
{
  const rows = await q(`select count(*)::int n from public.pack_notices`);
  await db.exec(SQL399);
  ok("a second run changes nothing: one door, one job, one changelog line, one ledger row, the rows kept",
    (await q(`select 1 from pg_trigger where tgname = 'pack_notices_push'`)).length === 1 && (await q(`select 1 from cron.job where jobname = 'release-pack-notices'`)).length === 1
    && (await q(`select 1 from public.changelog where title = 'Your pack, the evening before'`)).length === 1
    && (await q(`select 1 from public.schema_migrations where version = '0399_a_pack_hears_about_its_day'`)).length === 1
    && JSON.stringify(rows) === JSON.stringify(await q(`select count(*)::int n from public.pack_notices`)));
  await db.exec(`drop trigger pack_notices_push on public.pack_notices; drop trigger push_alerts_insert on public.alerts;`);
  let err = null;
  try { await db.exec(SQL399); } catch (e) { err = String(e.message || e); }
  ok("with no fan-out to copy, 0399 says so and makes no door — and fails nothing", err === null && (await q(`select 1 from pg_trigger where tgname = 'pack_notices_push'`)).length === 0, err);
}

console.log(`\nA PACK HEARS ABOUT ITS DAY (0399): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
