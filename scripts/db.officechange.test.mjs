// A CLIENT CHANGES A DELIVERY UNTIL ITS CUTOFF — 0359, against the whole schema (every migration, in
// order: scripts/fixtures/schema.full.mjs), acting as each person the way PostgREST does.
//
// Phase 2, part 2 of the B2B challenge report (2026-10-07). The report's tests for this phase:
// "Company A can't read or change Company B by id; cutoff refuses late changes in the database; a
// double tap or retry changes nothing twice." These hold the change sheet to them, and to the rest:
//   1. Quantity: this delivery only, whole jugs, never under the minimum, its money follows; the same
//      key twice and the same answer twice change nothing twice.
//   2. Skip: kept as skipped, never made again by the schedule; a skip comes back until the cutoff.
//   3. Move: to an open weekday within two weeks — its program date kept, the morning it left
//      recorded — never onto a morning that location already has, a closed day or a weekend; the
//      mornings offered are exactly those.
//   4. The driver's note, until the driver leaves.
//   5. The cutoff, in the database: after it every change is refused with PT409 (HTTP 409; it was
//      55000, a 500, until 0360), the screen's cue to turn the sheet into a request — the crew can
//      still change it; a paid delivery keeps its money.
//   6. Who: admin, location manager and orderer change; billing and viewer read (and billing asks);
//      a location manager only at their location; another company, a stranger, another tenant's
//      crew and crew in another city are told the delivery is not there; nobody writes the tables.
//   7. Requests: a record and one alert; the same key twice is one request; the crew answers it and
//      the alert with it.
//   8. The home in one call: the company, its programs, six weeks with the skips, what each may do.
//   9. The schedule never overwrites the client: a new weekly quantity skips the day the client set,
//      a new rule skips the delivery the client moved, a pause takes everything open off and a
//      resume brings it back as the client left it, skips staying skipped.
import { fullSchema } from "./fixtures/schema.full.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const T2 = "c4a90000-0000-4000-8000-00000000d0e2";
const u = (n) => `c4a90000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADMIN = u(1), ORDERER = u(2), VIEWER = u(3), BILLING = u(4), LOCMGR = u(5), OTHER = u(6), CREW = u(7), ATL_CREW = u(8), T2_CREW = u(9), STRANGER = u(10), OWNER = u(11);
const KEY = (n) => `c4a90000-0000-4000-8000-${String(900 + n).padStart(12, "0")}`;

async function as(db, uid, sql, params) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  try { return { rows: (await db.query(sql, params)).rows, error: null, code: null }; }
  catch (e) { return { rows: [], error: String(e.message || e), code: e.code ?? null }; }
  finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const val = async (db, sql, params) => (await db.query(sql, params)).rows[0];

const db = await fullSchema();
const q = (sql, p) => db.query(sql, p);
const ids = {};
{
  await db.exec(`begin; set local gt3.allow_second_tenant = 'on'; insert into public.tenants (id, slug, name) values ('${T2}', 'second', 'Second Co'); commit;`);
  const people = [[ADMIN, "admin", "member", T1], [ORDERER, "orderer", "member", T1], [VIEWER, "viewer", "member", T1], [BILLING, "billing", "member", T1],
    [LOCMGR, "locmgr", "member", T1], [OTHER, "other", "member", T1], [CREW, "crew", "operator", T1], [ATL_CREW, "atl", "operator", T1],
    [T2_CREW, "t2", "operator", T2], [STRANGER, "stranger", "member", T1], [OWNER, "owner", "owner", T1]];
  for (const [id, name, role, tenant] of people) {
    await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${name}@example.test`]);
    await q(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, tenant]);
  }
  await q(`update public.profiles set market = 'atlanta' where id = $1`, [ATL_CREW]);
  // Company A books a weekly 4 gallons (the account makes the company, its location, its admin and
  // its program — 0355); company B the same. The crew's button makes six weeks of Mondays (0356/0358).
  ids.acctA = (await val(db, `insert into public.business_accounts (user_id, company, contact_name, address_street, address_city, address_zip, standing_active, standing_gallons, jug_balance, market, tenant_id)
             values ($1, 'Gwen Co', 'Gwen', '1 Main St', 'Greenville', '29601', true, 4, 3, 'greenville', '${T1}') returning id`, [ADMIN])).id;
  ids.acctB = (await val(db, `insert into public.business_accounts (user_id, company, address_street, address_city, address_zip, standing_active, standing_gallons, market, tenant_id)
             values ($1, 'Other Co', '9 Elm St', 'Greenville', '29601', true, 5, 'greenville', '${T1}') returning id`, [OTHER])).id;
  const a = await val(db, `select company_id, location_id, program_id from public.business_accounts where id = $1`, [ids.acctA]);
  Object.assign(ids, { coA: a.company_id, L1: a.location_id, progA: a.program_id });
  ids.coB = (await val(db, `select company_id from public.business_accounts where id = $1`, [ids.acctB])).company_id;
  await q(`insert into public.company_members (company_id, user_id, role, tenant_id) values ($1, $2, 'orderer', '${T1}'), ($1, $3, 'viewer', '${T1}'), ($1, $4, 'billing', '${T1}')`, [ids.coA, ORDERER, VIEWER, BILLING]);
  // A second site for company A, with a location manager for it alone, and a one-off delivery there.
  ids.L2 = (await val(db, `insert into public.company_locations (company_id, label, address_street, address_city, address_zip, market, tenant_id)
             values ($1, 'Gwen Co Annex', '2 Main St', 'Greenville', '29601', 'greenville', '${T1}') returning id`, [ids.coA])).id;
  await q(`insert into public.company_members (company_id, user_id, role, location_ids, tenant_id) values ($1, $2, 'location_manager', array[$3::uuid], '${T1}')`, [ids.coA, LOCMGR, ids.L2]);
  const made = await as(db, CREW, `select public.generate_office_deliveries() n`);
  ok("setup · the crew's button makes the six weeks", made.error === null && made.rows[0].n >= 10, made);
  const mondays = (await q(`select id, delivery_date::text d from public.business_orders where program_id = $1 order by delivery_date`, [ids.progA])).rows;
  ok("setup · company A has its Mondays, every one still open", mondays.length >= 5
    && (await val(db, `select bool_and(cutoff_at > now()) b from public.business_orders where program_id = $1`, [ids.progA])).b === true, mondays);
  [ids.D1, ids.D2, ids.D3, ids.D4, ids.D5] = mondays.map((m) => m.id);
  ids.dates = mondays.map((m) => m.d);
  // a one-off at the annex, ten weekdays out; one past its cutoff (made late, for the refusals); B's first Monday
  const oneOff = async (loc, dateSql, cutoffSql) => (await val(db, `insert into public.business_orders (user_id, company, contact_phone, address_street, address_city, address_zip,
             delivery_date, gallons, price_per_gallon_cents, subtotal_cents, total_cents, market, tenant_id, company_id, location_id, cutoff_at)
           values ($1, 'Gwen Co', '864-555-0101', '2 Main St', 'Greenville', '29601', ${dateSql}, 4, 4500, 18000, 18000, 'greenville', '${T1}', $2, $3, ${cutoffSql}) returning id`,
    [ADMIN, ids.coA, loc])).id;
  ids.annex = await oneOff(ids.L2, `(select d::date from generate_series(current_date + 10, current_date + 16, interval '1 day') d where extract(isodow from d) = 3 limit 1)`, `null`);
  ids.late = await oneOff(ids.L1, `current_date + 3`, `(current_date - 1 + time '18:00') at time zone 'America/New_York'`);   // closed yesterday, 6 PM
  ids.B1 = (await val(db, `select id from public.business_orders where company_id = $1 order by delivery_date limit 1`, [ids.coB])).id;
}
const change = (uid, order, ch, opts = {}) => as(db, uid, `select public.office_change_delivery($1, $2, $3, $4::date, $5, $6, $7) j`,
  [order, ch, opts.gallons ?? null, opts.to ?? null, opts.note ?? null, opts.reason ?? null, opts.key ?? null]);
