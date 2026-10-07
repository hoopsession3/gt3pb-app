// EVERY OFFICE ORDER BELONGS TO A COMPANY — 0355, against the whole schema (every migration, applied
// in order: scripts/fixtures/schema.full.mjs), with the office data production can hold, then pasted.
//
// Phase 1, part 1 of the B2B challenge report (2026-10-07). The gate the report set for this part:
// the backfill's counts and sums match today's exactly, and running it twice adds nothing. Proved here:
//   1. Accounts in = companies from accounts out; each has its location, its person as admin, and a
//      program exactly when it has a weekly order (active or paused, as the account says).
//   2. Every office order, invoice and jug entry has a company and a location — one-off orders that
//      belonged to no one included: the same person's company of the same name, at the same street.
//   3. Order totals, invoice amounts, jug balances and report_sales are the same before and after,
//      and a second paste creates nothing and moves nothing.
//   4. After it, every write keeps the records in step: a booking, a pause, a new gallons figure, a
//      new door, a one-off, the weekly run, an invoice, a person deleting their account.
//   5. A client reads their own company and nothing else; the crew read by city; nobody writes the
//      new records from the app; a company is never hard-deleted.
import { readFileSync } from "node:fs";
import { fullSchema } from "./fixtures/schema.full.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const u = (n) => `5b1e0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OWNER = u(1), GV_CLIENT = u(2), ATL_CLIENT = u(3), PIA = u(4), OLU = u(5), STRANGER = u(6), GV_OPERATOR = u(7), NORA = u(8), ERASE_ME = u(9);
const GV_ACCT = u(101), ATL_ACCT = u(102), PIA_ACCT = u(103), ORLA_ACCT = u(104), NORA_ACCT = u(105), ERASE_ACCT = u(106);
const O = (n) => u(200 + n);
const FILE = readFileSync(new URL("../supabase/migrations/0355_every_office_order_belongs_to_a_company.sql", import.meta.url), "utf8");

async function as(db, uid, sql, params) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  try { return { rows: (await db.query(sql, params)).rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e) }; }
  finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const val = async (db, sql, params) => (await db.query(sql, params)).rows[0];
const n = async (db, sql, params) => Number((await val(db, sql, params)).n);

