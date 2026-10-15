// A SHOP ORDER'S PROMISE GRADES ITS ALERT — 0407, run in Postgres (Release 3 of the Today, Command, Audit & Catalog audit;
// the third of the crew's database rules. Ryan, 2026-10-15: 5 business days).
//
// The finding, as a sentence: a paid merch order waiting on us was critical from its 24th hour and stayed critical, so a
// printer delay rang during service for an order with days still in hand — nothing recorded what the business had
// promised. What is run here is the whole schema up to 0406, orders and an old critical written the old way, then 0407
// — twice — and the watchdog grading by the promise as the days pass.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SQL407 = readFileSync(join(ROOT, "supabase/migrations/0407_a_shop_orders_promise_grades_its_alert.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const T = "00000000-0000-0000-0000-000000000001";

const t0 = Date.now();
const db = await fullSchema({ before: "0407" });
console.log(`the schema to 0406 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];

const mkOrder = async (who, cents, createdSql) => {
  const c = (await q1(`insert into public.customers (name, tenant_id) values ($1, $2) returning id`, [who, T])).id;
  const o = (await q1(`insert into public.shop_orders (tenant_id, customer_id, status, total_cents, created_at, updated_at)
                       values ($1, $2, 'paid', $3, ${createdSql}, now()) returning id`, [T, c, cents])).id;
  await q(`insert into public.shop_order_items (order_id, title, qty, unit_cents) values ($1, 'GT3 6-Panel Cap', 1, $2)`, [o, cents]);
  return o;
};
const open = async (id) => q(`select severity, title, link from public.alerts where kind = 'shop_order_stalled' and subject_id = $1 and ack_at is null`, [id]);

// The old way: an order paid 30 hours ago, inside any promise, already raised critical by 0340's rule.
const young = await mkOrder("Ana B.", 3200, "now() - interval '30 hours'");
// An order paid twelve days ago, past any promise.
const stale = await mkOrder("Devon P.", 4800, "now() - interval '12 days'");
await q(`select public.shop_order_stall_watchdog(24)`);
ok("before 0407 both are critical — the old rule, by the hour", (await open(young))[0]?.severity === "critical" && (await open(stale))[0]?.severity === "critical");

// ── 0407 ──
await db.exec(SQL407);
ok("the promise: 5 business days — a Monday's order by the next Monday, a Friday's by the next Friday, a Saturday's by Friday too",
  JSON.stringify(await q1(`select public.shop_ship_by('2026-10-12T15:00:00Z')::text a, public.shop_ship_by('2026-10-16T15:00:00Z')::text b, public.shop_ship_by('2026-10-17T15:00:00Z')::text c`))
    === JSON.stringify({ a: "2026-10-19", b: "2026-10-23", c: "2026-10-23" }));
ok("paid at 11:30 pm Eastern on a Friday is Friday's order (UTC calls it Saturday): by the next Friday", (await q1(`select public.shop_ship_by('2026-10-16T23:30:00-04:00')::text d`)).d === "2026-10-23");
ok("the weekday before a Monday is the Friday", (await q1(`select public.prior_business_day('2026-10-19')::text d`)).d === "2026-10-16");
ok("every order already here has its promise, from the day it was placed", Number((await q1(`select count(*) n from public.shop_orders where ship_by is null`)).n) === 0
  && (await q1(`select ship_by::text d, public.shop_ship_by(created_at)::text e from public.shop_orders where id = $1`, [young])).d === (await q1(`select public.shop_ship_by(created_at)::text e from public.shop_orders where id = $1`, [young])).e);
const fresh = await mkOrder("Sam K.", 2800, "now()");
ok("a new order is written with its promise", (await q1(`select ship_by::text d from public.shop_orders where id = $1`, [fresh])).d === (await q1(`select public.shop_ship_by(now())::text d`)).d);
const view = await q(`select id, ship_risk from public.v_shop_orders where id = any($1::uuid[])`, [[young, stale, fresh]]);
const risk = (id) => view.find((v) => v.id === id)?.ship_risk;
ok("the view says which are at risk: the twelve-day order is, the young and the fresh are not", risk(stale) === true && risk(young) === false && risk(fresh) === false, view);

const y = await open(young), s = await open(stale);
ok("the open critical the old rule raised inside its promise is important now — it stops ringing the owners", y.length === 1 && y[0].severity === "important", y);
ok("…and the one past its promise stays critical", s.length === 1 && s[0].severity === "critical", s);
ok("the titles say the promise — 'ships by' inside it, 'promised' once it has passed — and the link is the Catalog's queue",
  /— still waiting on us · ships by \w{3}, \w{3} \d{1,2}$/.test(y[0].title) && /— still waiting on us · promised \w{3}, \w{3} \d{1,2}$/.test(s[0].title)
    && y[0].link === "/crew?s=catalog&a=shoporders" && s[0].link === "/crew?s=catalog&a=shoporders", [y[0].title, s[0].title]);

// ── the turn is news: inside → at risk ──
await q(`update public.shop_orders set ship_by = public.business_day() where id = $1`, [young]);
await q(`select public.shop_order_stall_watchdog(24)`);
const turned = await open(young);
const closed = Number((await q1(`select count(*) n from public.alerts where kind = 'shop_order_stalled' and subject_id = $1 and ack_at is not null and severity = 'important'`, [young])).n);
ok("when its promise comes due, the important alert closes and one critical opens — it rings once", turned.length === 1 && turned[0].severity === "critical" && closed === 1, { turned, closed });
await q(`select public.shop_order_stall_watchdog(24)`);
ok("run again, it is the same one critical — not another", (await open(young)).length === 1 && Number((await q1(`select count(*) n from public.alerts where kind = 'shop_order_stalled' and subject_id = $1`, [young])).n) === 2);
await q(`update public.shop_orders set ship_by = public.business_day() + 30 where id = $1`, [young]);
await q(`select public.shop_order_stall_watchdog(24)`);
ok("an open critical is never turned down under someone reading it", (await open(young))[0]?.severity === "critical");
await q(`update public.shop_orders set status = 'in_production' where id = $1`, [stale]);
await q(`select public.shop_order_stall_watchdog(24)`);
ok("an order that stops waiting on us closes its own alert, as before", (await open(stale)).length === 0);

// ── a second run changes nothing ──
const before = JSON.stringify(await q(`select id, ship_by from public.shop_orders order by id`)) + JSON.stringify(await q(`select severity, ack_at is null o from public.alerts where kind = 'shop_order_stalled' order by created_at`));
await db.exec(SQL407);
const after = JSON.stringify(await q(`select id, ship_by from public.shop_orders order by id`)) + JSON.stringify(await q(`select severity, ack_at is null o from public.alerts where kind = 'shop_order_stalled' order by created_at`));
ok("a second run changes nothing", after === before && Number((await q1(`select count(*) n from public.changelog where title = 'A merch order rings when its promise is at risk, not before'`)).n) === 1);
ok("the watchdog is still nobody's to call but the database's", (await q1(`select has_function_privilege('authenticated', 'public.shop_order_stall_watchdog(int)', 'execute') a, has_function_privilege('anon', 'public.shop_order_stall_watchdog(int)', 'execute') b`)).a === false);

console.log(`SHOP PROMISE (0407): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
