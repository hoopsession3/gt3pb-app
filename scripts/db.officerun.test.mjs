// AN OFFICE DELIVERY IS A STOP ON THE RUN — 0357, against the whole schema (every migration, in order:
// scripts/fixtures/schema.full.mjs), acting as each person the way PostgREST does.
//
// Phase 1, part 3 of the B2B challenge report (2026-10-07; defect 11). The crew's panel logged an
// office delivery in three writes from the browser — the order, a read of the balance, the ledger
// row, the balance — so two phones could count one swap twice and a failed write left jugs uncounted.
//   1. One write: delivered with the swap moves the order, the ledger and the balance together; the
//      balance never goes under zero; a second log of the same delivery is refused.
//   2. A mis-tap reopens: the jug entry is voided (the reversal kept as the record) and the stop is open.
//   3. Delivered with no swap, not delivered (the crew told once, and the alert answered when that was
//      the mis-tap), a one-off with no account, a canceled delivery, an unknown or missing outcome, a
//      delivery before its day and a reopen of something never logged each do exactly what they say.
//   4. Only the crew who can see it: a client, a signed-out caller, crew in another city and crew of
//      another company are refused — the function runs as its owner, so it asks what the policies ask.
//   5. The driver's run and the crew's route hear each other (business_orders is in the realtime publication).
import { fullSchema } from "./fixtures/schema.full.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const T2 = "7d1e0000-0000-4000-8000-00000000d0e2";
const u = (n) => `7d1e0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DRIVER = u(1), CLIENT = u(2), ATL_DRIVER = u(3), OTHER_CO = u(4), ACCT = u(101);
const O = (n) => u(200 + n);
const DAY = "'2026-01-05'";                                     // a Monday already come: loggable (an SQL date)

async function as(db, uid, sql, params) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  try { return { rows: (await db.query(sql, params)).rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e), code: e.code ?? null }; }
  finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const val = async (db, sql, params) => (await db.query(sql, params)).rows[0];

const db = await fullSchema();
{
  const q = (sql, p) => db.query(sql, p);
  await db.exec(`begin; set local gt3.allow_second_tenant = 'on'; insert into public.tenants (id, slug, name) values ('${T2}', 'second', 'Second Co'); commit;`);
  await q(`insert into auth.users (id, email) values ($1, 'driver@example.test'), ($2, 'client@example.test'), ($3, 'atl@example.test'), ($4, 'other@example.test')`, [DRIVER, CLIENT, ATL_DRIVER, OTHER_CO]);
  await q(`update public.profiles set role = 'operator', tenant_id = $2 where id = $1`, [DRIVER, T1]);
  await q(`update public.profiles set role = 'member', tenant_id = $2 where id = $1`, [CLIENT, T1]);
  await q(`update public.profiles set role = 'operator', tenant_id = $2, market = 'atlanta' where id = $1`, [ATL_DRIVER, T1]);
  await q(`update public.profiles set role = 'operator', tenant_id = $2 where id = $1`, [OTHER_CO, T2]);
  await q(`insert into public.business_accounts (id, user_id, company, address_street, address_city, address_zip, standing_active, standing_gallons, jug_balance, market, tenant_id)
           values ($1, $2, 'Gwen Co', '1 Main St', 'Greenville', '29601', true, 4, 2, 'greenville', '${T1}')`, [ACCT, CLIENT]);
  const order = (id, biz, gallons, { canceled = null, day = DAY } = {}) => q(`insert into public.business_orders (id, business_id, user_id, company, contact_phone, address_street, address_city, address_zip,
             delivery_date, gallons, subtotal_cents, total_cents, market, tenant_id${canceled ? ", canceled_at" : ""})
           values ($1, $2, $3, 'Gwen Co', '864-555-0101', '1 Main St', 'Greenville', '29601', ${day}, $4, 18000, 18000, 'greenville', '${T1}'${canceled ? `, '${canceled}'` : ""})`,
    [id, biz, CLIENT, gallons]);
  await order(O(1), ACCT, 4); await order(O(2), ACCT, 4); await order(O(3), ACCT, 3);
  await order(O(4), null, 3);                                   // a one-off, no account
  await order(O(5), ACCT, 4, { canceled: "2026-01-01T00:00:00Z" });
  await order(O(6), ACCT, 4, { day: "current_date + 30" });     // next month's delivery
  await order(O(7), ACCT, 4);                                   // never logged — for the refusals
}
const bal = async () => (await val(db, `select jug_balance b from public.business_accounts where id = $1`, [ACCT])).b;
const ord = (id) => val(db, `select status, driver_outcome, jugs_out, jugs_in from public.business_orders where id = $1`, [id]);
const log = (uid, id, outcome, empties = null) => as(db, uid, `select status from public.office_log_delivery($1, $2, $3)`, [id, outcome, empties]);
const reopen = (uid, id, why = "Mis-tap on the driver's run") => as(db, uid, `select status from public.office_reopen_delivery($1, $2)`, [id, why]);
const untouched = async (id) => { const o = await ord(id); return o.status === "received" && o.driver_outcome === null; };

// ── 1 · one write ──
{
  const r = await log(DRIVER, O(1), "delivered_swapped", 3);
  ok("1 · the driver logs a swap: delivered, 4 full out, 3 empties back", r.error === null && JSON.stringify(await ord(O(1))) === JSON.stringify({ status: "delivered", driver_outcome: "delivered_swapped", jugs_out: 4, jugs_in: 3 }), { r, o: await ord(O(1)) });
  const led = await val(db, `select jugs_out, jugs_in, balance_after, company_id is not null linked from public.jug_ledger where business_order_id = $1`, [O(1)]);
  ok("1 · …the ledger row and the balance move in the same write (2 + 4 − 3 = 3)", led?.balance_after === 3 && await bal() === 3 && led.linked, { led, bal: await bal() });
  const again = await log(DRIVER, O(1), "delivered_swapped", 3);
  ok("1 · a second log of the same delivery is refused, not counted twice", again.error !== null && /already logged/.test(again.error) && await bal() === 3
    && Number((await val(db, `select count(*) n from public.jug_ledger where business_order_id = $1`, [O(1)])).n) === 1, again);
}

// ── 2 · a mis-tap reopens ──
{
  const r = await reopen(DRIVER, O(1));
  ok("2 · reopening puts the stop back on the run", r.error === null && (await ord(O(1))).status === "out_for_delivery" && (await ord(O(1))).driver_outcome === null, { r, o: await ord(O(1)) });
  ok("2 · …and voids its jug entry, keeping it as the record, balance back to 2", await bal() === 2
    && (await val(db, `select voided_at is not null v, void_reason from public.jug_ledger where business_order_id = $1`, [O(1)])).v === true, await bal());
  const noReason = await reopen(DRIVER, O(1), "  ");
  ok("2 · a reopen says why", noReason.error !== null, noReason);
  const relog = await log(DRIVER, O(1), "delivered_swapped", 4);
  ok("2 · …and the stop can be logged again", relog.error === null && await bal() === 2, { relog, bal: await bal() });
}

// ── 3 · each outcome does what it says ──
{
  await log(DRIVER, O(2), "delivered_no_swap");
  ok("3 · delivered with no empties back: 4 out, 0 in, balance 2 + 4 = 6", JSON.stringify(await ord(O(2))) === JSON.stringify({ status: "delivered", driver_outcome: "delivered_no_swap", jugs_out: 4, jugs_in: 0 }) && await bal() === 6, await bal());
  await log(DRIVER, O(3), "not_available");
  const alert = () => val(db, `select count(*)::int n, count(*) filter (where ack_at is null)::int open, max(category) c from public.alerts where kind = 'office_not_delivered' and subject_id = $1`, [O(3)]);
  const a = await alert();
  ok("3 · not delivered: an issue, no jugs moved, the crew told once", (await ord(O(3))).status === "issue" && (await ord(O(3))).driver_outcome === "not_available" && await bal() === 6 && a.n === 1 && a.open === 1 && a.c === "order", a);
  const back = await reopen(DRIVER, O(3), "Tapped the wrong office");
  const b = await alert();
  ok("3 · …a mis-tapped \"not delivered\" reopens and its alert is answered, not left to chase", back.error === null && (await ord(O(3))).status === "out_for_delivery" && b.n === 1 && b.open === 0, { back, b });
  const one = await log(DRIVER, O(4), "delivered_swapped", 3);
  ok("3 · a one-off with no account logs, with no balance to move (as before)", one.error === null && (await ord(O(4))).status === "delivered"
    && Number((await val(db, `select count(*) n from public.jug_ledger where business_order_id = $1`, [O(4)])).n) === 0, one);
  const canceled = await log(DRIVER, O(5), "delivered_swapped", 3);
  ok("3 · a canceled delivery cannot be logged", canceled.error !== null && /canceled/.test(canceled.error), canceled);
  const odd = await log(DRIVER, O(7), "teleported");
  ok("3 · an unknown outcome is refused", odd.error !== null && odd.code === "22023" && await untouched(O(7)), odd);
  const none = await log(DRIVER, O(7), null);
  ok("3 · …and so is no outcome at all — it never marks a delivery delivered", none.error !== null && none.code === "22023" && await untouched(O(7)), { none, o: await ord(O(7)) });
  const early = await log(DRIVER, O(6), "delivered_swapped", 4);
  ok("3 · a delivery is logged on its day, not before", early.error !== null && /on the day/.test(early.error) && await untouched(O(6)), early);
  const nothing = await reopen(DRIVER, O(7));
  ok("3 · a delivery never logged has nothing to reopen", nothing.error !== null && /nothing to undo/.test(nothing.error) && await untouched(O(7)), nothing);
  await db.query(`update public.business_accounts set jug_balance = 0 where id = $1`, [ACCT]);
  await log(DRIVER, O(3), "delivered_swapped", 10);
  ok("3 · the balance never goes under zero (0 + 3 − 10 → 0)", await bal() === 0 && (await val(db, `select balance_after b from public.jug_ledger where business_order_id = $1 and voided_at is null`, [O(3)])).b === 0);
}

// ── 4 · only the crew who can see it ──
{
  const client = await log(CLIENT, O(7), "delivered_swapped", 1);
  ok("4 · a client cannot log a delivery", client.error !== null && client.code === "42501" && await untouched(O(7)), client);
  const anon = await log(null, O(7), "delivered_swapped", 1);
  ok("4 · signed out: refused", anon.error !== null && await untouched(O(7)), anon);
  const reopenClient = await reopen(CLIENT, O(2), "mine");
  ok("4 · nor reopen one", reopenClient.error !== null && (await ord(O(2))).status === "delivered", reopenClient);
  const atl = await log(ATL_DRIVER, O(7), "delivered_swapped", 1);
  ok("4 · crew in another city can't log a Greenville stop — it isn't on their screen", atl.error !== null && atl.code === "P0002" && await untouched(O(7)), atl);
  const atlBack = await reopen(ATL_DRIVER, O(2));
  ok("4 · …nor reopen one", atlBack.error !== null && atlBack.code === "P0002" && (await ord(O(2))).status === "delivered", atlBack);
  const other = await log(OTHER_CO, O(7), "delivered_swapped", 1);
  ok("4 · another company's crew can't touch this company's deliveries", other.error !== null && other.code === "P0002" && await untouched(O(7)), other);
  const otherBack = await reopen(OTHER_CO, O(2));
  ok("4 · …in either direction", otherBack.error !== null && otherBack.code === "P0002" && (await ord(O(2))).status === "delivered", otherBack);
}

// ── 5 · the run and the route hear each other ──
ok("5 · business_orders is in the realtime publication", (await val(db, `select exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'business_orders') e`)).e === true);

await db.close();
console.log(`db.officerun: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
