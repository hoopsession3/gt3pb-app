// 0391 — A CANCELED STOP SAYS SO, AND ITS PRE-ORDERS ARE TOLD, executed from its file against the whole schema (every
// migration before it, in order: scripts/fixtures/schema.full.mjs), acting as each kind of person the way PostgREST
// does.
//
// The finding, as a sentence (H5 of the customer frontend audit): a stop called off just disappeared — archived, gone
// from Find Us on the next read — and nobody who had ordered for it was told. After 0391 an owner or admin cancels it
// with a reason (cancel_stop): it is archived (off the road, and the live switch off if it named it — 0386), marked
// canceled, and the answer says how many cup orders placed for it and packs for its day there are to tell.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIG = (f) => readFileSync(join(ROOT, "supabase/migrations", f), "utf8");
const F391 = "0391_a_canceled_stop_says_so.sql";
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0c391000-0000-4000-8000-0000000000c1", SERVER = "0c391000-0000-4000-8000-0000000000c2", JORDAN = "0c391000-0000-4000-8000-0000000000c3";

const t0 = Date.now();
const db = await fullSchema({ before: "0391" });
console.log(`the schema before 0391 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
const as = async (uid, sql, params) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e) }; }
  finally { await root(); }
};
await db.exec(`
  grant usage on schema public to anon, authenticated, service_role;
  grant select on all tables in schema public to anon, authenticated;
`);
for (const [id, role] of [[OWNER, "owner"], [SERVER, "server"], [JORDAN, "member"]]) {
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}-${id.slice(-2)}@example.test`]);
  await db.query(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, T1]);
}
// A made-up Saturday: WineXpress 7–10am, and Five Forks the same afternoon; a lone stop the Saturday after.
const day = `(date_trunc('day', now() at time zone 'America/New_York') + interval '5 days')`;
const stop = async (name, startH, endH, plusDays = 0) => (await q(`insert into public.stops (name, status, starts_at, ends_at)
  values ($1, 'upcoming', (${day} + interval '${plusDays} days' + interval '${startH} hours') at time zone 'America/New_York',
                          (${day} + interval '${plusDays} days' + interval '${endH} hours') at time zone 'America/New_York') returning id`, [name]))[0].id;
const WX = await stop("WineXpress", 7, 10), FF = await stop("Five Forks", 13, 16), LONE = await stop("Lone stop", 7, 10, 7);
// Cup orders placed for WineXpress (one paid, one not, one already done), and packs for each day.
const cup = (stopId, status, paid) => q(`insert into public.orders (user_id, customer, items, total_cents, paid, status, stop_id) values ($1, 'Jordan', '{rise,flow}', 2000, $2, $3, $4)`, [JORDAN, paid, status, stopId]);
await cup(WX, "new", true); await cup(WX, "new", false); await cup(WX, "done", true);
const pack = (plusDays) => q(`insert into public.drop_orders (user_id, name, size, glass, mix, total_cents, drop_date) values ($1, 'Jordan', 6, 'return', '{"RISE":6}', 3000, (${day} + interval '${plusDays} days')::date)`, [JORDAN]);
await pack(0); await pack(7); await pack(7);
await q(`update public.live_status set is_live = true, current_stop_id = $1 where id = 1`, [LONE]);

// ── BEFORE 0391 ───────────────────────────────────────────────────────────────────────────────────────────────
{
  const r = await as(OWNER, `select public.cancel_stop($1, 'Rained out') c`, [WX]);
  ok("before 0391: a stop cannot be canceled — only archived, saying nothing", /cancel_stop/.test(r.error || "") && /does not exist/.test(r.error || ""), r);
}

await db.exec(MIG(F391));

{
  const server = await as(SERVER, `select public.cancel_stop($1, 'Rained out') c`, [WX]);
  ok("a server cannot call a stop off — owners and admins write stops", /owners and admins only/.test(server.error || ""), server);
  const anon = await as(null, `select public.cancel_stop($1, 'x') c`, [WX]);
  ok("…nor anon at all", /permission denied/.test(anon.error || ""), anon);
  const long = await as(OWNER, `select public.cancel_stop($1, $2) c`, [WX, "x".repeat(141)]);
  ok("…a reason past 140 characters is refused, and nothing moves", /140 characters/.test(long.error || "") && (await q(`select canceled_at from public.stops where id = $1`, [WX]))[0].canceled_at === null, long);

  const r = await as(OWNER, `select public.cancel_stop($1, '  Rained out  ') c`, [WX]);
  const c = r.rows[0]?.c;
  const s = (await q(`select archived_at, canceled_at, cancel_reason, status from public.stops where id = $1`, [WX]))[0];
  ok("cancel: archived, canceled, the reason kept (trimmed)", s.archived_at !== null && s.canceled_at !== null && s.cancel_reason === "Rained out", s);
  ok("…two cup orders placed for it still to be picked up (the done one is not)", c?.cups === 2, c);
  ok("…and no packs to tell: Five Forks still runs that day", c?.packs === 0 && c?.other_stop_that_day === true, c);
  const again = await as(OWNER, `select public.cancel_stop($1, 'Something else') c`, [WX]);
  ok("a second call changes nothing and says it was already", again.rows[0]?.c?.already === true
    && (await q(`select cancel_reason from public.stops where id = $1`, [WX]))[0].cancel_reason === "Rained out", again);

  const lone = await as(OWNER, `select public.cancel_stop($1, 'Truck in the shop') c`, [LONE]);
  ok("the lone stop of its day: its two packs are there to tell", lone.rows[0]?.c?.packs === 2 && lone.rows[0]?.c?.other_stop_that_day === false, lone);
  const ls = (await q(`select is_live, current_stop_id from public.live_status where id = 1`))[0];
  ok("…and the live switch that named it is off (0386, the archive)", ls.is_live === false && ls.current_stop_id === null, ls);
  const pub = await as(null, `select cancel_reason from public.stops where id = $1`, [LONE]);
  ok("a guest reads the reason — Find Us says it", pub.rows[0]?.cancel_reason === "Truck in the shop", pub);
  const restore = await q(`update public.stops set archived_at = null, canceled_at = null, cancel_reason = null where id = $1 returning id`, [FF]);
  ok("the crew's Restore clears all three", restore.length === 1);
}

{
  const g = (await q(`select has_function_privilege('anon', 'public.cancel_stop(uuid, text)', 'execute') a,
    has_function_privilege('authenticated', 'public.cancel_stop(uuid, text)', 'execute') b`))[0];
  ok("grants: anon holds no execute; a signed-in caller does (the function refuses inside)", g.a === false && g.b === true, g);
  await db.exec(MIG(F391));
  ok("a second run changes nothing: canceled stays canceled, one changelog line, recorded",
    (await q(`select count(*)::int n from public.stops where canceled_at is not null`))[0].n === 2
    && (await q(`select count(*)::int n from public.changelog where title = 'A canceled stop says so'`))[0].n === 1
    && (await q(`select count(*)::int n from public.schema_migrations where version = '0391_a_canceled_stop_says_so'`))[0].n >= 1);
}

console.log(`db.stopcancel: ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
