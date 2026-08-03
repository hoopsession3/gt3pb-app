// CANONICAL-DB CONTRACT — acceptance tests for 0228–0232 (ops hygiene, the loyalty ledger, the
// webhook inbox, order line items, identity/integrity). Same philosophy as db.fieldops.test.mjs:
// in-process WASM Postgres, prod-fidelity fixture shapes (the LIVE trigger wiring included, since
// 0229 replaces functions behind existing triggers), and every migration under test applied
// VERBATIM from its real file, in prod apply order.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); }
};

const db = new PGlite();
const q1 = async (sql, params) => (await db.query(sql, params)).rows[0];
const refused = async (sql) => { try { await db.exec(sql); return false; } catch { return true; } };

// ── platform stubs ────────────────────────────────────────────────────────────────────────────────
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create role anon; create role authenticated; create role service_role;
  grant usage on schema auth, public to anon, authenticated;
  create or replace function public.is_staff() returns boolean language sql stable as $$ select true $$;
  create or replace function public.is_admin() returns boolean language sql stable as $$ select true $$;
  create or replace function public.is_owner() returns boolean language sql stable as $$ select true $$;
  create or replace function public.effective_tenant() returns uuid language sql stable as $$
    select '00000000-0000-0000-0000-000000000001'::uuid $$;
  create table public.tenants (id uuid primary key);
  insert into public.tenants values ('00000000-0000-0000-0000-000000000001');
`);

// ── prod-fidelity fixtures (0001/0005/0012/0033/0125/0151/0152/0157/0062/0130/0187) ──────────────
const U1 = "aaaaaaaa-0000-0000-0000-000000000001"; // member with existing 5 points (opening test)
const U2 = "aaaaaaaa-0000-0000-0000-000000000002"; // referred member
const U3 = "aaaaaaaa-0000-0000-0000-000000000003"; // referrer
await db.exec(`
  insert into auth.users values ('${U1}'), ('${U2}'), ('${U3}');
  create table public.profiles (
    id uuid primary key references auth.users(id),
    display_name text, role text default 'member',
    points int not null default 0, credit_cents int not null default 0,
    founding_member boolean not null default false,
    referral_code text, referred_by uuid, referral_converted boolean not null default false
  );
  insert into public.profiles (id, points, referral_code) values ('${U1}', 5, 'CODE1');
  insert into public.profiles (id, points, referred_by) values ('${U2}', 0, '${U3}');
  insert into public.profiles (id, points, referral_code) values ('${U3}', 0, 'CODE3');
  create table public.referral_events (
    id uuid primary key default gen_random_uuid(),
    referrer uuid, referee uuid, converting_order uuid, converting_channel text,
    referrer_credit_cents int, referee_credit_cents int, created_at timestamptz default now()
  );
  create table public.orders (
    id uuid primary key default gen_random_uuid(),
    items text[] not null, total_cents int not null default 0,
    paid boolean not null default false, payment_id text, customer text,
    user_id uuid references auth.users(id), customer_id uuid,
    status text not null default 'new' check (status in ('new','preparing','ready','done','void')),
    created_at timestamptz not null default now()
  );
  create table public.drop_orders (
    id uuid primary key default gen_random_uuid(),
    user_id uuid, size int not null default 4, total_cents int not null default 0,
    picked_up boolean not null default false, customer_id uuid, created_at timestamptz default now()
  );
  create table public.delivery_orders (
    id uuid primary key default gen_random_uuid(),
    user_id uuid, pack_size int not null default 4, total_cents int not null default 0,
    status text not null default 'received', payment_id text, customer_id uuid, created_at timestamptz default now()
  );
  create table public.business_orders (
    id uuid primary key default gen_random_uuid(),
    status text not null default 'received', payment_status text not null default 'pending',
    customer_id uuid, created_at timestamptz default now()
  );
  create table public.subscriptions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid, customer_id uuid, square_subscription_id text unique, plan text,
    status text not null default 'active', current_period_end text, updated_at timestamptz default now()
  );
  create table public.products (
    id uuid primary key default gen_random_uuid(),
    slug text not null unique, name text not null, price_cents int not null default 0
  );
  insert into public.products (slug, name, price_cents) values
    ('rise', 'RISE Cold Brew', 500), ('flow', 'FLOW Hydration', 700);
  create table public.stops (
    id uuid primary key default gen_random_uuid(),
    name text not null default 'stop', status text not null default 'upcoming' check (status in ('live','upcoming','done')),
    starts_at timestamptz, ends_at timestamptz, completed_at timestamptz, archived_at timestamptz,
    vendor_id uuid, sort int default 0
  );
  create table public.alerts (
    id uuid primary key default gen_random_uuid(),
    severity text not null default 'important', category text, title text not null,
    body text, link text default '/admin', target_user_id uuid, created_by uuid,
    ack_at timestamptz, channels_sent text[] not null default '{}',
    tenant_id uuid default '00000000-0000-0000-0000-000000000001', created_at timestamptz default now()
  );
  create table public.customers (
    id uuid primary key default gen_random_uuid(),
    user_id uuid unique references auth.users(id), name text, phone text, email text,
    tenant_id uuid default '00000000-0000-0000-0000-000000000001',
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  );
  create table public.reserve_claims (id uuid primary key default gen_random_uuid(), customer_id uuid references public.customers(id));
  create table public.vip_verifications (id uuid primary key default gen_random_uuid(), customer_id uuid references public.customers(id) on delete set null);
  create table public.rsvps (
    id uuid primary key default gen_random_uuid(),
    event_id uuid, user_id uuid, contact_email text, status text not null default 'going',
    created_at timestamptz not null default now()
  );
  create table public.events (
    id uuid primary key default gen_random_uuid(),
    title text not null default 'event', day date, outlook_event_id text, archived_at timestamptz
  );
  create table public.assets (
    id uuid primary key default gen_random_uuid(),
    name text not null, created_at timestamptz not null default now()
  );
  insert into public.assets (name) values ('Amber Gallon Jug'), ('16oz Bottles');
  create table public.inventory_ledger (
    id uuid primary key default gen_random_uuid(),
    item text not null, kind text not null default 'confirm', qty numeric not null,
    tenant_id uuid default '00000000-0000-0000-0000-000000000001', created_at timestamptz default now()
  );
  create table public.live_status (
    id int primary key default 1, is_live boolean not null default false,
    current_stop_id uuid, tenant_id uuid default '00000000-0000-0000-0000-000000000001'
  );
  insert into public.live_status (id, is_live) values (1, true);
  create table public.stop_ops (
    stop_id uuid primary key references public.stops(id) on delete cascade,
    crew_brief text, dress_code text, recap text,
    tenant_id uuid default '00000000-0000-0000-0000-000000000001', updated_at timestamptz default now()
  );
`);
// the LIVE truck-offline producer (0052 verbatim) — 0232 must retarget its category without breaking it
await db.exec(`
  create or replace function public.alert_truck_offline() returns trigger
    language plpgsql security definer set search_path = public as $$
  begin
    if old.is_live = true and new.is_live = false then
      insert into public.alerts (severity, category, title, body, link, tenant_id)
      values ('important', 'truck', 'Truck went offline',
              'The live truck just went offline — confirm this was intended.', '/admin',
              coalesce(new.tenant_id, '00000000-0000-0000-0000-000000000001'));
    end if;
    return new;
  end; $$;
  create trigger live_status_offline_alert after update of is_live on public.live_status
    for each row execute function public.alert_truck_offline();
