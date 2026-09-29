// A PAID ORDER CAN STOP MOVING AND NOBODY HEARS — 0329, executed from its file against a real Postgres.
//
// The claim: an order this app says is waiting on US, that has not moved in a day, raises exactly one
// critical alert naming the customer — and keeps being exactly one while it stays stuck.
//
// The order that caused this was refused by Apliiq ("cannot be imported… will not be fulfilled") and
// the app never learned. It cannot learn: the rejection is an email to the account owner and there is
// no webhook. So the only honest signal available is the clock, and the only way that signal is worth
// having is if it does not turn into the flood 0327 just finished removing.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const T = "00000000-0000-0000-0000-000000000001";
const U1 = "11111111-1111-1111-1111-111111111111";
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const db = new PGlite();
const q1 = async (s) => (await db.query(s)).rows[0];
const rows = async (s) => (await db.query(s)).rows;

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  insert into auth.users (id, email) values ('${U1}', 'ryan@example.com');
  create role anon; create role authenticated; create role service_role;
  create publication supabase_realtime;
  create or replace function auth.uid() returns uuid language sql stable as $$ select '${U1}'::uuid $$;
  create or replace function public.is_staff() returns boolean language sql stable as $$ select true $$;
  create or replace function public.is_admin() returns boolean language sql stable as $$ select true $$;
  create schema if not exists cron;
  create or replace function cron.schedule(a text, b text, c text) returns bigint language sql as $$ select 1::bigint $$;
  create table public.profiles (id uuid primary key, role text default 'owner');
  create table public.tenants (id uuid primary key default gen_random_uuid());
  insert into public.tenants (id) values ('${T}');
  create table public.changelog (id uuid primary key default gen_random_uuid(), title text,
    category text, area text, summary text, shipped_on date, highlight boolean default false);
  create table public.schema_migrations (version text primary key, seq int not null,
    applied_at timestamptz default now(), note text, applied_count int default 1, evidence text);
  create or replace function public.record_migration(p_version text, p_note text default null)
    returns void language sql as $$
    insert into public.schema_migrations (version, seq, applied_at, note)
    values (p_version, coalesce(nullif(substring(p_version from '^[0-9]{4}'), '')::int, 0), now(), p_note)
    on conflict (version) do update set applied_count = public.schema_migrations.applied_count + 1 $$;
  create table public.audit_log (id bigint generated always as identity primary key, tenant_id uuid,
    table_name text, op text, row_id uuid, actor uuid, old_data jsonb, new_data jsonb,
    at timestamptz default now());
  create or replace function public.audit_row() returns trigger language plpgsql as $$
  begin
    insert into public.audit_log(tenant_id, table_name, op, row_id, actor, old_data, new_data)
    values (null, tg_table_name, tg_op, coalesce(new.id, old.id), auth.uid(),
      case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
      case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end);
    return null; end $$;

  create table public.customers (id uuid primary key default gen_random_uuid(),
    user_id uuid, name text, phone text, email text, tenant_id uuid);
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

// The real files, in the order production saw them. 0174 is what gives an alert `kind` and
// `subject_id` — the two columns this whole design turns on. 0327 adds occurrences/last_seen_at.
// 0328 is the view that owns "who is waiting", which 0329 reads instead of re-deriving.
for (const f of [
  "0050_alerts.sql",
  "0174_actionable_alerts.sql",
  "0313_a_paid_order_nobody_can_see.sql",
  "0327_an_alert_that_cries_wolf.sql",
  "0328_who_is_waiting_had_two_answers.sql",
  "0329_a_paid_order_can_stop_moving_and_nobody_hears.sql",
]) await db.exec(readFileSync(join(ROOT, "supabase/migrations", f), "utf8"));

const mkOrder = async (status, hoursAgo, who, cents) => {
  const c = (await q1(`insert into public.customers (name, tenant_id) values ('${who}', '${T}') returning id`)).id;
  const o = (await q1(`
    insert into public.shop_orders (tenant_id, customer_id, status, total_cents, created_at, updated_at)
    values ('${T}', '${c}', '${status}', ${cents}, now() - interval '${hoursAgo} hours', now())
    returning id`)).id;
  await db.exec(`insert into public.shop_order_items (order_id, title, qty, unit_cents)
                 values ('${o}', 'GT3 6-Panel Cap', 1, ${cents})`);
  return o;
};
const run = async (h = 24) => (await q1(`select public.shop_order_stall_watchdog(${h}) as n`)).n;
const alerts = async () => rows(`select id, title, body, severity, occurrences, last_seen_at, subject_id, ack_at
                                   from public.alerts where kind = 'shop_order_stalled' order by created_at`);

