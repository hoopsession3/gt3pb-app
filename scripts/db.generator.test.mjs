// THE WEEKLY RUN COMES FROM THE PROGRAM — 0356, against the whole schema (every migration, in order:
// scripts/fixtures/schema.full.mjs), pasted over the office data 0355 left, then exercised.
//
// Phase 1, part 2 of the B2B challenge report (2026-10-07). The report's Phase 1 tests, each here:
//   generation twice = no duplicates; both daylight-saving weekends; blackouts skip or move; a changed
//   delivery survives regeneration — plus everything the generator promises in between:
//   1. The paste: standing orders already made get their program date (the earliest of a pair; the
//      other is left and counted), and (program, date) becomes unique.
//   2. The clock: 6 PM on the last weekday before a delivery, market time, across both DST weekends,
//      in a non-Eastern market too.
//   3. The rule: weekly, every other week, two weekdays, the first and last of a month, a start and
//      an end — and a second run makes nothing.
//   4. A date belongs to a program that was on before its cutoff; the crew's explicit date is made anyway.
//   5. The place and the price: window from program, else location, else market; Settings' price or
//      the program's own.
//   6. Closed dates: GT3's skip, a market's move to the next weekday, a company's own.
//   7. An untouched delivery follows its program until its cutoff — a pause, a resume, new gallons, a
//      new door, a new rule (a Monday program moved to Thursdays delivers Thursdays, not both), the
//      program's window and price, Settings' price, the city's window — and a paid one, a linked one or
//      one past its cutoff never moves.
//   8. Who runs it: the crew's button (staff only, logged), the schedule (3 AM market time, once a day,
//      a failing market logged and alerted while the others run), a booking (the first changeable
//      delivery, once), a one-off's next date; and one tenant's button never makes another's.
//   9. Who reads: closed dates and the job log.
import { readFileSync } from "node:fs";
import { fullSchema } from "./fixtures/schema.full.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const T2 = "6e0e0000-0000-4000-8000-00000000d0e2";
const u = (n) => `6e0e0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OWNER = u(1), GV_CLIENT = u(2), ATL_CLIENT = u(3), STRANGER = u(4);
const GV_ACCT = u(101), ATL_ACCT = u(102);
const FILE = readFileSync(new URL("../supabase/migrations/0356_the_weekly_run_comes_from_the_program.sql", import.meta.url), "utf8");

async function as(db, uid, sql, params) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  try { return { rows: (await db.query(sql, params)).rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e), code: e.code ?? null }; }
  finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const val = async (db, sql, params) => (await db.query(sql, params)).rows[0];
const n = async (db, sql, params) => Number((await val(db, sql, params)).n);
const day = (d) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
const days = async (db, sql, params) => (await db.query(sql, params)).rows.map((r) => day(r.d));

// ── before 0356: what 0355 left, and two orders a re-booking made for one Monday ──
const db = await fullSchema({ before: "0356" });
{
  const q = (sql, p) => db.query(sql, p);
  for (const [id, email, role] of [[OWNER, "owner@example.test", "owner"], [GV_CLIENT, "gwen@example.test", "member"], [ATL_CLIENT, "ade@example.test", "member"], [STRANGER, "s@example.test", "member"]]) {
    await q(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
    await q(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, T1]);
  }
  await q(`update public.markets set office_window = 'mon_0600_0900' where slug = 'atlanta'`);
  await q(`insert into public.markets (slug, name, timezone, office_window) values ('denver', 'Denver', 'America/Denver', 'tue_0700_1000')`);
  await q(`update public.live_status set office_price_cents = 5200 where id = 1`);
  await q(`insert into public.business_accounts (id, user_id, company, contact_name, contact_phone, address_street, address_city, address_zip,
             billing_terms, standing_active, standing_gallons, market, tenant_id, created_at)
           values ($1, $2, 'Gwen Co', 'Gwen', '864-555-0101', '1 Main St', 'Greenville', '29601', 'prepaid', true, 4, 'greenville', '${T1}', '2026-09-01'),
                  ($3, $4, 'Ade Co', 'Ade', '404-555-0102', '9 Peach St', 'Atlanta', '30303', 'net15', true, 5, 'atlanta', '${T1}', '2026-09-02')`,
    [GV_ACCT, GV_CLIENT, ATL_ACCT, ATL_CLIENT]);
  const legacy = (id, date, created) => q(`insert into public.business_orders (id, business_id, user_id, company, address_street, address_city, address_zip,
             delivery_date, gallons, subtotal_cents, total_cents, standing, market, tenant_id, created_at)
           values ($1, $2, $3, 'Gwen Co', '1 Main St', 'Greenville', '29601', $4, 4, 18000, 18000, true, 'greenville', '${T1}', $5)`,
    [id, GV_ACCT, GV_CLIENT, date, created]);
  await legacy(u(201), "2026-09-28", "2026-09-21T12:00:00Z");
  await legacy(u(202), "2026-09-28", "2026-09-24T12:00:00Z");   // a re-booking's second order for the same Monday
  await legacy(u(203), "2026-10-05", "2026-09-28T12:00:00Z");
}
let applied = null;
try { await db.exec(FILE); } catch (e) { applied = String(e.message || e); }
ok("0356 applies over the office data 0355 left", applied === null, applied);

// ── 1 · the paste ──
{
  const sf = async (id) => day((await val(db, `select scheduled_for from public.business_orders where id = $1`, [id])).scheduled_for ?? "null");
  ok("1 · a standing order already made gets its program date", await sf(u(203)) === "2026-10-05");
  ok("1 · of two orders for one Monday, the earlier takes the date and the second is left as it was", await sf(u(201)) === "2026-09-28" && await sf(u(202)) === "null");
  ok("1 · (program, date) is unique", await n(db, `select count(*) n from pg_indexes where indexname = 'business_orders_program_date'`) === 1);
  const since = await val(db, `select p.active_since, a.created_at from public.company_programs p join public.business_accounts a on a.program_id = p.id where a.id = $1`, [GV_ACCT]);
  ok("1 · a program that is on has been on since its account was made", since.active_since?.toISOString() === since.created_at?.toISOString(), since);
  let again = null;
  try { await db.exec(FILE); } catch (e) { again = String(e.message || e); }
  ok("1 · a second paste runs cleanly", again === null, again);
}

// ── 2 · the clock ──
{
  const c = async (date, market) => (await val(db, `select public.office_cutoff($1, $2) c`, [date, market])).c.toISOString();
  ok("2 · Monday's cutoff is the Friday before at 6 PM (Oct 12 → Fri Oct 9, EDT)", await c("2026-10-12", "greenville") === "2026-10-09T22:00:00.000Z");
  ok("2 · …the weekend the clocks fall back (Nov 2 → Fri Oct 30, still EDT)", await c("2026-11-02", "greenville") === "2026-10-30T22:00:00.000Z");
  ok("2 · …the week after (Nov 9 → Fri Nov 6, EST)", await c("2026-11-09", "greenville") === "2026-11-06T23:00:00.000Z");
  ok("2 · …the weekend the clocks spring forward (Mar 15 2027 → Fri Mar 12, still EST)", await c("2027-03-15", "greenville") === "2027-03-12T23:00:00.000Z");
  ok("2 · …the week after (Mar 22 → Fri Mar 19, EDT)", await c("2027-03-22", "greenville") === "2027-03-19T22:00:00.000Z");
  ok("2 · a Tuesday's cutoff is Monday 6 PM, in a market that is not Eastern (Denver, MST)", await c("2030-01-08", "denver") === "2030-01-08T01:00:00.000Z");
}

// Programs made directly (as the table's owner) to try each rule, on Gwen's company and door.
const gv = await val(db, `select company_id, location_id from public.business_accounts where id = $1`, [GV_ACCT]);
const atl = await val(db, `select company_id, location_id from public.business_accounts where id = $1`, [ATL_ACCT]);
async function program(rule = {}, where = gv, market = "greenville", tenant = T1) {
  const p = await val(db, `insert into public.company_programs (tenant_id, company_id, location_id, status, market, every_n_weeks, weekdays, anchor_date, monthly_nth, starts_on, ends_on, delivery_window, price_per_gallon_cents)
                           values ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
    [tenant, where.company_id, where.location_id, market, rule.n ?? 1, rule.weekdays ?? [1], rule.anchor ?? null, rule.nth ?? null, rule.starts ?? null, rule.ends ?? null, rule.window ?? null, rule.price ?? null]);
  await db.query(`update public.company_programs set active_since = $2 where id = $1`, [p.id, rule.since ?? "2020-01-01T00:00:00Z"]);
  await db.query(`insert into public.company_program_lines (tenant_id, program_id, quantity) values ($1, $2, $3)`, [tenant, p.id, rule.gallons ?? 4]);
  return p.id;
}
const gen = async (pid, from, through, tenant = T1) => n(db, `select public.office_generate($1, null, $3, $2, $4) n`, [tenant, pid, through, from]);
const madeFor = (pid) => days(db, `select scheduled_for d from public.business_orders where program_id = $1 order by scheduled_for`, [pid]);