// What production can hold before 0355: weekly accounts (on, paused, orphaned by an erasure, never
// weekly), an Atlanta account with its own window, one-off orders with no account (the same client
// twice at one door and once at another; a client of an account booking one-off at the account's door
// and at a second door; one whose person is gone), invoices both ways, a jug entry, a wired deal.
async function stage(db) {
  const q = (sql, p) => db.query(sql, p);
  for (const [id, email] of [[OWNER, "owner@example.test"], [GV_CLIENT, "gwen@example.test"], [ATL_CLIENT, "ade@example.test"], [PIA, "pia@example.test"],
    [OLU, "olu@example.test"], [STRANGER, "stranger@example.test"], [GV_OPERATOR, "op@example.test"], [NORA, "nora@example.test"], [ERASE_ME, "eve@example.test"]]) {
    await q(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
  }
  for (const [id, role] of [[OWNER, "owner"], [GV_CLIENT, "member"], [ATL_CLIENT, "member"], [PIA, "member"], [OLU, "member"], [STRANGER, "member"],
    [GV_OPERATOR, "operator"], [NORA, "member"], [ERASE_ME, "member"]]) {
    await q(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, T1]);
  }
  const acct = (id, user, company, market, terms, active, gallons, street, zip, extra = "") => q(
    `insert into public.business_accounts (id, user_id, company, contact_name, contact_phone, contact_email, address_street, address_city, address_zip,
       billing_terms, standing_active, standing_gallons, market, tenant_id${extra ? ", preferred_window" : ""})
     values ($1, $2, $3, 'Contact', '864-555-0100', null, $4, 'City', $5, $6, $7, $8, $9, '${T1}'${extra ? `, '${extra}'` : ""})`,
    [id, user, company, street, zip, terms, active, gallons, market]);
  await acct(GV_ACCT, GV_CLIENT, "Gwen Co", "greenville", "prepaid", true, 4, "1 Main St", "29601");
  await acct(ATL_ACCT, ATL_CLIENT, "Ade Co", "atlanta", "net15", true, 5, "9 Peach St", "30303", "mon_0600_0900");
  await acct(PIA_ACCT, PIA, "Pia Co", "greenville", "prepaid", false, 3, "5 Elm St", "29605");
  await acct(ORLA_ACCT, null, "Orla Co", "greenville", "net30", false, 6, "7 Oak St", "29607");
  await acct(NORA_ACCT, NORA, "Nora Co", "greenville", "prepaid", false, null, "3 Ash St", "29603");
  await acct(ERASE_ACCT, ERASE_ME, "Eve Co", "greenville", "prepaid", true, 4, "8 Fir St", "29608");

  const order = (id, biz, user, company, street, zip, date, total, extra = {}) => q(
    `insert into public.business_orders (id, business_id, user_id, company, contact_name, contact_phone, address_street, address_city, address_zip,
       delivery_date, delivery_window, gallons, price_per_gallon_cents, subtotal_cents, delivery_fee_cents, tax_cents, total_cents,
       billing_terms, payment_status, status, standing, market, tenant_id, canceled_at)
     values ($1, $2, $3, $4, 'Contact', '864-555-0100', $5, 'City', $6, $7, 'mon_0500_0800', $8, 4500, $9, 0, 0, $9,
       $10, $11, $12, $13, $14, '${T1}', $15)`,
    [id, biz, user, company, street, zip, date, extra.gallons ?? 4, total, extra.terms ?? "prepaid", extra.pay ?? "pending",
      extra.status ?? "received", extra.standing ?? false, extra.market ?? "greenville", extra.canceled ?? null]);
  await order(O(1), GV_ACCT, GV_CLIENT, "Gwen Co", "1 Main St", "29601", "2026-09-28", 18000, { standing: true, pay: "paid", status: "delivered" });
  await order(O(2), GV_ACCT, GV_CLIENT, "Gwen Co", "1 Main St", "29601", "2026-10-05", 18000, { standing: true });
  await order(O(3), ATL_ACCT, ATL_CLIENT, "Ade Co", "9 Peach St", "30303", "2026-10-05", 22500, { standing: true, gallons: 5, terms: "net15", pay: "invoiced", market: "atlanta" });
  await order(O(4), null, OLU, "Olu Co", "4 Pine St", "29604", "2026-09-21", 13500, { gallons: 3 });
  await order(O(5), null, OLU, "  olu co ", "4 PINE ST", "29604", "2026-09-28", 13500, { gallons: 3 });   // same client, same door
  await order(O(6), null, OLU, "Olu Co", "12 Birch Rd", "29612", "2026-10-05", 13500, { gallons: 3 });  // same client, a second door
  await order(O(7), null, GV_CLIENT, "Gwen Co", "1 Main St", "29601", "2026-10-07", 13500, { gallons: 3 });   // one-off at the account's door
  await order(O(8), null, GV_CLIENT, "Gwen Co", "200 Annex Way", "29609", "2026-10-08", 13500, { gallons: 3 }); // one-off at a second door
  await order(O(9), null, null, "Zed Co", "6 Gone Ln", "29606", "2026-09-14", 13500, { gallons: 3, pay: "paid", status: "delivered" });
  await order(O(10), GV_ACCT, GV_CLIENT, "Gwen Co", "1 Main St", "29601", "2026-09-21", 18000, { standing: true, canceled: "2026-09-19T12:00:00Z" });

  await q(`insert into public.invoices (business_id, business_order_id, amount_cents, terms, status, tenant_id) values ($1, $2, 22500, 'net15', 'open', '${T1}')`, [ATL_ACCT, O(3)]);
  await q(`insert into public.invoices (business_id, business_order_id, amount_cents, terms, status, tenant_id) values (null, $1, 13500, 'net15', 'open', '${T1}')`, [O(6)]);
  await q(`insert into public.jug_ledger (business_id, business_order_id, jugs_out, jugs_in, balance_after, tenant_id) values ($1, $2, 4, 0, 4, '${T1}')`, [GV_ACCT, O(1)]);
  await q(`update public.business_accounts set jug_balance = 4 where id = $1`, [GV_ACCT]);
  await q(`insert into public.vendors (id, name) values ($1, 'Gwen Co (prospect)'), ($2, 'Unwired prospect')`, [u(401), u(402)]);
  await q(`insert into public.opportunities (id, vendor_id, stage, tenant_id, business_account_id) values ($1, $2, 'live', '${T1}', $3)`, [u(301), u(401), GV_ACCT]);
  await q(`insert into public.opportunities (id, vendor_id, stage, tenant_id) values ($1, $2, 'lead', '${T1}')`, [u(302), u(402)]);
}