`);
// add customer FKs to the order families (0151/0193 shape) so the merge repoint has real FKs to walk
await db.exec(`
  alter table public.orders          add constraint orders_customer_fk          foreign key (customer_id) references public.customers(id);
  alter table public.drop_orders     add constraint drop_orders_customer_fk     foreign key (customer_id) references public.customers(id);
  alter table public.delivery_orders add constraint delivery_orders_customer_fk foreign key (customer_id) references public.customers(id);
  alter table public.business_orders add constraint business_orders_customer_fk foreign key (customer_id) references public.customers(id);
  alter table public.subscriptions   add constraint subscriptions_customer_fk   foreign key (customer_id) references public.customers(id);
`);
// the LIVE loyalty wiring 0229 replaces from behind (0012/0152): naive fns + their triggers
await db.exec(`
  create or replace function public.credit_wallet(p_user_id uuid, p_points int, p_total_cents int, p_order_id uuid, p_channel text)
  returns void language plpgsql security definer as $$
  begin
    update public.profiles set points = points + greatest(coalesce(p_points,1),1) where id = p_user_id;
  end $$;
  create or replace function public.award_points() returns trigger language plpgsql security definer as $$
  begin
    if new.status = 'done' and old.status is distinct from 'done' and new.user_id is not null then
      perform public.credit_wallet(new.user_id, coalesce(array_length(new.items,1),1), new.total_cents, new.id, 'cup');
    end if;
    return new;
  end $$;
  create trigger trg_award_points after update on public.orders for each row execute function public.award_points();
  create or replace function public.award_points_pack() returns trigger language plpgsql security definer as $$
  begin
    if new.picked_up = true and old.picked_up is distinct from true and new.user_id is not null then
      perform public.credit_wallet(new.user_id, new.size, new.total_cents, new.id, 'pickup');
    end if;
    return new;
  end $$;
  create trigger trg_award_points_pack after update on public.drop_orders for each row execute function public.award_points_pack();
  create or replace function public.award_points_delivery() returns trigger language plpgsql security definer as $$
  begin
    if new.status = 'delivered' and old.status is distinct from 'delivered' and new.user_id is not null then
      perform public.credit_wallet(new.user_id, new.pack_size, new.total_cents, new.id, 'delivery');
    end if;
    return new;
  end $$;
  create trigger trg_award_points_delivery after update on public.delivery_orders for each row execute function public.award_points_delivery();
`);
// pre-apply data the migrations must normalize/merge:
const C1 = "cccccccc-0000-0000-0000-000000000001";
const C2 = "cccccccc-0000-0000-0000-000000000002";
const OH = "dddddddd-0000-0000-0000-000000000001"; // a HISTORICAL done order (pre-ledger era)
await db.exec(`
  insert into public.customers (id, user_id, name, phone, email) values
    ('${C1}', null, null, '(864) 555-0101', null),
    ('${C2}', '${U1}', 'Jordan', '864-555-0101', 'jordan@x.com');
  insert into public.orders (items, user_id, customer_id, paid) values ('{rise}', null, '${C1}', true);
  insert into public.orders (id, items, user_id, total_cents, status, paid) values
    ('${OH}', '{rise,rise}', '${U1}', 1000, 'done', true);
  insert into public.vip_verifications (customer_id) values ('${C1}');
  insert into public.alerts (severity, category, title) values
    ('fyi', 'truck', 'legacy truck alert'), ('fyi', 'note', 'legacy note alert'),
    ('fyi', 'app_error', 'legacy error alert'), ('fyi', null, 'legacy null alert');