// ── 3 · the rule ──
{
  const weekly = await program();
  ok("3 · weekly on Mondays: the four Mondays of January 2030", await gen(weekly, "2030-01-01", "2030-01-31") === 4
    && JSON.stringify(await madeFor(weekly)) === JSON.stringify(["2030-01-07", "2030-01-14", "2030-01-21", "2030-01-28"]), await madeFor(weekly));
  ok("3 · a second run makes nothing", await gen(weekly, "2030-01-01", "2030-01-31") === 0 && (await madeFor(weekly)).length === 4);
  const biweekly = await program({ n: 2, anchor: "2030-01-07" });
  await gen(biweekly, "2030-01-01", "2030-01-31");
  ok("3 · every other week from an anchor", JSON.stringify(await madeFor(biweekly)) === JSON.stringify(["2030-01-07", "2030-01-21"]), await madeFor(biweekly));
  const twice = await program({ weekdays: [1, 4] });
  await gen(twice, "2030-01-01", "2030-01-14");
  ok("3 · two weekdays (Monday and Thursday)", JSON.stringify(await madeFor(twice)) === JSON.stringify(["2030-01-03", "2030-01-07", "2030-01-10", "2030-01-14"]), await madeFor(twice));
  const first = await program({ nth: 1 }), last = await program({ nth: -1 });
  await gen(first, "2030-01-01", "2030-03-31"); await gen(last, "2030-01-01", "2030-03-31");
  ok("3 · the first Monday of each month", JSON.stringify(await madeFor(first)) === JSON.stringify(["2030-01-07", "2030-02-04", "2030-03-04"]), await madeFor(first));
  ok("3 · the last Monday of each month", JSON.stringify(await madeFor(last)) === JSON.stringify(["2030-01-28", "2030-02-25", "2030-03-25"]), await madeFor(last));
  const bounded = await program({ starts: "2030-01-15", ends: "2030-01-25" });
  await gen(bounded, "2030-01-01", "2030-01-31");
  ok("3 · a start and an end date", JSON.stringify(await madeFor(bounded)) === JSON.stringify(["2030-01-21"]), await madeFor(bounded));
}

