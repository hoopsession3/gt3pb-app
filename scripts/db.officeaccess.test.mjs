// A CLIENT SEES THEIR OWN OFFICE ACCOUNT, AND CANNOT REWRITE IT — 0354, against the whole schema
// (every migration, applied in order: scripts/fixtures/schema.full.mjs), acting as each kind of person
// the way PostgREST does: `set role authenticated` with the caller's id in request.jwt.claim.sub.
//
// Phase 0 of the B2B challenge report (2026-10-07). Before 0354, proved on the schema as production
// had it: a signed-in client could put their own account on net 30 and write any jug count, and an
// Atlanta client could not read their own account. After it:
//   1. A client reads their own account and nobody else's; every direct write to it is refused —
//      terms, jugs, market, window, gallons — and so is creating one.
//   2. The two changes /office offers go through set_office_standing(): their own account only, never
//      under the minimum, never for a stranger, never signed out.
//   3. An Atlanta client reads their own account, orders and invoices; a Greenville operator still
//      cannot read Atlanta's money (0291's scope stands for staff); owners see both cities.
//   4. The weekly run prices from Settings — the price /office quotes — not a stale per-city copy.
//   5. An account that loses its person stops its weekly order and tells the crew.
//   6. Settings cannot save a minimum under 3 gallons, which every booking would fail.
import { readFileSync } from "node:fs";
import { fullSchema } from "./fixtures/schema.full.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0f1ce000-0000-4000-8000-0000000000a1";
const GV_CLIENT = "0f1ce000-0000-4000-8000-0000000000c1";
const ATL_CLIENT = "0f1ce000-0000-4000-8000-0000000000c2";
const STRANGER = "0f1ce000-0000-4000-8000-0000000000c3";
const GV_OPERATOR = "0f1ce000-0000-4000-8000-0000000000e1";
const GV_ACCT = "0f1ce000-0000-4000-8000-00000000ac01";
const ATL_ACCT = "0f1ce000-0000-4000-8000-00000000ac02";
const ATL_ORDER = "0f1ce000-0000-4000-8000-00000000b001";

async function stage(db) {
  const q = (sql, p) => db.query(sql, p);
  for (const [id, email] of [[OWNER, "owner@example.test"], [GV_CLIENT, "gwen@example.test"], [ATL_CLIENT, "ade@example.test"], [STRANGER, "stranger@example.test"], [GV_OPERATOR, "op@example.test"]]) {
    await q(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
  }
  for (const [id, role] of [[OWNER, "owner"], [GV_CLIENT, "member"], [ATL_CLIENT, "member"], [STRANGER, "member"], [GV_OPERATOR, "operator"]]) {
    // every profile keeps 0289's default market, 'greenville' — which is exactly the Atlanta client's case
    await q(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, T1]);
  }
  await q(`insert into public.business_accounts (id, user_id, company, contact_name, contact_phone, contact_email,
             address_street, address_city, address_zip, billing_terms, standing_active, standing_gallons, market, tenant_id)
           values ($1, $2, 'Gwen Co', 'Gwen', '864-555-0101', 'gwen@example.test', '1 Main St', 'Greenville', '29601', 'prepaid', true, 4, 'greenville', $5),
                  ($3, $4, 'Ade Co',  'Ade',  '404-555-0102', 'ade@example.test',  '9 Peach St', 'Atlanta',   '30303', 'net15',   true, 5, 'atlanta',    $5)`,
    [GV_ACCT, GV_CLIENT, ATL_ACCT, ATL_CLIENT, T1]);
  await q(`insert into public.business_orders (id, business_id, user_id, company, contact_name, contact_phone, address_street, address_city, address_zip,
             delivery_date, delivery_window, gallons, price_per_gallon_cents, subtotal_cents, delivery_fee_cents, tax_cents, total_cents,
             billing_terms, payment_status, status, standing, market, tenant_id)
           values ($1, $2, $3, 'Ade Co', 'Ade', '404-555-0102', '9 Peach St', 'Atlanta', '30303',
             '2026-10-12', 'mon_0500_0800', 5, 4500, 22500, 0, 0, 22500, 'net15', 'invoiced', 'received', true, 'atlanta', $4)`,
    [ATL_ORDER, ATL_ACCT, ATL_CLIENT, T1]);
  await q(`insert into public.invoices (business_id, business_order_id, amount_cents, terms, status, tenant_id)
           values ($1, $2, 22500, 'net15', 'open', $3)`, [ATL_ACCT, ATL_ORDER, T1]);
}