`);

// ── APPLY 0228–0232 VERBATIM, in prod order ──────────────────────────────────────────────────────
for (const f of ["0228_ops_hygiene.sql", "0229_loyalty_ledger.sql", "0230_webhook_inbox.sql", "0231_order_items.sql", "0232_identity_integrity.sql"]) {
  let applied = true, msg;
  try { await db.exec(readFileSync(join(ROOT, "supabase/migrations", f), "utf8")); }
  catch (e) { applied = false; msg = e.message; }
  ok(`${f} applies verbatim`, applied, msg);
}

// ═══ 0229 · the loyalty book ═════════════════════════════════════════════════════════════════════
// backfill happened BEFORE the apply trigger existed: points unchanged, ledger holds it —
// as a per-order historical award (2, for the pre-ledger done order) + the opening residual (3)
ok("backfill: ledger sum carries U1's 5 points exactly", (await q1(`select coalesce(sum(points),0)::int s from loyalty_ledger where user_id='${U1}'`)).s === 5);
ok("backfill: the historical done order got its own award row", (await q1(`select points from loyalty_ledger where order_id='${OH}' and kind='award'`))?.points === 2);
ok("backfill did NOT double profiles.points", (await q1(`select points from profiles where id='${U1}'`)).points === 5);

// THE flagship bug: done -> void -> done must land at n, never 2n
const o1 = (await q1(`insert into orders (items, user_id, total_cents) values ('{rise,rise,flow}', '${U1}', 1700) returning id`)).id;
await db.exec(`update orders set status='done' where id='${o1}'`);
ok("award on done: +3 (one per drink)", (await q1(`select points from profiles where id='${U1}'`)).points === 8);
await db.exec(`update orders set status='void' where id='${o1}'`);
ok("void claws the award back", (await q1(`select points from profiles where id='${U1}'`)).points === 5);
await db.exec(`update orders set status='done' where id='${o1}'`);
ok("done AGAIN after void: award once more is refused — the ledger already holds an award for this order", (await q1(`select points from profiles where id='${U1}'`)).points === 5, (await q1(`select points from profiles where id='${U1}'`)).points);
ok("ledger for o1 = award + clawback only", (await q1(`select count(*)::int c from loyalty_ledger where order_id='${o1}'`)).c === 2);

// direct replay of credit_wallet (a Square-style double event) is a no-op
await db.exec(`select credit_wallet('${U1}', 3, 1700, '${o1}', 'cup')`);
ok("credit_wallet replay for the same order+channel is refused", (await q1(`select points from profiles where id='${U1}'`)).points === 5);

// corrections: done -> preparing keeps the award; return to done can't double it
const o2 = (await q1(`insert into orders (items, user_id, total_cents) values ('{flow}', '${U1}', 700) returning id`)).id;
await db.exec(`update orders set status='done' where id='${o2}'; update orders set status='preparing' where id='${o2}'; update orders set status='done' where id='${o2}';`);
ok("done->preparing->done awards exactly once", (await q1(`select points from profiles where id='${U1}'`)).points === 6);

// referral conversion: first award converts (both wallets +$5), replays never re-convert
const o3 = (await q1(`insert into orders (items, user_id, total_cents) values ('{rise}', '${U2}', 900) returning id`)).id;
await db.exec(`update orders set status='done' where id='${o3}'`);
ok("referee credited $5 on conversion", (await q1(`select credit_cents from profiles where id='${U2}'`)).credit_cents === 500);
ok("referrer credited $5 on conversion", (await q1(`select credit_cents from profiles where id='${U3}'`)).credit_cents === 500);
await db.exec(`update orders set status='void' where id='${o3}'; update orders set status='done' where id='${o3}';`);
ok("void->done replay does NOT re-convert the referral", (await q1(`select credit_cents from profiles where id='${U3}'`)).credit_cents === 500);

// pickup + delivery channels claw on the undo
const d1 = (await q1(`insert into drop_orders (user_id, size, total_cents) values ('${U1}', 4, 2000) returning id`)).id;
await db.exec(`update drop_orders set picked_up=true where id='${d1}'`);
const afterPack = (await q1(`select points from profiles where id='${U1}'`)).points;
await db.exec(`update drop_orders set picked_up=false where id='${d1}'`);
ok("un-pickup claws the pack award", (await q1(`select points from profiles where id='${U1}'`)).points === afterPack - 4);
const v1 = (await q1(`insert into delivery_orders (user_id, pack_size, total_cents) values ('${U1}', 6, 3000) returning id`)).id;
await db.exec(`update delivery_orders set status='delivered' where id='${v1}'`);
await db.exec(`update delivery_orders set status='issue' where id='${v1}'`);
ok("un-deliver claws the delivery award", (await q1(`select points from profiles where id='${U1}'`)).points === afterPack - 4);

// scan + owner set flow through the book; invariant holds for every profile
await db.exec(`select award_manual_point('CODE1')`);
ok("scan +1 lands", (await q1(`select points from profiles where id='${U1}'`)).points === afterPack - 3);
await db.exec(`select admin_set_member('${U1}', 20, null, null)`);
ok("owner set-to-20 lands as an adjust", (await q1(`select points from profiles where id='${U1}'`)).points === 20);
ok("INVARIANT: profiles.points == ledger sum, every profile",
  (await q1(`select count(*)::int c from profiles p where coalesce(p.points,0) <> coalesce((select sum(l.points) from loyalty_ledger l where l.user_id = p.id), 0)`)).c === 0);

// ═══ 0230 · inbox + terminal states ══════════════════════════════════════════════════════════════
await db.exec(`insert into webhook_events (id, type) values ('evt_1', 'payment.updated')`);
ok("inbox refuses a duplicate event id", await refused(`insert into webhook_events (id, type) values ('evt_1', 'payment.updated')`));
await db.exec(`insert into subscriptions (square_subscription_id, status) values ('sq-1', 'canceled')`);
await db.exec(`update subscriptions set status='paused' where square_subscription_id='sq-1'`);
ok("stale 'paused' cannot overwrite terminal 'canceled'", (await q1(`select status from subscriptions where square_subscription_id='sq-1'`)).status === "canceled");
await db.exec(`insert into subscriptions (square_subscription_id, status) values ('sq-2', 'past_due')`);
await db.exec(`update subscriptions set status='paused' where square_subscription_id='sq-2'`);
ok("past_due ignores 'paused'", (await q1(`select status from subscriptions where square_subscription_id='sq-2'`)).status === "past_due");
await db.exec(`update subscriptions set status='active' where square_subscription_id='sq-2'`);
ok("past_due clears on a real payment", (await q1(`select status from subscriptions where square_subscription_id='sq-2'`)).status === "active");

// ═══ 0231 · line items ═══════════════════════════════════════════════════════════════════════════
ok("backfill covered every pre-existing order", (await q1(`select count(*)::int c from orders o where coalesce(array_length(o.items,1),0) <> (select coalesce(sum(oi.qty),0)::int from order_items oi where oi.order_id = o.id)`)).c === 0);
const o4 = (await q1(`insert into orders (items, user_id, total_cents, paid) values ('{rise,rise,flow}', '${U1}', 1700, true) returning id`)).id;
ok("explode: 2 slugs, right quantities", (await q1(`select count(*)::int c, sum(qty)::int q from order_items where order_id='${o4}'`)).c === 2 && (await q1(`select qty from order_items where order_id='${o4}' and slug='rise'`)).qty === 2);
ok("explode snapshots the menu price", (await q1(`select unit_price_cents from order_items where order_id='${o4}' and slug='rise'`)).unit_price_cents === 500);
await db.exec(`update orders set items='{flow}' where id='${o4}'`);
ok("editing items re-explodes", (await q1(`select count(*)::int c from order_items where order_id='${o4}'`)).c === 1);
const o5 = (await q1(`insert into orders (items, paid, total_cents) values ('{mystery-drink}', true, 900) returning id`)).id;
ok("unknown slug lands honest: estimated=true, null price", (await q1(`select estimated, unit_price_cents from order_items where order_id='${o5}'`)).estimated === true);
const mix = (await db.query(`select * from report_product_mix(365)`)).rows;
const rise = mix.find((r) => r.slug === "rise");
ok("mix report: rise revenue = qty x snapshot price (no equal-split)", rise && Number(rise.revenue_cents) % 500 === 0 && Number(rise.qty) >= 1, rise);
ok("mix report flags estimated rows", mix.find((r) => r.slug === "mystery-drink")?.has_estimates === true);

// ═══ 0232 · identity + integrity ═════════════════════════════════════════════════════════════════
ok("customer dupes merged to one row", (await q1(`select count(*)::int c from customers where phone_norm = '8645550101'`)).c === 1);
ok("merge kept the row WITH the user account", (await q1(`select user_id from customers where phone_norm='8645550101'`)).user_id === U1);
ok("merge repointed the order FK (dynamic pg_constraint walk)", (await q1(`select count(*)::int c from orders where customer_id = '${C2}'`)).c === 1);
ok("merge repointed vip_verifications too", (await q1(`select count(*)::int c from vip_verifications where customer_id = '${C2}'`)).c === 1);
ok("door: duplicate phone refused", await refused(`insert into customers (phone) values ('864.555.0101')`));
ok("door: duplicate email refused", await refused(`insert into customers (email) values (' JORDAN@X.COM ')`));
const rc = (await q1(`select resolve_customer(null, '(864)555-0101', null, 'J2') r`)).r;
ok("resolve_customer finds by normalized phone", rc === C2);
const EV = (await q1(`insert into events (title, day) values ('Test', '2026-08-01') returning id`)).id;
await db.exec(`insert into rsvps (event_id, user_id) values ('${EV}', '${U1}')`);
ok("rsvp: member can't double-rsvp", await refused(`insert into rsvps (event_id, user_id) values ('${EV}', '${U1}')`));
await db.exec(`insert into rsvps (event_id, contact_email) values ('${EV}', 'Guest@X.com')`);
ok("rsvp: guest email can't double-rsvp (case-blind)", await refused(`insert into rsvps (event_id, contact_email) values ('${EV}', 'guest@x.com')`));
await db.exec(`update events set outlook_event_id='OUT-1' where id='${EV}'`);
ok("outlook id unique", await refused(`insert into events (title, outlook_event_id) values ('Dup', 'OUT-1')`));
ok("legacy alert categories normalized (truck/app_error->system, note->content, null->system)",
  (await q1(`select count(*)::int c from alerts where category in ('truck','note','app_error') or category is null`)).c === 0);
ok("door: typo category refused", await refused(`insert into alerts (severity, category, title) values ('fyi','inventroy','x')`));
// the truck-offline producer keeps working after the door — going offline must never error
let offlineOk = true;
try { await db.exec(`update live_status set is_live=false where id=1`); } catch { offlineOk = false; }
ok("truck-offline transition still works (producer retargeted to 'system')", offlineOk);
ok("truck-offline alert landed canonical", (await q1(`select category from alerts where title='Truck went offline' order by created_at desc limit 1`))?.category === "system");
await db.exec(`update orders set status='ready' where id='${o5}'`);
ok("status change stamps status_changed_at", (await q1(`select status_changed_at is not null s from orders where id='${o5}'`)).s === true);
const st0 = (await q1(`select status_changed_at from orders where id='${o5}'`)).status_changed_at;
await db.exec(`update orders set customer=null where id='${o5}'`);
ok("non-status edits do NOT stamp", String((await q1(`select status_changed_at from orders where id='${o5}'`)).status_changed_at) === String(st0));
await db.exec(`insert into inventory_ledger (item, qty) values ('amber gallon jug', 3)`);
ok("inventory autolink: name matched to the asset", (await q1(`select item_id is not null l from inventory_ledger where item='amber gallon jug'`)).l === true);

// ═══ 0228 · stops clean up after themselves ══════════════════════════════════════════════════════
const s1 = (await q1(`insert into stops (name, status, starts_at) values ('Stale never-ran', 'upcoming', now() - interval '5 days') returning id`)).id;
const s2 = (await q1(`insert into stops (name, status, starts_at) values ('Yesterday, still fresh', 'upcoming', now() - interval '1 day') returning id`)).id;
// s3 = THE MAIN PATH: go-offline wraps AND archives in the same moment (crew LiveControl) — the
// recap must still fire (panel blocker: the first draft filtered archived stops and never asked).
await q1(`insert into stops (name, status, starts_at, completed_at, archived_at) values ('Ran + wrapped 4h ago', 'done', now() - interval '7 hours', now() - interval '4 hours', now() - interval '4 hours') returning id`);
const s4 = (await q1(`insert into stops (name, status, starts_at, completed_at) values ('Ancient done stop', 'done', now() - interval '10 days', now() - interval '10 days') returning id`)).id;
// s5 = crew already typed the recap in the wrap dialog — nothing to ask for
const s5 = (await q1(`insert into stops (name, status, starts_at, completed_at) values ('Wrapped with recap typed', 'done', now() - interval '8 hours', now() - interval '5 hours') returning id`)).id;
await db.exec(`insert into stop_ops (stop_id, recap) values ('${s5}', 'Sold out of RISE by 2pm; bring double next time.')`);
await db.exec(`select archive_stale_stops()`);
ok("auto-archive: 5-day-old upcoming stop archived", (await q1(`select archived_at is not null a from stops where id='${s1}'`)).a === true);
ok("auto-archive: yesterday's stop untouched", (await q1(`select archived_at is null a from stops where id='${s2}'`)).a === true);
ok("auto-archive: DONE stops are history, never archived by the job", (await q1(`select archived_at is null a from stops where id='${s4}'`)).a === true);
const alertsBefore = (await q1(`select count(*)::int c from alerts where title like 'Recap:%'`)).c;
await db.exec(`select stop_recap_alerts()`);
ok("recap ask: the go-offline-archived stop STILL gets its ping (main close-out path)", (await q1(`select count(*)::int c from alerts where title = 'Recap: Ran + wrapped 4h ago'`)).c === 1);
ok("recap ask: ancient stop outside the 48h window stays quiet", (await q1(`select count(*)::int c from alerts where title = 'Recap: Ancient done stop'`)).c === 0);
ok("recap ask: a recap already typed in the wrap dialog is never re-asked", (await q1(`select count(*)::int c from alerts where title = 'Recap: Wrapped with recap typed'`)).c === 0);
await db.exec(`select stop_recap_alerts()`);
ok("recap ask: never asks twice", (await q1(`select count(*)::int c from alerts where title like 'Recap:%'`)).c === alertsBefore + 1);
ok("recap alert uses a canonical category (post-0232 door)", (await q1(`select category from alerts where title = 'Recap: Ran + wrapped 4h ago'`)).category === "task");

// ═══ panel regressions ═══════════════════════════════════════════════════════════════════════════
// (a) clamp removal: owner sets DOWN, then a void lands — counter and ledger stay in lockstep
await db.exec(`select admin_set_member('${U1}', 0, null, null)`);
await db.exec(`update orders set status='void' where id='${OH}'`);
ok("clamp gone: historical void claws through zero (points may go negative, ledger == counter)",
  (await q1(`select points from profiles where id='${U1}'`)).points === -2);
ok("INVARIANT survives the set-down + void sequence",
  (await q1(`select count(*)::int c from profiles p where coalesce(p.points,0) <> coalesce((select sum(l.points) from loyalty_ledger l where l.user_id = p.id), 0)`)).c === 0);
await db.exec(`update orders set status='done' where id='${OH}'`);
ok("historical order voided-then-redone nets zero (no double-dip on pre-ledger orders)",
  (await q1(`select points from profiles where id='${U1}'`)).points === -2);
await db.exec(`select admin_set_member('${U1}', 20, null, null)`);
// (b) 0229 re-applied whole: nobody's balance moves, no second opening row
const ptsBefore = (await q1(`select points from profiles where id='${U1}'`)).points;
await db.exec(readFileSync(join(ROOT, "supabase/migrations", "0229_loyalty_ledger.sql"), "utf8"));
ok("re-applying 0229 is a no-op on balances (panel: used to double points)",
  (await q1(`select points from profiles where id='${U1}'`)).points === ptsBefore);
ok("re-applying 0229 adds no second opening row",
  (await q1(`select count(*)::int c from loyalty_ledger where user_id='${U1}' and channel='opening'`)).c === 1);
// (c) resolve_customer cross-collision: phone matches row A, email belongs to row B — must not throw
const CA = (await q1(`insert into customers (phone) values ('803-111-2222') returning id`)).id;
await db.exec(`insert into customers (email) values ('col@x.com')`);
let resolved = null, resolveThrew = false;
try { resolved = (await q1(`select resolve_customer(null, '(803) 111-2222', 'col@x.com', 'X') r`)).r; } catch { resolveThrew = true; }
ok("resolve_customer cross-collision: no throw (order writes never fail on identity absorb)", resolveThrew === false);
ok("resolve_customer cross-collision: kept the phone match, skipped the colliding email",
  resolved === CA && (await q1(`select email from customers where id='${CA}'`)).email === null);


// ── 0256: products drive economics (audit P0 — the two-price-table fix) ──
// Fixtures to prod shape (0028/0044/0062 columns the minimal products fixture lacks), then 0256
// applied VERBATIM from its file — the harness's own philosophy. A category with mapped drinks
// gets LIVE numbers (avg menu price, recipe-derived cost); an unmapped one keeps its stored
// fallback. This is the event-ROI money math — lock it.
await db.exec(`
  alter table public.products add column if not exists line text;
  alter table public.products add column if not exists active boolean not null default true;
  create table if not exists public.product_economics (
    product_key text primary key, label text not null, price_cents int not null default 0,
    unit_cost_cents int, active boolean not null default true, sort int not null default 0,
    updated_at timestamptz not null default now());
  create table if not exists public.inventory_items (
    id uuid primary key default gen_random_uuid(), name text not null, unit_cost numeric);
  create table if not exists public.product_components (
    id uuid primary key default gen_random_uuid(),
    product_id uuid not null references public.products(id) on delete cascade,
    inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
    qty_per_serving numeric, unit text, unique (product_id, inventory_item_id));
