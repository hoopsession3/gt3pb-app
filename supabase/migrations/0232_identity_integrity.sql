-- 0232 — identity + integrity batch (audit #5, #7, #8, #9, #6, #4). Six canonical-DB gaps closed in
-- one pass, each one "a constraint the schema should have been born with":
--   A. customers: one human = one row. Normalized phone/email as GENERATED columns + partial unique
--      indexes; existing dupes are merged mechanically first (keeper = has user_id, else oldest;
--      every FK that references customers(id) is repointed DYNAMICALLY off pg_constraint, so no
--      referencing table can be forgotten — the merge_vendors lesson). resolve_customer (0216 live
--      version) re-reads through the norm columns (indexed) and becomes race-safe: a concurrent
--      insert now hits the unique index and falls back to select.
--   B. rsvps: refresh-resubmit inflated going counts (probe-proven). One rsvp per (event, member)
--      and per (event, guest email).
--   C. events.outlook_event_id UNIQUE — calendar sync can't double-import.
--   D. alerts.category: the closed set from lib/alertKinds.ts, enforced at the DOOR (the probe got
--      'inventroy' accepted). Legacy rows are normalized through the same mapping the router uses.
--   E. status_changed_at on the four order families — fulfillment SLA truth ("when did it move?").
--   F. inventory_ledger.item_id -> assets(id), auto-linked from the item name on insert, so stock
--      history survives a rename. (Ledger is empty in prod today — clean add.)

-- ── A1. merge existing duplicate customers (recon 2026-07-14: exactly 1 phone-dupe group) ─────────
do $$
declare
  grp record; keeper uuid; dupe uuid; r record;
begin
  for grp in
    select k, array_agg(id order by (user_id is not null) desc, created_at asc) as ids
    from (
      select id, user_id, created_at,
             tenant_id::text || '|' || nullif(regexp_replace(coalesce(phone,''), '\D', '', 'g'), '') as k
      from public.customers
    ) c
    where k is not null
    group by k having count(*) > 1
    union all
    select k, array_agg(id order by (user_id is not null) desc, created_at asc)
    from (
      select id, user_id, created_at,
             tenant_id::text || '|' || nullif(lower(btrim(coalesce(email,''))), '') as k
      from public.customers
    ) c
    where k is not null
    group by k having count(*) > 1
  loop
    keeper := grp.ids[1];
    -- a row may already have been merged away by an earlier group in this same pass (panel catch)
    if not exists (select 1 from public.customers where id = keeper) then continue; end if;
    foreach dupe in array grp.ids[2:] loop
      exit when dupe is null;
      if dupe = keeper then continue; end if;
      if not exists (select 1 from public.customers where id = dupe) then continue; end if;
      -- repoint EVERY foreign key that references customers(id) — enumerated live, not hardcoded
      for r in
        select con.conrelid::regclass as tbl, att.attname as col
        from pg_constraint con
        join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
        where con.contype = 'f' and con.confrelid = 'public.customers'::regclass
      loop
        execute format('update %s set %I = $1 where %I = $2', r.tbl, r.col, r.col) using keeper, dupe;
      end loop;
      -- absorb anything the keeper is missing, then drop the dupe row
      update public.customers k set
        user_id = coalesce(k.user_id, d.user_id),
        name    = coalesce(k.name, d.name),
        phone   = coalesce(k.phone, d.phone),
        email   = coalesce(k.email, d.email),
        updated_at = now()
      from public.customers d where k.id = keeper and d.id = dupe;
      delete from public.customers where id = dupe;
    end loop;
  end loop;
end $$;

-- ── A2. normalized identity columns + the door ────────────────────────────────────────────────────
alter table public.customers add column if not exists phone_norm text
  generated always as (nullif(regexp_replace(coalesce(phone,''), '\D', '', 'g'), '')) stored;
alter table public.customers add column if not exists email_norm text
  generated always as (nullif(lower(btrim(coalesce(email,''))), '')) stored;
create unique index if not exists customers_phone_norm_uniq
  on public.customers (tenant_id, phone_norm) where phone_norm is not null;
create unique index if not exists customers_email_norm_uniq
  on public.customers (tenant_id, email_norm) where email_norm is not null;

-- ── A3. resolve_customer v2 — norm-column lookups (indexed) + race-safe insert ────────────────────
create or replace function public.resolve_customer(p_user_id uuid, p_phone text, p_email text, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; norm_phone text; norm_email text; tid uuid := public.effective_tenant();
begin
  norm_phone := nullif(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), '');
  norm_email := nullif(lower(trim(coalesce(p_email,''))), '');

  if p_user_id is not null then
    select id into cid from public.customers where user_id = p_user_id limit 1;
  end if;
  if cid is null and norm_phone is not null then
    select id into cid from public.customers
      where phone_norm = norm_phone and tenant_id = tid
      order by (user_id is not null) desc, created_at asc limit 1;
  end if;
  if cid is null and norm_email is not null then
    select id into cid from public.customers
      where email_norm = norm_email and tenant_id = tid
      order by (user_id is not null) desc, created_at asc limit 1;
  end if;

  if cid is null then
    begin
      insert into public.customers (user_id, name, phone, email, tenant_id)
        values (p_user_id, nullif(trim(coalesce(p_name,'')),''), p_phone, norm_email, tid)
        returning id into cid;
    exception when unique_violation then
      -- a concurrent resolve won the race — adopt its row
      select id into cid from public.customers
        where tenant_id = tid and ((norm_phone is not null and phone_norm = norm_phone)
                                or (norm_email is not null and email_norm = norm_email))
        order by (user_id is not null) desc, created_at asc limit 1;
    end;
  else
    begin
      update public.customers set
        user_id    = coalesce(user_id, p_user_id),
        name       = coalesce(name, nullif(trim(coalesce(p_name,'')),'')),
        phone      = coalesce(phone, p_phone),
        email      = coalesce(email, norm_email),
        updated_at = now()
      where id = cid;
    exception when unique_violation then
      -- absorbing the caller's OTHER contact field would collide with a different customer row
      -- (phone on one row, email on another). Keep the match, skip the contact absorb — an order
      -- write must never fail because identity absorb was ambitious (panel catch).
      update public.customers set
        user_id    = coalesce(user_id, p_user_id),
        name       = coalesce(name, nullif(trim(coalesce(p_name,'')),'')),
        updated_at = now()
      where id = cid;
    end;
  end if;
  return cid;
end $$;

-- ── B. one rsvp per person per event ──────────────────────────────────────────────────────────────
delete from public.rsvps a using public.rsvps b
  where a.id <> b.id and a.event_id = b.event_id
    and a.user_id is not null and a.user_id = b.user_id
    and (a.created_at > b.created_at or (a.created_at = b.created_at and a.id > b.id));
delete from public.rsvps a using public.rsvps b
  where a.id <> b.id and a.event_id = b.event_id
    and a.user_id is null and b.user_id is null
    and a.contact_email is not null and lower(a.contact_email) = lower(b.contact_email)
    and (a.created_at > b.created_at or (a.created_at = b.created_at and a.id > b.id));
create unique index if not exists rsvps_member_once on public.rsvps (event_id, user_id)
  where user_id is not null;
create unique index if not exists rsvps_guest_once on public.rsvps (event_id, lower(contact_email))
  where user_id is null and contact_email is not null;

-- ── C. outlook sync can't double-import ───────────────────────────────────────────────────────────
create unique index if not exists events_outlook_uniq on public.events (outlook_event_id)
  where outlook_event_id is not null;

-- ── D. alert categories: the closed set, at the door ──────────────────────────────────────────────
-- Mirror of lib/alertKinds.ts normalizeCategory(): legacy rows map exactly as the router reads them.
update public.alerts set category = case
  when category in ('order','orders')                       then 'order'
  when category in ('money','billing')                      then 'money'
  when category = 'brew'                                    then 'brew'
  when category like 'booking%'                             then 'booking'
  when category = 'prep'                                    then 'prep'
  when category in ('content','comment','note')             then 'content'
  when category in ('task','assignment')                    then 'task'
  when category = 'strategy'                                then 'strategy'
  else 'system'                                             -- app_error, truck, typos, null
end
where category is null or category not in
  ('order','money','brew','booking','prep','content','task','strategy','system');
alter table public.alerts alter column category set default 'system';
alter table public.alerts alter column category set not null;
alter table public.alerts drop constraint if exists alerts_category_canon;
alter table public.alerts add constraint alerts_category_canon
  check (category in ('order','money','brew','booking','prep','content','task','strategy','system'));

-- The ONE live producer still emitting a legacy category: alert_truck_offline (0052, unchanged since)
-- writes 'truck' — under the new check that would ERROR the live_status update itself (going offline
-- would break). Same function, canonical category ('system' — exactly where the router's
-- normalizeCategory sends 'truck'). Diffed against the live 0052 body; nothing else changed.
create or replace function public.alert_truck_offline() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if old.is_live = true and new.is_live = false then
    insert into public.alerts (severity, category, title, body, link, tenant_id)
    values ('important', 'system', 'Truck went offline',
            'The live truck just went offline - confirm this was intended.', '/admin',
            coalesce(new.tenant_id, '00000000-0000-0000-0000-000000000001'));
  end if;
  return new;
end; $$;

-- ── E. when did it move? ──────────────────────────────────────────────────────────────────────────
create or replace function public.stamp_status_change() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) ->> tg_argv[0]) is distinct from (to_jsonb(old) ->> tg_argv[0]) then
    new.status_changed_at := now();
  end if;
  return new;
