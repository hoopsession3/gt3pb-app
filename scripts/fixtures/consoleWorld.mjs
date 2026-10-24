// THE CONSOLE'S WORLD (R49) — who is signed in, and what a busy week looks like, for scripts/smoke.console.mjs.
//
// Made-up people at made-up addresses (example.test), in a database that lives in the harness's own process. The
// owner is the account the phone check signs in as. The rows are chosen for what breaks a phone's layout: a long
// name, a long title in all capitals (the Apliiq names arrive that way), a price with cents, a list long enough to
// scroll, an empty field where a field usually is.
export const T1 = "00000000-0000-0000-0000-000000000001";
export const OWNER = { id: "0c449000-0000-4000-8000-0000000000a1", email: "owner@fixture.test", name: "Ryan Fixture" };

const PEOPLE = [
  ["0c449000-0000-4000-8000-0000000000b1", "maria@fixture.test", "Maria Delgado-Whitfield", "admin"],
  ["0c449000-0000-4000-8000-0000000000b2", "dev@fixture.test", "Dev Okafor", "operator"],
  ["0c449000-0000-4000-8000-0000000000b3", "sam@fixture.test", "Sam Lee", "server"],
  ["0c449000-0000-4000-8000-0000000000c1", "jordan@fixture.test", "Jordan Abernathy-Castellanos", "member"],
  ["0c449000-0000-4000-8000-0000000000c2", "kim@fixture.test", "Kim Ng", "member"],
  ["0c449000-0000-4000-8000-0000000000c3", "pat@fixture.test", "Pat Morales", "member"],
  ["0c449000-0000-4000-8000-0000000000c4", "alex@fixture.test", null, "member"],
];

async function tryq(db, sql, p) { try { return await db.query(sql, p); } catch (e) { return { rows: [], error: e.message }; } }

