// 0402 — THE TRUCK'S POSITION IS THE CREW'S, executed from its file against the whole schema (every migration before it,
// in order, with Supabase's own default privileges: scripts/fixtures/schema.full.mjs), acting as anon, a member, the crew
// and the server the way PostgREST does.
//
// The finding, as a sentence (R6 of the customer audit): live_status is the one row everyone may read, signed out too, and
// 0022 kept the truck's GPS on it — so the public key read where the truck stood, to the metre, and every 8-second write
// went out to every open Find Us page. No customer page draws it. It moves to a row of its own that only the crew read.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SQL402 = readFileSync(join(ROOT, "supabase/migrations/0402_the_trucks_position_is_the_crews.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0c402000-0000-4000-8000-0000000000c1", SAM = "0c402000-0000-4000-8000-0000000000a1";

const t0 = Date.now();
const db = await fullSchema({ before: "0402" });
console.log(`the schema before 0402 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claims', '', false);`);
// "server" is the service role with no session; a uid is a signed-in person; null is anon.
const as = async (uid, sql, params) => {
  const sub = uid && uid !== "server" ? uid : "";
  await db.exec(`select set_config('request.jwt.claim.sub', '${sub}', false);
    set role ${uid === "server" ? "service_role" : uid ? "authenticated" : "anon"};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e), code: e.code }; }
  finally { await root(); }
};
for (const [id, role, email] of [[OWNER, "owner", "owner@example.test"], [SAM, "member", "sam@example.test"]]) {
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
  await db.query(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, T1]);
}
const stop = (await q1(`insert into public.stops (name, status, sort, tenant_id) values ('Falls Park', 'live', 0, $1) returning id`, [T1])).id;
await db.query(`insert into public.live_status (id, current_stop_id, is_live, tenant_id) values (1, $1, true, $2)
  on conflict (id) do update set current_stop_id = excluded.current_stop_id, is_live = true`, [stop, T1]);

// ── BEFORE: the position is on the public row ───────────────────────────────────────────────────────────────────────────
const pinned = await as(OWNER, `select public.admin_set_truck_pos(34.8526, -82.394)`);
ok("before 0402: the crew pin the truck (admin_set_truck_pos)", !pinned.error, pinned.error);
const leak = await as(null, `select truck_lat, truck_lng, pos_updated_at from public.live_status where id = 1`);
ok("before 0402: a caller with no session reads the truck's GPS off live_status — the leak",
  !leak.error && leak.rows.length === 1 && Number(leak.rows[0].truck_lat) === 34.8526, leak);

// ── 0402 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
await db.exec(SQL402);
const cols = (await q(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'live_status'`)).map((r) => r.column_name);
ok("after 0402: live_status has no position columns left", !cols.some((c) => ["truck_lat", "truck_lng", "pos_updated_at"].includes(c)), cols);
ok("after 0402: live_status keeps what the public pages read — the switch, its stop, the lead time, pay at pickup",
  ["is_live", "current_stop_id", "preorder_lead_h", "pay_at_pickup"].every((c) => cols.includes(c)), cols);
const moved = await q1(`select truck_lat, truck_lng, pos_updated_at from public.truck_position where id = 1`);
ok("after 0402: the position is carried over to truck_position", moved && Number(moved.truck_lat) === 34.8526 && Number(moved.truck_lng) === -82.394 && moved.pos_updated_at !== null, moved);
ok("after 0402: truck_position has row level security on", (await q1(`select relrowsecurity as r from pg_class where relname = 'truck_position'`)).r === true);

const anon = await as(null, `select * from public.truck_position`);
ok("after 0402: a caller with no session cannot read the position at all", !!anon.error && /permission denied/.test(anon.error), anon);
const member = await as(SAM, `select * from public.truck_position`);
ok("after 0402: a member reads no position (row level security)", !member.error && member.rows.length === 0, member);
const crew = await as(OWNER, `select truck_lat from public.truck_position`);
ok("after 0402: the crew read it", !crew.error && crew.rows.length === 1, crew);
const pub = await as(null, `select id, is_live, current_stop_id from public.live_status where id = 1`);
ok("after 0402: Find Us's read still answers signed out — the switch and its stop", !pub.error && pub.rows[0]?.is_live === true && pub.rows[0]?.current_stop_id === stop, pub);
const star = await as(null, `select * from public.live_status where id = 1`);
ok("after 0402: even a select * on live_status signed out carries no position", !star.error && !("truck_lat" in (star.rows[0] ?? {})), star.rows[0]);

// ── the writers, after ──────────────────────────────────────────────────────────────────────────────────────────────
ok("after 0402: the crew's pin writes the crew's row", !(await as(OWNER, `select public.admin_set_truck_pos(34.85, -82.40)`)).error
  && Number((await q1(`select truck_lat from public.truck_position where id = 1`)).truck_lat) === 34.85);
ok("after 0402: a member's pin is refused by the function's own check", /not authorized/.test((await as(SAM, `select public.admin_set_truck_pos(1, 2)`)).error || ""));
ok("after 0402: a caller with no session cannot call it", /permission denied/.test((await as(null, `select public.admin_set_truck_pos(1, 2)`)).error || ""));
ok("after 0402: nor go offline", /permission denied/.test((await as(null, `select public.admin_set_offline()`)).error || ""));
const off = await as(OWNER, `select public.admin_set_offline()`);
const after = await q1(`select l.is_live, l.current_stop_id, p.truck_lat, p.pos_updated_at from public.live_status l, public.truck_position p where l.id = 1 and p.id = 1`);
ok("after 0402: going offline turns the switch off and clears the position", !off.error && after.is_live === false && after.current_stop_id === null && after.truck_lat === null && after.pos_updated_at === null, { off, after });
ok("after 0402: the stop that was live is upcoming again", (await q1(`select status from public.stops where id = $1`, [stop])).status === "upcoming");

// ── a second run changes nothing ────────────────────────────────────────────────────────────────────────────────────────
await as(OWNER, `select public.admin_set_truck_pos(34.9, -82.3)`);
let again = null;
try { await db.exec(SQL402); } catch (e) { again = String(e.message || e); }
ok("0402 runs twice without an error", again === null, again);
ok("a second run keeps the position as it stands", Number((await q1(`select truck_lat from public.truck_position where id = 1`)).truck_lat) === 34.9);
ok("0402 is in the ledger", Number((await q1(`select count(*)::int as n from public.schema_migrations where version like '0402%'`)).n) >= 1);

await db.close();
console.log(`\nTRUCK POSITION (0402): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
