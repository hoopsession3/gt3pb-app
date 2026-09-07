// A PAID ORDER NOBODY CAN SEE — 0313, executed from its file against a real Postgres.
//
// The fixture is copied from 0271's actual DDL rather than simplified, ESPECIALLY the status check
// constraint. That constraint is the reason this suite exists in the shape it does: a state machine
// written in plpgsql that emits a value the table refuses is a runtime error nobody sees until a
// customer's order is stuck, and a fixture without the constraint would pass it happily. A fixture
// that doesn't match production is a test that lies — the fifth time that sentence has earned its
// place in this directory.
//
// The assertion I care most about is §5: the print-on-demand webhook does a bare
//   update shop_orders set status = 'shipped'
// and if that can overwrite a refund, the record ends up saying an order you gave the money back
// for is on its way to the customer. That path does not go through the function, so testing the
// function would have proved nothing about it.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const T = "00000000-0000-0000-0000-000000000001";
const U1 = "00000000-0000-0000-0000-0000000000c1";
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const db = new PGlite();
const q1 = async (s) => (await db.query(s)).rows[0];
const raises = async (s) => { try { await db.exec(s); return null; } catch (e) { return String(e.message || e); } };

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  insert into auth.users (id, email) values ('${U1}', 'ryan@example.com');
  create role anon; create role authenticated;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(coalesce(current_setting('test.uid', true), ''), '')::uuid $$;
  create or replace function public.is_staff() returns boolean language sql stable as $$
    select coalesce(current_setting('test.staff', true), 'on') = 'on' $$;

  create table public.tenants (id uuid primary key default gen_random_uuid());
  insert into public.tenants (id) values ('${T}');
  create table public.changelog (id uuid primary key default gen_random_uuid(), title text,
    category text, area text, summary text, shipped_on date, highlight boolean default false);
  create table public.schema_migrations (version text primary key, seq int not null,
    applied_at timestamptz, recorded_at timestamptz not null default now(), applied_by uuid,
    applied_count int not null default 1, evidence text not null default 'stamped', note text);
  create or replace function public.record_migration(p_version text, p_note text default null)
  returns public.schema_migrations language plpgsql as $$
  declare r public.schema_migrations; begin
    insert into public.schema_migrations (version, seq, applied_at, note)
    values (p_version, substring(p_version from '^[0-9]+')::int, now(), p_note)
    on conflict (version) do update set applied_count = public.schema_migrations.applied_count + 1
    returning * into r; return r; end $$;

  -- 0042's audit spine, because 0313 attaches triggers to it
  create table public.audit_log (id bigint generated always as identity primary key, tenant_id uuid,
    table_name text not null, op text not null, row_id text, actor uuid,
    old_data jsonb, new_data jsonb, at timestamptz not null default now());
  create or replace function public.audit_row() returns trigger language plpgsql as $$
  declare rec jsonb; begin
    rec := to_jsonb(case when tg_op = 'DELETE' then old else new end);
    insert into public.audit_log(tenant_id, table_name, op, row_id, actor, old_data, new_data)
    values (nullif(rec->>'tenant_id','')::uuid, tg_table_name, tg_op, rec->>'id', auth.uid(),
      case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
      case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end);
    return null; end $$;

  create table public.customers (id uuid primary key default gen_random_uuid(),
    user_id uuid, name text, phone text, email text, tenant_id uuid);

  -- ── verbatim from 0271, constraint included ──────────────────────────────────────────────────
  create table public.shop_products (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) default '${T}',
    kind text not null default 'merch' check (kind in ('merch','program_tier')),
    apliiq_product_id text, title text not null, blurb text,
    price_cents int not null default 0 check (price_cents >= 0),
    cost_cents int check (cost_cents is null or cost_cents >= 0),
    image_url text, images jsonb not null default '[]'::jsonb,
    variants jsonb not null default '[]'::jsonb, program_tier text,
    published_at timestamptz, public_title text, sort int not null default 0,
    archived_at timestamptz, created_at timestamptz not null default now(),
    updated_at timestamptz not null default now());

  create table public.shop_orders (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) default '${T}',
    customer_id uuid references public.customers(id) on delete set null,
    user_id uuid references auth.users(id) on delete set null,
    email text, payment_id text,
    subtotal_cents int not null default 0, total_cents int not null default 0,
    ship_name text, ship_address jsonb,
    status text not null default 'paid'
      check (status in ('paid','needs_fulfillment','submitted','in_production','shipped','delivered','refunded','canceled')),
    apliiq_order_id text, benefit_code text, note text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now());

  create table public.shop_order_items (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.shop_orders(id) on delete cascade,
    product_id uuid references public.shop_products(id) on delete set null,
    title text not null, variant jsonb, qty int not null default 1 check (qty > 0),
    unit_cents int not null default 0, cost_cents int);

  create table public.merch_fulfillments (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.shop_orders(id) on delete cascade,
    carrier text, tracking_number text, tracking_url text,
    shipped_at timestamptz, created_at timestamptz not null default now());
