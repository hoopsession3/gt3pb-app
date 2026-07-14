-- 0222 — FIELD OPS, the physical table (merge Phase 1). events + stops become one table of
-- "scheduled field operations," discriminated by kind. This is the EXPAND step of the
-- expand→migrate→contract plan:
--   • the 0220 view of the same name is replaced by this table (the view had no code consumers —
--     its one job was to freeze the target shape, which this table now honors);
--   • every existing row is backfilled PRESERVING ITS UUID (both sources use gen_random_uuid();
--     collision probability is cryptographically negligible — and a precondition
--     check below ASSERTS disjointness so a collision aborts loudly instead of skipping silently);
--   • AFTER-triggers on events and stops mirror every insert/update/delete into field_ops, so the
--     old tables remain the writers and this table is always current. Nothing reads it yet.
-- Column mapping: events.title → name; everything else keeps its source column name. Columns stay
-- nullable at this stage (the mirror must accept whatever the sources hold); the contract migration
-- tightens them. ROLLBACK: drop the two triggers + this table — zero impact on anything live.

-- PRECONDITION (enforced, not assumed): the two id spaces must be disjoint. gen_random_uuid()
-- collisions are cryptographically negligible, but if one ever existed the backfill's on-conflict
-- would SILENTLY skip a row — so we assert instead of hoping.
do $$ begin
  if exists (select 1 from public.events e join public.stops s on s.id = e.id) then
    raise exception 'events/stops share a UUID — resolve before merging';
  end if;
end $$;

drop view if exists public.field_ops;

create table if not exists public.field_ops (
  id            uuid primary key,
  kind          text not null check (kind in ('event','stop')),
  name          text not null,
  -- when
  day           date,
  starts_at     timestamptz,
  ends_at       timestamptz,
  start_time    text,
  end_time      text,
  day_label     text,
  when_label    text,
  time_label    text,
  plan_days     integer,
  default_buffer_min integer,
  completed_at  timestamptz,
  -- where
  location_text text,
  address       text,
  lat           double precision,
  lng           double precision,
  state         text,
  county        text,
  -- classification
  type          text,
  category      text,
  archetype     text,
  stage         text,
  status        text,
  menu_tier     text,
  tag_label     text,
  -- rig & utilities
  rig           text,
  power_available   boolean,
  water_available   boolean,
  menu_nitro        boolean,
  menu_nature_aid   boolean,
  menu_salted_maple boolean,
  menu_bottles      boolean,
  menu_broth        boolean,
  -- event-shaped fields
  member_only   boolean,
  capacity      integer,
  claimed       integer,
  going_count   integer,
  blurb         text,
  expected_attendance integer,
  duration_hrs  numeric,
  staff_count   integer,
  is_live       boolean,
  outlook_event_id  text,
  outlook_synced_at timestamptz,
  -- stop-shaped fields
  order_ahead_enabled  boolean,
  pickup_enabled       boolean,
  order_ahead_lead_min integer,
  note          text,
  notes         text,
  poc_name      text,
  poc_phone     text,
  poc_email     text,
  service_dates text,
  -- shared meta
  sort          integer,
  vendor_id     uuid references public.vendors(id) on delete set null,
  archived_at   timestamptz,
  tenant_id     uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  created_at    timestamptz not null default now()
);
create index if not exists field_ops_kind_idx on public.field_ops (kind, day, starts_at);
create index if not exists field_ops_live_idx on public.field_ops (is_live) where is_live;

alter table public.field_ops enable row level security;
-- Mirror-stage policies: both sources are world-readable today (events 0001; stops 0001, kept in
-- 0195 — the customer truck page reads them), so the union is too. Direct writes are staff-gated;
-- in practice all writes come from the SECURITY DEFINER mirror triggers until the contract phase.
drop policy if exists "field ops read" on public.field_ops;
create policy "field ops read" on public.field_ops for select using (true);
drop policy if exists "field ops staff write" on public.field_ops;
create policy "field ops staff write" on public.field_ops for all
  using ((select public.is_staff())) with check ((select public.is_staff()));
drop policy if exists "tenant isolation" on public.field_ops;
create policy "tenant isolation" on public.field_ops as restrictive
  for all using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
grant select on public.field_ops to anon;
-- SELECT-only during the mirror phase: ALL writes flow through the SECURITY DEFINER mirror triggers.
-- (The panel proved a direct staff delete could strand dangling spine refs and 500 checkout — the
-- write grant returns at the contract phase, when field_ops becomes the one true writer surface.)
grant select on public.field_ops to authenticated;