// Act as a person the way PostgREST does, then put the session back for the next step.
async function as(db, uid, sql, params) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  try { return { rows: (await db.query(sql, params)).rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e), code: e.code ?? null }; }
  finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const val = async (db, sql, params) => (await db.query(sql, params)).rows[0];

// ── before 0354: the defects, on the schema as production has it ──
{
  const before = await fullSchema({ before: "0354" });
  await stage(before);
  const wrote = await as(before, GV_CLIENT, `update public.business_accounts set billing_terms = 'net30', jug_balance = -40 where id = $1 returning billing_terms`, [GV_ACCT]);
  ok("before 0354: a client could put their own account on net 30 and write any jug count from the browser",
    wrote.rows[0]?.billing_terms === "net30" && (await val(before, `select jug_balance from public.business_accounts where id = $1`, [GV_ACCT])).jug_balance === -40, wrote);
  const made = await as(before, STRANGER, `insert into public.business_accounts (user_id, company, billing_terms, standing_active, standing_gallons)
                                            values ('${STRANGER}', 'Net Thirty LLC', 'net30', true, 3) returning id`);
  ok("before 0354: …and could create a net-30 account for the weekly run to bill", made.error === null && made.rows.length === 1, made);
  const atl = await as(before, ATL_CLIENT, `select id from public.business_accounts where id = $1`, [ATL_ACCT]);
  ok("before 0354: an Atlanta client could not read their own account", atl.rows.length === 0, atl);
  await before.close();
}

// ── 0354 pasted over what production may hold: a minimum of 2 already saved, an account that already
//    has no person. live_status is the truck's live row too, and a check holds on every write of a
//    row — so the file raises the minimum before it adds the check, or the next go-live would fail
//    on it. The account without a person is named and left alone. And it is pasted by hand, so it
//    must run twice cleanly.
{
  const prod = await fullSchema({ before: "0354" });
  await stage(prod);
  await prod.query(`update public.live_status set office_min_gallons = 2 where id = 1`);
  await prod.query(`update public.business_accounts set user_id = null where id = $1`, [ATL_ACCT]);
  const file = readFileSync(new URL("../supabase/migrations/0354_a_client_reads_its_account_and_cannot_rewrite_it.sql", import.meta.url), "utf8");
  let applied = null, again = null, live = null;
  try { await prod.exec(file); } catch (e) { applied = String(e.message || e); }
  ok("pasted: 0354 applies over a saved minimum of 2 and an orphaned account", applied === null, applied);
  ok("pasted: …the minimum is 3 now", (await val(prod, `select office_min_gallons m from public.live_status where id = 1`)).m === 3);
  try { await prod.query(`update public.live_status set is_live = true where id = 1`); } catch (e) { live = String(e.message || e); }
  ok("pasted: …and the truck's live row still takes a write (going live)", live === null, live);
  // Named in a notice and left running: it may be an office the crew set up by hand (0354, note 4).
  ok("pasted: …an account that already had no person is left as it was", (await val(prod, `select standing_active s from public.business_accounts where id = $1`, [ATL_ACCT])).s === true);
  try { await prod.exec(file); } catch (e) { again = String(e.message || e); }
  ok("pasted: …and a second paste runs cleanly", again === null, again);
  await prod.close();
}

const db = await fullSchema();
await stage(db);