const ord = (id) => val(db, `select delivery_date::text d, scheduled_for::text s, gallons::float g, total_cents t, canceled_at is not null c, canceled_reason r,
                                    moved_from::text mf, client_note n, change_reason cr, gallons_changed_at is not null gc, cutoff_at from public.business_orders where id = $1`, [id]);
const audits = async (id) => Number((await val(db, `select count(*) n from public.office_order_changes where order_id = $1`, [id])).n);
const price = (await val(db, `select office_price_cents p from public.live_status where id = 1`)).p;

// ── 1 · quantity ──
{
  const r = await change(ORDERER, ids.D1, "quantity", { gallons: 6, reason: "ran_out", key: KEY(1) });
  const o = await ord(ids.D1);
  ok("1 · an orderer sets this delivery to 6 gallons — that delivery only, its money with it", r.error === null && o.g === 6 && o.t === 6 * price && o.gc && o.cr === "ran_out"
    && (await ord(ids.D2)).g === 4, { r, o });
  ok("1 · …and answers with the delivery as the screen reads it", r.rows[0]?.j?.gallons === 6 && r.rows[0]?.j?.open === true && r.rows[0]?.j?.money_locked === false, r.rows[0]?.j);
  const audit = await val(db, `select change, was->>'gallons' was, became->>'gallons' became, reason, changed_by, by_crew from public.office_order_changes where order_id = $1`, [ids.D1]);
  ok("1 · …on record: who, from 4 to 6, why", audit?.change === "quantity" && audit.was === "4" && audit.became === "6" && audit.reason === "ran_out" && audit.changed_by === ORDERER && audit.by_crew === false, audit);
  const again = await change(ORDERER, ids.D1, "quantity", { gallons: 6, reason: "ran_out", key: KEY(1) });
  ok("1 · the same key again (a double tap, a retry) changes nothing twice", again.error === null && await audits(ids.D1) === 1, { again, n: await audits(ids.D1) });
  // the real hazard: a retry that arrives late, after a newer change — it must not put the old answer back
  await change(ORDERER, ids.D1, "quantity", { gallons: 7, key: KEY(10) });
  const lateRetry = await change(ORDERER, ids.D1, "quantity", { gallons: 6, reason: "ran_out", key: KEY(1) });
  ok("1 · a retry that arrives after a newer change doesn't undo it", lateRetry.error === null && (await ord(ids.D1)).g === 7 && await audits(ids.D1) === 2, { lateRetry, o: await ord(ids.D1) });
  await change(ORDERER, ids.D1, "quantity", { gallons: 6, key: KEY(11) });
  const same = await change(ORDERER, ids.D1, "quantity", { gallons: 6, key: KEY(2) });
  ok("1 · …and the same answer under a new key is no change at all", same.error === null && await audits(ids.D1) === 3, await audits(ids.D1));
  const under = await change(ORDERER, ids.D1, "quantity", { gallons: 2 });
  const half = await change(ORDERER, ids.D1, "quantity", { gallons: 4.5 });
  const huge = await change(ORDERER, ids.D1, "quantity", { gallons: 101 });
  const none = await change(ORDERER, ids.D1, "quantity", {});
  ok("1 · never under the minimum, never half a jug, never past 100 (that's a request), never blank — each said in words",
    under.code === "22023" && /minimum is 3 gallons/.test(under.error) && half.code === "22023" && /whole jugs/.test(half.error)
    && huge.code === "22023" && /send a request/.test(huge.error) && none.code === "22023" && (await ord(ids.D1)).g === 6, { under, half, huge, none });
  const bad = await change(ORDERER, ids.D1, "quantity", { gallons: 5, reason: "bored" });
  const what = await change(ORDERER, ids.D1, "cancel_everything");
  ok("1 · an unknown reason or change is refused", bad.code === "22023" && what.code === "22023", { bad, what });
}