const sums = async (db) => ({
  orders: await n(db, `select count(*) n from public.business_orders`),
  orderTotal: await n(db, `select coalesce(sum(total_cents), 0) n from public.business_orders`),
  invoiceTotal: await n(db, `select coalesce(sum(amount_cents), 0) n from public.invoices`),
  openInvoices: await n(db, `select count(*) n from public.invoices where status in ('open', 'sent')`),
  jugs: await n(db, `select coalesce(sum(jug_balance), 0) n from public.business_accounts`),
  jugLedger: await n(db, `select coalesce(sum(jugs_out - jugs_in), 0) n from public.jug_ledger`),
  accounts: await n(db, `select count(*) n from public.business_accounts`),
});
const spineCounts = async (db) => ({
  companies: await n(db, `select count(*) n from public.companies`),
  locations: await n(db, `select count(*) n from public.company_locations`),
  members: await n(db, `select count(*) n from public.company_members`),
  programs: await n(db, `select count(*) n from public.company_programs`),
  lines: await n(db, `select count(*) n from public.company_program_lines`),
});

const db = await fullSchema({ before: "0355" });
await stage(db);
const before = await sums(db);
const salesBefore = (await as(db, OWNER, `select public.report_sales(60) r`)).rows[0]?.r;

let applied = null;
try { await db.exec(FILE); } catch (e) { applied = String(e.message || e); }
ok("0355 applies over the office data production can hold", applied === null, applied);