// ── 1 · read your own, write none of it ──
{
  const mine = await as(db, GV_CLIENT, `select id, company from public.business_accounts`);
  ok("1 · a client reads their own account", mine.rows.length === 1 && mine.rows[0].id === GV_ACCT, mine);
  for (const [col, v] of [["billing_terms", "'net30'"], ["jug_balance", "-40"], ["market", "'atlanta'"], ["preferred_window", "'any time'"], ["standing_gallons", "99"], ["company", "'Renamed'"]]) {
    const r = await as(db, GV_CLIENT, `update public.business_accounts set ${col} = ${v} where id = $1 returning id`, [GV_ACCT]);
    ok(`1 · a client cannot write ${col} on their own account`, r.rows.length === 0, r);
  }
  const row = await val(db, `select billing_terms, jug_balance, market, company, standing_gallons from public.business_accounts where id = $1`, [GV_ACCT]);
  ok("1 · …and the row is exactly as it was", row.billing_terms === "prepaid" && row.jug_balance === 0 && row.market === "greenville" && row.company === "Gwen Co" && Number(row.standing_gallons) === 4, row);
  const made = await as(db, STRANGER, `insert into public.business_accounts (user_id, company, billing_terms, standing_active, standing_gallons)
                                        values ('${STRANGER}', 'Net Thirty LLC', 'net30', true, 3) returning id`);
  ok("1 · a client cannot create an account (the weekly run would have billed it)", made.error !== null && /row-level security/i.test(made.error), made);
  const staff = await as(db, OWNER, `update public.business_accounts set jug_balance = 2 where id = $1 returning jug_balance`, [GV_ACCT]);
  ok("1 · staff still write the account (the office route's jug count)", staff.rows[0]?.jug_balance === 2, staff);
}

// ── 2 · the two changes /office offers, through one checked door ──
{
  const pause = await as(db, GV_CLIENT, `select standing_active from public.set_office_standing($1, false, null)`, [GV_ACCT]);
  ok("2 · a client can switch their weekly order off", pause.rows[0]?.standing_active === false, pause);
  const resume = await as(db, GV_CLIENT, `select standing_active, standing_gallons from public.set_office_standing($1, true, 6)`, [GV_ACCT]);
  ok("2 · …and back on, with more gallons", resume.rows[0]?.standing_active === true && Number(resume.rows[0]?.standing_gallons) === 6, resume);
  const under = await as(db, GV_CLIENT, `select * from public.set_office_standing($1, null, 2)`, [GV_ACCT]);
  ok("2 · never under 3 gallons", under.error !== null && /minimum is 3/.test(under.error), under);
  ok("2 · …refused as 22023, the code /office shows the sentence for", under.code === "22023", under);
  await db.query(`update public.live_status set office_min_gallons = 4 where id = 1`);
  const underMin = await as(db, GV_CLIENT, `select * from public.set_office_standing($1, null, 3)`, [GV_ACCT]);
  ok("2 · never under the minimum in Settings", underMin.error !== null && /minimum is 4/.test(underMin.error), underMin);
  await db.query(`update public.live_status set office_min_gallons = 3 where id = 1`);
  const theirs = await as(db, GV_CLIENT, `select * from public.set_office_standing($1, false, null)`, [ATL_ACCT]);
  ok("2 · never someone else's account", theirs.error !== null && /not your office account/.test(theirs.error), theirs);
  ok("2 · …and theirs is untouched", (await val(db, `select standing_active from public.business_accounts where id = $1`, [ATL_ACCT])).standing_active === true);
  const anon = await as(db, null, `select * from public.set_office_standing($1, false, null)`, [GV_ACCT]);
  ok("2 · not signed out", anon.error !== null && /permission denied/i.test(anon.error), anon);
  const terms = await as(db, GV_CLIENT, `select billing_terms, jug_balance from public.set_office_standing($1, true, 5)`, [GV_ACCT]);
  ok("2 · the door changes the order and nothing else on the row", terms.rows[0]?.billing_terms === "prepaid" && terms.rows[0]?.jug_balance === 2, terms);
}