// ── 2 · skip ──
{
  const r = await change(ADMIN, ids.D2, "skip", { reason: "office_closed", key: KEY(3) });
  const o = await ord(ids.D2);
  ok("2 · the admin skips a Monday: kept, marked skipped, never deleted", r.error === null && o.c && o.r === "skipped" && o.cr === "office_closed" && r.rows[0].j.canceled === true, { r, o });
  await as(db, CREW, `select public.generate_office_deliveries()`);
  const n = await val(db, `select count(*)::int n, bool_and(canceled_at is not null) c from public.business_orders where program_id = $1 and scheduled_for = $2`, [ids.progA, ids.dates[1]]);
  ok("2 · the schedule never makes that Monday again", n.n === 1 && n.c === true, n);
  const twice = await change(ADMIN, ids.D2, "skip", { key: KEY(4) });
  ok("2 · skipping it again is no change", twice.error === null && await audits(ids.D2) === 1, await audits(ids.D2));
  const back = await change(ADMIN, ids.D2, "unskip", { key: KEY(5) });
  ok("2 · a skip comes back before the cutoff", back.error === null && (await ord(ids.D2)).c === false && (await ord(ids.D2)).r === null, back);
  const backAgain = await change(ADMIN, ids.D2, "unskip", { key: KEY(6) });
  ok("2 · …and bringing back what is on is no change", backAgain.error === null && await audits(ids.D2) === 2, await audits(ids.D2));
  await change(ADMIN, ids.D2, "skip", { reason: "office_closed", key: KEY(7) });        // skipped again, for the agenda and the pause below
}

