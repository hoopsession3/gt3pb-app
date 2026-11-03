// IMS8 · WHO MAY MOVE AN ORDER, AND WHO READS THE CUSTOMER BOOK (0473 + 0474, in Postgres, through the real doors).
// Ryan, 2026-11-03: "Verify business creation/join paths and test set_shop_order_status against another business,
// unauthenticated callers and every permitted role… Prepare narrowly scoped customer access for the actual order
// workflow. Use aggregate-only access for customer totals." Every person is made up.
import { fullSchema } from "./fixtures/schema.full.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → ${JSON.stringify(got)?.slice(0, 500)}` : "")); } };
const T1 = "00000000-0000-0000-0000-000000000001", T2 = "0c474000-0000-4000-8000-0000000000b2";
const ROLES = ["owner", "admin", "server", "operator", "event_manager", "contractor", "member"];
const STAFF = ROLES.filter((r) => r !== "member");   // is_staff: every role but member (0035)
const id = (t, i) => `0c474000-0000-4000-8000-000000${t}0${String(i).padStart(4, "0")}`;
const P1 = Object.fromEntries(ROLES.map((r, i) => [r, id(1, i)])), P2 = Object.fromEntries(ROLES.map((r, i) => [r, id(2, i)]));

const db = await fullSchema({});
const q = async (s, p) => (await db.query(s, p)).rows, q1 = async (s, p) => (await q(s, p))[0];
await db.exec(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;`);
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', '', false); select set_config('request.jwt.claims', '', false);`);
const as = async (who, sql, params) => {
  const role = who === "service" ? "service_role" : who ? "authenticated" : "anon";
  const sub = who && who !== "service" ? who : "";
  await db.exec(`select set_config('request.jwt.claim.sub', '${sub}', false); select set_config('request.jwt.claim.role', '${role}', false);
    select set_config('request.jwt.claims', '${JSON.stringify({ sub, role, aal: "aal1" })}', false); set role ${role};`);
  try { return { rows: (await db.query(sql, params)).rows, code: null }; } catch (e) { return { rows: [], code: e.code ?? "?", error: String(e.message) }; } finally { await root(); }
};

// ── making a business, joining one ───────────────────────────────────────────────────────────────────────────────────
const NEWBIE = id(9, 1);
await q(`insert into auth.users (id, email) values ($1, 'new@example.test')`, [NEWBIE]);
ok("a new account lands in the one business there is (the profile stamped with it)", (await q1(`select tenant_id from public.profiles where id = $1`, [NEWBIE])).tenant_id === T1);
ok("a session can't make a business (tenants: no insert rule)", !!(await as(NEWBIE, `insert into public.tenants (id, slug, name) values ($1, 'mine', 'Mine')`, [T2])).code);
const asRoot2 = await db.query(`insert into public.tenants (id, slug, name) values ($1, 'second', 'Second') returning id`, [T2]).then(() => null, (e) => e.message);
ok("…nor even the database owner without saying so (0305's guard: one business until R-002 closes)", /second tenant/i.test(asRoot2 ?? ""), asRoot2);
await db.exec(`begin; set local gt3.allow_second_tenant = 'on'; insert into public.tenants (id, slug, name) values ('${T2}', 'other-business', 'Other business') on conflict do nothing; commit;`);
ok("a session can't move itself to another business, or raise its own role (no column grant on tenant_id or role)",
  !!(await as(NEWBIE, `update public.profiles set tenant_id = $2 where id = $1`, [NEWBIE, T2])).code && !!(await as(NEWBIE, `update public.profiles set role = 'owner' where id = $1`, [NEWBIE])).code
  && (await q1(`select tenant_id, role from public.profiles where id = $1`, [NEWBIE])).role === "member");

for (const [t, P] of [[T1, P1], [T2, P2]]) for (const r of ROLES) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [P[r], `${r}-${t.slice(-2)}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3, is_admin = $4 where id = $1`, [P[r], r, t, r === "owner" || r === "admin"]);
}
const order = async (t) => (await q1(`insert into public.shop_orders (email, ship_name, total_cents, status, tenant_id) values ('buyer@example.test', 'Pat Buyer', 3200, 'paid', $1) returning id`, [t])).id;
const status = async (o) => (await q1(`select status from public.shop_orders where id = $1`, [o])).status;
const move = (who, o) => as(who, `select (public.set_shop_order_status($1, 'needs_fulfillment', 'checked')).status s`, [o]);

// ── set_shop_order_status: every role, both businesses, signed out ──────────────────────────────────────────────────
for (const r of STAFF) {
  const o = await order(T1);
  const res = await move(P1[r], o);
  ok(`set_shop_order_status — ${r} of this business: moves it`, res.rows[0]?.s === "needs_fulfillment", res);
}
{ const o = await order(T1); const res = await move(P1.member, o);
  ok("…a member: refused, unchanged", !!res.code && (await status(o)) === "paid", res); }
{ const o = await order(T1); const res = await move(null, o);
  ok("…signed out: refused (no grant), unchanged", res.code === "42501" && (await status(o)) === "paid", res); }