// ── 3 · the city filter is for staff ──
{
  const acct = await as(db, ATL_CLIENT, `select id from public.business_accounts`);
  ok("3 · an Atlanta client reads their own account", acct.rows.length === 1 && acct.rows[0].id === ATL_ACCT, acct);
  const orders = await as(db, ATL_CLIENT, `select id from public.business_orders`);
  ok("3 · …their own orders", orders.rows.length === 1 && orders.rows[0].id === ATL_ORDER, orders);
  const inv = await as(db, ATL_CLIENT, `select amount_cents from public.invoices`);
  ok("3 · …and their own invoices", inv.rows.length === 1 && inv.rows[0].amount_cents === 22500, inv);
  // (their own may exist: resuming in section 2 makes their next delivery, 0356)
  const gv = await as(db, GV_CLIENT, `select count(*)::int n from public.business_orders where business_id is distinct from $1`, [GV_ACCT]);
  ok("3 · a client still sees no one else's orders", gv.rows[0]?.n === 0, gv);
  const op = await as(db, GV_OPERATOR, `select market from public.business_accounts`);
  ok("3 · a Greenville operator still cannot read Atlanta's accounts (0291 stands for staff)",
    op.rows.length === 1 && op.rows[0].market === "greenville", op);
  const opOrders = await as(db, GV_OPERATOR, `select count(*)::int n from public.business_orders where market = 'atlanta'`);
  ok("3 · …or its orders", opOrders.rows[0]?.n === 0, opOrders);
  const own = await as(db, OWNER, `select count(*)::int n from public.business_accounts`);
  ok("3 · an owner reads both cities", own.rows[0]?.n === 2, own);
}

// ── 4 · one price: the weekly run bills what /office quotes ──
{
  await db.query(`update public.live_status set office_price_cents = 5200 where id = 1`);
  await db.query(`update public.markets set office_price_cents = 4500 where slug in ('greenville', 'atlanta')`);
  const made = await as(db, OWNER, `select public.generate_office_route('2031-03-03') n`);
  ok("4 · the weekly run makes the standing orders", made.rows[0]?.n === 2, made);
  const prices = (await db.query(`select distinct price_per_gallon_cents p from public.business_orders where delivery_date = '2031-03-03'`)).rows.map((r) => r.p);
  ok("4 · priced from Settings (52.00), not the per-city copy (45.00)", prices.length === 1 && prices[0] === 5200, prices);
  const again = await as(db, OWNER, `select public.generate_office_route('2031-03-03') n`);
  ok("4 · a second run adds nothing", again.rows[0]?.n === 0, again);
  const notStaff = await as(db, GV_CLIENT, `select public.generate_office_route('2031-03-10') n`);
  ok("4 · a client cannot run it", notStaff.error !== null, notStaff);
}

// ── 5 · an account that loses its person stops its weekly order ──
{
  await db.query(`update public.business_accounts set user_id = null where id = $1`, [GV_ACCT]);
  const row = await val(db, `select standing_active, company from public.business_accounts where id = $1`, [GV_ACCT]);
  ok("5 · the weekly order switches off when the account loses its person", row.standing_active === false, row);
  ok("5 · …the company's record stays", row.company === "Gwen Co", row);
  const alert = await val(db, `select count(*)::int n, max(category) c from public.alerts where kind = 'office_standing_orphaned' and subject_id = $1`, [GV_ACCT]);
  ok("5 · …and the crew is told, once", alert.n === 1 && alert.c === "order", alert);
  const made = await as(db, OWNER, `select public.generate_office_route('2031-03-10') n`);
  ok("5 · the next weekly run makes nothing for it", made.rows[0]?.n === 1, made);
  // By any path — a staff member's own edit too, run as PostgREST runs them (role authenticated). The
  // trigger function is closed to callers, and Postgres asks no EXECUTE of a trigger when it fires.
  const byStaff = await as(db, OWNER, `update public.business_accounts set user_id = null where id = $1 returning standing_active`, [ATL_ACCT]);
  ok("5 · …by any path: a staff member's edit stops it too", byStaff.error === null && byStaff.rows[0]?.standing_active === false, byStaff);
  const atlAlert = await val(db, `select count(*)::int n from public.alerts where kind = 'office_standing_orphaned' and subject_id = $1`, [ATL_ACCT]);
  ok("5 · …and the crew is told once for that one too", atlAlert.n === 1, atlAlert);
}

// ── 6 · a minimum under 3 cannot be saved ──
{
  // As the table's owner: the check holds whoever writes (Settings writes it as an admin, 0003).
  let low = null;
  try { await db.query(`update public.live_status set office_min_gallons = 2 where id = 1`); } catch (e) { low = String(e.message || e); }
  ok("6 · Settings cannot save a minimum under 3 gallons", low !== null && /live_status_office_min_ok/.test(low), low);
}

await db.close();
console.log(`db.officeaccess: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