-- ── mirror: events → field_ops ────────────────────────────────────────────────────────────────────
create or replace function public.mirror_event_to_field_ops() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    delete from public.field_ops where id = old.id and kind = 'event';
    return old;
  end if;
  if tg_op = 'UPDATE' and new.id is distinct from old.id then
    delete from public.field_ops where id = old.id and kind = 'event';   -- PK reassignment can't orphan a mirror row
  end if;
  insert into public.field_ops (
    id, kind, name, day, start_time, end_time, day_label, plan_days, default_buffer_min, completed_at,
    location_text, state, county, type, category, archetype, stage, rig,
    power_available, water_available, menu_nitro, menu_nature_aid, menu_salted_maple, menu_bottles, menu_broth,
    member_only, capacity, claimed, going_count, blurb, expected_attendance, duration_hrs, staff_count,
    is_live, outlook_event_id, outlook_synced_at, sort, vendor_id, archived_at, tenant_id
  ) values (
    new.id, 'event', new.title, new.day, new.start_time, new.end_time, new.day_label, new.plan_days, new.default_buffer_min, new.completed_at,
    new.location_text, new.state, new.county, new.type, new.category, new.archetype, new.stage, new.rig,
    new.power_available, new.water_available, new.menu_nitro, new.menu_nature_aid, new.menu_salted_maple, new.menu_bottles, new.menu_broth,
    new.member_only, new.capacity, new.claimed, new.going_count, new.blurb, new.expected_attendance, new.duration_hrs, new.staff_count,
    new.is_live, new.outlook_event_id, new.outlook_synced_at, new.sort, new.vendor_id, new.archived_at, new.tenant_id
  )
  on conflict (id) do update set
    name = excluded.name, day = excluded.day, start_time = excluded.start_time, end_time = excluded.end_time,
    day_label = excluded.day_label, plan_days = excluded.plan_days, default_buffer_min = excluded.default_buffer_min,
    completed_at = excluded.completed_at, location_text = excluded.location_text, state = excluded.state,
    county = excluded.county, type = excluded.type, category = excluded.category, archetype = excluded.archetype,
    stage = excluded.stage, rig = excluded.rig, power_available = excluded.power_available,
    water_available = excluded.water_available, menu_nitro = excluded.menu_nitro, menu_nature_aid = excluded.menu_nature_aid,
    menu_salted_maple = excluded.menu_salted_maple, menu_bottles = excluded.menu_bottles, menu_broth = excluded.menu_broth,
    member_only = excluded.member_only, capacity = excluded.capacity, claimed = excluded.claimed,
    going_count = excluded.going_count, blurb = excluded.blurb, expected_attendance = excluded.expected_attendance,
    duration_hrs = excluded.duration_hrs, staff_count = excluded.staff_count, is_live = excluded.is_live,
    outlook_event_id = excluded.outlook_event_id, outlook_synced_at = excluded.outlook_synced_at,
    sort = excluded.sort, vendor_id = excluded.vendor_id, archived_at = excluded.archived_at, tenant_id = excluded.tenant_id
  where public.field_ops.kind = 'event';
  return new;
end $$;
drop trigger if exists mirror_event_to_field_ops_tg on public.events;
create trigger mirror_event_to_field_ops_tg after insert or update or delete on public.events
  for each row execute function public.mirror_event_to_field_ops();