// ── 3 · move ──
{
  const d3 = ids.dates[2];
  const open = (await as(db, ORDERER, `select delivery_date::text d from public.office_open_dates($1)`, [ids.D3])).rows.map((r) => r.d);
  const want = (await q(`select d::date::text d from generate_series(greatest(current_date + 1, $1::date - 14), $1::date + 14, interval '1 day') d
                          where extract(isodow from d) between 1 and 5 and d::date <> $1::date and d::date <= current_date + 42
                            and (extract(isodow from d) <> 1 or d::date = $2::date)
                            and public.office_cutoff(d::date, 'greenville') > now() order by 1`, [d3, ids.dates[1]])).rows.map((r) => r.d);
  ok("3 · the mornings offered: the weekdays within two weeks, inside the six weeks, cutoff ahead — never a Monday it already has (the skipped one is open), never a weekend",
    open.length >= 6 && JSON.stringify(open) === JSON.stringify(want), { open, want });
  const tue = (await val(db, `select ($1::date + 1)::text d`, [d3])).d;
  const r = await change(ORDERER, ids.D3, "move", { to: tue, reason: "office_closed", key: KEY(8) });
  const o = await ord(ids.D3);
  ok("3 · moved to the Tuesday: its program date kept, the morning it left recorded, a cutoff for its new day",
    r.error === null && o.d === tue && o.s === d3 && o.mf === d3
    && new Date(o.cutoff_at).getTime() === new Date((await val(db, `select public.office_cutoff($1::date, 'greenville') c`, [tue])).c).getTime(), { r, o });
  await as(db, CREW, `select public.generate_office_deliveries()`);
  ok("3 · the schedule doesn't make its Monday again", Number((await val(db, `select count(*) n from public.business_orders where program_id = $1 and scheduled_for = $2`, [ids.progA, d3])).n) === 1);
  const ontoMonday = await change(ORDERER, ids.D3, "move", { to: ids.dates[3] });
  const weekend = await change(ORDERER, ids.D3, "move", { to: (await val(db, `select ($1::date + 5)::text d`, [d3])).d });
  const far = await change(ORDERER, ids.D3, "move", { to: (await val(db, `select ($1::date + 16)::text d`, [d3])).d });
  await q(`insert into public.office_closed_dates (company_id, starts_on, ends_on, policy, note, tenant_id) values ($1, $2::date + 2, $2::date + 2, 'skip', 'Gwen Co offsite', '${T1}')`, [ids.coA, d3]);
  const closed = await change(ORDERER, ids.D3, "move", { to: (await val(db, `select ($1::date + 2)::text d`, [d3])).d });
  ok("3 · never onto a morning it already has, a weekend, more than two weeks out or the company's closed day",
    ontoMonday.code === "22023" && /already has a delivery/.test(ontoMonday.error) && weekend.code === "22023" && far.code === "22023" && closed.code === "22023" && /closed/.test(closed.error)
    && (await ord(ids.D3)).d === tue, { ontoMonday, weekend, far, closed });
  const offered = (await as(db, ORDERER, `select delivery_date::text d from public.office_open_dates($1)`, [ids.D3])).rows.map((x) => x.d);
  ok("3 · …and the closed day is no longer offered", !offered.includes((await val(db, `select ($1::date + 2)::text d`, [d3])).d) && offered.length >= 5, offered);
  // A Monday not made yet (a skipped date is fine to land on: its row is there, canceled)
  const ontoSkipped = await change(ORDERER, ids.D3, "move", { to: ids.dates[1] });
  ok("3 · a skipped Monday is an open morning", ontoSkipped.error === null && (await ord(ids.D3)).d === ids.dates[1] && (await ord(ids.D3)).mf === d3, ontoSkipped);
  await change(ORDERER, ids.D3, "move", { to: tue });                                        // back to the Tuesday, for the followers below
  ok("3 · moved twice, it still remembers where it started", (await ord(ids.D3)).mf === d3 && (await ord(ids.D3)).d === tue);
}