export async function seedConsoleWorld(db) {
  const notes = [];
  const run = async (what, sql, p) => { const r = await tryq(db, sql, p); if (r.error) notes.push(`${what}: ${r.error.slice(0, 140)}`); return r; };
  await run("owner", `insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at, last_sign_in_at) values ($1, $2, jsonb_build_object('full_name', $3::text), now(), now())`, [OWNER.id, OWNER.email, OWNER.name]);
  await run("owner profile", `update public.profiles set role = 'owner', tenant_id = $2, display_name = $3 where id = $1`, [OWNER.id, T1, OWNER.name]);
  for (const [id, email, name, role] of PEOPLE) {
    await run(`person ${email}`, `insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at, last_sign_in_at) values ($1, $2, jsonb_build_object('full_name', $3::text), now() - interval '30 days', now() - interval '2 days')`, [id, email, name]);
    await run(`profile ${email}`, `update public.profiles set role = $2, tenant_id = $3, display_name = $4 where id = $1`, [id, role, T1, name]);
  }
  // Merch the way Apliiq names it, and one with no photo and no price yet.
  const merch = [
    ["GT3 PERFORMANCE BAR HEAVYWEIGHT GARMENT-DYED HOODIE — VINTAGE BLACK", 6800, true],
    ["GT3 6-Panel Cap", 3200, true],
    ["Motion on Tap Long Sleeve", 4200, false],
    ["Untitled draft", 0, false],
  ];
  for (const [title, price, live] of merch) {
    await run(`merch ${title}`, `insert into public.shop_products (kind, title, price_cents, published_at, tenant_id) values ('merch', $1, $2, ${live ? "now()" : "null"}, $3)`, [title, price, T1]);
  }
  // Customers (the CRM): a long name, a name-less one, a VIP; the members' accounts linked.
  const cust = [];
  const custRows = [
    ["Jordan Abernathy-Castellanos", "jordan@fixture.test", "+18645550101", "0c449000-0000-4000-8000-0000000000c1", "founding"],
    ["Kim Ng", "kim@fixture.test", "+18645550102", "0c449000-0000-4000-8000-0000000000c2", "member"],
    ["Pat Morales", "pat@fixture.test", null, "0c449000-0000-4000-8000-0000000000c3", null],
    [null, "alex@fixture.test", null, "0c449000-0000-4000-8000-0000000000c4", null],
    ["Christopher-Alexander Montgomery III", "cam.iii.longaddress@fixture.test", "+18645550109", null, null],
  ];
  for (const [name, email, phone, uid, tier] of custRows) {
    // An account already has its customer row (made with the account); a walk-up is a new one.
    const had = uid ? await run(`customer ${email}`, `update public.customers set name = $1, email = $2, phone = $3, tenant_id = $5, tier = coalesce($6, 'guest') where user_id = $4 returning id`, [name, email, phone, uid, T1, tier]) : { rows: [] };
    const r = had.rows[0] ? had : await run(`customer ${email}`, `insert into public.customers (name, email, phone, user_id, tenant_id, tier) values ($1, $2, $3, $4, $5, coalesce($6, 'guest')) returning id`, [name, email, phone, uid, T1, tier]);
    if (r.rows[0]) cust.push(r.rows[0].id);
  }
  // Shop orders, one at each step, and one a customer is waiting on.
  for (const [i, [status, days, total]] of [["paid", 1, 3200], ["submitted", 3, 6800], ["shipped", 6, 7400], ["delivered", 12, 4200], ["refunded", 20, 3200]].entries()) {
    await run(`shop order ${status}`, `insert into public.shop_orders (tenant_id, customer_id, email, subtotal_cents, total_cents, ship_name, ship_address, status, created_at, apliiq_order_id) values ($1, $2, $3, $4, $4, $5, $6, $7, now() - make_interval(days => $8), case when $7 in ('submitted', 'shipped', 'delivered') then 'AQ-' || (10400 + $8)::text end)`,
      [T1, cust[i % cust.length] ?? null, custRows[i % custRows.length][1], total, custRows[i % custRows.length][0] ?? "Alex", JSON.stringify({ line1: "1200 Laurens Rd Apt 4B", city: "Greenville", state: "SC", postal_code: "29607" }), status, days]);
  }
  // GT3 Nutrition: two students, one given by hand, one bought.
  if (cust[0]) await run("course 1", `insert into public.program_access (tenant_id, customer_id, tier, source, note, granted_by) values ($1, $2, 'pro', 'comp', 'Founding member — thank you', $3)`, [T1, cust[0], OWNER.id]);
  if (cust[1]) await run("course 2", `insert into public.program_access (tenant_id, customer_id, tier, source) values ($1, $2, 'pro', 'purchase')`, [T1, cust[1]]);
  // Today's truck orders.
  for (const [i, [who, total, status]] of [["Kim", 1400, "new"], ["Jordan A.", 2800, "ready"], ["Walk-up", 1000, "done"]].entries()) {
    await run(`order ${who}`, `insert into public.orders (customer, items, total_cents, paid, status, tenant_id, created_at, payment_status) values ($1, $2, $3, true, $4, $5, now() - make_interval(mins => $6), 'paid')`,
      [who, ["RISE"], total, status, T1, 10 + i * 7]);
  }
  // A drop pickup and a delivery, days apart (R51: the order ledger is grouped by the day each was bought).
  await run("pickup", `insert into public.drop_orders (name, phone, size, glass, total_cents, paid, drop_date, tenant_id, customer_id, created_at) values ('Pat Morales', '+18645550103', 6, 'new', 3600, true, current_date + 1, $1, $2, now() - interval '2 days')`, [T1, cust[2] ?? null]);
  await run("delivery", `insert into public.delivery_orders (delivery_date, name, phone, address_street, address_city, address_zip, pack_size, rise_count, flow_count, bottle_subtotal_cents, delivery_fee_cents, total_cents, tenant_id, customer_id, created_at) values (current_date + 2, 'Kim Ng', '+18645550102', '1200 Laurens Rd Apt 4B', 'Greenville', '29607', 6, 3, 3, 3600, 500, 4100, $1, $2, now() - interval '4 days')`, [T1, cust[1] ?? null]);
  // Spend.
  for (const [cat, desc, cents, days] of [["supplies", "Cups, lids and sleeves — 1,000 count", 18450, 2], ["supplies", "Generator fuel", 6400, 5], ["ingredients", "Organic cold brew concentrate (Cleanest Cuppa) — 5 gal", 21000, 9]]) {
    await run(`expense ${desc}`, `insert into public.expenses (tenant_id, category, description, amount_cents, spent_on, created_by) values ($1, $2, $3, $4, current_date - $5::int, $6)`, [T1, cat, desc, cents, days, OWNER.id]);
  }
  return notes;
}