`);

await db.exec(readFileSync(join(ROOT, "supabase/migrations/0313_a_paid_order_nobody_can_see.sql"), "utf8"));
console.log("0313 executed against a real Postgres.\n");
await db.exec(`select set_config('test.uid','${U1}',false)`);

const newOrder = async (extra = "", who = "'Nino Vance'") => (await db.query(
  `insert into public.shop_orders (customer_id, email, ship_name, ship_address, subtotal_cents, total_cents, status ${extra ? "," + extra.split("=")[0] : ""})
   values (null, 'nino@example.com', ${who}, '{"street":"1 Peachtree","city":"Atlanta","state":"GA","zip":"30301"}'::jsonb,
           4200, 4200, 'needs_fulfillment' ${extra ? "," + extra.split("=").slice(1).join("=") : ""})
   returning id`)).rows[0].id;

// ── 1) THE ORDER, WHOLE — the thing that did not exist ─────────────────────────────────────────
const cust = (await db.query(`insert into public.customers (name, email) values ('Nino Vance','nino@example.com') returning id`)).rows[0].id;
const prodA = (await db.query(`insert into public.shop_products (title, price_cents, cost_cents, apliiq_product_id, published_at)
  values ('Performance Tee', 3200, 1400, 'AP-1', now()) returning id`)).rows[0].id;
const prodB = (await db.query(`insert into public.shop_products (title, price_cents, cost_cents, published_at)
  values ('3 Cap', 1000, 500, now()) returning id`)).rows[0].id;

const o1 = await newOrder();
await db.exec(`update public.shop_orders set customer_id='${cust}' where id='${o1}'`);
await db.exec(`insert into public.shop_order_items (order_id, product_id, title, qty, unit_cents, cost_cents) values
  ('${o1}','${prodA}','Performance Tee',1,3200,1400), ('${o1}','${prodB}','3 Cap',1,1000,500)`);

const v1 = await q1(`select * from public.v_shop_orders where id='${o1}'`);
ok("an order finally has a row a screen can render", !!v1);
ok("with the customer's name on it", v1.who === "Nino Vance", v1.who);
ok("and what they actually bought, in one line", v1.items === "1x 3 Cap, 1x Performance Tee", v1.items);
ok("counting lines and units separately", Number(v1.item_count) === 2 && Number(v1.unit_count) === 2);
ok("and the margin, from the costs the catalog already carried (4200 − 1900)",
  Number(v1.margin_cents) === 2300, v1.margin_cents);
ok("it is waiting on us, not on the printer", v1.waiting_on_us === true && v1.waiting_on_printer === false);
ok("and it is not closed", v1.closed === false);

// who falls back through three names before it gives up
const o2 = await newOrder("", "'Walk-in Wendy'");
ok("no customer record → the shipping name",
  (await q1(`select who from public.v_shop_orders where id='${o2}'`)).who === "Walk-in Wendy");
await db.exec(`update public.shop_orders set ship_name = null where id='${o2}'`);
ok("no shipping name → the email, so the row is never anonymous",
  (await q1(`select who from public.v_shop_orders where id='${o2}'`)).who === "nino@example.com");
await db.exec(`update public.shop_orders set email = null where id='${o2}'`);
ok("and only then 'Guest'",
  (await q1(`select who from public.v_shop_orders where id='${o2}'`)).who === "Guest");

// ── 2) A MARGIN FROM AN UNKNOWN COST IS A WRONG NUMBER THAT LOOKS RIGHT ────────────────────────
const o3 = await newOrder();
await db.exec(`insert into public.shop_order_items (order_id, title, qty, unit_cents) values ('${o3}','Mystery Hoodie',1,4200)`);
const v3 = await q1(`select margin_cents, cost_cents, items from public.v_shop_orders where id='${o3}'`);
ok("no line carries a cost → margin is unknown, not 'all of it'", v3.margin_cents === null, v3.margin_cents);
ok("and the cost is unknown too, rather than zero", v3.cost_cents === null, v3.cost_cents);

// ── 3) THE FOUR STATUSES NOTHING COULD REACH ───────────────────────────────────────────────────
const walk = await newOrder();
await db.exec(`update public.shop_orders set status='paid' where id='${walk}'`);
for (const s of ["needs_fulfillment", "submitted", "in_production", "shipped", "delivered"]) {
  await db.exec(`select public.set_shop_order_status('${walk}', '${s}')`);
}
ok("an order can now walk its whole life — including in_production and delivered, which nothing could write",
  (await q1(`select status from public.shop_orders where id='${walk}'`)).status === "delivered");

const bad = await raises(`select public.set_shop_order_status('${o1}', 'delivered')`);
ok("and cannot skip to the end: needs_fulfillment does not go straight to delivered",
  /can go to:/i.test(bad || ""), bad);
ok("the refusal names the moves that ARE legal, rather than just saying no",
  /submitted/.test(bad || "") && /canceled/.test(bad || ""), bad);
ok("moving an order to where it already is is refused too",
  /already/i.test(await raises(`select public.set_shop_order_status('${o1}', 'needs_fulfillment')`) || ""));

// ── 4) THE TWO THAT COST A CUSTOMER SOMETHING ──────────────────────────────────────────────────
ok("a refund with no reason is refused",
  /Say why/i.test(await raises(`select public.set_shop_order_status('${o1}', 'refunded')`) || ""));
ok("so is a cancellation with no reason",
  /Say why/i.test(await raises(`select public.set_shop_order_status('${o1}', 'canceled', '   ')`) || ""));
ok("a refund larger than the order is refused",
  /between 1 cent/i.test(await raises(`select public.set_shop_order_status('${o1}', 'refunded', 'oops', 999999)`) || ""));
ok("and a zero refund, which records nothing while looking like something",
  /between 1 cent/i.test(await raises(`select public.set_shop_order_status('${o1}', 'refunded', 'oops', 0)`) || ""));

const canc = await newOrder();
await db.exec(`select public.set_shop_order_status('${canc}', 'canceled', 'printer discontinued the blank')`);
ok("cancelling records the reason", (await q1(`select status_note as n from public.shop_orders where id='${canc}'`)).n === "printer discontinued the blank");
ok("and who did it, and when — none of which a bare status write recorded",
  (await q1(`select status_changed_by as b, status_changed_at as a from public.shop_orders where id='${canc}'`)).b === U1);
// a cancelled order still holds somebody's money; it must not be a dead end
await db.exec(`select public.set_shop_order_status('${canc}', 'refunded', 'refunded in Square, ref 8814')`);
const cancRow = await q1(`select status, refund_amount_cents as r from public.shop_orders where id='${canc}'`);
ok("a cancelled order can still be refunded — every shop order was charged before it existed",
  cancRow.status === "refunded", cancRow.status);
ok("and the refund defaults to what was actually charged", Number(cancRow.r) === 4200, cancRow.r);
ok("refunded is the end of the line",
  /end of its life/i.test(await raises(`select public.set_shop_order_status('${canc}', 'shipped', 'x')`) || ""));

const part = await newOrder();
await db.exec(`select public.set_shop_order_status('${part}', 'refunded', 'shipped one of two', 1000)`);
ok("a partial refund records the amount that actually went back",
  Number((await q1(`select refund_amount_cents as r from public.shop_orders where id='${part}'`)).r) === 1000);
ok("and the table itself refuses a refund bigger than the charge, function or no function",
  /shop_orders_refund_sane|violates check/i.test(
    await raises(`update public.shop_orders set refund_amount_cents = 99999 where id='${part}'`) || ""));

// ── 5) THE ONE THAT DOES NOT GO THROUGH THE FUNCTION ───────────────────────────────────────────
// Exactly what app/api/apliiq/fulfillment/route.ts does, verbatim in shape: insert the tracking,
// then a bare update to 'shipped'. If that wins, the record says an order you refunded is on its way.
const late = await newOrder();
await db.exec(`select public.set_shop_order_status('${late}', 'refunded', 'customer changed their mind')`);
await db.exec(`insert into public.merch_fulfillments (order_id, carrier, tracking_number, tracking_url, shipped_at)
  values ('${late}', 'USPS', '9400111', 'https://tools.usps.com/x', now())`);
await db.exec(`update public.shop_orders set status = 'shipped', updated_at = now() where id='${late}'`);
const lateRow = await q1(`select status, note from public.shop_orders where id='${late}'`);
ok("a late shipping report cannot resurrect a refunded order", lateRow.status === "refunded", lateRow.status);
ok("but it is written down where a person will read it, rather than swallowed",
  /Printer reported "shipped"/.test(lateRow.note || "") && /already refunded/.test(lateRow.note || ""), lateRow.note);
const lateView = await q1(`select tracking_number as t, carrier as c, closed from public.v_shop_orders where id='${late}'`);
ok("and the tracking is kept, because it is real", lateView.t === "9400111" && lateView.c === "USPS");
ok("the order reads as closed", lateView.closed === true);
// the deliberate-correction hatch the house uses everywhere else still opens
await db.exec(`select set_config('gt3.allow_hard_delete','on',false)`);
await db.exec(`update public.shop_orders set status = 'shipped' where id='${late}'`);
ok("a deliberate correction can still override it, the same way every other guard here works",
  (await q1(`select status from public.shop_orders where id='${late}'`)).status === "shipped");
await db.exec(`select set_config('gt3.allow_hard_delete','off',false)`);

// ── 6) WHO IS ALLOWED TO ──────────────────────────────────────────────────────────────────────
await db.exec(`select set_config('test.staff','off',false)`);
ok("a customer cannot move their own order along",
  /Only crew/i.test(await raises(`select public.set_shop_order_status('${o1}', 'submitted')`) || ""));
await db.exec(`select set_config('test.staff','on',false)`);

// ── 7) THE NUMBER THE SCREEN LEADS WITH ────────────────────────────────────────────────────────
await db.exec(`update public.shop_orders set created_at = now() - interval '30 hours' where id='${o1}'`);
const qq = await q1(`select * from public.v_shop_queue`);
ok("the queue counts what is waiting on us", Number(qq.on_us) >= 1, qq.on_us);
ok("what is waiting on the printer", Number(qq.on_printer) >= 0);
ok("and how long the oldest unhandled order has been sitting — the number that matters at 9am",
  Number(qq.oldest_on_us_hours) >= 30, qq.oldest_on_us_hours);
ok("cancelled orders are left out of gross", Number(qq.gross_cents) > 0);
// 4200 (cancelled then refunded) + 1000 (partial) + 4200 (the late-webhook order) = 9400. The sum
// deliberately does NOT filter on status = 'refunded': a partial refund on an order that then ships
// is still money that went back, and a total that hides it is the kind of number you only find out
// is wrong at tax time.
ok("and refunds are totalled separately rather than netted silently", Number(qq.refunded_cents) === 9400, qq.refunded_cents);

// ── 8) ITEMS, AND THE CATALOG MOVING UNDERNEATH THEM ──────────────────────────────────────────
await db.exec(`update public.shop_products set archived_at = now() where id='${prodB}'`);
const items = (await db.query(`select title, line_cents, line_cost_cents, product_archived, product_unlinked
  from public.v_shop_order_items where order_id='${o1}' order by title`)).rows;
ok("an order's lines carry their own totals", Number(items[1].line_cents) === 3200);
ok("a product archived after the sale is flagged, not hidden", items[0].product_archived === true);
ok("and while it exists the line is still linked to it", items[0].product_unlinked === false);
// This is the assertion that corrected the view. I had written product_gone as "the id points at a
// product that isn't there" — which 0271's `on delete set null` makes impossible, so the column was
// permanently false. Deleting a real product rather than imagining one is what showed it.
await db.exec(`delete from public.shop_products where id='${prodB}'`);
ok("deleting the product unlinks the line rather than orphaning it",
  (await q1(`select product_unlinked as g from public.v_shop_order_items where order_id='${o1}' and title='3 Cap'`)).g === true);
ok("and the line still says what was bought and what it cost, which is why checkout copies both onto the order",
  Number((await q1(`select line_cents as c from public.v_shop_order_items where order_id='${o1}' and title='3 Cap'`)).c) === 1000);
ok("the order's own line summary is unaffected by the catalog moving",
  (await q1(`select items from public.v_shop_orders where id='${o1}'`)).items === "1x 3 Cap, 1x Performance Tee");

// ── 9) THE TRAIL ──────────────────────────────────────────────────────────────────────────────
const trail = await q1(`select count(*) as c from public.audit_log where table_name='shop_orders' and op='UPDATE'`);
ok("every status move is in the audit log, which a customer order table did not have until now",
  Number(trail.c) > 0, trail.c);
ok("the actor is recorded on it",
  (await q1(`select actor as a from public.audit_log where table_name='shop_orders' and op='UPDATE' order by id desc limit 1`)).a === U1);
ok("items and fulfillments are audited too",
  Number((await q1(`select count(distinct table_name) as c from public.audit_log where table_name in ('shop_order_items','merch_fulfillments')`)).c) === 2);

// ── 10) the shape 0312 now demands of every view ──────────────────────────────────────────────
const inv = (await db.query(`select c.relname, coalesce(array_to_string(c.reloptions,','),'') as opts
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='v' and c.relname like 'v_shop%' order by 1`)).rows;
ok("all three new views exist", inv.length === 3, inv.map((r) => r.relname));
ok("and every one of them honours the RLS on the tables underneath",
  inv.every((r) => /security_invoker=on/.test(r.opts)), inv.map((r) => r.opts));

// ── 11) ledger + changelog ────────────────────────────────────────────────────────────────────
ok("0313 recorded itself by filename",
  (await q1(`select version as v from public.schema_migrations where seq=313`)).v === "0313_a_paid_order_nobody_can_see");
ok("and said what changed, twice", Number((await q1(`select count(*) as c from public.changelog`)).c) === 2);

console.log(`\nA PAID ORDER NOBODY CAN SEE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
