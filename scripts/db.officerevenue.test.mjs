// OFFICE REVENUE IS COUNTED ON THE DAY IT IS DELIVERED — 0358, against the whole schema (every
// migration, in order: scripts/fixtures/schema.full.mjs), acting as each person the way PostgREST does.
//
// Phase 2, part 1 of the B2B challenge report (2026-10-07). Before 0358 every reader dated an office
// order by created_at — for a generated delivery, the night the schedule made it. With six weeks of
// deliveries made ahead, that would count a prepaid client's money weeks early and drop a pay-on-
// delivery client's out of every window. These checks hold each reader to the delivery day:
//   1. report_sales: the office total and each day's office money land on the delivery day — an order
//      made long ago and delivered this week counts this week; one paid now for a delivery in two
//      weeks counts nowhere yet; canceled and unpaid never count; the other channels read as before.
//   2. founder_digest_alert: its seven days, the same way.
//   3. all_orders: an office order appears once its day has come, dated that day (noon UTC, the same
//      calendar day in every US market); a client still sees only their own.
//   4. Six weeks ahead: the crew's button makes every changeable delivery in the next 42 days.
import { fullSchema } from "./fixtures/schema.full.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const u = (n) => `8e7e0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OWNER = u(1), CLIENT = u(2), OTHER = u(3);

async function as(db, uid, sql, params) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  try { return { rows: (await db.query(sql, params)).rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e), code: e.code ?? null }; }
  finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const val = async (db, sql, params) => (await db.query(sql, params)).rows[0];

const db = await fullSchema();
// Supabase's default privileges give the signed-in role SELECT on every table and view made in public
// (0312 took the views back from anon); the fixture doesn't model default privileges, so the grants
// production has are given here — all_orders is security_invoker, so the signed-in person also needs
// its four tables, and their policies still decide which rows come back.
await db.exec(`grant select on public.all_orders, public.orders, public.drop_orders, public.delivery_orders, public.business_orders to authenticated`);
const today = (await val(db, `select current_date::text d`)).d;
const mmdd = async (offset) => (await val(db, `select to_char(current_date + $1::int, 'MM-DD') d`, [offset])).d;
const ids = {};
{
  const q = (sql, p) => db.query(sql, p);
  for (const [id, email, role] of [[OWNER, "owner@example.test", "owner"], [CLIENT, "gwen@example.test", "member"], [OTHER, "ade@example.test", "member"]]) {
    await q(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
    await q(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, T1]);
  }
  // One office order per case, written as the table's owner: the delivery day and the night it was made.
  const order = async (key, { user = CLIENT, deliveredIn, madeAgo, pay = "paid", canceled = false, cents }) => {
    ids[key] = (await val(db, `insert into public.business_orders (user_id, company, contact_phone, address_street, address_city, address_zip,
               delivery_date, gallons, subtotal_cents, total_cents, payment_status, market, tenant_id, created_at, canceled_at)
             values ($1, 'Gwen Co', '864-555-0101', '1 Main St', 'Greenville', '29601', current_date + $2::int, 4, $3, $3, $4, 'greenville', '${T1}',
                     now() - make_interval(days => $5::int), ${canceled ? "now()" : "null"}) returning id`,
      [user, deliveredIn, cents, pay, madeAgo])).id;
  };
  await order("thisWeek",  { deliveredIn: -2,  madeAgo: 40, cents: 20000 });   // made 40 days ago (six weeks ahead), delivered this week
  await order("prepaid",   { deliveredIn: 14,  madeAgo: 0,  cents: 30000 });   // paid today for a delivery in two weeks
  await order("lastMonth", { deliveredIn: -10, madeAgo: 2,  cents: 40000 });   // made two days ago for a delivery ten days back (a late booking)
  await order("canceled",  { deliveredIn: -1,  madeAgo: 3,  cents: 50000, canceled: true });
  await order("unpaid",    { deliveredIn: -3,  madeAgo: 3,  cents: 60000, pay: "pending" });
  await order("theirs",    { user: OTHER, deliveredIn: -4, madeAgo: 9, cents: 70000 });
  // a cup from today, so the other channels are seen reading as before
  await q(`insert into public.orders (items, total_cents, paid, tenant_id) values ('{rise}', 900, true, '${T1}')`);
}