// ── 4 · the driver's note ──
{
  const r = await change(ORDERER, ids.D1, "note", { note: "  Side door — buzz 2  ", key: KEY(9) });
  ok("4 · a note for the driver, trimmed", r.error === null && (await ord(ids.D1)).n === "Side door — buzz 2" && r.rows[0].j.client_note === "Side door — buzz 2", r);
  const long = await change(ORDERER, ids.D1, "note", { note: "x".repeat(301) });
  ok("4 · up to 300 characters", long.code === "22023", long);
  const late = await change(ORDERER, ids.late, "note", { note: "Leave at reception" });
  ok("4 · the note runs past the cutoff, until the driver leaves", late.error === null && (await ord(ids.late)).n === "Leave at reception", late);
  await q(`update public.business_orders set status = 'out_for_delivery' where id = $1`, [ids.late]);
  const gone = await change(ORDERER, ids.late, "note", { note: "Too late" });
  ok("4 · …and not after (PT409: the screen offers a message instead)", gone.code === "PT409" && /driver has left/.test(gone.error), gone);
  await q(`update public.business_orders set status = 'received' where id = $1`, [ids.late]);
  const clear = await change(ORDERER, ids.D1, "note", { note: "" });
  ok("4 · an empty note clears it", clear.error === null && (await ord(ids.D1)).n === null, clear);
}

// ── 5 · the cutoff, in the database ──
{
  const qty = await change(ORDERER, ids.late, "quantity", { gallons: 6 });
  const skip = await change(ORDERER, ids.late, "skip");
  const move = await change(ORDERER, ids.late, "move", { to: (await val(db, `select (current_date + 9)::text d`)).d });
  ok("5 · after the cutoff a client's quantity, skip and move are refused with PT409, saying when it closed",
    [qty, skip, move].every((x) => x.code === "PT409") && /closed .* at 6:00 PM/.test(qty.error) && (await ord(ids.late)).g === 4 && (await ord(ids.late)).c === false, { qty, skip, move });
  const crew = await change(CREW, ids.late, "quantity", { gallons: 6 });
  ok("5 · the crew can still change it (the AM answering the request)", crew.error === null && (await ord(ids.late)).g === 6, crew);
  ok("5 · …and the record says it was the crew", (await val(db, `select by_crew from public.office_order_changes where order_id = $1 and change = 'quantity'`, [ids.late])).by_crew === true);
  await q(`update public.business_orders set payment_status = 'paid' where id = $1`, [ids.D4]);
  const paidQty = await change(ADMIN, ids.D4, "quantity", { gallons: 8 });
  const paidSkip = await change(ADMIN, ids.D4, "skip");
  ok("5 · a paid delivery keeps its money: its quantity and skip become a request", paidQty.code === "PT409" && /is paid/.test(paidQty.error) && paidSkip.code === "PT409" && (await ord(ids.D4)).g === 4, { paidQty, paidSkip });
  const paidMove = await change(ADMIN, ids.D4, "move", { to: (await val(db, `select ($1::date + 1)::text d`, [ids.dates[3]])).d });
  ok("5 · …but it can still move to another morning", paidMove.error === null, paidMove);
  await change(ADMIN, ids.D4, "move", { to: ids.dates[3] });
  await q(`update public.business_orders set status = 'brewed' where id = $1`, [ids.D5]);
  const brewing = await change(ADMIN, ids.D5, "quantity", { gallons: 5 });
  ok("5 · once it is brewing, it is under way", brewing.code === "PT409" && /under way/.test(brewing.error), brewing);
  await q(`update public.business_orders set status = 'received' where id = $1`, [ids.D5]);
}