-- ── mirror: stops → field_ops ─────────────────────────────────────────────────────────────────────
create or replace function public.mirror_stop_to_field_ops() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    delete from public.field_ops where id = old.id and kind = 'stop';
    return old;
  end if;
  if tg_op = 'UPDATE' and new.id is distinct from old.id then
    delete from public.field_ops where id = old.id and kind = 'stop';    -- PK reassignment can't orphan a mirror row
  end if;
  insert into public.field_ops (
    id, kind, name, starts_at, ends_at, when_label, time_label, tag_label, plan_days, default_buffer_min, completed_at,
    location_text, address, lat, lng, status, menu_tier, rig,
    power_available, water_available, menu_nitro, menu_nature_aid, menu_salted_maple, menu_bottles, menu_broth,
    order_ahead_enabled, pickup_enabled, order_ahead_lead_min,
    note, notes, poc_name, poc_phone, poc_email, service_dates, sort, vendor_id, archived_at, tenant_id
  ) values (
    new.id, 'stop', new.name, new.starts_at, new.ends_at, new.when_label, new.time_label, new.tag_label, new.plan_days, new.default_buffer_min, new.completed_at,
    new.location_text, new.address, new.lat, new.lng, new.status, new.menu_tier, new.rig,
    new.power_available, new.water_available, new.menu_nitro, new.menu_nature_aid, new.menu_salted_maple, new.menu_bottles, new.menu_broth,
    new.order_ahead_enabled, new.pickup_enabled, new.order_ahead_lead_min,
    new.note, new.notes, new.poc_name, new.poc_phone, new.poc_email, new.service_dates, new.sort, new.vendor_id, new.archived_at, new.tenant_id
  )
  on conflict (id) do update set
    name = excluded.name, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
    when_label = excluded.when_label, time_label = excluded.time_label, tag_label = excluded.tag_label,
    plan_days = excluded.plan_days, default_buffer_min = excluded.default_buffer_min, completed_at = excluded.completed_at,
    location_text = excluded.location_text, address = excluded.address, lat = excluded.lat, lng = excluded.lng,
    status = excluded.status, menu_tier = excluded.menu_tier, rig = excluded.rig,
    power_available = excluded.power_available, water_available = excluded.water_available,
    menu_nitro = excluded.menu_nitro, menu_nature_aid = excluded.menu_nature_aid,
    menu_salted_maple = excluded.menu_salted_maple, menu_bottles = excluded.menu_bottles, menu_broth = excluded.menu_broth,
    order_ahead_enabled = excluded.order_ahead_enabled, pickup_enabled = excluded.pickup_enabled,
    order_ahead_lead_min = excluded.order_ahead_lead_min, note = excluded.note, notes = excluded.notes,
    poc_name = excluded.poc_name, poc_phone = excluded.poc_phone, poc_email = excluded.poc_email,
    service_dates = excluded.service_dates, sort = excluded.sort, vendor_id = excluded.vendor_id,
    archived_at = excluded.archived_at, tenant_id = excluded.tenant_id
  where public.field_ops.kind = 'stop';
  return new;
end $$;
drop trigger if exists mirror_stop_to_field_ops_tg on public.stops;
create trigger mirror_stop_to_field_ops_tg after insert or update or delete on public.stops
  for each row execute function public.mirror_stop_to_field_ops();

-- ── backfill (idempotent: the upsert path makes re-runs safe) ─────────────────────────────────────
insert into public.field_ops (
  id, kind, name, day, start_time, end_time, day_label, plan_days, default_buffer_min, completed_at,
  location_text, state, county, type, category, archetype, stage, rig,
  power_available, water_available, menu_nitro, menu_nature_aid, menu_salted_maple, menu_bottles, menu_broth,
  member_only, capacity, claimed, going_count, blurb, expected_attendance, duration_hrs, staff_count,
  is_live, outlook_event_id, outlook_synced_at, sort, vendor_id, archived_at, tenant_id)
select id, 'event', title, day, start_time, end_time, day_label, plan_days, default_buffer_min, completed_at,
  location_text, state, county, type, category, archetype, stage, rig,
  power_available, water_available, menu_nitro, menu_nature_aid, menu_salted_maple, menu_bottles, menu_broth,
  member_only, capacity, claimed, going_count, blurb, expected_attendance, duration_hrs, staff_count,
  is_live, outlook_event_id, outlook_synced_at, sort, vendor_id, archived_at, tenant_id
from public.events
on conflict (id) do nothing;

insert into public.field_ops (
  id, kind, name, starts_at, ends_at, when_label, time_label, tag_label, plan_days, default_buffer_min, completed_at,
  location_text, address, lat, lng, status, menu_tier, rig,
  power_available, water_available, menu_nitro, menu_nature_aid, menu_salted_maple, menu_bottles, menu_broth,
  order_ahead_enabled, pickup_enabled, order_ahead_lead_min,
  note, notes, poc_name, poc_phone, poc_email, service_dates, sort, vendor_id, archived_at, tenant_id)
select id, 'stop', name, starts_at, ends_at, when_label, time_label, tag_label, plan_days, default_buffer_min, completed_at,
  location_text, address, lat, lng, status, menu_tier, rig,
  power_available, water_available, menu_nitro, menu_nature_aid, menu_salted_maple, menu_bottles, menu_broth,
  order_ahead_enabled, pickup_enabled, order_ahead_lead_min,
  note, notes, poc_name, poc_phone, poc_email, service_dates, sort, vendor_id, archived_at, tenant_id
from public.stops
on conflict (id) do nothing;

-- verify:
--   select (select count(*) from events) + (select count(*) from stops) = (select count(*) from field_ops);  -- true
--   select tgname from pg_trigger where tgname like 'mirror_%_to_field_ops_tg';                              -- 2 rows