// ── 1 · accounts in = companies out ──
{
  const accts = (await db.query(`select id, company_id, location_id, program_id, standing_gallons, standing_active from public.business_accounts order by id`)).rows;
  ok("1 · every account has a company and a location", accts.every((a) => a.company_id && a.location_id), accts);
  ok("1 · accounts in = companies from accounts out (one each, never merged)", new Set(accts.map((a) => a.company_id)).size === accts.length);
  ok("1 · a program exactly when the account has a weekly order", accts.every((a) => (a.standing_gallons !== null) === (a.program_id !== null)), accts);
  const prog = async (acct) => val(db, `select p.status, l.quantity::float q, p.market, p.location_id = a.location_id same_loc
                                          from public.business_accounts a join public.company_programs p on p.id = a.program_id
                                          join public.company_program_lines l on l.program_id = p.id where a.id = $1`, [acct]);
  ok("1 · a weekly order that is on is an active program, with its gallons as its one line", JSON.stringify(await prog(GV_ACCT)) === JSON.stringify({ status: "active", q: 4, market: "greenville", same_loc: true }), await prog(GV_ACCT));
  ok("1 · a paused one is a paused program", (await prog(PIA_ACCT))?.status === "paused");
  ok("1 · …and one an erasure switched off is paused, not lost", (await prog(ORLA_ACCT))?.status === "paused" && (await prog(ORLA_ACCT))?.q === 6);
  const status = async (acct) => (await val(db, `select c.status, c.market, c.billing_terms, c.name from public.business_accounts a join public.companies c on c.id = a.company_id where a.id = $1`, [acct]));
  ok("1 · the company reads as the account: live, paused, its city and terms", (await status(GV_ACCT)).status === "live" && (await status(PIA_ACCT)).status === "paused"
    && (await status(NORA_ACCT)).status === "live" && (await status(ATL_ACCT)).market === "atlanta" && (await status(ORLA_ACCT)).billing_terms === "net30");
  const loc = async (acct) => val(db, `select l.* from public.business_accounts a join public.company_locations l on l.id = a.location_id where a.id = $1`, [acct]);
  ok("1 · the location carries the door: address, market", (await loc(ATL_ACCT)).address_street === "9 Peach St" && (await loc(ATL_ACCT)).market === "atlanta");
  ok("1 · a window someone set is kept; the column's default is not mistaken for a choice", (await loc(ATL_ACCT)).delivery_window === "mon_0600_0900" && (await loc(GV_ACCT)).delivery_window === null);
  const members = (await db.query(`select m.user_id, m.role, m.active, a.id acct from public.business_accounts a join public.company_members m on m.company_id = a.company_id order by a.id`)).rows;
  ok("1 · the account's person is the company's admin", members.some((m) => m.acct === GV_ACCT && m.user_id === GV_CLIENT && m.role === "admin" && m.active));
  ok("1 · an account with no person has no member", !members.some((m) => m.acct === ORLA_ACCT));
}

// ── 2 · every order, invoice and jug entry has a company ──
{
  ok("2 · every office order has a company and a location", await n(db, `select count(*) n from public.business_orders where company_id is null or location_id is null`) === 0);
  const o = async (id) => val(db, `select company_id, location_id, program_id from public.business_orders where id = $1`, [id]);
  const gv = await val(db, `select company_id, location_id, program_id from public.business_accounts where id = $1`, [GV_ACCT]);
  ok("2 · a weekly order joins its account's company, location and program", JSON.stringify(await o(O(1))) === JSON.stringify(gv) && (await o(O(10))).program_id === gv.program_id);
  ok("2 · a one-off at the account's door joins the account's company and location", (await o(O(7))).company_id === gv.company_id && (await o(O(7))).location_id === gv.location_id && (await o(O(7))).program_id === null);
  ok("2 · a one-off at another door: the same company, a second location", (await o(O(8))).company_id === gv.company_id && (await o(O(8))).location_id !== gv.location_id);
  ok("2 · the same one-off client twice at one door: one company, one location (name and street compared as people write them)",
    (await o(O(4))).company_id === (await o(O(5))).company_id && (await o(O(4))).location_id === (await o(O(5))).location_id);
  ok("2 · …and at a second door: the same company, a second location", (await o(O(6))).company_id === (await o(O(4))).company_id && (await o(O(6))).location_id !== (await o(O(4))).location_id);
  const zed = await val(db, `select c.name, c.status from public.business_orders o join public.companies c on c.id = o.company_id where o.id = $1`, [O(9)]);
  ok("2 · a one-off whose person is gone starts its own company from the order", zed?.name === "Zed Co" && zed?.status === "live", zed);
  ok("2 · Olu's three one-offs are one company with two locations", await n(db, `select count(distinct company_id) n from public.business_orders where user_id = $1`, [OLU]) === 1
    && await n(db, `select count(distinct location_id) n from public.business_orders where user_id = $1`, [OLU]) === 2);
  ok("2 · every invoice has its order's company", await n(db, `select count(*) n from public.invoices i join public.business_orders o on o.id = i.business_order_id
                                                         where i.company_id is distinct from o.company_id or i.location_id is distinct from o.location_id`) === 0
    && await n(db, `select count(*) n from public.invoices where company_id is null`) === 0);
  ok("2 · every jug entry has its company and location", await n(db, `select count(*) n from public.jug_ledger where company_id is null or location_id is null`) === 0);
  ok("2 · a deal wired to an account belongs to its company; an unwired one is left alone",
    (await val(db, `select company_id from public.opportunities where id = $1`, [u(301)])).company_id === gv.company_id
    && (await val(db, `select company_id from public.opportunities where id = $1`, [u(302)])).company_id === null);
}