// ── 4 · a date belongs to a program that was on before its cutoff ──
{
  const late = await program({ since: new Date().toISOString() });
  ok("4 · a program switched on after a date's cutoff does not get that date", await gen(late, "2020-01-01", "2020-01-31") === 0);
  ok("4 · …but a later date, whose cutoff is ahead, it does", await gen(late, "2030-04-01", "2030-04-07") === 1);
  await db.query(`update public.company_programs set status = 'paused' where id = $1`, [late]);
  const wrapper = await as(db, OWNER, `select public.generate_office_route('2020-01-06') n`);
  ok("4 · the crew's explicit date is made for the programs that are on, cutoff or not (and not for a paused one)", wrapper.error === null && wrapper.rows[0].n >= 1
    && await n(db, `select count(*) n from public.business_orders where program_id = $1 and scheduled_for = '2020-01-06'`, [late]) === 0, wrapper);
}

// ── 5 · the place and the price ──
{
  const o = async (pid, date) => val(db, `select delivery_window w, price_per_gallon_cents p, total_cents t, market from public.business_orders where program_id = $1 and scheduled_for = $2`, [pid, date]);
  const atlMarket = await program({}, atl, "atlanta");
  await gen(atlMarket, "2030-05-06", "2030-05-06");
  ok("5 · no window on the program or the door: the market's (Atlanta 6–9 AM)", (await o(atlMarket, "2030-05-06")).w === "mon_0600_0900", await o(atlMarket, "2030-05-06"));
  await db.query(`update public.company_locations set delivery_window = 'mon_0700_1000' where id = $1`, [atl.location_id]);
  await gen(atlMarket, "2030-05-13", "2030-05-13");
  ok("5 · a window on the door wins over the market's", (await o(atlMarket, "2030-05-13")).w === "mon_0700_1000");
  const own = await program({ window: "mon_0800_1100", price: 6000, gallons: 5 }, atl, "atlanta");
  await gen(own, "2030-05-06", "2030-05-06");
  ok("5 · a window on the program wins over both, and its own price over Settings'", JSON.stringify(await o(own, "2030-05-06")) === JSON.stringify({ w: "mon_0800_1100", p: 6000, t: 30000, market: "atlanta" }), await o(own, "2030-05-06"));
  ok("5 · without its own price, a program bills Settings' price", (await o(atlMarket, "2030-05-06")).p === 5200);
  await db.query(`update public.company_locations set delivery_window = null where id = $1`, [atl.location_id]);
}