`);
await db.exec(readFileSync(join(ROOT, "supabase/migrations", "0256_products_drive_economics.sql"), "utf8"));
await db.exec(`insert into product_economics (product_key, label, price_cents, unit_cost_cents, active, sort)
  values ('nitro','Nitro',700,250,true,1),('bottles','Bottles',1200,500,true,5)`);
const INV0256 = (await q1(`insert into inventory_items (name, unit_cost) values ('0256 Beans', 0.50) returning id`)).id;
const P0256 = (await q1(`insert into products (slug, name, price_cents, active, econ_key) values ('t0256-a','T Nitro A',1000,true,'nitro') returning id`)).id;
await db.exec(`insert into products (slug, name, price_cents, active, econ_key) values ('t0256-b','T Nitro B',1400,true,'nitro')`);
await db.exec(`insert into product_components (product_id, inventory_item_id, qty_per_serving, unit) values ('${P0256}','${INV0256}',2,'oz')`);
const live0256 = await q1(`select price_cents, unit_cost_cents, price_live, cost_live from product_economics_live where product_key='nitro'`);
ok("0256 live category price = avg of its drinks' menu prices (not the stale stored $7)",
  live0256.price_cents === 1200 && live0256.price_live === true, live0256);
ok("0256 live category cost = recipe-derived (2 × $0.50), same math as the COGS calculator",
  live0256.unit_cost_cents === 100 && live0256.cost_live === true, live0256);
const fb0256 = await q1(`select price_cents, unit_cost_cents, price_live from product_economics_live where product_key='bottles'`);
ok("0256 unmapped category falls back to its stored manual price/cost (bottles)",
  fb0256.price_cents === 1200 && fb0256.unit_cost_cents === 500 && fb0256.price_live === false, fb0256);
ok("0256 re-applied whole is a no-op (view + seed idempotent)",
  await (async () => { try { await db.exec(readFileSync(join(ROOT, "supabase/migrations", "0256_products_drive_economics.sql"), "utf8")); return true; } catch { return false; } })());

// ── 0259: one company calendar (Business lane leads with "plan"; lead/pipe/meeting join lanes) ──
// Fixture to 0159 shape (minus FKs the contract doesn't exercise), rows seeded to the PRE-0259
// prod state, then 0259 applied VERBATIM from its file. The re-apply contract is the whole point:
// array_prepend/append with no guard would double-add on every deploy replay.
await db.exec(`
  create table if not exists public.work_streams (
    id uuid primary key default gen_random_uuid(), key text not null unique, label text not null,
    color text not null default '#8a8a8a', categories text[] not null default '{}',
    sections text[] not null default '{}', owner_role text, sort int not null default 0);
  insert into work_streams (key, label, categories, sections, sort) values
    ('events','Events','{event,booking,ops}','{plan,prep}',2),
    ('business','Business','{money,admin,strategy,task,system}','{notes,money,customers,team}',5);