// ── a fresh order is not a problem ─────────────────────────────────────────────────────────────
{
  await mkOrder("paid", 1, "Fresh Freddy", 3200);
  const n = await run(24);
  ok("a one-hour-old paid order raises nothing", n === 0 && (await alerts()).length === 0, n);
}

// ── the cap's exact state: submitted, overnight ────────────────────────────────────────────────
const capId = await mkOrder("submitted", 25, "Ryan", 3200);
{
  const n = await run(24);
  const a = await alerts();
  ok("a 25h 'submitted' order raises one alert", n === 1 && a.length === 1, { n, len: a.length });
  ok("it is critical", a[0]?.severity === "critical", a[0]?.severity);
  ok("it is keyed to that order", a[0]?.subject_id === capId, a[0]?.subject_id);
  ok("occurrences starts at 1", Number(a[0]?.occurrences) === 1, a[0]?.occurrences);
  ok("the body names the customer", /Ryan/.test(a[0]?.body ?? ""), a[0]?.body?.slice(0, 60));
  ok("the body names the money", /32\.00/.test(a[0]?.body ?? ""), a[0]?.body?.slice(0, 80));
  ok("the body names what they bought", /6-Panel Cap/.test(a[0]?.body ?? ""));
  ok("the body says sent, not accepted", /not that the printer accepted it/.test(a[0]?.body ?? ""));
  ok("the title carries the age", /has not moved in \d+ hours/.test(a[0]?.title ?? ""), a[0]?.title);
}

// ── the 0327 lesson, applied to a new watchdog ─────────────────────────────────────────────────
{
  const before = (await alerts())[0];
  await run(24); await run(24); await run(24);
  const a = await alerts();
  ok("three more runs add no rows", a.length === 1, a.length);
  ok("and do NOT inflate the counter — a continuous stall is one episode",
    Number(a[0].occurrences) === 1, a[0].occurrences);
  ok("but last_seen_at moves, so the row is not mistaken for stale",
    new Date(a[0].last_seen_at) >= new Date(before.last_seen_at));
}

// ── whose problem it is, is the view's decision and not this function's ────────────────────────
{
  await mkOrder("in_production", 300, "Printer Pete", 5000);
  await mkOrder("delivered", 400, "Done Dana", 5000);
  await mkOrder("refunded", 400, "Refund Rita", 5000);
  await mkOrder("canceled", 400, "Cancel Carl", 5000);
  await mkOrder("shipped", 400, "Shipped Sam", 5000);
  const n = await run(24);
  ok("an order at the printer is not ours to chase", n === 0, n);
  ok("and neither are closed or in-transit ones", (await alerts()).length === 1, (await alerts()).length);
}

// ── two stuck orders are two lines, not one overwritten ────────────────────────────────────────
{
  await mkOrder("needs_fulfillment", 48, "Second Sam", 6800);
  const n = await run(24);
  const a = await alerts();
  ok("a second stalled order opens its own alert", n === 1 && a.length === 2, { n, len: a.length });
  ok("keyed to different orders", a[0].subject_id !== a[1].subject_id);
}

// ── acknowledging means "tell me again if it happens" ──────────────────────────────────────────
{
  await db.exec(`update public.alerts set ack_at = now() where kind = 'shop_order_stalled' and subject_id = '${capId}'`);
  const n = await run(24);
  const mine = (await alerts()).filter((a) => a.subject_id === capId);
  ok("an acked alert does not suppress the next one", n === 1, n);
  ok("the order now has two rows: one cleared, one open", mine.length === 2, mine.length);
  ok("exactly one of them is open", mine.filter((a) => a.ack_at === null).length === 1);
}

// ── the guard against turning this into noise ──────────────────────────────────────────────────
{
  const fresh = await mkOrder("paid", 0, "Brand New Bella", 1000);
  const n = await run(0);            // 0 would mean "alert the instant an order is paid"
  const got = (await alerts()).filter((a) => a.subject_id === fresh);
  ok("stale_hours 0 is clamped, so a brand-new order is still not stalled", got.length === 0, n);
}

// ── the migration recorded itself (the 0304 contract) ──────────────────────────────────────────
{
  const r = await q1(`select version, seq from public.schema_migrations
                       where version = '0329_a_paid_order_can_stop_moving_and_nobody_hears'`);
  ok("0329 is in the ledger", !!r, r);
  ok("with the seq its filename implies", Number(r?.seq) === 329, r?.seq);
}

console.log(fail
  ? `A PAID ORDER THAT STOPS MOVING: ${pass} passed, ${fail} FAILED`
  : `A PAID ORDER THAT STOPS MOVING: ${pass} passed, 0 failed`);
console.log("0313 + 0327 + 0328 + 0329 executed against a real Postgres.\n");
process.exit(fail ? 1 : 0);