for (const r of ROLES) {
  const o = await order(T1);
  const res = await move(P2[r], o);
  const cancel = await as(P2[r], `select public.set_shop_order_status($1, 'refunded', 'from elsewhere', 100)`, [o]);
  ok(`…${r} of ANOTHER business: can't move or refund ours (0417 found by id alone)`, !!res.code && !!cancel.code && (await status(o)) === "paid"
    && (await q1(`select refund_amount_cents from public.shop_orders where id = $1`, [o])).refund_amount_cents === null, { res, cancel });
}
{ const o = await order(T2); const res = await move(P2.server, o);
  ok("…and the other business's crew still move their own", res.rows[0]?.s === "needs_fulfillment", res); }

// ── the rest of the order family: the same question ─────────────────────────────────────────────────────────────────
{
  const o = await order(T1);
  const x = await as(P2.owner, `select public.shop_apliiq_checked($1, 'AP-1')`, [o]);
  const own = await as(P1.server, `select (public.shop_apliiq_checked($1, null)).id`, [o]);
  ok("shop_apliiq_checked: another business refused (it already asked); ours answered", !!x.code && !own.code, { x, own });
  for (const [fn, args] of [["claim_shop_order_for_submit", `$1::uuid, '${T1}'::uuid, 120`], ["shop_order_stall_watchdog", "24"]]) {
    const r1 = await as(P1.owner, `select public.${fn}(${args})`, fn.startsWith("claim") ? [o] : []);
    const r2 = await as(null, `select public.${fn}(${args})`, fn.startsWith("claim") ? [o] : []);
    ok(`${fn}: the server's only — refused to a session and to the signed out (42501)`, r1.code === "42501" && r2.code === "42501", { r1, r2 });
  }
}

// ── the customer book (0474) and its count (0473) ───────────────────────────────────────────────────────────────────
const C1 = (await q1(`insert into public.customers (name, email, phone, tenant_id) values ('Pat Buyer', 'pat@example.test', '555-0100', $1) returning id`, [T1])).id;
await q(`insert into public.customers (name, email, tenant_id) values ('Theirs', 'theirs@example.test', $1)`, [T2]);
const O1 = (await q1(`insert into public.shop_orders (customer_id, email, ship_name, total_cents, status, tenant_id) values ($1, 'pat@example.test', 'P. Buyer (ship)', 3200, 'paid', $2) returning id`, [C1, T1])).id;
const nT1 = (await q1(`select count(*)::int n from public.customers where tenant_id = $1`, [T1])).n;
for (const r of ["owner", "admin"]) {
  const rows = (await as(P1[r], `select id, phone from public.customers`)).rows;
  ok(`customers — ${r}: the business's book, no other business's`, rows.length === nT1 && rows.some((x) => x.phone === "555-0100"), rows.length);
}
for (const r of ["server", "operator", "event_manager", "contractor"]) {
  const rows = (await as(P1[r], `select id from public.customers where id <> (select id from public.customers where user_id = $1 limit 1) or $1 is null`, [P1[r]])).rows;
  ok(`…${r}: no other customer's row (was every one, every column)`, rows.length === 0, rows.length);
}
ok("…a member: their own row only", (await as(P1.member, `select user_id from public.customers`)).rows.every((x) => x.user_id === P1.member));
ok("…signed out: nothing", (await as(null, `select id from public.customers`)).rows.length === 0);
const sv = await as(P1.server, `select who, email, ship_name from public.v_shop_orders where id = $1`, [O1]);
ok("the crew's order sheet still reads the order: who = the order's ship name (no customer row needed), its email", sv.rows[0]?.who === "P. Buyer (ship)" && sv.rows[0]?.email === "pat@example.test", sv);
const ov = await as(P1.owner, `select who from public.v_shop_orders where id = $1`, [O1]);
ok("…the owner's: the customer's own name", ov.rows[0]?.who === "Pat Buyer", ov);
const ct = async (who) => as(who, `select public.customers_total() n`);
ok("customers_total — crew get the count of this business's book, a number and nothing else", (await ct(P1.server)).rows[0]?.n === nT1 && Object.keys((await ct(P1.server)).rows[0]).length === 1);
ok("…the other business's crew get theirs", (await ct(P2.contractor)).rows[0]?.n === 1);
ok("…a member: no number (null)", (await ct(P1.member)).rows[0]?.n === null);
ok("…signed out: refused (no grant)", (await ct(null)).code === "42501");

console.log(`IMS8 WHO MOVES AN ORDER, WHO READS THE BOOK (0473 + 0474, in Postgres): ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