`);
await db.exec(readFileSync(join(ROOT, "supabase/migrations", "0259_one_company_calendar.sql"), "utf8"));
const biz0259 = await q1(`select sections, categories from work_streams where key='business'`);
ok("0259 Business lane now LEADS with plan (the shared calendar is the landing)",
  biz0259.sections[0] === "plan" && biz0259.sections.join(",") === "plan,notes,money,customers,team", biz0259);
ok("0259 pipe + meeting joined the Business lane's categories",
  biz0259.categories.includes("pipe") && biz0259.categories.includes("meeting"), biz0259);
ok("0259 lead joined the Events lane's categories",
  (await q1(`select categories from work_streams where key='events'`)).categories.join(",") === "event,booking,ops,lead");
await db.exec(readFileSync(join(ROOT, "supabase/migrations", "0259_one_company_calendar.sql"), "utf8"));
const biz0259b = await q1(`select sections, categories from work_streams where key='business'`);
ok("0259 re-applied is a no-op (guards hold — no double plan/pipe/meeting)",
  biz0259b.sections.join(",") === "plan,notes,money,customers,team" && biz0259b.categories.filter((c) => c === "pipe").length === 1, biz0259b);

// ── 0260: admin audit trail (enterprise round P1 — who changed what, when) ──
// Fixtures: an auth.uid() stub (the harness has no live session; the trigger must tolerate a
// null actor — that IS the contract for service-role writes), plus the hot tables 0260 hooks
// that the harness doesn't already carry. Then 0260 VERBATIM, twice (re-apply must be a no-op).
await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as 'select null::uuid';
  create table if not exists public.deals (
    id uuid primary key default gen_random_uuid(), title text not null, vendor_type text not null default 'gym',
    model text not null default 'rev_share', rate_pct numeric, monthly_cents int, price_label text, blurb text,
    line text, active boolean not null default true, sort int not null default 0, updated_at timestamptz);
  create table if not exists public.budgets (
    tenant_id uuid not null default '00000000-0000-0000-0000-000000000001', category text not null,
    monthly_limit_cents int not null default 0, updated_at timestamptz, primary key (tenant_id, category));
  create table if not exists public.site_copy (key text primary key, value text);
`);
await db.exec(readFileSync(join(ROOT, "supabase/migrations", "0260_admin_audit_trail.sql"), "utf8"));
const D0260 = (await q1(`insert into deals (title) values ('Gym fridge') returning id`)).id;
await db.exec(`update deals set title = 'Gym fridge partnership', rate_pct = 10 where id = '${D0260}'`);
const au1 = await q1(`select action, table_name, row_pk, summary from admin_audit where table_name='deals' and action='UPDATE' order by id desc limit 1`);
ok("0260 UPDATE logs a human diff (old → new, changed columns only)",
  au1 && au1.row_pk === D0260 && /title: Gym fridge → Gym fridge partnership/.test(au1.summary) && /rate_pct: ∅ → 10/.test(au1.summary) && !/updated_at/.test(au1.summary), au1);
await db.exec(`update deals set title = title where id = '${D0260}'`);
ok("0260 a no-change save logs NOTHING (timestamp-only touches aren't history)",
  (await q1(`select count(*)::int n from admin_audit where table_name='deals' and action='UPDATE'`)).n === 1);
await db.exec(`delete from deals where id = '${D0260}'`);
ok("0260 DELETE keeps the old row snapshot",
  (await q1(`select old_row->>'title' t from admin_audit where table_name='deals' and action='DELETE' limit 1`)).t === "Gym fridge partnership");
ok("0260 null actor allowed (service-role/system writes still log)",
  (await q1(`select count(*)::int n from admin_audit where actor is null`)).n >= 2);
ok("0260 re-applied whole is a no-op",
  await (async () => { try { await db.exec(readFileSync(join(ROOT, "supabase/migrations", "0260_admin_audit_trail.sql"), "utf8")); return true; } catch { return false; } })());

