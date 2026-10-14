// 0400 — A LIMITED RESERVE IS PAID TO HOLD, executed from its file against the whole schema (every migration before it,
// in order: scripts/fixtures/schema.full.mjs), acting as a member, the crew and the server the way PostgREST does.
//
// The finding, as a sentence (R5 of the customer audit): a reserve was a 48-hour hold paid at the truck — nothing said
// where or when to come, the hold ran out on its own clock, and on the day the crew had no list of who was owed a bottle.
//
// The world is first made the way production had it before 0400 — a claim marked paid at the truck, and a hold — so the
// file is seen to keep them. Then every function it adds, by whoever may call it, and what a refund made in Square, the
// books and the crew's lists make of a paid claim. NOT MODELED: Square (scripts/reservepay.test.mjs), pg_cron.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SQL400 = readFileSync(join(ROOT, "supabase/migrations/0400_a_limited_reserve_is_paid_to_hold.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0c400000-0000-4000-8000-0000000000c1", CREW = "0c400000-0000-4000-8000-0000000000c2";
const SAM = "0c400000-0000-4000-8000-0000000000a1", ALEX = "0c400000-0000-4000-8000-0000000000a2", GUEST = "0c400000-0000-4000-8000-0000000000a3";

const t0 = Date.now();
const db = await fullSchema({ before: "0400" });
console.log(`the schema before 0400 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
// "server" is the service role (the routes); a uid is a signed-in person; null is anon.
const as = async (uid, sql, params) => {
  const sub = uid && uid !== "server" ? uid : "";
  await db.exec(`select set_config('request.jwt.claim.sub', '${sub}', false); set role ${uid === "server" ? "service_role" : uid ? "authenticated" : "anon"};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e), code: e.code }; }
  finally { await root(); }
};
const raises = async (sql, params) => { try { await db.query(sql, params); return null; } catch (e) { return { message: String(e.message || e), code: e.code }; } };
// Supabase's own table grants (the fixture keeps none): what a role may touch is then RLS's to say, as in production.
await db.exec(`
  grant usage on schema public to anon, authenticated, service_role;
  grant select on all tables in schema public to anon, authenticated;
  grant update on public.reserves to authenticated;
`);
for (const [id, role] of [[OWNER, "owner"], [CREW, "server"], [SAM, "member"], [ALEX, "member"], [GUEST, "member"]]) {
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}-${id.slice(-2)}@example.test`]);
  await db.query(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, T1]);
}
// Members by tier (0176); the guest has an account and no membership.
await db.query(`update public.customers set tier = 'member' where user_id in ($1, $2)`, [SAM, ALEX]);
await db.query(`update public.customers set tier = 'guest' where user_id = $1`, [GUEST]);

// ── THE WORLD AS PRODUCTION HAD IT ───────────────────────────────────────────────────────────────────────────────────
const OLD = (await q1(`insert into public.reserves (name, price_cents, stock_total, stock_remaining, per_member_limit, status, tenant_id)
  values ('Old Cask', 6000, 5, 3, 1, 'live', $1) returning id`, [T1])).id;
await db.query(`insert into public.reserve_claims (reserve_id, user_id, qty, state, tenant_id) values ($1, $2, 1, 'paid', $3)`, [OLD, SAM, T1]);
await db.query(`insert into public.reserve_claims (reserve_id, user_id, qty, state, hold_expires_at, tenant_id) values ($1, $2, 1, 'held', now() + interval '1 day', $3)`, [OLD, ALEX, T1]);
ok("before 0400: a member claims a reserve with no card — a hold, paid at the truck", (await as(SAM, `select has_function_privilege('authenticated', 'public.claim_reserve(uuid,integer)', 'execute') as x`)).rows[0]?.x === true);

await db.exec(SQL400);
let again = null;
try { await db.exec(SQL400); } catch (e) { again = String(e.message || e); }
ok("0400 runs twice and changes nothing the second time", again === null, again);
ok("existing rows: a claim marked paid at the truck (no payment, no amount) was handed over — collected; a hold stays a hold",
  (await q1(`select state from public.reserve_claims where reserve_id = $1 and user_id = $2`, [OLD, SAM])).state === "collected"
  && (await q1(`select state from public.reserve_claims where reserve_id = $1 and user_id = $2`, [OLD, ALEX])).state === "held");
ok("the ledger says 0400 ran", (await q(`select 1 from public.schema_migrations where version = '0400_a_limited_reserve_is_paid_to_hold'`)).length === 1);

// ── the shape ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const cols = (t) => q(`select column_name, is_nullable from information_schema.columns where table_schema = 'public' and table_name = $1`, [t]);
const rc = await cols("reserve_claims");
ok("shape: a reserve names its pickup; a claim keeps its key, payment, what it took and gave back, its cancel and its handover",
  (await cols("reserves")).some((c) => c.column_name === "stop_id")
  && ["idempotency_key", "payment_id", "paid_cents", "refunded_cents", "canceled_at", "cancel_reason", "collected_at", "collected_by"].every((n) => rc.some((c) => c.column_name === n)));
ok("shape: a claim's member may be let go (an erased account), and one member may hold more than one claim on a reserve",
  rc.find((c) => c.column_name === "user_id")?.is_nullable === "YES" && (await q(`select 1 from pg_indexes where indexname = 'one_active_claim_per_member'`)).length === 0);
const priv = async (role, fn) => (await q1(`select has_function_privilege($1, $2, 'execute') as x`, [role, fn])).x;
ok("who may: hold, settle and release are the server's alone; a member no longer claims a hold; the crew hand over",
  !(await priv("authenticated", "public.hold_reserve(uuid,uuid,integer,text)")) && !(await priv("anon", "public.hold_reserve(uuid,uuid,integer,text)"))
  && !(await priv("authenticated", "public.settle_reserve(uuid,text,integer)")) && !(await priv("authenticated", "public.release_reserve(uuid,text,integer)"))
  && (await priv("service_role", "public.hold_reserve(uuid,uuid,integer,text)")) && !(await priv("authenticated", "public.claim_reserve(uuid,integer)"))
  && (await priv("authenticated", "public.collect_reserve_claim(uuid)")) && !(await priv("anon", "public.collect_reserve_claim(uuid)")));

// ── a pickup, and a reserve handed over at it ─────────────────────────────────────────────────────────────────────────
const D = `(date_trunc('day', now() at time zone 'America/New_York') + interval '5 days')`;
const at = (plusDays, h) => `((${D} + interval '${plusDays} days' + interval '${h} hours') at time zone 'America/New_York')`;
const stop = async (name, starts) => (await q1(`insert into public.stops (name, status, starts_at, ends_at) values ($1, 'upcoming', ${starts}, ${starts} + interval '3 hours') returning id`, [name])).id;
const WX = await stop("WineXpress", at(0, 11));
const SOON = await stop("Tomorrow's", `now() + interval '20 hours'`);
const OFF = await stop("Rained out", at(1, 11));
await db.query(`update public.stops set canceled_at = now(), cancel_reason = 'Rained out' where id = $1`, [OFF]);
const reserve = async (name, extra = {}) => (await q1(`insert into public.reserves (name, price_cents, stock_total, stock_remaining, per_member_limit, member_only, status, stop_id, tenant_id)
  values ($1, $2, $3, $3, $4, $5, $6, $7, $8) returning id`, [name, extra.price ?? 4000, extra.stock ?? 6, extra.limit ?? 3, extra.members ?? true, extra.status ?? "live", extra.stop === undefined ? WX : extra.stop, T1])).id;
const BR = await reserve("Barrel Rise");
const hold = (user, res, qty, key) => as("server", `select public.hold_reserve($1, $2, $3, $4) as h`, [user, res, qty, key]);
const stock = async (id) => (await q1(`select stock_remaining n, status from public.reserves where id = $1`, [id]));
const claimOf = async (id) => q1(`select * from public.reserve_claims where id = $1`, [id]);

ok("closes: 24 hours before its stop; never with no stop or a stop called off",
  (await q1(`select public.reserve_closes_at($1) = (select starts_at - interval '24 hours' from public.stops where id = $2) as x`, [BR, WX])).x === true
  && (await q1(`select public.reserve_closes_at($1) as x`, [await reserve("No pickup", { stop: null })])).x === null
  && (await q1(`select public.reserve_closes_at($1) as x`, [await reserve("Called off", { stop: OFF })])).x === null);

// ── the hold ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const h1 = await hold(SAM, BR, 2, "rsv-db-key-000001");
const H1 = h1.rows[0]?.h;
ok("hold: two bottles off the shelf, as a pending claim under the key, priced from the reserve",
  !h1.error && H1?.state === "pending" && H1.qty === 2 && H1.amount_cents === 8000 && H1.again === false && (await stock(BR)).n === 4, h1);
const h1b = (await hold(SAM, BR, 2, "rsv-db-key-000001")).rows[0]?.h;
ok("hold: the same key again is the same claim — no second pair off the shelf", h1b?.id === H1.id && h1b.again === true && (await stock(BR)).n === 4, h1b);
const theirs = await hold(ALEX, BR, 1, "rsv-db-key-000001");
ok("hold: another member's key is not theirs to hold under", /someone else/.test(theirs.error ?? ""), theirs);
const lim = await hold(SAM, BR, 2, "rsv-db-key-000002");
ok("hold: the member's limit is the sum of their claims — 2 + 2 > 3 is refused, in words (409)", /more than one member may reserve/.test(lim.error ?? "") && lim.code === "PT409", lim);
const guest = await hold(GUEST, BR, 1, "rsv-db-key-000003");
ok("hold: members only — a guest account is told so (403)", /This reserve is for members/.test(guest.error ?? "") && guest.code === "42501", guest);
const SMALL = await reserve("Small Batch", { stock: 2, limit: 5 });
const over = await hold(ALEX, SMALL, 3, "rsv-db-key-000004");
const last = await hold(ALEX, SMALL, 2, "rsv-db-key-000005");
const gone = await hold(SAM, SMALL, 1, "rsv-db-key-000006");
ok("hold: more than are left — 'Only 2 left.'; the last two — sold out flips; then 'Sold out.'",
  /Only 2 left/.test(over.error ?? "") && !last.error && (await stock(SMALL)).status === "sold_out" && /Sold out/.test(gone.error ?? "") && gone.code === "PT409", [over, gone]);
const draft = await hold(SAM, await reserve("Draft", { status: "draft" }), 1, "rsv-db-key-000007");
const noStop = await hold(SAM, await reserve("Unnamed pickup", { stop: null }), 1, "rsv-db-key-000008");
ok("hold: not on offer, or no pickup named — gone (404)", /isn't on offer right now/.test(draft.error ?? "") && draft.code === "PT404" && noStop.code === "PT404", [draft, noStop]);
const off = await hold(SAM, await reserve("Rained", { stop: OFF }), 1, "rsv-db-key-000009");
const soon = await hold(SAM, await reserve("Too late", { stop: SOON }), 1, "rsv-db-key-000010");
ok("hold: its pickup called off — 'check back for the new one'; under 24 hours to go — closed (409)",
  /called off/.test(off.error ?? "") && off.code === "PT409" && /have closed/.test(soon.error ?? "") && soon.code === "PT409", [off, soon]);
const badQty = await hold(SAM, BR, 13, "rsv-db-key-000011"), badKey = await hold(SAM, BR, 1, "short");
ok("hold: between 1 and 12, under a real key — a bad value (22023)", badQty.code === "22023" && badKey.code === "22023", [badQty, badKey]);

// ── paid, released ────────────────────────────────────────────────────────────────────────────────────────────────────
const settle = (id, pay, cents) => as("server", `select public.settle_reserve($1, $2, $3) as s`, [id, pay, cents]);
const release = (id, why, back) => as("server", `select public.release_reserve($1, $2, $3) as r`, [id, why, back]);
await settle(H1.id, "pay_DB0000001", 8000);
const c1 = await claimOf(H1.id);
ok("settle: pending → paid, with Square's payment and what it took", c1.state === "paid" && c1.payment_id === "pay_DB0000001" && c1.paid_cents === 8000, c1);
const s2 = (await settle(H1.id, "pay_DB0000001", 8000)).rows[0]?.s;
ok("settle: the same payment again is no change", s2?.again === true && (await claimOf(H1.id)).paid_cents === 8000, s2);
const paidH1 = (await hold(SAM, BR, 2, "rsv-db-key-000001")).rows[0]?.h;
ok("hold: a paid claim's key answers with the claim and what was paid", paidH1?.id === H1.id && paidH1.state === "paid" && paidH1.amount_cents === 8000, paidH1);
// A second claim, declined: released, its key given up for a new hold.
const H2 = (await hold(ALEX, BR, 1, "rsv-db-key-000020")).rows[0].h;
await release(H2.id, "card declined", 0);
const c2 = await claimOf(H2.id);
ok("release: a declined claim lets go — cancelled, why, and its bottle back on the shelf", c2.state === "cancelled" && c2.cancel_reason === "card declined" && (await stock(BR)).n === 4, c2);
const H2b = (await hold(ALEX, BR, 1, "rsv-db-key-000020")).rows[0]?.h;
ok("hold: the key of a claim that ended is given up — the same key holds again, a new claim",
  H2b && H2b.id !== H2.id && H2b.again === false && (await claimOf(H2.id)).idempotency_key.startsWith("rsv-db-key-000020~"), H2b);
const late = await settle(H2.id, "pay_LATE", 4000);
ok("settle: a released claim is not waiting on its payment (409)", /not waiting on its payment/.test(late.error ?? "") && late.code === "PT409", late);

// The crew hand one over; refunds come back from Square.
const collect = (uid, id) => as(uid, `select public.collect_reserve_claim($1) as c`, [id]);
const H3 = (await hold(ALEX, BR, 1, "rsv-db-key-000030")).rows[0].h;
const pend = await collect(CREW, H3.id);
await settle(H3.id, "pay_DB0000003", 4000);
const mem = await collect(ALEX, H3.id);
const crew = await collect(CREW, H3.id);
const c3 = await claimOf(H3.id);
ok("hand over: a pending claim is not owed a bottle yet (409); a member cannot hand one over (403); the crew can — by whom, when",
  pend.code === "PT409" && mem.code === "42501" && !crew.error && c3.state === "collected" && c3.collected_by === CREW && c3.collected_at !== null, [pend, mem, crew]);
const rel3 = await release(H3.id, "canceled by the crew", 4000);
ok("release: a claim handed over is not put back on the shelf (409)", rel3.code === "PT409" && (await claimOf(H3.id)).state === "collected", rel3);

// ── the crew read every claim; a member their own ─────────────────────────────────────────────────────────────────────
const seen = async (uid) => (await as(uid, `select count(*)::int n from public.reserve_claims where reserve_id = $1`, [BR])).rows[0]?.n;
const all = Number((await q1(`select count(*)::int n from public.reserve_claims where reserve_id = $1`, [BR])).n);
ok("read: the crew see every claim on a reserve; a member only their own", (await seen(CREW)) === all && (await seen(SAM)) === 1 && all >= 4, [await seen(CREW), await seen(SAM), all]);

// ── a reserve people paid for stays up ─────────────────────────────────────────────────────────────────────────────────
const down = await as(OWNER, `update public.reserves set status = 'archived' where id = $1`, [BR]);
ok("taken down with paid claims on it: refused in the crew's words", /People have paid for this reserve/.test(down.error ?? "") && (await stock(BR)).status !== "archived", down);
const EMPTY = await reserve("Nobody yet");
ok("…and one nobody paid for comes down as before", !(await as(OWNER, `update public.reserves set status = 'archived' where id = $1`, [EMPTY])).error);

// ── refunds made in Square ─────────────────────────────────────────────────────────────────────────────────────────────
const refund = (id, pay, cents, status = "COMPLETED") => db.query(`insert into public.square_refunds (id, payment_id, amount_cents, status) values ($1, $2, $3, $4)
  on conflict (id) do update set amount_cents = excluded.amount_cents, status = excluded.status, updated_at = now()`, [id, pay, cents, status]);
await refund("rf_DB1", "pay_DB0000001", 3000);
const m1 = await q1(`select channel, channel_order_id from public.square_refunds where id = 'rf_DB1'`);
const p1 = await claimOf(H1.id);
ok("Square refund: matched to its claim (channel 'reserve'); a part of it kept on the claim, which stays paid",
  m1.channel === "reserve" && m1.channel_order_id === H1.id && p1.state === "paid" && p1.refunded_cents === 3000, [m1, p1]);
await refund("rf_DB1", "pay_DB0000001", 3000);
ok("Square refund: the same refund said again counts once", (await claimOf(H1.id)).refunded_cents === 3000);
const before = (await stock(BR)).n;
await refund("rf_DB2", "pay_DB0000001", 5000);
const p2 = await claimOf(H1.id);
ok("Square refund: all of it back — the claim let go ('refunded in Square'), its bottles back on the shelf",
  p2.state === "cancelled" && p2.cancel_reason === "refunded in Square" && p2.refunded_cents === 8000 && (await stock(BR)).n === before + 2, p2);
await refund("rf_DB3", "pay_DB0000003", 1500);
const p3 = await claimOf(H3.id);
ok("Square refund of a claim already handed over: kept on it — it stays handed over", p3.state === "collected" && p3.refunded_cents === 1500, p3);
await refund("rf_DB4", "pay_DB0000003", 9999);
ok("Square refund: never more kept than was paid", (await claimOf(H3.id)).refunded_cents === 4000);
await refund("rf_DB5", "pay_NOBODY", 100);
ok("Square refund of a payment no claim carries: not a reserve's", (await q1(`select channel from public.square_refunds where id = 'rf_DB5'`)).channel === null);

// ── the books ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// Square's own feed carries a reserve's payment too (event_sales): it is the reserve's money, not walk-up money.
const H4 = (await hold(SAM, BR, 1, "rsv-db-key-000040")).rows[0].h;
await settle(H4.id, "pay_DB0000004", 4000);
await db.query(`insert into public.event_sales (square_payment_id, amount_cents, item_count) values ('pay_DB0000004', 4000, 1), ('pay_WALKUP01', 700, 1)`);
const sales = (await as(OWNER, `select public.report_sales(30) as r`)).rows[0]?.r;
ok("books: reserves are their own channel — what they took, less what went back (paid and handed over); a hold paid at the truck is not counted twice",
  sales?.by_channel?.reserve === 4000 + (4000 - 4000) && sales.orders_by_channel?.reserve === 2, [sales?.by_channel, sales?.orders_by_channel]);
ok("books: a reserve's payment is not walk-up money", sales?.by_channel?.square_walkup === 700, sales?.by_channel);
ok("books: and the total says both once", sales?.revenue_cents === Object.values(sales?.by_channel ?? {}).reduce((a, b) => a + Number(b), 0), sales);

// An event's sales are Square's own feed for the day: a reserve's payment in it is the reserve's, not the event's.
const EV = (await q1(`insert into public.events (title, tenant_id) values ('Harvest Pour', $1) returning id`, [T1])).id;
await db.query(`update public.event_sales set event_id = $1 where square_payment_id in ('pay_DB0000004', 'pay_WALKUP01')`, [EV]);
const evs = (await as(OWNER, `select public.report_events() as r`)).rows[0]?.r ?? [];
ok("books: an event's takings leave a reserve's payment out", evs.find((e) => e.id === EV)?.actual_cents === 700, evs.find((e) => e.id === EV));

// What went back is never more than was paid — said again, the larger stands; and the table itself will not hold more.
const H5 = (await hold(ALEX, BR, 1, "rsv-db-key-000050")).rows[0].h;
await settle(H5.id, "pay_DB0000005", 4000);
await release(H5.id, "canceled by the member", 1000);
await release(H5.id, "canceled by the member", 2500);
await release(H5.id, "canceled by the member", 99999);
const c5 = await claimOf(H5.id);
const cap = await raises(`update public.reserve_claims set refunded_cents = 4001 where id = $1`, [H5.id]);
ok("refunds: said again, the larger stands, and never more than was paid — the table refuses more",
  c5.state === "cancelled" && c5.refunded_cents === 4000 && /reserve_claims_cents_check/.test(cap?.message ?? ""), [c5.refunded_cents, cap]);

// The file's own verify block, run: each query answers what its comment says.
const block = SQL400.slice(SQL400.indexOf("-- verify (numbers and booleans only):"));
const checks = [];
let cur = "";
for (const line of block.split("\n").slice(1)) {
  const m = line.match(/^--\s{3}(.*)$/);
  if (!m) continue;
  cur += " " + m[1].replace(/\s+--\s+(\S+)\s*$/, (_, want) => { checks.push({ sql: "", want }); return ""; });
  if (checks.length && checks.at(-1).sql === "") { checks.at(-1).sql = cur.trim(); cur = ""; }
}
const answers = [];
for (const c of checks) {
  const row = await q1(c.sql.replace(/;$/, ""));
  const got = String(Object.values(row)[0]);
  answers.push(got === c.want ? null : `${c.sql.slice(0, 60)}… → ${got}, not ${c.want}`);
}
ok(`verify: the file's ${checks.length} checks answer as written`, checks.length >= 8 && answers.every((a) => a === null), answers.filter(Boolean));

// ── erased: the books keep the claim without the member ────────────────────────────────────────────────────────────────
await db.query(`update public.reserve_claims set state = 'collected', collected_at = now() where id = $1`, [H4.id]);
await db.query(`update public.reserve_claims set state = 'cancelled' where user_id = $1 and state in ('held', 'pending', 'paid')`, [SAM]);
const erased = await raises(`delete from auth.users where id = $1`, [SAM]);
const kept = await q(`select state, user_id from public.reserve_claims where idempotency_key in ('rsv-db-key-000001', 'rsv-db-key-000040')`);
ok("erased: the account goes; its claims stay in the books, the member let go", erased === null && kept.length === 2 && kept.every((k) => k.user_id === null), [erased, kept]);

console.log(`0400 — A LIMITED RESERVE IS PAID TO HOLD: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
