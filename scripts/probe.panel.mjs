// Adversarial probes for 0228-0232 (SQL lens). Not a test suite — targeted attack probes.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIG = (f) => readFileSync(join(ROOT, "supabase/migrations", f), "utf8");
const FILES = ["0228_ops_hygiene.sql", "0229_loyalty_ledger.sql", "0230_webhook_inbox.sql", "0231_order_items.sql", "0232_identity_integrity.sql"];

const U1 = "aaaaaaaa-0000-0000-0000-000000000001";
const U2 = "aaaaaaaa-0000-0000-0000-000000000002";
const U3 = "aaaaaaaa-0000-0000-0000-000000000003";

async function mkdb({ seedCustomers = "default", preDoneOrder = false } = {}) {
  const db = new PGlite();
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
    insert into public.products (slug, name, price_cents) values ('rise', 'RISE Cold Brew', 500), ('flow', 'FLOW Hydration', 700);
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
    alter table public.orders          add constraint orders_customer_fk          foreign key (customer_id) references public.customers(id);
    alter table public.drop_orders     add constraint drop_orders_customer_fk     foreign key (customer_id) references public.customers(id);
    alter table public.delivery_orders add constraint delivery_orders_customer_fk foreign key (customer_id) references public.customers(id);
    alter table public.business_orders add constraint business_orders_customer_fk foreign key (customer_id) references public.customers(id);
    alter table public.subscriptions   add constraint subscriptions_customer_fk   foreign key (customer_id) references public.customers(id);
  `);
  // live loyalty wiring (0012/0152 shape)
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
  if (seedCustomers === "default") {
    await db.exec(`
      insert into public.customers (id, user_id, name, phone, email) values
        ('cccccccc-0000-0000-0000-000000000001', null, null, '(864) 555-0101', null),
        ('cccccccc-0000-0000-0000-000000000002', '${U1}', 'Jordan', '864-555-0101', 'jordan@x.com');
    `);
  } else if (seedCustomers === "chain") {
    // A(u1, phone P, newer), X(no user, phone P + email E, oldest), Z(u2, email E only, newest)
    await db.exec(`
      insert into public.customers (id, user_id, name, phone, email, created_at) values
        ('cccccccc-0000-0000-0000-000000000011', '${U1}', 'A', '864-555-0202', null,       now() - interval '2 days'),
        ('cccccccc-0000-0000-0000-000000000012', null,   'X', '(864)555-0202', 'e@x.com',  now() - interval '3 days'),
        ('cccccccc-0000-0000-0000-000000000013', '${U2}', 'Z', null,           'E@x.com ', now() - interval '1 day');
    `);
  } else if (seedCustomers === "chainfk") {
    // same as chain, but the row that ends up deleted-in-pass-1 is the email-group KEEPER and the
    // surviving email dupe has a referencing order -> repoint targets a deleted keeper.
    await db.exec(`
      insert into public.customers (id, user_id, name, phone, email, created_at) values
        ('cccccccc-0000-0000-0000-000000000021', '${U1}', 'A', '864-555-0303', null,      now() - interval '2 days'),
        ('cccccccc-0000-0000-0000-000000000022', null,   'X', '(864)555-0303', 'f@x.com', now() - interval '3 days'),
        ('cccccccc-0000-0000-0000-000000000023', null,   'Y', null,            'f@x.com', now() - interval '1 day');
      insert into public.orders (items, customer_id) values ('{rise}', 'cccccccc-0000-0000-0000-000000000023');
    `);
  }
  if (preDoneOrder) {
    // an order completed BEFORE the ledger existed (awarded via the live counter path)
    await db.exec(`
      insert into public.orders (id, items, user_id, total_cents, status)
        values ('dddddddd-0000-0000-0000-000000000001', '{rise}', '${U1}', 500, 'new');
      update public.orders set status='done' where id='dddddddd-0000-0000-0000-000000000001';
    `);
  }
  return db;
}
const apply = async (db, files = FILES) => { for (const f of files) await db.exec(MIG(f)); };
const q1 = async (db, sql, p) => (await db.query(sql, p)).rows[0];
const P = (name, detail) => console.log(`\n### ${name}\n${detail}`);

// ────────────────────────────────────────────────────────────────────────────────────────────────
// PROBE 1 — 0229 clamp divergence: owner sets points down, then a clawback lands
{
  const db = await mkdb();
  await apply(db);
  const o = (await q1(db, `insert into orders (items, user_id, total_cents) values ('{rise,rise,flow}', '${U1}', 1700) returning id`)).id;
  await db.exec(`update orders set status='done' where id='${o}'`);
  const p1 = (await q1(db, `select points from profiles where id='${U1}'`)).points;           // 8
  await db.exec(`select admin_set_member('${U1}', 0, null, null)`);                            // owner sets DOWN to 0
  const p2 = (await q1(db, `select points from profiles where id='${U1}'`)).points;           // 0
  await db.exec(`update orders set status='void' where id='${o}'`);                            // clawback -3 lands
  const p3 = (await q1(db, `select points from profiles where id='${U1}'`)).points;
  const s3 = (await q1(db, `select coalesce(sum(points),0)::int s from loyalty_ledger where user_id='${U1}'`)).s;
  await db.exec(`select award_manual_point('CODE1')`);                                         // later +1 scan
  const p4 = (await q1(db, `select points from profiles where id='${U1}'`)).points;
  const s4 = (await q1(db, `select coalesce(sum(points),0)::int s from loyalty_ledger where user_id='${U1}'`)).s;
  const bad = (await q1(db, `select count(*)::int c from profiles p where coalesce(p.points,0) <> coalesce((select sum(l.points) from loyalty_ledger l where l.user_id = p.id), 0)`)).c;
  // owner re-set: does it re-sync?
  await db.exec(`select admin_set_member('${U1}', 10, null, null)`);
  const p5 = (await q1(db, `select points from profiles where id='${U1}'`)).points;
  const s5 = (await q1(db, `select coalesce(sum(points),0)::int s from loyalty_ledger where user_id='${U1}'`)).s;
  P("PROBE 1 clamp divergence",
    `after done(+3): points=${p1}; owner set 0: points=${p2}; void claws -3: points=${p3} LEDGER SUM=${s3}` +
    `\nscan +1: points=${p4} sum=${s4}; verify-query divergent profiles=${bad}` +
    `\nowner re-set to 10: points=${p5} sum=${s5}  (divergence permanent: ${p5 !== s5})`);
}

// PROBE 2 — FOUND semantics + null order_id + channel coexistence
{
  const db = await mkdb();
  await apply(db);
  await db.exec(`
    create table probe_found (step text, f boolean);
    do $probe$
    begin
      insert into loyalty_ledger (user_id, order_id, channel, kind, points) values ('${U1}', 'eeeeeeee-0000-0000-0000-000000000001', 'cup', 'award', 1)
        on conflict (user_id, order_id, channel, kind) where order_id is not null do nothing;
      insert into probe_found values ('first insert', found);
      insert into loyalty_ledger (user_id, order_id, channel, kind, points) values ('${U1}', 'eeeeeeee-0000-0000-0000-000000000001', 'cup', 'award', 1)
        on conflict (user_id, order_id, channel, kind) where order_id is not null do nothing;
      insert into probe_found values ('conflict-skip', found);
      insert into loyalty_ledger (user_id, order_id, channel, kind, points) values ('${U1}', null, 'scan', 'award', 1)
        on conflict (user_id, order_id, channel, kind) where order_id is not null do nothing;
      insert into probe_found values ('null order 1', found);
      insert into loyalty_ledger (user_id, order_id, channel, kind, points) values ('${U1}', null, 'scan', 'award', 1)
        on conflict (user_id, order_id, channel, kind) where order_id is not null do nothing;
      insert into probe_found values ('null order 2', found);
    end $probe$;`);
  const flags = (await db.query(`select step, f from probe_found order by step`)).rows;
  const cross = await db.exec(`insert into loyalty_ledger (user_id, order_id, channel, kind, points) values ('${U1}', 'eeeeeeee-0000-0000-0000-000000000001', 'pickup', 'award', 4)`).then(() => "coexists", (e) => "refused: " + e.message);
  const n = (await q1(db, `select count(*)::int c from loyalty_ledger where order_id = 'eeeeeeee-0000-0000-0000-000000000001'`)).c;
  const scans = (await q1(db, `select count(*)::int c from loyalty_ledger where channel='scan' and user_id='${U1}'`)).c;
  P("PROBE 2 FOUND + null order_id + channels", `${JSON.stringify(flags)}\nscan rows inserted=${scans}; same order different channel: ${cross}; rows for that order=${n}`);
}

// PROBE 3 — 0229 re-apply: opening backfill doubles points silently
{
  const db = await mkdb();
  await apply(db);
  const before = (await q1(db, `select points from profiles where id='${U1}'`)).points;
  let err = null;
  try { await db.exec(MIG("0229_loyalty_ledger.sql")); } catch (e) { err = e.message; }
  const after = (await q1(db, `select points from profiles where id='${U1}'`)).points;
  const openings = (await q1(db, `select count(*)::int c from loyalty_ledger where channel='opening' and user_id='${U1}'`)).c;
  P("PROBE 3 re-apply 0229", `error=${err}; U1 points before=${before} after=${after}; opening rows=${openings}`);
}

// PROBE 4 — pre-ledger done order: void->done after migration double-awards across the boundary
{
  const db = await mkdb({ preDoneOrder: true });
  await apply(db);
  const p0 = (await q1(db, `select points from profiles where id='${U1}'`)).points; // 5+1=6 opening
  await db.exec(`update orders set status='void' where id='dddddddd-0000-0000-0000-000000000001'`);
  const p1 = (await q1(db, `select points from profiles where id='${U1}'`)).points; // claw finds nothing
  await db.exec(`update orders set status='done' where id='dddddddd-0000-0000-0000-000000000001'`);
  const p2 = (await q1(db, `select points from profiles where id='${U1}'`)).points; // fresh award
  P("PROBE 4 boundary double-award", `opening=${p0}; after void=${p1} (no claw); after re-done=${p2} (order counted twice: ${p2 > p0})`);
}

// PROBE 5 — done->void->done net for a POST-ledger order (file's verify says "lands at n")
{
  const db = await mkdb();
  await apply(db);
  const base = (await q1(db, `select points from profiles where id='${U1}'`)).points;
  const o = (await q1(db, `insert into orders (items, user_id, total_cents) values ('{rise,flow}', '${U1}', 1200) returning id`)).id;
  await db.exec(`update orders set status='done' where id='${o}'; update orders set status='void' where id='${o}'; update orders set status='done' where id='${o}';`);
  const end = (await q1(db, `select points from profiles where id='${U1}'`)).points;
  P("PROBE 5 done->void->done", `base=${base}, order is DONE at the end, net points from it = ${end - base} (file's verify comment promises +n=2)`);
}

// PROBE 6 — resolve_customer absorb collision (phone hit + email owned by another row)
{
  const db = await mkdb();
  await apply(db);
  await db.exec(`
    select resolve_customer(null, '555-777-0001', null, 'PhoneOnly');
    select resolve_customer(null, null, 'other@x.com', 'EmailOnly');
  `);
  let out;
  try {
    const r = await q1(db, `select resolve_customer(null, '(555) 777-0001', 'OTHER@x.com', 'Both') r`);
    out = "returned " + r.r;
  } catch (e) { out = "THROWS: " + e.message.split("\n")[0]; }
  P("PROBE 6 resolve_customer absorb collision", out);
}

// PROBE 7 — merge chained groups: phone-pass deletes a row the email group still contains
{
  const db = await mkdb({ seedCustomers: "chain" });
  let err = null;
  try { await apply(db); } catch (e) { err = e.message.split("\n")[0]; }
  let dup = null;
  if (!err) dup = (await db.query(`select email_norm, count(*) from customers where email_norm is not null group by 1 having count(*)>1`)).rows;
  P("PROBE 7 chained merge (A/X/Z)", `apply error=${err}; surviving email dupes=${JSON.stringify(dup)}`);
}
{
  const db = await mkdb({ seedCustomers: "chainfk" });
  let err = null;
  try { await apply(db); } catch (e) { err = e.message.split("\n")[0]; }
  P("PROBE 7b chained merge w/ FK on later-group dupe", `apply error=${err}`);
}

// PROBE 8 — recap window boundaries + CTE atomicity
{
  const db = await mkdb();
  await apply(db);
  const mk = (name, doneAgo) => q1(db, `insert into stops (name, status, starts_at, completed_at) values ('${name}', 'done', now() - interval '${doneAgo}' - interval '3 hours', now() - interval '${doneAgo}') returning id`);
  await mk("done-49h", "49 hours");
  await mk("done-52h", "52 hours");
  await db.exec(`insert into stops (name, status) values ('live-no-timestamps', 'live')`);
  await db.exec(`select stop_recap_alerts()`);
  const a49 = (await q1(db, `select count(*)::int c from alerts where title='Recap: done-49h'`)).c;
  const a52 = (await q1(db, `select count(*)::int c from alerts where title='Recap: done-52h'`)).c;
  const aNT = (await q1(db, `select count(*)::int c from alerts where title='Recap: live-no-timestamps'`)).c;
  // atomicity: make the alert INSERT fail, then confirm recap_asked_at did NOT stick
  const s = (await mk("atomic-probe", "4 hours")).id;
  await db.exec(`alter table alerts add constraint tmp_block check (title not like 'Recap: atomic%')`);
  let failed = false;
  try { await db.exec(`select stop_recap_alerts()`); } catch { failed = true; }
  const marked = (await q1(db, `select recap_asked_at is not null m from stops where id='${s}'`)).m;
  await db.exec(`alter table alerts drop constraint tmp_block`);
  await db.exec(`select stop_recap_alerts()`);
  const later = (await q1(db, `select count(*)::int c from alerts where title='Recap: atomic-probe'`)).c;
  P("PROBE 8 recap boundaries + atomicity",
    `completed 49h ago fires=${a49 === 1} (panel assumed never); 52h ago fires=${a52 === 1}; timestamp-less live stop fires=${aNT === 1}` +
    `\ninsert-blocked call errored=${failed}; recap_asked_at stamped anyway=${marked}; after unblock alert fired=${later === 1}`);
}

// PROBE 9 — 0230 guard mirror: canceled keeps status, other fields still move
{
  const db = await mkdb();
  await apply(db);
  await db.exec(`insert into subscriptions (square_subscription_id, status, current_period_end) values ('sq-9', 'canceled', '2026-01-01')`);
  await db.exec(`update subscriptions set status='active', current_period_end='2026-09-01', updated_at=now() where square_subscription_id='sq-9'`);
  const r = await q1(db, `select status, current_period_end from subscriptions where square_subscription_id='sq-9'`);
  P("PROBE 9 guard lets non-status fields move", JSON.stringify(r));
}

// PROBE 10 — 0231 exploder: empty items, non-items update stability, backfill re-run
{
  const db = await mkdb();
  await apply(db);
  const o = (await q1(db, `insert into orders (items, user_id, paid) values ('{}', '${U1}', true) returning id`)).id;
  const c0 = (await q1(db, `select count(*)::int c from order_items where order_id='${o}'`)).c;
  const o2 = (await q1(db, `insert into orders (items, paid) values ('{rise}', true) returning id`)).id;
  const idBefore = (await q1(db, `select id from order_items where order_id='${o2}'`)).id;
  await db.exec(`update orders set customer='X' where id='${o2}'`);
  const idAfter = (await q1(db, `select id from order_items where order_id='${o2}'`)).id;
  const nBefore = (await q1(db, `select count(*)::int c from order_items`)).c;
  await db.exec(`
    insert into public.order_items (order_id, slug, name, qty, unit_price_cents, estimated)
    select o.id, i.slug, p.name, count(*)::int, p.price_cents, (p.id is null)
    from public.orders o
    cross join unnest(o.items) as i(slug)
    left join public.products p on p.slug = i.slug
    where not exists (select 1 from public.order_items oi where oi.order_id = o.id)
    group by o.id, i.slug, p.id, p.name, p.price_cents;`);
  const nAfter = (await q1(db, `select count(*)::int c from order_items`)).c;
  P("PROBE 10 exploder edges", `empty-items rows=${c0}; non-items update kept rows (${idBefore === idAfter}); backfill re-run added ${nAfter - nBefore} rows`);
}

// PROBE 11 — re-apply idempotency of the four files other than 0229
{
  const db = await mkdb();
  await apply(db);
  const snap = async () => JSON.stringify({
    points: (await q1(db, `select sum(points)::int s from profiles`)).s,
    items: (await q1(db, `select count(*)::int c from order_items`)).c,
    cust: (await q1(db, `select count(*)::int c from customers`)).c,
    ledger: (await q1(db, `select count(*)::int c from loyalty_ledger`)).c,
  });
  const before = await snap();
  const out = [];
  for (const f of ["0228_ops_hygiene.sql", "0230_webhook_inbox.sql", "0231_order_items.sql", "0232_identity_integrity.sql"]) {
    try { await db.exec(MIG(f)); out.push(`${f} OK`); }
    catch (e) { out.push(`${f} FAILED: ${e.message.split("\n")[0]}`); }
  }
  const after = await snap();
  P("PROBE 11 re-apply 0228/0230/0231/0232", out.join("; ") + `\nstate unchanged=${before === after} (before=${before} after=${after})`);
}

console.log("\nprobes done");