end $$;
alter table public.orders          add column if not exists status_changed_at timestamptz;
alter table public.drop_orders     add column if not exists status_changed_at timestamptz;
alter table public.delivery_orders add column if not exists status_changed_at timestamptz;
alter table public.business_orders add column if not exists status_changed_at timestamptz;
drop trigger if exists trg_stamp_status on public.orders;
create trigger trg_stamp_status before update on public.orders
  for each row execute function public.stamp_status_change('status');
drop trigger if exists trg_stamp_status on public.drop_orders;
create trigger trg_stamp_status before update on public.drop_orders
  for each row execute function public.stamp_status_change('picked_up');
drop trigger if exists trg_stamp_status on public.delivery_orders;
create trigger trg_stamp_status before update on public.delivery_orders
  for each row execute function public.stamp_status_change('status');
drop trigger if exists trg_stamp_status on public.business_orders;
create trigger trg_stamp_status before update on public.business_orders
  for each row execute function public.stamp_status_change('status');

-- ── F. stock history survives a rename ────────────────────────────────────────────────────────────
alter table public.inventory_ledger add column if not exists item_id uuid references public.assets(id) on delete set null;
create index if not exists inventory_ledger_item_idx on public.inventory_ledger (item_id);
create or replace function public.inventory_ledger_autolink() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.item_id is null and new.item is not null then
    select a.id into new.item_id from public.assets a
      where lower(a.name) = lower(new.item)
      order by a.created_at asc limit 1;
  end if;
  return new;
end $$;
drop trigger if exists trg_inventory_ledger_autolink on public.inventory_ledger;
create trigger trg_inventory_ledger_autolink before insert on public.inventory_ledger
  for each row execute function public.inventory_ledger_autolink();

-- verify:
--   select count(*) from (select tenant_id, phone_norm from customers where phone_norm is not null group by 1,2 having count(*)>1) x;  -- 0
--   insert into alerts (severity, category, title) values ('fyi','inventroy','x');  -- REFUSED (check)
--   select indexname from pg_indexes where indexname in ('customers_phone_norm_uniq','customers_email_norm_uniq','rsvps_member_once','rsvps_guest_once','events_outlook_uniq');  -- 5 rows