// ── 6 · closed dates ──
{
  const gvP = await program(), atlP = await program({}, atl, "atlanta");
  await db.query(`insert into public.office_closed_dates (tenant_id, starts_on, ends_on, policy, note) values ('${T1}', '2030-02-11', '2030-02-11', 'skip', 'GT3 retreat')`);
  await db.query(`insert into public.office_closed_dates (tenant_id, market, starts_on, ends_on, policy, note) values ('${T1}', 'atlanta', '2030-02-18', '2030-02-18', 'next_business_day', 'Atlanta truck down')`);
  await db.query(`insert into public.office_closed_dates (tenant_id, company_id, starts_on, ends_on, policy, note) values ('${T1}', $1, '2030-02-25', '2030-02-25', 'skip', 'Office closed')`, [gv.company_id]);
  await gen(gvP, "2030-02-10", "2030-02-28"); await gen(atlP, "2030-02-10", "2030-02-28");
  ok("6 · GT3's closed date skips the delivery everywhere", (await madeFor(gvP)).indexOf("2030-02-11") === -1 && (await madeFor(atlP)).indexOf("2030-02-11") === -1);
  const moved = await val(db, `select delivery_date d, cutoff_at c from public.business_orders where program_id = $1 and scheduled_for = '2030-02-18'`, [atlP]);
  ok("6 · Atlanta's move-to-next-weekday: delivered Tuesday, filling Monday's date, with Tuesday's cutoff", day(moved?.d) === "2030-02-19" && moved.c.toISOString() === "2030-02-18T23:00:00.000Z", moved);
  ok("6 · …and Greenville, not closed, delivers that Monday", (await madeFor(gvP)).includes("2030-02-18"));
  ok("6 · a company's own closed date skips only its own delivery", !(await madeFor(gvP)).includes("2030-02-25") && (await madeFor(atlP)).includes("2030-02-25"));
}