// ── 6 · who ──
{
  const viewer = await change(VIEWER, ids.D5, "quantity", { gallons: 5 });
  const billing = await change(BILLING, ids.D5, "skip");
  ok("6 · a viewer and a billing person read deliveries but don't change them — told so", viewer.code === "42501" && /ask your office admin/.test(viewer.error) && billing.code === "42501", { viewer, billing });
  const mgrHere = await change(LOCMGR, ids.annex, "quantity", { gallons: 5 });
  const mgrThere = await change(LOCMGR, ids.D5, "quantity", { gallons: 5 });
  ok("6 · a location manager changes their site's delivery, and the other site's is not there for them", mgrHere.error === null && mgrThere.code === "PT404", { mgrHere, mgrThere });
  const other = await change(OTHER, ids.D5, "skip");
  const stranger = await change(STRANGER, ids.D5, "skip");
  const t2 = await change(T2_CREW, ids.D5, "skip");
  const atl = await change(ATL_CREW, ids.D5, "skip");
  const anon = await change(null, ids.D5, "skip");
  ok("6 · company B, a stranger, another tenant's crew and crew in another city are told it isn't there; signed out can't call it",
    [other, stranger, t2, atl].every((x) => x.code === "PT404" && /no longer exists/.test(x.error)) && anon.error !== null && (await ord(ids.D5)).c === false, { other, stranger, t2, atl, anon });
  const homeB = await as(db, OTHER, `select public.office_home($1) h`, [ids.coA]);
  const homeT2 = await as(db, T2_CREW, `select public.office_home($1) h`, [ids.coA]);
  const datesB = await as(db, OTHER, `select * from public.office_open_dates($1)`, [ids.D5]);
  ok("6 · company B can't read company A's home or its open mornings by id", homeB.code === "PT404" && homeT2.code === "PT404" && datesB.code === "PT404", { homeB, homeT2, datesB });
  const write = await as(db, ORDERER, `update public.business_orders set gallons = 40 where id = $1 returning id`, [ids.D5]);
  const forge = await as(db, ORDERER, `insert into public.office_order_changes (company_id, order_id, change) values ($1, $2, 'quantity')`, [ids.coA, ids.D5]);
  const forgeReq = await as(db, ORDERER, `insert into public.company_requests (company_id, kind, body) values ($1, 'other', 'hi')`, [ids.coA]);
  ok("6 · nobody writes the delivery, the change log or a request around the functions", write.rows.length === 0 && (await ord(ids.D5)).g === 4 && forge.error !== null && forgeReq.error !== null, { write, forge, forgeReq });
  const mine = (await as(db, ORDERER, `select count(*)::int n from public.office_order_changes`)).rows[0].n;
  const theirs = (await as(db, OTHER, `select count(*)::int n from public.office_order_changes`)).rows[0].n;
  const mgr = (await as(db, LOCMGR, `select count(*)::int n from public.office_order_changes`)).rows[0].n;
  ok("6 · the change log reads by company and site: A's people see A's, B sees none, the annex manager the annex's", mine >= 8 && theirs === 0 && mgr === 1, { mine, theirs, mgr });
  // The deliveries themselves, as PostgREST and realtime read them (5b): every person of company A at
  // their sites — not only the one who booked — and nobody else; a person taken off the company, nothing.
  const rows = async (uid) => (await as(db, uid, `select count(*)::int n from public.business_orders where company_id = $1`, [ids.coA])).rows[0]?.n;
  const all = Number((await val(db, `select count(*) n from public.business_orders where company_id = $1`, [ids.coA])).n);
  const annexOnly = Number((await val(db, `select count(*) n from public.business_orders where company_id = $1 and location_id = $2`, [ids.coA, ids.L2])).n);
  const seen = { viewer: await rows(VIEWER), orderer: await rows(ORDERER), billing: await rows(BILLING), mgr: await rows(LOCMGR),
    other: await rows(OTHER), stranger: await rows(STRANGER), t2: await rows(T2_CREW), all, annexOnly };
  ok("6 · company A's deliveries read by A's people — not only the one who booked — the annex manager the annex's, nobody else",
    all >= 6 && annexOnly === 1 && seen.viewer === all && seen.orderer === all && seen.billing === all && seen.mgr === annexOnly
    && seen.other === 0 && seen.stranger === 0 && seen.t2 === 0, seen);
  await q(`update public.company_members set active = false where company_id = $1 and user_id = $2`, [ids.coA, VIEWER]);
  const gone = await rows(VIEWER);
  await q(`update public.company_members set active = true where company_id = $1 and user_id = $2`, [ids.coA, VIEWER]);
  ok("6 · a person taken off the company reads none of its deliveries", gone === 0, gone);
}