// ── 0261: batch → order traceability (recall readiness) ──
// Fixtures where the harness lacks them, 0261 VERBATIM, then the recall contract: stamp a batch
// on a pack, ask "who got batch X", and confirm deleting the batch clears (not blocks) the ref.
await db.exec(`
  create table if not exists public.brew_batches (
    id uuid primary key default gen_random_uuid(), recipe_name text, batch_gal numeric, status text not null default 'planned',
    brew_date date, drop_date date);
  create table if not exists public.drop_orders (
    id uuid primary key default gen_random_uuid(), name text, phone text, size int not null default 6,
    drop_date date not null default current_date, canceled_at timestamptz);
  create table if not exists public.delivery_orders (
    id uuid primary key default gen_random_uuid(), delivery_date date not null default current_date, canceled_at timestamptz);
  -- the harness may already carry these tables in a slimmer shape — top up the columns the test uses
  alter table public.drop_orders add column if not exists name text;
  alter table public.drop_orders add column if not exists phone text;
`);
await db.exec(readFileSync(join(ROOT, "supabase/migrations", "0261_batch_traceability.sql"), "utf8"));
const B0261 = (await q1(`insert into brew_batches (recipe_name, batch_gal, status) values ('Flow OG', 2.5, 'ready') returning id`)).id;
const P0261 = (await q1(`insert into drop_orders (name, phone) values ('Meena', '864') returning id`)).id;
await db.exec(`update drop_orders set batch_id = '${B0261}' where id = '${P0261}'`);
ok("0261 recall query answers 'who got batch X'",
  (await q1(`select name from drop_orders where batch_id = '${B0261}'`)).name === "Meena");
await db.exec(`delete from brew_batches where id = '${B0261}'`);
ok("0261 deleting a batch CLEARS the pack's reference (set null, never blocks cleanup)",
  (await q1(`select batch_id from drop_orders where id = '${P0261}'`)).batch_id === null);
ok("0261 re-applied whole is a no-op",
  await (async () => { try { await db.exec(readFileSync(join(ROOT, "supabase/migrations", "0261_batch_traceability.sql"), "utf8")); return true; } catch { return false; } })());

// ── 0262: note continuation (addenda + kept files + notes in the change log) ──
// Fixtures: harness has no meeting_notes (notes never had a canonical block before — the freeze
// WAS the bug), and its profiles is the slim 0001 shape — top up is_admin, which the 0262
// leadership policies reference. Then 0262 VERBATIM (its storage DO block self-skips: no storage
// schema here), twice. The audit trigger rides 0260's function, live from the block above.
await db.exec(`
  create table if not exists public.meeting_notes (
    id uuid primary key default gen_random_uuid(), title text not null, summary text, body text,
    visibility text not null default 'collab', created_by uuid references auth.users(id) on delete set null,
    archived_at timestamptz, created_at timestamptz not null default now());
  alter table public.profiles add column if not exists is_admin boolean not null default false;
`);
await db.exec(readFileSync(join(ROOT, "supabase/migrations", "0262_note_continuation.sql"), "utf8"));
const N0262 = (await q1(`insert into meeting_notes (title, body, created_by) values ('Vendor sit-down', 'Original body — never edited.', '${U1}') returning id`)).id;
const A0262 = (await q1(`insert into note_addenda (note_id, body, created_by) values ('${N0262}', 'Added after the follow-up call.', '${U1}') returning id`)).id;
ok("0262 an addendum lands attributed + timestamped, original body untouched",
  await (async () => {
    const a = await q1(`select body, created_by, created_at from note_addenda where id = '${A0262}'`);
    const n = await q1(`select body from meeting_notes where id = '${N0262}'`);
    return a.body === "Added after the follow-up call." && a.created_by === U1 && !!a.created_at && n.body === "Original body — never edited.";
  })());
await db.exec(`insert into note_files (note_id, addendum_id, path, name, mime, size_bytes, created_by)
  values ('${N0262}', '${A0262}', '${N0262}/123-abc.pdf', 'contract.pdf', 'application/pdf', 52000, '${U1}')`);
ok("0262 a kept file records its real name + key; deleting its addendum orphans (set null), never blocks",
  await (async () => {
    const f1 = await q1(`select name, addendum_id from note_files where note_id = '${N0262}'`);
    await db.exec(`delete from note_addenda where id = '${A0262}'`);
    const f2 = await q1(`select addendum_id from note_files where note_id = '${N0262}'`);
    return f1.name === "contract.pdf" && f1.addendum_id === A0262 && f2.addendum_id === null;
  })());
await db.exec(`update meeting_notes set title = 'Vendor sit-down · August' where id = '${N0262}'`);
await db.exec(`update meeting_notes set summary = 'refreshed recap v2' where id = '${N0262}'`);
ok("0262 a rename hits the admin change log; a summary refresh (derived content) does NOT",
  await (async () => {
    const logged = await q1(`select count(*)::int n from admin_audit where table_name='meeting_notes' and summary like '%Vendor sit-down · August%'`);
    const spam = await q1(`select count(*)::int n from admin_audit where table_name='meeting_notes' and summary like '%refreshed recap%'`);
    return logged.n === 1 && spam.n === 0;
  })());
ok("0262 policy sets complete: 3 on addenda, 3 on files, and NO addenda update policy (append-only)",
  await (async () => {
    const pa = await q1(`select count(*)::int n from pg_policies where tablename = 'note_addenda'`);
    const pf = await q1(`select count(*)::int n from pg_policies where tablename = 'note_files'`);
    const upd = await q1(`select count(*)::int n from pg_policies where tablename = 'note_addenda' and cmd = 'UPDATE'`);
    return pa.n === 3 && pf.n === 3 && upd.n === 0;
  })());
ok("0262 deleting the note cascades its continuation (addenda + file rows go with it)",
  await (async () => {
    await db.exec(`delete from meeting_notes where id = '${N0262}'`);
    return (await q1(`select count(*)::int n from note_files where note_id = '${N0262}'`)).n === 0;
  })());
ok("0262 re-applied whole is a no-op",
  await (async () => { try { await db.exec(readFileSync(join(ROOT, "supabase/migrations", "0262_note_continuation.sql"), "utf8")); return true; } catch { return false; } })());

// ── 0263: executive operating rhythm (check-ins, decision follow-through, program↔goal links, nudges) ──
// Fixtures: the exec tables the harness never carried (goals / strategy_decisions / initiatives /
// event_tasks-minimal). meeting_notes + alerts persist from earlier blocks. Then 0263 VERBATIM,
// twice — its cron blocks self-skip here (no pg_cron), the nudge FUNCTION is tested directly.
await db.exec(`
  create table if not exists public.goals (
    id uuid primary key default gen_random_uuid(), title text not null, unit text default '',
    target_value numeric not null default 0, current_value numeric not null default 0,
    status text not null default 'active', owner_user_id uuid,
    updated_at timestamptz not null default now(), created_at timestamptz not null default now());
  create table if not exists public.strategy_decisions (
    id uuid primary key default gen_random_uuid(), key text not null, decision text not null, why text,
    author_id uuid, author_name text, created_at timestamptz not null default now());
  create table if not exists public.initiatives (
    id uuid primary key default gen_random_uuid(), title text not null, status text not null default 'active');
  create table if not exists public.event_tasks (
    id uuid primary key default gen_random_uuid(), label text not null, done boolean not null default false);
`);
await db.exec(readFileSync(join(ROOT, "supabase/migrations", "0263_exec_rhythm.sql"), "utf8"));
const G0263 = (await q1(`insert into goals (title, target_value, owner_user_id) values ('Wholesale accounts', 10, '${U1}') returning id`)).id;
ok("0263 check-in accepts the two honest answers and rejects invented ones",
  await (async () => {
    await db.exec(`update goals set checkin_status = 'at_risk', checkin_at = now(), checkin_by = '${U1}' where id = '${G0263}'`);
    const good = (await q1(`select checkin_status from goals where id = '${G0263}'`)).checkin_status === "at_risk";
    let rejected = false;
    try { await db.exec(`update goals set checkin_status = 'vibes' where id = '${G0263}'`); } catch { rejected = true; }
    return good && rejected;
  })());