// ── 7 · an untouched delivery follows its program until its cutoff ──
{
  const gvProg = (await val(db, `select program_id from public.business_accounts where id = $1`, [GV_ACCT])).program_id;
  await gen(gvProg, "2030-06-01", "2030-06-30");   // the Mondays of June 2030: 3, 10, 17, 24
  const ids = (await db.query(`select id, scheduled_for from public.business_orders where program_id = $1 and scheduled_for between '2030-06-01' and '2030-06-30' order by scheduled_for`, [gvProg])).rows.map((r) => r.id);
  await db.query(`update public.business_orders set payment_status = 'paid' where id = $1`, [ids[0]]);
  await db.query(`update public.business_orders set paylink_url = 'https://example.test/pay' where id = $1`, [ids[1]]);
  await as(db, OWNER, `select public.generate_office_route('2020-01-13') n`);   // a date long past its cutoff
  const past = (await val(db, `select id from public.business_orders where program_id = $1 and scheduled_for = '2020-01-13'`, [gvProg])).id;
  const state = async () => (await db.query(`select id, canceled_reason r, gallons::float g, total_cents t, address_street s from public.business_orders where id = any($1) order by scheduled_for`, [[...ids, past]])).rows;

  const pause = await as(db, GV_CLIENT, `select standing_active from public.set_office_standing($1, false, null)`, [GV_ACCT]);
  const p1 = await state();
  ok("7 · the client's pause takes their untouched deliveries off, marked why", pause.error === null && p1.filter((r) => r.r === "paused").map((r) => r.id).join() === [ids[2], ids[3]].join(), p1);
  ok("7 · …a paid one, a linked one and one past its cutoff stay", [ids[0], ids[1], past].every((id) => p1.find((r) => r.id === id).r === null));
  await as(db, GV_CLIENT, `select 1 from public.set_office_standing($1, true, null)`, [GV_ACCT]);
  ok("7 · resuming puts them back", (await state()).every((r) => r.r === null), await state());
  await as(db, GV_CLIENT, `select 1 from public.set_office_standing($1, null, 7)`, [GV_ACCT]);
  const g = await state();
  ok("7 · new gallons reach the untouched deliveries, priced as they were", g.find((r) => r.id === ids[2]).g === 7 && g.find((r) => r.id === ids[2]).t === 7 * 5200 && g.find((r) => r.id === ids[3]).g === 7, g);
  ok("7 · …and not the paid, linked or past ones", [ids[0], ids[1], past].every((id) => g.find((r) => r.id === id).g === 4));
  await as(db, OWNER, `update public.business_accounts set address_street = '2 Main St' where id = $1`, [GV_ACCT]);
  const s = await state();
  ok("7 · a new door reaches the untouched deliveries only", s.find((r) => r.id === ids[3]).s === "2 Main St" && s.find((r) => r.id === ids[0]).s === "1 Main St", s);
  ok("7 · regenerating moves none of it (a changed delivery survives)", await gen(gvProg, "2030-06-01", "2030-06-30") === 0
    && JSON.stringify(await state()) === JSON.stringify(s));
}