// ── 3 · the same numbers, and a second paste is a no-op ──
{
  const after = await sums(db);
  ok("3 · order count and totals, invoice amounts, open invoices, jug balances and the jug ledger are exactly as before", JSON.stringify(after) === JSON.stringify(before), { before, after });
  const salesAfter = (await as(db, OWNER, `select public.report_sales(60) r`)).rows[0]?.r;
  ok("3 · report_sales is identical before and after", salesBefore !== undefined && JSON.stringify(salesAfter) === JSON.stringify(salesBefore), { salesBefore, salesAfter });
  const spine1 = await spineCounts(db);
  const links1 = (await db.query(`select id, company_id, location_id, program_id from public.business_orders order by id`)).rows;
  let again = null;
  try { await db.exec(FILE); } catch (e) { again = String(e.message || e); }
  ok("3 · a second paste runs cleanly", again === null, again);
  ok("3 · …and creates nothing", JSON.stringify(await spineCounts(db)) === JSON.stringify(spine1), { spine1, now: await spineCounts(db) });
  ok("3 · …and moves no link", JSON.stringify((await db.query(`select id, company_id, location_id, program_id from public.business_orders order by id`)).rows) === JSON.stringify(links1));
}

// ── 4 · every write keeps the records in step ──
{
  // a new weekly booking, the way /api/office writes it (service role)
  const NEW_ACCT = u(110);
  await db.query(`insert into public.business_accounts (id, user_id, company, contact_name, contact_phone, contact_email, address_street, address_city, address_zip,
                    billing_terms, standing_active, standing_gallons, market, tenant_id)
                  values ($1, $2, 'Stan Co', 'Stan', '864-555-0111', 'stan@example.test', '11 New St', 'Greenville', '29611', 'prepaid', true, 3, 'greenville', '${T1}')`, [NEW_ACCT, STRANGER]);
  await db.query(`insert into public.business_orders (business_id, user_id, company, contact_name, contact_phone, address_street, address_city, address_zip,
                    delivery_date, gallons, subtotal_cents, total_cents, standing, market, tenant_id)
                  values ($1, $2, 'Stan Co', 'Stan', '864-555-0111', '11 New St', 'Greenville', '29611', '2026-10-12', 3, 13500, 13500, true, 'greenville', '${T1}')`, [NEW_ACCT, STRANGER]);
  const na = await val(db, `select a.company_id, a.location_id, a.program_id, (select count(*) from public.company_members m where m.company_id = a.company_id and m.user_id = $2 and m.active) members
                              from public.business_accounts a where a.id = $1`, [NEW_ACCT, STRANGER]);
  ok("4 · a new weekly booking arrives with its company, location, admin and program", na.company_id && na.location_id && na.program_id && Number(na.members) === 1, na);
  const no = await val(db, `select company_id, location_id, program_id from public.business_orders where business_id = $1`, [NEW_ACCT]);
  ok("4 · …and its first order with all three", no.company_id === na.company_id && no.location_id === na.location_id && no.program_id === na.program_id, no);

  // the client pauses and changes gallons through 0354's door
  const pause = await as(db, GV_CLIENT, `select standing_active from public.set_office_standing($1, false, null)`, [GV_ACCT]);
  const gvp = async () => val(db, `select p.status, c.status cstatus, l.quantity::float q from public.business_accounts a join public.company_programs p on p.id = a.program_id
                                     join public.companies c on c.id = a.company_id join public.company_program_lines l on l.program_id = p.id where a.id = $1`, [GV_ACCT]);
  ok("4 · a client's pause pauses the program and the company", pause.error === null && (await gvp()).status === "paused" && (await gvp()).cstatus === "paused", { pause, now: await gvp() });
  await as(db, GV_CLIENT, `select 1 from public.set_office_standing($1, true, 6)`, [GV_ACCT]);
  ok("4 · …resume with 6 gallons: active, live, and the line says 6", JSON.stringify(await gvp()) === JSON.stringify({ status: "active", cstatus: "live", q: 6 }), await gvp());

  // the crew's jug count changes no company record
  const stamp = async () => (await val(db, `select c.updated_at, l.updated_at lu from public.business_accounts a join public.companies c on c.id = a.company_id
                                             join public.company_locations l on l.id = a.location_id where a.id = $1`, [GV_ACCT]));
  const s1 = await stamp();
  const jug = await as(db, OWNER, `update public.business_accounts set jug_balance = 7 where id = $1 returning jug_balance`, [GV_ACCT]);
  ok("4 · the crew's jug count still saves, and touches no company record", jug.rows[0]?.jug_balance === 7 && JSON.stringify(await stamp()) === JSON.stringify(s1), jug);

  // a new door, by the crew
  await as(db, OWNER, `update public.business_accounts set address_street = '2 Main St', access_instructions = 'Side door' where id = $1`, [GV_ACCT]);
  const l = await val(db, `select l.address_street, l.access_instructions from public.business_accounts a join public.company_locations l on l.id = a.location_id where a.id = $1`, [GV_ACCT]);
  ok("4 · a changed address and door note reach the location", l.address_street === "2 Main St" && l.access_instructions === "Side door", l);

  // a one-off for someone new, and again
  const oneOff = (id, street) => db.query(`insert into public.business_orders (id, user_id, company, contact_name, contact_phone, address_street, address_city, address_zip,
                    delivery_date, gallons, subtotal_cents, total_cents, market, tenant_id)
                  values ($1, $2, 'Nell Co', 'Nell', '864-555-0122', $3, 'Greenville', '29622', '2026-10-12', 3, 13500, 13500, 'greenville', '${T1}')`, [id, NORA, street]);
  await oneOff(O(20), "22 Hill St"); await oneOff(O(21), "22 Hill St");
  const nell = (await db.query(`select company_id, location_id from public.business_orders where id in ($1, $2)`, [O(20), O(21)])).rows;
  ok("4 · a one-off for a new company starts one; the next one joins it", nell.length === 2 && nell[0].company_id && nell[0].company_id === nell[1].company_id && nell[0].location_id === nell[1].location_id, nell);

  // the weekly run (0354's, unchanged here) gives its orders their program
  const made = await as(db, OWNER, `select public.generate_office_route('2026-10-19') n`);
  const gen = (await db.query(`select o.program_id = a.program_id same from public.business_orders o join public.business_accounts a on a.id = o.business_id where o.delivery_date = '2026-10-19'`)).rows;
  ok("4 · the weekly run's orders carry their account's program", made.error === null && gen.length > 0 && gen.every((r) => r.same), { made, gen });

  // the crew invoices an order: the invoice takes the order's company
  // as the table's owner: the fixture has no app grant on invoices (production's crew insert is
  // covered by "invoice staff"); what is under test is the trigger, which runs for any writer
  const inv = await db.query(`insert into public.invoices (business_id, business_order_id, amount_cents, terms, status, tenant_id) values ($1, $2, 13500, 'net15', 'open', '${T1}') returning company_id, location_id`,
    [NEW_ACCT, (await val(db, `select id from public.business_orders where business_id = $1 limit 1`, [NEW_ACCT])).id]).then((r) => ({ rows: r.rows, error: null }), (e) => ({ rows: [], error: String(e.message || e) }));
  ok("4 · a new invoice carries its order's company and location", inv.error === null && inv.rows[0]?.company_id === na.company_id && inv.rows[0]?.location_id === na.location_id, inv);

  // a person deletes their GT3 account: the record stays, the role goes, the weekly order stops
  let erased = null;
  try { await db.query(`delete from auth.users where id = $1`, [ERASE_ME]); } catch (e) { erased = String(e.message || e); }
  const eve = await val(db, `select a.user_id, p.status, (select count(*) from public.company_members m where m.company_id = a.company_id and m.active) active_members,
                                    (select count(*) from public.company_members m where m.company_id = a.company_id) members
                               from public.business_accounts a join public.company_programs p on p.id = a.program_id where a.id = $1`, [ERASE_ACCT]);
  ok("4 · deleting a person's account still works with a company role to let go of", erased === null, erased);
  ok("4 · …the company keeps the record that someone held the role, inactive; the program pauses",
    eve.user_id === null && Number(eve.active_members) === 0 && Number(eve.members) === 1 && eve.status === "paused", eve);
}

