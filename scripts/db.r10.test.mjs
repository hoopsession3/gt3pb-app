// R10 — THE 10/10 AUDIT OF THE BACK END, RUN IN POSTGRES (2026-10-16; Ryan: "then audit for 10/10 best practices... front
// and back end").
//
//   0419  a limit counts what it lets in, and a day's count lasts the day; what the push function sent is kept (push_sent);
//         a new phone nobody is signed in on is counted; the truck going live is stamped by the database; a scheduled job
//         that fails is said
//   0420  money on a pack, a delivery, an office order or an invoice changes through its own doors; an office order is
//         settled through one; covered is never the caller's own; a delivery's Undo keeps its stamps; Money and the digest
//         count Eastern days; an RSVP is a member's own
//
// What is run here is the whole schema up to 0418, the findings reproduced on it, then 0419 and 0420 — each twice — as
// the roles that call them. Every person, order and payment is made up.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M419 = readFileSync(join(ROOT, "supabase/migrations/0419_a_push_is_sent_once_for_what_happened_and_a_limit_counts_what_it_lets_in.sql"), "utf8");
const M420 = readFileSync(join(ROOT, "supabase/migrations/0420_money_moves_through_its_own_doors_and_is_counted_on_the_business_day.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const T2 = "0c420000-0000-4000-8000-0000000000f2";     // another business
const SAM = "0c420000-0000-4000-8000-0000000000a1";    // a member
const NIA = "0c420000-0000-4000-8000-0000000000a2";    // a member
const KAY = "0c420000-0000-4000-8000-0000000000b1";    // crew (server)
const LEE = "0c420000-0000-4000-8000-0000000000b2";    // crew (server)
const ALEX = "0c420000-0000-4000-8000-0000000000c1";   // an owner

const t0 = Date.now();
const db = await fullSchema({ before: "0419" });
console.log(`the schema to 0418 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', '', false);`);
// As PostgREST calls it: the role, and the request's claims.
const as = async (who, sql, params) => {
  const role = who === "service" ? "service_role" : who ? "authenticated" : "anon";
  await db.exec(`select set_config('request.jwt.claim.sub', '${who && who !== "service" ? who : ""}', false);
    select set_config('request.jwt.claim.role', '${role}', false); set role ${role};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e), code: e.code ?? null }; }
  finally { await root(); }
};
await db.exec(`grant usage on schema public to anon, authenticated, service_role;
  do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
  grant all on all tables in schema public to service_role; grant execute on all functions in schema public to service_role;
  alter role service_role bypassrls;`);
// A second business, made deliberately (0305's guard says how): its orders are not ours to settle.
await db.exec(`begin; set local gt3.allow_second_tenant = 'on';
  insert into public.tenants (id, slug, name) values ('${T2}', 'another-business', 'Another business'),
    ('0c420000-0000-4000-8000-0000000000f3', 'eastern-days', 'Eastern days'); commit;`);
for (const [id, role, name] of [[SAM, "member", "Sam Ito"], [NIA, "member", "Nia Park"], [KAY, "server", "Kay Lin"], [LEE, "server", "Lee Ford"], [ALEX, "owner", "Alex Rivera"]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${name.split(" ")[0].toLowerCase()}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3, display_name = $4 where id = $1`, [id, role, T1, name]);
}
const pts = async (uid) => (await q1(`select coalesce(points, 0)::int p from public.profiles where id = $1`, [uid])).p;
const pack = async (row = {}) => (await q1(`insert into public.drop_orders (user_id, name, size, glass, total_cents, paid, payment_id, drop_date, tenant_id)
  values ($1, $2, $3, 'return', $4, $5, $6, current_date + 3, $7) returning id`,
  [row.user ?? SAM, row.name ?? "Sam Ito", row.size ?? 6, row.total ?? 3600, row.paid ?? false, row.payment ?? null, T1])).id;
const cup = async (row = {}) => (await q1(`insert into public.orders (items, total_cents, tip_cents, status, customer, user_id, tenant_id, paid, payment_id, created_at)
  values ($1, $2, 0, $3, $4, $5, $6, $7, $8, coalesce($9::timestamptz, now())) returning id`,
  [row.items ?? ["flow"], row.total ?? 1000, row.status ?? "new", row.customer ?? "Ana Ruiz", row.user ?? null, row.tenant ?? T1, row.paid ?? false, row.payment ?? null, row.at ?? null])).id;
const delivery = async (row = {}) => (await q1(`insert into public.delivery_orders (user_id, name, phone, address_street, address_city, address_zip, pack_size, rise_count, flow_count, dusk_count,
    bottle_subtotal_cents, delivery_fee_cents, total_cents, delivery_date, payment_id, payment_status, tenant_id)
  values ($1, 'Sam Ito', '+18645550100', '1 Made-up Way', 'Greenville', '29601', $2, $2, 0, 0, 6000, 500, 6500, current_date + 2, $3, $4, $5) returning id`,
  [row.user ?? SAM, row.size ?? 12, row.payment ?? null, row.pay ?? "pending", T1])).id;
const acct = (await q1(`insert into public.business_accounts (user_id, company) values ($1, 'Acme Dental') returning id`, [SAM])).id;
const EV = (await q1(`insert into public.events (title, tenant_id) values ('Made-up market day', $1) returning id`, [T1])).id;
let crewMadeOwing = null;   // whether a crew page could add an office order still owed before 0420 — it still can after
const office = async (row = {}) => (await q1(`insert into public.business_orders (business_id, user_id, company, contact_name, contact_phone, address_street, address_city, address_zip,
    delivery_date, gallons, subtotal_cents, total_cents, billing_terms, payment_status, tenant_id)
  values ($1, $2, 'Acme Dental', 'Dee Ross', '8645550100', '1 Main St', 'Greenville', '29601', current_date + 4, 3, 13500, $3, $4, $5, $6) returning id`,
  [acct, SAM, row.total ?? 13500, row.terms ?? "net15", row.pay ?? "pending", row.tenant ?? T1])).id;
const limitNow = async (bucket, ms) => Number((await q1(`select coalesce((select count from public.rate_limit_hits where bucket = $1
  and window_start = to_timestamp(floor(extract(epoch from now()) * 1000 / $2) * $2 / 1000.0)), 0) n`, [bucket, ms])).n);
const hit = async (bucket, ms, max) => (await as("service", `select public.rate_limit_hit($1, $2, $3) r`, [bucket, ms, max])).rows[0]?.r;

// ── before 0419 and 0420: the findings, reproduced ──────────────────────────────────────────────────────────────────
{
  const tries = [];
  for (let i = 0; i < 10; i++) tries.push(await hit("before:1.2.3.4", 60_000, 6));
  ok("before 0419: one caller's sixty refused tries were counted — ten tries at a limit of six left a count of ten",
    tries.filter(Boolean).length === 6 && (await limitNow("before:1.2.3.4", 60_000)) === 10, await limitNow("before:1.2.3.4", 60_000));
  const p = await pack({ total: 3600 });
  const forged = await as(KAY, `update public.drop_orders set paid = true, total_cents = 1 where id = $1 returning paid, total_cents`, [p]);
  ok("before 0420: any crew role set a pack paid, at a price of its choosing, straight through the API",
    !forged.error && forged.rows[0]?.paid === true && forged.rows[0]?.total_cents === 1, forged);
  const o = await office({ pay: "pending" });
  const marked = await as(KAY, `update public.business_orders set payment_status = 'paid' where id = $1 returning payment_status`, [o]);
  ok("before 0420: …and marked an office order paid, which the office board did for anyone on the crew",
    !marked.error && marked.rows[0]?.payment_status === "paid", marked);
  const own = await cup({ user: KAY, customer: "Kay Lin" });
  const covered = await as(KAY, `select public.staff_collect_payment('cup', $1, 'covered') r`, [own]);
  ok("before 0420: a crew member settled their own order as covered — free, and counted nowhere", covered.rows[0]?.r === "collected", covered);
  const rs = await as(null, `insert into public.rsvps (event_id, status) values ($1, 'going')`, [EV]);
  ok("before 0420: a signed-out page wrote an RSVP with nobody on it — the public count, pushed up at will", !rs.error, rs);
  const owing = await as(KAY, `insert into public.business_orders (business_id, user_id, company, contact_name, contact_phone, address_street, address_city, address_zip, delivery_date, gallons, subtotal_cents, total_cents, billing_terms, payment_status, tenant_id)
    values ($1, $2, 'Acme Dental', 'Dee Ross', '8645550100', '1 Main St', 'Greenville', '29601', current_date + 4, 3, 13500, 13500, 'net15', $3, $4) returning id`, [acct, SAM, "pending", T1]);
  crewMadeOwing = !owing.error;
  await q(`delete from public.rate_limit_hits`);
}

for (const sql of [M419, M420]) await db.exec(sql);
for (const sql of [M419, M420]) await db.exec(sql);   // a second run changes nothing
// 0419 and 0420 load on the schema to 0418, and load again — a throw above fails this file; a milestone, not counted as a check (R14, F25).

// ── 0419 · a limit counts what it lets in ─────────────────────────────────────────────────────────────────────────
{
  const tries = [];
  for (let i = 0; i < 10; i++) tries.push(await hit("door:1.2.3.4", 60_000, 6));
  ok("a limit: six of ten tries fit, and the four refused are not counted — the count is six, not ten",
    JSON.stringify(tries) === JSON.stringify([true, true, true, true, true, true, false, false, false, false]) && (await limitNow("door:1.2.3.4", 60_000)) === 6,
    { tries, n: await limitNow("door:1.2.3.4", 60_000) });
  // The shared ceiling, asked last (lib/rateLimit): one address past its own limit never spends it.
  for (let i = 0; i < 30; i++) { if (await hit("door2:1.2.3.4", 60_000, 6)) await hit("door2:all", 60_000, 60); }
  ok("…so one address trying thirty times spends six of everyone's sixty", (await limitNow("door2:all", 60_000)) === 6, await limitNow("door2:all", 60_000));
  ok("a limit of nothing lets nothing in, and counts nothing",
    (await hit("zero", 60_000, 0)) === false && (await hit("zero", 60_000, -1)) === false && (await limitNow("zero", 60_000)) === 0);
  // A day's window starts at midnight (UTC, the window's own clock): the sweep used to take any window started more
  // than an hour ago — the day's own count, every twentieth call or so, from one in the morning.
  const DAY = 86_400_000;
  await q(`insert into public.rate_limit_hits (bucket, window_start, count) values ('sms:+18645550100', to_timestamp(floor(extract(epoch from now()) * 1000 / ${DAY}) * ${DAY} / 1000.0), 2)`);
  await q(`insert into public.rate_limit_hits (bucket, window_start, count) values ('sms:+18645550100', to_timestamp(floor(extract(epoch from now()) * 1000 / ${DAY}) * ${DAY} / 1000.0) - interval '1 day', 9)`);
  for (let i = 0; i < 120; i++) await hit("sms:+18645550100", DAY, 1000);
  ok("a day's count lasts the day: 120 more tries (each with its chance of a sweep) leave today's count at 122",
    (await limitNow("sms:+18645550100", DAY)) === 122, await limitNow("sms:+18645550100", DAY));
  const src = (await q1(`select prosrc from pg_proc where proname = 'rate_limit_hit'`)).prosrc;
  ok("…the sweep takes only the bucket's ended windows — never the one being counted", /window_start < w/.test(src) && !/interval '1 hour'/.test(src));
  await q(`insert into public.rate_limit_hits (bucket, window_start, count) values ('old:x', now() - interval '3 days', 5), ('young:x', now() - interval '1 day', 5)`);
  const swept = await as("service", `select public.sweep_rate_limits() n`);
  ok("the nightly sweep takes every window older than two days, and none younger",
    Number(swept.rows[0]?.n) >= 1 && Number((await q1(`select count(*) n from public.rate_limit_hits where bucket = 'old:x'`)).n) === 0
      && Number((await q1(`select count(*) n from public.rate_limit_hits where bucket = 'young:x'`)).n) === 1, swept);
  const anonHit = await as(null, `select public.rate_limit_hit('x', 1000, 1)`), memberSweep = await as(SAM, `select public.sweep_rate_limits()`);
  ok("the limiter and its sweep are the server's alone", /permission denied/.test(anonHit.error ?? "") && /permission denied/.test(memberSweep.error ?? ""), { anonHit, memberSweep });
  ok("the sweeps and the watch are scheduled",
    Number((await q1(`select count(*) n from cron.job where jobname in ('push-sent-sweep', 'rate-limit-sweep', 'cron-watch')`)).n) === 3
    && /interval '90 days'/.test((await q1(`select command from cron.job where jobname = 'push-sent-sweep'`)).command));
}

// ── 0419 · what the push function sent ───────────────────────────────────────────────────────────────────────────
{
  const first = await as("service", `insert into public.push_sent (event_key) values ('orders:new:0c420000-0000-4000-8000-000000000001') returning event_key`);
  const again = await as("service", `insert into public.push_sent (event_key) values ('orders:new:0c420000-0000-4000-8000-000000000001')`);
  ok("an event kept once; the same event again is refused as a duplicate (23505 — the function's 'sent already')",
    !first.error && first.rows.length === 1 && again.code === "23505", { first, again });
  const peek = await as(null, `select count(*) from public.push_sent`), fake = await as(SAM, `insert into public.push_sent (event_key) values ('alert:x-made-up')`);
  ok("nobody but the server reads or writes it", /permission denied/.test(peek.error ?? "") && /permission denied/.test(fake.error ?? ""), { peek, fake });
  const short = await as("service", `insert into public.push_sent (event_key) values ('x')`);
  ok("a key is three to two hundred characters", /push_sent_event_key_check|check constraint/.test(short.error ?? ""), short);
}

// ── 0419 · a new phone nobody is signed in on is counted ──────────────────────────────────────────────────────────
{
  const HOUR = 3_600_000;
  const tok = (n) => n.toString(16).padStart(64, "a");
  const known = await as(null, `select public.keep_app_push_token($1)`, [tok(1)]);
  await q(`insert into public.rate_limit_hits (bucket, window_start, count) values ('push:new-guest', to_timestamp(floor(extract(epoch from now()) * 1000 / ${HOUR}) * ${HOUR} / 1000.0), 300)
    on conflict (bucket, window_start) do update set count = 300`);
  const fresh = await as(null, `select public.keep_app_push_token($1)`, [tok(2)]);
  const again = await as(null, `select public.keep_app_push_token($1)`, [tok(1)]);
  const member = await as(SAM, `select public.keep_app_push_token($1)`, [tok(3)]);
  ok("a new signed-out phone past the hour's three hundred is refused; a phone already kept, and a member's, are not",
    !known.error && /Too many devices just now/.test(fresh.error ?? "") && !again.error && !member.error, { known, fresh, again, member });
  ok("…and the phone refused was not kept", Number((await q1(`select count(*) n from public.push_subscriptions where endpoint = $1`, [`apns:${tok(2)}`])).n) === 0);
  const idx = (await q(`select indexname from pg_indexes where tablename = 'push_subscriptions' and indexname in ('push_subscriptions_member_idx', 'push_subscriptions_crew_idx', 'push_subscriptions_live_idx')`)).length;
  ok("the sends' three indexes are there", idx === 3, idx);
}

// ── 0419 · the truck going live, stamped by the database ─────────────────────────────────────────────────────────
{
  await q(`insert into public.live_status (id, is_live) values (1, false) on conflict (id) do update set is_live = false`);
  ok("offline: no stamp", (await q1(`select live_since from public.live_status where id = 1`)).live_since === null);
  const on = await as(ALEX, `update public.live_status set is_live = true where id = 1 returning live_since`);
  const at = on.rows[0]?.live_since;
  ok("going live stamps the moment", !on.error && at instanceof Date && Math.abs(Date.now() - at.getTime()) < 120_000, on);
  await q(`select pg_sleep(0.05)`);
  const moved = await as(ALEX, `update public.live_status set next_eta = 'soon', is_live = true where id = 1 returning live_since`);
  ok("a write while live keeps the stamp it has", moved.rows[0]?.live_since?.getTime() === at?.getTime(), moved);
  const forged = await as(ALEX, `update public.live_status set live_since = now() + interval '1 hour' where id = 1 returning live_since`);
  ok("a page's own value for it is never kept", forged.rows[0]?.live_since?.getTime() === at?.getTime(), forged);
  const off = await as(ALEX, `update public.live_status set is_live = false where id = 1 returning live_since`);
  ok("going offline clears it", off.rows[0]?.live_since === null, off);
}

// ── 0419 · a scheduled job that fails is said ─────────────────────────────────────────────────────────────────────
{
  // The re-ring of a critical (0162's job, scheduled when the schema loaded), failing; and a job that failed an hour ago.
  const job = (await q1(`select jobid from cron.job where jobname = 'escalate-criticals' order by jobid limit 1`)).jobid;
  const quiet = (await q1(`insert into cron.job (jobname, schedule, command) values ('quiet-job', '* * * * *', 'select 1') returning jobid`)).jobid;
  await q(`insert into cron.job_run_details (jobid, status, return_message, start_time, end_time) values
    ($1, 'failed', 'ERROR: permission denied for table alerts', now() - interval '9 minutes', now() - interval '9 minutes'),
    ($1, 'failed', 'ERROR: relation "x" does not exist', now() - interval '2 minutes', now() - interval '2 minutes'),
    ($1, 'succeeded', '1 row', now() - interval '1 minute', now() - interval '1 minute'),
    ($2, 'failed', 'ERROR: an hour ago', now() - interval '60 minutes', now() - interval '60 minutes'),
    ($2, 'succeeded', 'old', now() - interval '9 days', now() - interval '9 days')`, [job, quiet]);
  const n = (await q1(`select public.cron_watch() n`)).n;
  const a = await q(`select severity, category, kind, title, body, link, subject_id::text s from public.alerts where kind = 'cron_failed'`);
  ok("a job failing in the last twenty minutes raises one alert, by its name, with how many runs failed and the last words",
    Number(n) === 1 && a.length === 1 && a[0].severity === "important" && a[0].category === "system"
      && a[0].title === "A scheduled job is failing — escalate-criticals" && /^2 failed runs in the last 20 minutes\. The last said: ERROR: relation "x" does not exist$/.test(a[0].body)
      && a[0].link === "/crew?s=settings&a=set-errors", { n, a });
  await q(`select public.cron_watch()`);
  ok("…failing again is the same one alert (one open per job), and a job that failed an hour ago is not said",
    Number((await q1(`select count(*) n from public.alerts where kind = 'cron_failed'`)).n) === 1
      && (await q1(`select subject_id::text s from public.alerts where kind = 'cron_failed'`)).s === (await q1(`select md5('cron:escalate-criticals')::uuid::text s`)).s);
  ok("the run log keeps a week", Number((await q1(`select count(*) n from cron.job_run_details where end_time < now() - interval '7 days'`)).n) === 0
    && Number((await q1(`select count(*) n from cron.job_run_details`)).n) === 4);
  const peek = await as(KAY, `select public.cron_watch()`);
  ok("the watch is the database's own to run", /permission denied/.test(peek.error ?? ""), peek);
}

// ── 0420 · money on an order changes through its own doors ───────────────────────────────────────────────────────
{
  const p = await pack({ total: 3600 });
  const paid = await as(KAY, `update public.drop_orders set paid = true where id = $1`, [p]);
  const price = await as(KAY, `update public.drop_orders set total_cents = 1 where id = $1`, [p]);
  const work = await as(KAY, `update public.drop_orders set picked_up = true, bottles_returned = true where id = $1 returning picked_up`, [p]);
  ok("a pack: crew can't set it paid or change its price — the work on it (picked up, bottles back) writes as ever",
    /Money on an order changes through its own door — paid is not a page's to write/.test(paid.error ?? "") && /total_cents/.test(price.error ?? "")
      && !work.error && work.rows[0]?.picked_up === true, { paid, price, work });
  const v = await delivery();
  const vMoney = await as(KAY, `update public.delivery_orders set total_cents = 100 where id = $1`, [v]);
  const vPay = await as(KAY, `update public.delivery_orders set payment_status = 'paid' where id = $1`, [v]);
  const vRun = await as(KAY, `update public.delivery_orders set status = 'out_for_delivery', driver_note = 'gate code 12' where id = $1 returning status`, [v]);
  ok("a delivery: its money is not the crew's to write; the run (status, notes) is",
    /total_cents/.test(vMoney.error ?? "") && /payment_status/.test(vPay.error ?? "") && !vRun.error && vRun.rows[0]?.status === "out_for_delivery", { vMoney, vPay, vRun });
  const o = await office();
  const oPay = await as(KAY, `update public.business_orders set payment_status = 'paid' where id = $1`, [o]);
  const oLink = await as(KAY, `update public.business_orders set paylink_url = 'https://evil.example/pay' where id = $1`, [o]);
  const oRun = await as(KAY, `update public.business_orders set status = 'delivered', jugs_out = 3, jugs_in = 2 where id = $1 returning status`, [o]);
  ok("an office order: paid, invoiced and its payment link are not the crew's; logging the delivery is",
    /payment_status/.test(oPay.error ?? "") && /paylink_url/.test(oLink.error ?? "") && !oRun.error && oRun.rows[0]?.status === "delivered", { oPay, oLink, oRun });
  const inv = await as(KAY, `insert into public.invoices (business_id, business_order_id, amount_cents, terms, status) values ($1, $2, 1, 'net15', 'open')`, [acct, o]);
  ok("an invoice is not a page's to make", /Money on an order is recorded through its own door/.test(inv.error ?? ""), inv);
  const settled = await as(KAY, `insert into public.business_orders (business_id, user_id, company, contact_name, contact_phone, address_street, address_city, address_zip, delivery_date, gallons, subtotal_cents, total_cents, billing_terms, payment_status, tenant_id)
    values ($1, $2, 'Acme Dental', 'Dee Ross', '8645550100', '1 Main St', 'Greenville', '29601', current_date + 4, 3, 13500, 13500, 'net15', $3, $4) returning id`, [acct, SAM, "paid", T1]);
  const owing = await as(KAY, `insert into public.business_orders (business_id, user_id, company, contact_name, contact_phone, address_street, address_city, address_zip, delivery_date, gallons, subtotal_cents, total_cents, billing_terms, payment_status, tenant_id)
    values ($1, $2, 'Acme Dental', 'Dee Ross', '8645550100', '1 Main St', 'Greenville', '29601', current_date + 4, 3, 13500, 13500, 'net15', $3, $4) returning id`, [acct, SAM, "pending", T1]);
  ok("a page may not create one already settled; one still owed it may, as it could before",
    /Money on an order is recorded through its own door/.test(settled.error ?? "") && crewMadeOwing === true && !owing.error, { settled, owing, crewMadeOwing });
  const owner = await as(ALEX, `update public.business_orders set payment_status = 'paid' where id = $1 returning payment_status`, [o]);
  const server = await as("service", `update public.drop_orders set paid = true, payment_id = 'sq-420-srv' where id = $1 returning paid`, [p]);
  const collect = await as(LEE, `select public.staff_collect_payment('pickup', $1, 'cash') r`, [await pack({ total: 3600 })]);
  ok("an owner may still correct it; the server and the database's own functions (cash at the window) write as before",
    !owner.error && owner.rows[0]?.payment_status === "paid" && !server.error && server.rows[0]?.paid === true && collect.rows[0]?.r === "collected", { owner, server, collect });
}

// ── 0420 · an office order settled, one door ─────────────────────────────────────────────────────────────────────
{
  const net30 = await office({ terms: "net30", total: 27000 }), prepaid = await office({ terms: "prepaid" }), gone = await office();
  await q(`update public.business_orders set canceled_at = now() where id = $1`, [gone]);
  const crew = await as(KAY, `select public.settle_office_order($1, 'paid') r`, [prepaid]);
  ok("crew can't settle an office order — an owner's or an admin's", /Owners and admins settle office orders/.test(crew.error ?? ""), crew);
  const a = await as(ALEX, `select public.settle_office_order($1, 'invoiced') r`, [net30]);
  const inv = await q(`select amount_cents, terms, status, business_id::text b from public.invoices where business_order_id = $1`, [net30]);
  ok("invoiced: the order and its invoice in one write — the order's total, its own terms, open",
    a.rows[0]?.r?.ok === true && a.rows[0]?.r?.payment_status === "invoiced" && inv.length === 1 && inv[0].amount_cents === 27000 && inv[0].terms === "net30"
      && inv[0].status === "open" && inv[0].b === acct && (await q1(`select payment_status from public.business_orders where id = $1`, [net30])).payment_status === "invoiced", { a, inv });
  const twice = await as(ALEX, `select public.settle_office_order($1, 'invoiced') r`, [net30]);
  ok("a second tap hears 'already' — no second invoice", twice.rows[0]?.r?.already === "invoiced"
    && Number((await q1(`select count(*) n from public.invoices where business_order_id = $1`, [net30])).n) === 1, twice);
  const p = await as(ALEX, `select public.settle_office_order($1, 'paid') r`, [prepaid]);
  ok("paid: the order is paid, and no invoice is made", p.rows[0]?.r?.payment_status === "paid"
    && Number((await q1(`select count(*) n from public.invoices where business_order_id = $1`, [prepaid])).n) === 0, p);
  const c = await as(ALEX, `select public.settle_office_order($1, 'paid') r`, [gone]);
  const how = await as(ALEX, `select public.settle_office_order($1, 'free') r`, [await office()]);
  const elsewhere = await office({ tenant: T2 });
  const other = await as(ALEX, `select public.settle_office_order($1, 'paid') r`, [elsewhere]);
  ok("a canceled order, a word that is not paid or invoiced, and another business's order are each refused in words",
    /canceled — nothing to settle/.test(c.error ?? "") && /paid or invoiced/.test(how.error ?? "") && /isn't on the books/.test(other.error ?? ""), { c, how, other });
  const anon = await as(null, `select public.settle_office_order($1, 'paid')`, [prepaid]);
  ok("a signed-out page can't call it at all", /permission denied/.test(anon.error ?? ""), anon);
}

// ── 0420 · covered is never your own ─────────────────────────────────────────────────────────────────────────────
{
  const mine = await cup({ user: KAY, customer: "Kay Lin" });
  const self = await as(KAY, `select public.staff_collect_payment('cup', $1, 'covered') r`, [mine]);
  const other = await as(LEE, `select public.staff_collect_payment('cup', $1, 'covered') r`, [mine]);
  ok("a cup: your own order is another crew member's to cover — and they can",
    /your own order: another crew member settles it as covered/.test(self.error ?? "") && other.rows[0]?.r === "collected", { self, other });
  const myPack = await pack({ user: KAY, name: "Kay Lin" });
  const selfP = await as(KAY, `select public.staff_collect_payment('pickup', $1, 'covered') r`, [myPack]);
  const cashP = await as(KAY, `select public.staff_collect_payment('pickup', $1, 'cash') r`, [myPack]);
  ok("a pack: the same — and your own paid in cash is still yours to take",
    /your own pack/.test(selfP.error ?? "") && cashP.rows[0]?.r === "collected", { selfP, cashP });
}

// ── 0420 · a delivery's Undo keeps its stamps ────────────────────────────────────────────────────────────────────
{
  const v = await delivery({ size: 12, payment: "sq-420-dv", pay: "paid" });
  const p0 = await pts(SAM);
  await q(`update public.delivery_orders set status = 'delivered' where id = $1`, [v]);
  const p1 = await pts(SAM);
  await q(`update public.delivery_orders set status = 'out_for_delivery' where id = $1`, [v]);   // ↩ Undo on the run
  const p2 = await pts(SAM);
  await q(`update public.delivery_orders set status = 'delivered' where id = $1`, [v]);
  const p3 = await pts(SAM);
  ok("delivered awards twelve; a step back keeps them; delivered again does not award twice", p1 === p0 + 12 && p2 === p1 && p3 === p1, { p0, p1, p2, p3 });
  await q(`update public.delivery_orders set canceled_at = now() where id = $1`, [v]);
  ok("…and a cancel gives them back", (await pts(SAM)) === p0, { now: await pts(SAM), p0 });
  const never = await delivery({ size: 6 });
  await q(`update public.delivery_orders set canceled_at = now() where id = $1`, [never]);
  ok("a delivery canceled before it was delivered takes nothing", (await pts(SAM)) === p0);
}

// ── 0420 · Money and the digest count Eastern days ───────────────────────────────────────────────────────────────
{
  // Each amount on its own made-up business, so nothing above is in it.
  const T3 = "0c420000-0000-4000-8000-0000000000f3", OWN = "0c420000-0000-4000-8000-0000000000c3";
  await q(`insert into auth.users (id, email) values ($1, 'own3@example.test')`, [OWN]);
  await q(`update public.profiles set role = 'owner', tenant_id = $2, display_name = 'Made-up owner' where id = $1`, [OWN, T3]);
  const et = async (dayOffset, hhmm) => (await q1(`select ((public.business_day() + $1::int)::timestamp + $2::time) at time zone 'America/New_York' t`, [dayOffset, hhmm])).t;
  const eveningYesterday = await et(-1, "21:30"), firstMorning = await et(-6, "00:30"), dayBefore = await et(-7, "23:30");
  await cup({ tenant: T3, paid: true, payment: "sq-420-e1", total: 1111, at: eveningYesterday.toISOString() });
  await cup({ tenant: T3, paid: true, payment: "sq-420-e2", total: 2222, at: firstMorning.toISOString() });
  await cup({ tenant: T3, paid: true, payment: "sq-420-e3", total: 4444, at: dayBefore.toISOString() });
  const r = (await as(OWN, `select public.report_sales(7) r`)).rows[0]?.r;
  const label = async (d) => (await q1(`select to_char(public.business_day() + $1::int, 'MM-DD') l`, [d])).l;
  const yLabel = await label(-1), firstLabel = await label(-6), todayLabel = await label(0);
  const cents = (l) => r?.by_day?.find((x) => x.day === l)?.cents;
  ok("a sale at 9:30 pm Eastern is that evening's — in yesterday's bar, not today's",
    cents(yLabel) === 1111 && cents(todayLabel) === 0, r?.by_day);
  ok("the week starts at Eastern midnight of its first day: 12:30 am that morning is in it, 11:30 pm the night before is not",
    cents(firstLabel) === 2222 && r?.revenue_cents === 3333 && r?.by_channel?.cup === 3333, r && { rev: r.revenue_cents, by: r.by_day });
  ok("seven bars, one an Eastern day each, oldest first", r?.by_day?.length === 7 && r.by_day[0].day === firstLabel && r.by_day[6].day === todayLabel, r?.by_day);
  await q(`update public.live_status set digest_cadence = 'daily' where id = 1`);
  await as("service", `select public.founder_digest_alert()`);
  const d = await q1(`select body from public.alerts where title = '📊 Daily founder digest' and tenant_id = $1 order by created_at desc limit 1`, [T3]);
  ok("the founder digest's week is the same seven Eastern days", /^Revenue 7d: \$33\.33/.test(d?.body ?? ""), d);
  const src = (await q1(`select prosrc from pg_proc where proname = 'report_sales'`)).prosrc;
  ok("the bars are one grouped read, not nine a day", /per_day as/.test(src) && !/for d in/i.test(src) && /generate_series\(first_day, today/.test(src));
}

// ── 0420 · an RSVP is a member's own ─────────────────────────────────────────────────────────────────────────────
{
  const ev = EV;
  const guest = await as(null, `insert into public.rsvps (event_id, status) values ($1, 'going')`, [ev]);
  const own = await as(SAM, `insert into public.rsvps (event_id, user_id, status) values ($1, $2, 'going') returning id`, [ev, SAM]);
  const forOther = await as(SAM, `insert into public.rsvps (event_id, user_id, status) values ($1, $2, 'going')`, [ev, NIA]);
  const nobody = await as(SAM, `insert into public.rsvps (event_id, status) values ($1, 'going')`, [ev]);
  const word = await as(NIA, `insert into public.rsvps (event_id, user_id, status) values ($1, $2, 'yes please')`, [ev, NIA]);
  ok("a signed-out page can't RSVP; a member can for themselves — not for someone else, not for nobody, and only going, maybe or cancelled",
    !!guest.error && !own.error && own.rows.length === 1 && !!forOther.error && !!nobody.error && /rsvps_status_words/.test(word.error ?? ""), { guest, own, forOther, nobody, word });
  ok("the signed-out door is gone", Number((await q1(`select count(*) n from pg_policies where tablename = 'rsvps' and policyname = 'anyone rsvp'`)).n) === 0);
}

console.log(`R10 · THE BACK END AT TEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