// ── 7b · a new rule, window or price reaches the untouched deliveries; a decided one stays ──
{
  const july = (pid, where) => days(db, `select scheduled_for d from public.business_orders where program_id = $1 and scheduled_for between '2030-07-01' and '2030-07-31' and ${where} order by 1`, [pid]);
  const row = (pid, d) => val(db, `select canceled_reason r, delivery_window w, price_per_gallon_cents p, total_cents t from public.business_orders where program_id = $1 and scheduled_for = $2`, [pid, d]);
  const rp = await program();                                   // Mondays, Greenville, Settings' price ($52)
  await gen(rp, "2030-07-01", "2030-07-31");                    // July 2030's Mondays: 1, 8, 15, 22, 29
  await db.query(`update public.business_orders set payment_status = 'paid' where program_id = $1 and scheduled_for = '2030-07-01'`, [rp]);
  await db.query(`update public.company_programs set weekdays = '{4}' where id = $1`, [rp]);
  const off = await july(rp, `canceled_reason = 'schedule changed'`);
  ok("7b · a Monday program moved to Thursdays: its untouched Mondays come off, marked why", JSON.stringify(off) === JSON.stringify(["2030-07-08", "2030-07-15", "2030-07-22", "2030-07-29"]), off);
  ok("7b · …the paid Monday stays", (await row(rp, "2030-07-01")).r === null);
  await gen(rp, "2030-07-01", "2030-07-31");
  const thu = await july(rp, `canceled_at is null`);
  ok("7b · …and the run makes the Thursdays and never those Mondays again — not both", JSON.stringify(thu) === JSON.stringify(["2030-07-01", "2030-07-04", "2030-07-11", "2030-07-18", "2030-07-25"]), thu);
  await db.query(`update public.company_programs set weekdays = '{1}' where id = $1`, [rp]);
  const back = await july(rp, `canceled_at is null`);
  ok("7b · moved back to Mondays: the Mondays come back and the Thursdays come off", JSON.stringify(back) === JSON.stringify(["2030-07-01", "2030-07-08", "2030-07-15", "2030-07-22", "2030-07-29"]), back);
  await db.query(`update public.company_programs set delivery_window = 'mon_0900_1200', price_per_gallon_cents = 6000 where id = $1`, [rp]);
  const w = await row(rp, "2030-07-08"), paid = await row(rp, "2030-07-01");
  ok("7b · the program's own window and price reach its untouched deliveries (4 gal × $60)", w.w === "mon_0900_1200" && w.p === 6000 && w.t === 24000, w);
  ok("7b · …and not the paid one", paid.p === 5200 && paid.w !== "mon_0900_1200", paid);

  const sp = await program();                                   // no price or window of its own, none on the door
  await gen(sp, "2030-08-01", "2030-08-31");
  await db.query(`update public.live_status set office_price_cents = 5500 where id = 1`);
  const s1 = await row(sp, "2030-08-05");
  ok("7b · Settings' new price reaches the untouched deliveries of programs without their own (4 gal × $55) — not a program with its own", s1.p === 5500 && s1.t === 22000 && (await row(rp, "2030-07-08")).p === 6000, s1);
  await db.query(`update public.live_status set office_price_cents = 5200 where id = 1`);
  const gvWindow = (await val(db, `select office_window w from public.markets where slug = 'greenville'`)).w;
  await db.query(`update public.markets set office_window = 'mon_0530_0830' where slug = 'greenville'`);
  const s2 = await row(sp, "2030-08-05");
  ok("7b · the city's new office window reaches deliveries with no window of their own or on their door — not a program with its own", s2.w === "mon_0530_0830" && (await row(rp, "2030-07-08")).w === "mon_0900_1200", s2);
  await db.query(`update public.markets set office_window = $1 where slug = 'greenville'`, [gvWindow]);
}