// ── 7 · requests ──
{
  const ask = (uid, kind, body, opts = {}) => as(db, uid, `select (public.office_request($1, $2, $3, $4, $5::jsonb, $6)).* `,
    [kind, body, opts.order ?? null, opts.company ?? null, opts.wants ? JSON.stringify(opts.wants) : null, opts.key ?? null]);
  const r = await ask(ORDERER, "change_after_cutoff", "Can we make it 6 gallons? Big meeting.", { order: ids.late, wants: { change: "quantity", gallons: 6 }, key: KEY(20) });
  const req = r.rows[0];
  ok("7 · a change after the cutoff becomes a request: the company's, its site, its delivery, what the sheet asked", r.error === null && req.company_id === ids.coA && req.location_id === ids.L1
    && req.order_id === ids.late && req.status === "open" && req.wants?.gallons === 6 && req.created_by === ORDERER, r);
  const alert = await val(db, `select count(*)::int n, max(title) t, max(body) b from public.alerts where kind = 'office_request' and subject_id = $1 and ack_at is null`, [req?.id]);
  ok("7 · …and the crew's inbox is told once, naming the company and the delivery", alert.n === 1 && alert.t === "Change after the cutoff — Gwen Co" && /\(the \w+day, \w{3} \d+ delivery\)/.test(alert.b), alert);
  const again = await ask(ORDERER, "change_after_cutoff", "Can we make it 6 gallons? Big meeting.", { order: ids.late, key: KEY(20) });
  ok("7 · the same key again is the same request, not a second one", again.rows[0]?.id === req.id && Number((await val(db, `select count(*) n from public.company_requests`)).n) === 1, again);
  const billing = await ask(BILLING, "billing", "Please add PO 4471 to our invoices.", { key: KEY(21) });
  ok("7 · billing asks a billing question for the company", billing.error === null && billing.rows[0].company_id === ids.coA && billing.rows[0].location_id === null, billing);
  const viewer = await ask(VIEWER, "other", "Hello");
  const other = await ask(OTHER, "other", "Hi", { order: ids.D5 });
  const blank = await ask(ORDERER, "other", "   ");
  ok("7 · a viewer is told their role can't; company B can't ask about A's delivery; a request says something",
    viewer.code === "42501" && other.code === "PT404" && /no longer exists/.test(other.error) && blank.code === "22023", { viewer, other, blank });
  const clientSet = await as(db, ORDERER, `select (public.office_request_set($1, 'done')).status`, [req.id]);
  ok("7 · only the crew moves a request along", clientSet.code === "42501", clientSet);
  const working = await as(db, CREW, `select (public.office_request_set($1, 'in_progress')).*`, [req.id]);
  ok("7 · the crew takes it: in progress, and it's theirs", working.error === null && working.rows[0].status === "in_progress" && working.rows[0].owner === CREW, working);
  const done = await as(db, CREW, `select (public.office_request_set($1, 'done', 'Made it 6 — see you Monday.')).*`, [req.id]);
  const acked = await val(db, `select count(*)::int n from public.alerts where kind = 'office_request' and subject_id = $1 and ack_at is null`, [req.id]);
  ok("7 · done answers the request and its alert", done.rows[0]?.status === "done" && done.rows[0].resolution === "Made it 6 — see you Monday." && done.rows[0].resolved_by === CREW && acked.n === 0, { done, acked });
  const seenB = (await as(db, OTHER, `select count(*)::int n from public.company_requests`)).rows[0].n;
  const seenA = (await as(db, VIEWER, `select count(*)::int n from public.company_requests`)).rows[0].n;
  ok("7 · A's requests read by A's people only", seenA === 2 && seenB === 0, { seenA, seenB });
}

// ── 8 · the home in one call ──
{
  const h = (await as(db, ADMIN, `select public.office_home() h`)).rows[0]?.h;
  ok("8 · the admin's home: their company, their role, what they may do", h?.company?.id === ids.coA && h.role === "admin" && h.can_change === true && h.can_request === true && h.min_gallons === 3, h && { company: h.company, role: h.role });
  ok("8 · …both sites, the program with its account (theirs to pause), the jugs", h.locations.length === 2 && h.programs.length === 1 && h.programs[0].gallons === 4
    && h.programs[0].account?.id === ids.acctA && h.programs[0].account.mine === true && h.jugs === 3, { locations: h.locations.length, programs: h.programs, jugs: h.jugs });
  const agenda = h.agenda.map((d) => d.id);
  ok("8 · six weeks, soonest first: the skip is there to undo, the moved one on its new morning",
    agenda.includes(ids.D2) && h.agenda.find((d) => d.id === ids.D2).canceled_reason === "skipped" && h.agenda.find((d) => d.id === ids.D3).moved_from === ids.dates[2]
    && h.agenda.every((d, i) => i === 0 || d.date >= h.agenda[i - 1].date), h.agenda.map((d) => [d.date, d.canceled_reason]));
  ok("8 · each line says whether it can still change, and why not", h.agenda.find((d) => d.id === ids.late)?.open === false && h.agenda.find((d) => d.id === ids.D1)?.open === true
    && h.agenda.find((d) => d.id === ids.D4)?.money_locked === true, h.agenda.map((d) => [d.date, d.open, d.money_locked]));
  ok("8 · a skip before its cutoff is still open — it can come back", h.agenda.find((d) => d.id === ids.D2)?.canceled === true && h.agenda.find((d) => d.id === ids.D2)?.open === true,
    h.agenda.find((d) => d.id === ids.D2));
  ok("8 · the requests are there with their answers", h.requests.length === 2 && h.requests.some((r) => r.status === "done" && r.resolution === "Made it 6 — see you Monday."), h.requests);
  const ho = (await as(db, ORDERER, `select public.office_home() h`)).rows[0]?.h;
  ok("8 · an orderer's home: the same company, not theirs to pause", ho?.role === "orderer" && ho.can_change === true && ho.programs[0].account.mine === false, ho && { role: ho.role, account: ho.programs[0].account });
  const hv = (await as(db, VIEWER, `select public.office_home() h`)).rows[0]?.h;
  ok("8 · a viewer reads it all and may do nothing", hv?.can_change === false && hv.can_request === false && hv.agenda.length === h.agenda.length, hv && { can_change: hv.can_change });
  const hm = (await as(db, LOCMGR, `select public.office_home() h`)).rows[0]?.h;
  ok("8 · the annex manager sees the annex alone", hm?.locations.length === 1 && hm.locations[0].id === ids.L2 && hm.agenda.length === 1 && hm.agenda[0].id === ids.annex && hm.programs.length === 0 && hm.jugs === 0, hm && { locations: hm.locations, agenda: hm.agenda.length });
  const hc = (await as(db, CREW, `select public.office_home($1) h`, [ids.coA])).rows[0]?.h;
  ok("8 · the crew sees what the client sees", hc?.role === "crew" && hc.agenda.length === h.agenda.length, hc && { role: hc.role });
  const hs = (await as(db, STRANGER, `select public.office_home() h`)).rows[0];
  ok("8 · someone with no office account gets nothing (the page offers to set one up)", hs?.h === null, hs);
  const anon = await as(db, null, `select public.office_home() h`);
  ok("8 · signed out can't call it", anon.error !== null, anon);
}