// ── 1 · report_sales ──
{
  const r7 = (await as(db, OWNER, `select public.report_sales(7) r`)).rows[0]?.r;
  ok("1 · the last 7 days count the orders delivered in them (made 40 days ago or not), not the one paid for two weeks out",
    r7?.by_channel?.office === 20000 + 70000, r7?.by_channel);
  const day = (r, key) => (r?.by_day ?? []).find((d) => d.day === key)?.cents;
  ok("1 · …and each day's office money lands on its delivery day", day(r7, await mmdd(-2)) >= 20000 && day(r7, await mmdd(-4)) >= 70000 && day(r7, await mmdd(0)) === 900, r7?.by_day);
  const r30 = (await as(db, OWNER, `select public.report_sales(30) r`)).rows[0]?.r;
  ok("1 · the last 30 days add the late booking delivered ten days back; canceled and unpaid never count",
    r30?.by_channel?.office === 20000 + 70000 + 40000, r30?.by_channel);
  ok("1 · the other channels read as before (today's cup)", r7?.by_channel?.cup === 900 && r7?.revenue_cents === 900 + 20000 + 70000, r7);
}

// ── 2 · the founder digest ──
{
  await db.query(`update public.live_status set digest_cadence = 'daily' where id = 1`);
  await db.query(`select public.founder_digest_alert()`);
  const a = await val(db, `select body from public.alerts where title = '📊 Daily founder digest' order by created_at desc limit 1`);
  ok("2 · the digest's seven days count office money on its delivery day", /Revenue 7d: \$909\.00/.test(a?.body ?? ""), a);
}

// ── 3 · all_orders ──
{
  const read = await as(db, OWNER, `select id, created_at from public.all_orders where channel = 'office'`);
  ok("3 · the crew reads all_orders", read.error === null, read.error);
  const rows = read.rows;
  const seen = new Set(rows.map((r) => r.id));
  ok("3 · an office order appears once its day has come — every past one, not the one two weeks out",
    ["thisWeek", "lastMonth", "canceled", "unpaid", "theirs"].every((k) => seen.has(ids[k])) && !seen.has(ids.prepaid), [...seen].length);
  const tw = rows.find((r) => r.id === ids.thisWeek);
  const want = (await val(db, `select ((current_date - 2) + time '12:00') at time zone 'UTC' t`)).t;
  ok("3 · …dated by its delivery day, noon UTC (the same calendar day in every US market), not the night it was made",
    tw && tw.created_at.toISOString() === want.toISOString(), { got: tw?.created_at, want });
  const mine = (await as(db, CLIENT, `select id from public.all_orders where channel = 'office'`)).rows.map((r) => r.id);
  ok("3 · a client still sees only their own office orders through it", mine.length === 4 && !mine.includes(ids.theirs) && !mine.includes(ids.prepaid), mine.length);
}

// ── 4 · six weeks ahead ──
{
  ok("4 · office_horizon() is 42", (await val(db, `select public.office_horizon() h`)).h === 42);
  const acct = (await val(db, `insert into public.business_accounts (user_id, company, address_street, address_city, address_zip, standing_active, standing_gallons, market, tenant_id)
             values ($1, 'Six Weeks Co', '5 Elm St', 'Greenville', '29601', true, 4, 'greenville', '${T1}') returning program_id`, [CLIENT])).program_id;
  const made = await as(db, OWNER, `select public.generate_office_deliveries() n`);
  const got = (await db.query(`select scheduled_for::text d from public.business_orders where program_id = $1 order by 1`, [acct])).rows.map((r) => r.d);
  const want = (await db.query(`select d::date::text d from generate_series(current_date + 1, current_date + 42, interval '1 day') d
                                 where extract(isodow from d) = 1 and public.office_cutoff(d::date, 'greenville') > now() order by 1`)).rows.map((r) => r.d);
  ok("4 · the crew's button makes every Monday in the next six weeks whose cutoff is ahead — not just next week's",
    made.error === null && want.length >= 5 && JSON.stringify(got) === JSON.stringify(want), { made: made.error, got, want, today });
}

await db.close();
console.log(`db.officerevenue: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