// ── 8 · who runs it ──
{
  const crew = await as(db, OWNER, `select public.generate_office_deliveries() n`);
  const logged = await n(db, `select count(*) n from public.job_runs where run_by = $1 and ok and job = 'office_generation'`, [OWNER]);
  ok("8 · the crew's button makes this week's deliveries and logs a run per market", crew.error === null && logged >= 2, { crew, logged });
  const refused = await as(db, GV_CLIENT, `select public.generate_office_deliveries() n`);
  ok("8 · …and is staff only", refused.error !== null, refused);

  const sched = (at) => val(db, `select public.run_office_generation($1) n`, [at]);
  const runs = (market) => n(db, `select count(*) n from public.job_runs where run_by is null and market = $1`, [market]);
  await sched("2030-01-07T07:00:00Z");   // 2 AM in Greenville
  ok("8 · the schedule waits for 3 AM in each market's own time", await runs("greenville") === 0);
  await sched("2030-01-07T09:00:00Z");   // 4 AM
  ok("8 · …then runs it once that day", await runs("greenville") === 1 && await n(db, `select count(*) n from public.job_runs where run_by is null and market = 'greenville' and ok and run_on = '2030-01-07'`) === 1);
  await sched("2030-01-07T15:00:00Z");
  ok("8 · …and not again the same day", await runs("greenville") === 1);
  const denver = await program({ weekdays: [2] }, gv, "denver");
  await db.query(`update public.markets set timezone = 'Not/AZone' where slug = 'denver'`);
  let threw = null;
  try { await sched("2030-01-08T12:00:00Z"); } catch (e) { threw = String(e.message || e); }
  ok("8 · a market whose run fails does not stop the others", threw === null && await runs("greenville") === 2, threw);
  ok("8 · …its failure is logged", await n(db, `select count(*) n from public.job_runs where market = 'denver' and ok = false and error is not null`) === 1);
  ok("8 · …and the crew hears, once", await n(db, `select count(*) n from public.alerts where kind = 'office_generation_failed'`) === 1);
  await db.query(`update public.markets set timezone = 'America/Denver' where slug = 'denver'`);
  await db.query(`update public.company_programs set status = 'ended' where id = $1`, [denver]);

  const book = async () => (await db.query(`select * from public.book_office_standing($1)`, [ATL_ACCT])).rows;
  const b1 = await book(), b2 = await book();
  ok("8 · a booking gets its first delivery whose cutoff is still ahead", b1.length === 1 && new Date(b1[0].cutoff_at) > new Date() && b1[0].delivery_window === "mon_0600_0900", b1);
  ok("8 · …the same one when asked again (never a second)", b2.length === 1 && b2[0].order_id === b1[0].order_id, b2);
  await as(db, ATL_CLIENT, `select 1 from public.set_office_standing($1, false, null)`, [ATL_ACCT]);
  ok("8 · …and nothing for a paused account", (await book()).length === 0);
  const next = await as(db, STRANGER, `select delivery_date, cutoff_at, delivery_window from public.office_next_delivery('atlanta')`);
  ok("8 · a one-off's next date: Atlanta's window weekday, cutoff ahead", next.error === null && new Date(next.rows[0].cutoff_at) > new Date()
    && new Date(next.rows[0].delivery_date).getUTCDay() === 1 && next.rows[0].delivery_window === "mon_0600_0900", next);
  ok("8 · booking is the server's, never a client's", (await as(db, GV_CLIENT, `select * from public.book_office_standing($1)`, [GV_ACCT])).error !== null);

  // 0305's guard (0317's wording) refuses a second tenant unless asked for deliberately, in its own transaction
  await db.exec(`begin; set local gt3.allow_second_tenant = 'on'; insert into public.tenants (id, slug, name) values ('${T2}', 'second', 'Second Co'); commit;`);
  const co2 = await val(db, `insert into public.companies (tenant_id, name) values ($1, 'Other Tenant Co') returning id`, [T2]);
  const loc2 = await val(db, `insert into public.company_locations (tenant_id, company_id, market) values ($1, $2, 'greenville') returning id`, [T2, co2.id]);
  const other = await program({}, { company_id: co2.id, location_id: loc2.id }, "greenville", T2);
  await as(db, OWNER, `select public.generate_office_route('2030-09-02') n`);
  ok("8 · one tenant's button never makes another tenant's deliveries", await n(db, `select count(*) n from public.business_orders where program_id = $1`, [other]) === 0);
}

// ── 9 · who reads ──
{
  const mine = await as(db, GV_CLIENT, `select note from public.office_closed_dates order by note`);
  ok("9 · a client reads their own company's closed dates, not GT3's", JSON.stringify(mine.rows.map((r) => r.note)) === JSON.stringify(["Office closed"]), mine);
  const add = await as(db, GV_CLIENT, `insert into public.office_closed_dates (starts_on, ends_on) values ('2030-12-24', '2030-12-26') returning id`);
  ok("9 · …and cannot add one", add.error !== null, add);
  const crew = await as(db, OWNER, `insert into public.office_closed_dates (starts_on, ends_on, policy, note) values ('2030-12-24', '2030-12-26', 'skip', 'Holidays') returning id`);
  ok("9 · the crew can", crew.error === null && crew.rows.length === 1, crew);
  ok("9 · the job log is the crew's to read", (await as(db, OWNER, `select id from public.job_runs`)).rows.length > 0
    && (await as(db, GV_CLIENT, `select id from public.job_runs`)).rows.length === 0);
  const write = await as(db, OWNER, `insert into public.job_runs (job, run_on) values ('x', '2030-01-01') returning id`);
  ok("9 · nobody writes the job log from the app", write.error !== null, write);
}

await db.close();
console.log(`db.generator: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