// ── 5 · who reads, and that nobody writes ──
{
  const companiesSeen = async (uid) => (await as(db, uid, `select name from public.companies order by name`)).rows.map((r) => r.name);
  const gwen = await companiesSeen(GV_CLIENT);
  ok("5 · a client reads their own company, nobody else's", JSON.stringify(gwen) === JSON.stringify(["Gwen Co"]), gwen);
  ok("5 · …its locations, program, line and their own membership", (await as(db, GV_CLIENT, `select id from public.company_locations`)).rows.length === 2
    && (await as(db, GV_CLIENT, `select id from public.company_programs`)).rows.length === 1
    && (await as(db, GV_CLIENT, `select id from public.company_program_lines`)).rows.length === 1
    && (await as(db, GV_CLIENT, `select id from public.company_members`)).rows.length === 1);
  ok("5 · an Atlanta client reads their Atlanta company (the city filter is the crew's)", JSON.stringify(await companiesSeen(ATL_CLIENT)) === JSON.stringify(["Ade Co"]));
  const pia = (await as(db, PIA, `select c.name from public.companies c`)).rows.map((r) => r.name);
  ok("5 · a different client reads only theirs", JSON.stringify(pia) === JSON.stringify(["Pia Co"]), pia);
  const anon = await as(db, null, `select id from public.companies`);
  ok("5 · signed out: nothing at all", anon.error !== null && /permission denied/i.test(anon.error), anon);
  const op = await companiesSeen(GV_OPERATOR);
  ok("5 · a Greenville operator reads Greenville's companies and not Atlanta's", op.includes("Gwen Co") && !op.includes("Ade Co"), op);
  ok("5 · …nor Atlanta's locations or programs", (await as(db, GV_OPERATOR, `select id from public.company_locations where market = 'atlanta'`)).rows.length === 0
    && (await as(db, GV_OPERATOR, `select id from public.company_programs where market = 'atlanta'`)).rows.length === 0);
  ok("5 · the owner reads every city", (await companiesSeen(OWNER)).includes("Ade Co") && (await companiesSeen(OWNER)).includes("Gwen Co"));
  for (const [who, uid] of [["a client", GV_CLIENT], ["the owner", OWNER]]) {
    const w = await as(db, uid, `update public.companies set name = 'Renamed' returning id`);
    const i = await as(db, uid, `insert into public.company_programs (company_id, location_id) select company_id, id from public.company_locations limit 1 returning id`);
    ok(`5 · ${who} cannot write the new records from the app`, w.error !== null && i.error !== null, { w, i });
  }
  let del = null;
  try { await db.query(`delete from public.companies where name = 'Zed Co'`); } catch (e) { del = String(e.message || e); }
  ok("5 · a company is never hard-deleted", del !== null && /Hard deletes are blocked/.test(del), del);
}

await db.close();
console.log(`db.spine: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