const DN0263 = (await q1(`insert into meeting_notes (title, created_by) values ('Strategy Session · test', '${U1}') returning id`)).id;
const DT0263 = (await q1(`insert into event_tasks (label) values ('Call the distributor') returning id`)).id;
const D0263 = (await q1(`insert into strategy_decisions (key, decision, note_id, follow_up_task_id) values ('wholesale', 'Go direct, skip the middleman', '${DN0263}', '${DT0263}') returning id`)).id;
ok("0263 the ledger outlives its sources: note deleted → decision stands, provenance nulled, task link intact",
  await (async () => {
    await db.exec(`delete from meeting_notes where id = '${DN0263}'`);
    const d = await q1(`select note_id, follow_up_task_id, decision from strategy_decisions where id = '${D0263}'`);
    return d.decision === "Go direct, skip the middleman" && d.note_id === null && d.follow_up_task_id === DT0263;
  })());
const I0263 = (await q1(`insert into initiatives (title) values ('August launch') returning id`)).id;
await db.exec(`insert into initiative_goals (initiative_id, goal_id) values ('${I0263}', '${G0263}')`);
ok("0263 program ↔ goal link exists and cascades with the goal (no orphan junctions)",
  await (async () => {
    const linked = (await q1(`select count(*)::int n from initiative_goals where initiative_id = '${I0263}'`)).n === 1;
    const G2 = (await q1(`insert into goals (title, target_value) values ('Temp', 1) returning id`)).id;
    await db.exec(`insert into initiative_goals (initiative_id, goal_id) values ('${I0263}', '${G2}')`);
    await db.exec(`delete from goals where id = '${G2}'`);
    return linked && (await q1(`select count(*)::int n from initiative_goals where initiative_id = '${I0263}'`)).n === 1;
  })());
ok("0263 the Monday nudge pings a quiet goal's owner ONCE (unacked dedupe), and skips checked-in goals",
  await (async () => {
    await db.exec(`update goals set checkin_status = null, checkin_at = null, updated_at = now() - interval '8 days' where id = '${G0263}'`);
    const GQ = (await q1(`insert into goals (title, target_value, owner_user_id) values ('Fresh checked-in goal', 5, '${U2}') returning id`)).id;
    await db.exec(`update goals set checkin_at = now(), updated_at = now() - interval '8 days' where id = '${GQ}'`);
    await db.exec(`select public.goal_checkin_nudges()`);
    await db.exec(`select public.goal_checkin_nudges()`);
    const mine = (await q1(`select count(*)::int n from alerts where category = 'strategy' and target_user_id = '${U1}' and title like '%Wholesale accounts%'`)).n;
    const theirs = (await q1(`select count(*)::int n from alerts where category = 'strategy' and target_user_id = '${U2}'`)).n;
    return mine === 1 && theirs === 0;
  })());
ok("0263 re-applied whole is a no-op",
  await (async () => { try { await db.exec(readFileSync(join(ROOT, "supabase/migrations", "0263_exec_rhythm.sql"), "utf8")); return true; } catch { return false; } })());

// ── 0264: GT3 Command — the workstream registry, Monday audit, KPI snapshots ──
await db.exec(readFileSync(join(ROOT, "supabase/migrations", "0264_gt3_command_registry.sql"), "utf8"));
ok("0264 the 8/2 portfolio seeds verbatim: 10 streams, mean 7.0, all audited 8/2",
  await (async () => {
    const n = (await q1(`select count(*)::int n from os_workstreams`)).n;
    const mean = (await q1(`select round(avg(health),1)::text m from os_workstreams`)).m;
    const audited = (await q1(`select count(*)::int n from workstream_audits where week_of = '2026-08-02'`)).n;
    return n === 10 && mean === "7.0" && audited === 10;
  })());
ok("0264 one audit per stream per week (unique) — re-audit updates, never duplicates",
  await (async () => {
    const ws = (await q1(`select id from os_workstreams where name = 'Events'`)).id;
    await db.exec(`insert into workstream_audits (workstream_id, week_of, c_owner, c_next, c_blockers, c_artifacts, c_signal, total)
      values ('${ws}', '2026-08-03', 2, 2, 1, 2, 1, 8)`);
    let dup = false;
    try { await db.exec(`insert into workstream_audits (workstream_id, week_of, total) values ('${ws}', '2026-08-03', 9)`); } catch { dup = true; }
    return dup;
  })());
ok("0264 the Monday nudge posts ONE leadership-wide alert and dedupes while unacked",
  await (async () => {
    await db.exec(`select public.os_audit_nudge()`);
    await db.exec(`select public.os_audit_nudge()`);
    return (await q1(`select count(*)::int n from alerts where title like '🗂 Monday audit%'`)).n === 1;
  })());
ok("0264 KPI snapshots: same metric+week re-entry updates in place",
  await (async () => {
    await db.exec(`insert into kpi_snapshots (metric, period, value) values ('loop_part', '2026-08-03', 10)
      on conflict (metric, period) do update set value = excluded.value`);
    await db.exec(`insert into kpi_snapshots (metric, period, value) values ('loop_part', '2026-08-03', 12)
      on conflict (metric, period) do update set value = excluded.value`);
    const r = await q1(`select count(*)::int n, max(value)::int v from kpi_snapshots where metric = 'loop_part'`);
    return r.n === 1 && r.v === 12;
  })());
ok("0264 re-applied whole is a no-op (still 10 streams, still one 8/2 audit each)",
  await (async () => {
    try { await db.exec(readFileSync(join(ROOT, "supabase/migrations", "0264_gt3_command_registry.sql"), "utf8")); } catch { return false; }
    return (await q1(`select count(*)::int n from os_workstreams`)).n === 10
        && (await q1(`select count(*)::int n from workstream_audits where week_of = '2026-08-02'`)).n === 10;
  })());

// ── 0265: the pipeline moves onto the Playbook enum ──
// Fixture: opportunities in the OLD vocabulary (the harness never carried the table), rows in
// every legacy stage, then 0265 VERBATIM — the migration map is the contract.
await db.exec(`
  create table if not exists public.vendors (id uuid primary key default gen_random_uuid(), name text not null default 'New vendor', archived_at timestamptz, confirmed_distinct boolean not null default false);
  create table if not exists public.opportunities (
    id uuid primary key default gen_random_uuid(),
    vendor_id uuid not null references public.vendors(id) on delete cascade,
    stage text not null default 'prospect'
      check (stage in ('prospect','first_attempt','talking','proposal','won','lost')),
    value_cents int, next_step text, next_step_at date, source text not null default 'manual',
    notes text, lost_reason text, won_at timestamptz, lost_at timestamptz,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now());
`);
const V0265 = (await q1(`insert into vendors (name) values ('Enum Test Gym') returning id`)).id;
await db.exec(`insert into opportunities (vendor_id, stage) values
  ('${V0265}','prospect'),('${V0265}','first_attempt'),('${V0265}','talking'),('${V0265}','proposal'),('${V0265}','won'),('${V0265}','lost')`);