// ── 9 · the schedule never overwrites the client ──
{
  // a new weekly quantity (the admin's own control, 0354): every open delivery takes 5 — but D1, set to 6 for its day
  const r = await as(db, ADMIN, `select (public.set_office_standing($1, null, 5)).standing_gallons g`, [ids.acctA]);
  ok("9 · a new weekly quantity reaches the deliveries nobody set…", r.error === null && (await ord(ids.D5)).g === 5 && (await ord(ids.D3)).g === 5, { r, d5: await ord(ids.D5) });
  ok("9 · …and not the day the client set", (await ord(ids.D1)).g === 6, await ord(ids.D1));
  // a new price from GT3 reaches it all, on each delivery's own gallons
  await q(`update public.company_programs set price_per_gallon_cents = 5000 where id = $1`, [ids.progA]);
  ok("9 · GT3's price still reaches the client's day, on its own gallons", (await ord(ids.D1)).t === 6 * 5000 && (await ord(ids.D5)).t === 5 * 5000, [await ord(ids.D1), await ord(ids.D5)]);
  // a pause takes off every open delivery, the client's too; a resume brings them back as the client left them
  await as(db, ADMIN, `select public.set_office_standing($1, false, null)`, [ids.acctA]);
  const paused = await val(db, `select bool_and(canceled_at is not null) c from public.business_orders where id = any ($1::uuid[])`, [[ids.D1, ids.D3, ids.D5]]);
  ok("9 · a pause takes off everything open — the client's changed days too", paused.c === true && (await ord(ids.D1)).r === "paused" && (await ord(ids.D2)).r === "skipped", [await ord(ids.D1), await ord(ids.D2)]);
  const unskipPaused = await change(ADMIN, ids.D2, "unskip");
  ok("9 · a skip can't come back while the program is paused", unskipPaused.code === "PT409" && /paused/.test(unskipPaused.error), unskipPaused);
  await as(db, ADMIN, `select public.set_office_standing($1, true, null)`, [ids.acctA]);
  const d1 = await ord(ids.D1), d3 = await ord(ids.D3), d2 = await ord(ids.D2);
  ok("9 · a resume brings them back as the client left them; the skip stays skipped", !d1.c && d1.g === 6 && !d3.c && d3.mf === ids.dates[2] && d2.c && d2.r === "skipped", { d1, d3, d2 });
  // a new rule (Thursdays): the Mondays nobody moved come off, the one moved to a Tuesday stays, Thursdays are made
  await q(`update public.company_programs set weekdays = '{4}' where id = $1`, [ids.progA]);
  const d5 = await ord(ids.D5), d3b = await ord(ids.D3);
  const thursdays = Number((await val(db, `select count(*) n from public.business_orders where program_id = $1 and extract(isodow from scheduled_for) = 4 and canceled_at is null`, [ids.progA])).n);
  ok("9 · a new rule takes off the Mondays nobody moved and makes the Thursdays", d5.c && d5.r === "schedule changed" && thursdays >= 4, { d5, thursdays });
  ok("9 · …and leaves the delivery the client moved to a morning of their own", !d3b.c && d3b.mf === ids.dates[2], d3b);
}

await db.close();
console.log(`db.officechange: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
