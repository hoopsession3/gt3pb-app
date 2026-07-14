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
const s3 = (await q1(`insert into stops (name, status, starts_at, completed_at, archived_at) values ('Ran + wrapped 4h ago', 'done', now() - interval '7 hours', now() - interval '4 hours', now() - interval '4 hours') returning id`)).id;
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

console.log(`CANONICAL-DB CONTRACT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