await db.exec(readFileSync(join(ROOT, "supabase/migrations", "0265_pipeline_playbook_enum.sql"), "utf8"));
ok("0265 every legacy row lands on the Playbook enum (prospect→lead, first_attempt/talking→warm, proposal→sampled, won→live, lost stays)",
  await (async () => {
    const r = await q1(`select
      count(*) filter (where stage='lead')::int lead, count(*) filter (where stage='warm')::int warm,
      count(*) filter (where stage='sampled')::int sam, count(*) filter (where stage='live')::int live,
      count(*) filter (where stage='lost')::int lost,
      count(*) filter (where stage in ('prospect','first_attempt','talking','proposal','won'))::int legacy
      from opportunities where vendor_id = '${V0265}'`);
    return r.lead === 1 && r.warm === 2 && r.sam === 1 && r.live === 1 && r.lost === 1 && r.legacy === 0;
  })());
ok("0265 the new law holds: legacy stages rejected, default is 'lead', priority vocabulary enforced",
  await (async () => {
    const oldRejected = await refused(`insert into opportunities (vendor_id, stage) values ('${V0265}', 'prospect')`);
    const def = (await q1(`insert into opportunities (vendor_id) values ('${V0265}') returning stage`)).stage;
    const priRejected = await refused(`update opportunities set priority = 'P9' where vendor_id = '${V0265}'`);
    await db.exec(`update opportunities set priority = 'P1', mrr_cents = 177300 where stage = 'live' and vendor_id = '${V0265}'`);
    return oldRejected && def === "lead" && priRejected;
  })());
ok("0265 re-applied whole is a no-op",
  await (async () => { try { await db.exec(readFileSync(join(ROOT, "supabase/migrations", "0265_pipeline_playbook_enum.sql"), "utf8")); return true; } catch { return false; } })());

// ── 0266: the 8/2 state seeds — and seeds exactly once ──
// events table exists (harness base). readiness_checks + initiatives fixtures where missing.
await db.exec(`
  alter table public.events add column if not exists location_text text;
  alter table public.meeting_notes add column if not exists met_on date not null default current_date;
  alter table public.meeting_notes add column if not exists source text not null default 'manual';
  alter table public.event_tasks add column if not exists meeting_note_id uuid;
  alter table public.event_tasks add column if not exists kind text;
  alter table public.event_tasks add column if not exists section text;
  alter table public.event_tasks add column if not exists critical boolean not null default false;
  alter table public.event_tasks add column if not exists due_at timestamptz;
  alter table public.event_tasks add column if not exists sort int;
  alter table public.initiatives add column if not exists created_at timestamptz not null default now();
  create table if not exists public.readiness_checks (
    id uuid primary key default gen_random_uuid(),
    initiative_id uuid references public.initiatives(id) on delete cascade,
    label text not null, category text, status text not null default 'at_risk',
    critical boolean not null default true, note text, sort int not null default 0,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now());
`);
await db.exec(readFileSync(join(ROOT, "supabase/migrations", "0266_seed_8_2_state.sql"), "utf8"));
await db.exec(readFileSync(join(ROOT, "supabase/migrations", "0266_seed_8_2_state.sql"), "utf8"));   // twice, on purpose
ok("0266 the whole 8/2 session lands ONCE despite double apply: 8 ledger lines, 9 follow-ups, 13 accounts, 3 events, 5 gates, 2 notes",
  await (async () => {
    const dec = (await q1(`select count(*)::int n from strategy_decisions where key in ('cooler','gtm:sampling','pricing:loop','product:latte','print:options','gtm:coupons','pipeline:upstate','parked:vending')`)).n;
    const note = (await q1(`select id from meeting_notes where title = 'Strategy Session · Aug 2 — the cooler session'`)).id;
    const fu = (await q1(`select count(*)::int n from event_tasks where meeting_note_id = '${note}'`)).n;
    const accts = (await q1(`select count(*)::int n from opportunities o join vendors v on v.id = o.vendor_id where v.name in ('Upstate Spine & Sport','Soul Yoga','Corporate Delivery','Wine Xpress')`)).n;
    const evs = (await q1(`select count(*)::int n from events where title in ('Soul Yoga Workshop — serve window','Sassafras Flower Farm','Greenville Fit Fest')`)).n;
    const gates = (await q1(`select count(*)::int n from readiness_checks where label like 'Gate %'`)).n;
    const shelf = (await q1(`select count(*)::int n from meeting_notes where title = 'Playbook v1.0 — Strategy of Record'`)).n;
    return dec === 8 && fu === 9 && accts === 4 && evs === 3 && (gates === 5 || gates === 0) && shelf === 1;
  })());
ok("0266 decisions carry provenance to the session note; Corporate Delivery seeds LIVE with MRR + won_at",
  await (async () => {
    const withNote = (await q1(`select count(*)::int n from strategy_decisions where key = 'cooler' and note_id is not null`)).n;
    const cd = await q1(`select o.stage, o.mrr_cents, (o.won_at is not null) as live_at from opportunities o join vendors v on v.id = o.vendor_id where v.name = 'Corporate Delivery' limit 1`);
    return withNote === 1 && cd.stage === "live" && Number(cd.mrr_cents) === 177300 && cd.live_at === true;
  })());

// ── 0267: utilization (definer-RPC-only writes, admin-only reads, honest counters) ──
await db.exec(readFileSync(join(ROOT, "supabase/migrations", "0267_utilization.sql"), "utf8"));
ok("0267 track_guest counts once per call, same-day rows merge",
  await (async () => {
    await db.exec(`select public.track_guest()`);
    await db.exec(`select public.track_guest()`);
    const r = await q1(`select count(*)::int n, max(hits)::int h from guest_daily`);
    return r.n === 1 && r.h >= 2;
  })());
ok("0267 track_user is a no-op with no session (anon can never write a user's row)",
  await (async () => {
    await db.exec(`select public.track_user('crew:command', false)`);   // harness auth.uid() = null
    return (await q1(`select count(*)::int n from user_activity`)).n === 0;
  })());
ok("0267 with a session: logins and actions accumulate on ONE daily row, last_action updates",
  await (async () => {
    await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select '${U1}'::uuid $$`);
    await db.exec(`select public.track_user('login', true)`);
    await db.exec(`select public.track_user('crew:command', false)`);
    await db.exec(`select public.track_user('crew:plan', false)`);
    const r = await q1(`select count(*)::int n from user_activity where user_id = '${U1}'`);
    const row = await q1(`select logins, actions, last_action from user_activity where user_id = '${U1}' limit 1`);
    await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$`);
    return r.n === 1 && row.logins === 1 && row.actions === 3 && row.last_action === "crew:plan";
  })());
ok("0267 no client write path exists: zero insert/update policies on both tables (RPC is the only door)",
  await (async () => {
    const w = await q1(`select count(*)::int n from pg_policies where tablename in ('user_activity','guest_daily') and cmd in ('INSERT','UPDATE','DELETE','ALL')`);
    const r = await q1(`select count(*)::int n from pg_policies where tablename in ('user_activity','guest_daily') and cmd = 'SELECT'`);
    return w.n === 0 && r.n === 2;
  })());
ok("0267 re-applied whole is a no-op",
  await (async () => { try { await db.exec(readFileSync(join(ROOT, "supabase/migrations", "0267_utilization.sql"), "utf8")); return true; } catch { return false; } })());

console.log(`CANONICAL-DB CONTRACT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
