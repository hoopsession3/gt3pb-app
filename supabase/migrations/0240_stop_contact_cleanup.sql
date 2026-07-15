-- 0240 — stop contact cleanup: poc_name/poc_phone/poc_email/service_dates on `stops` (and their
-- field_ops mirror) are DEAD, WORLD-READABLE columns. `stops` has never had a column-level SELECT
-- restriction — its RLS is row-level `using (true)`, unchanged since 0001 — so any anon or
-- authenticated client can read them today (Wave-1 audit finding). But nothing in the app writes
-- to them: the 0226 vendor-identity consolidation moved point-of-contact data onto `vendors`
-- (which IS properly locked down — is_admin()-gated, no public read policy). Verified against
-- BOTH the code and the live table before writing this:
--   • grep: the only POC editor in app/crew/page.tsx is gated `kind === 'vendor'`, which targets
--     the vendors table — zero INSERT/UPDATE call sites ever write stops.poc_* or
--     field_ops.poc_* (field_ops is a trigger-maintained mirror; its only writer is 0222's
--     mirror_stop_to_field_ops(), sourced from stops).
--   • live data (2026-07-15): 0 of 6 stops and 0 of 6 field_ops stop-rows carry a non-null value
--     in any of the four columns.
--
-- This closes the pending 0224 field_ops-contract prerequisite ("stop POC fields MUST move behind
-- staff-only access") the simple way: since the columns are provably dead, DROP them rather than
-- relocating them behind a staff-gated sibling table (the 0195 pattern used for crew_brief/
-- dress_code/recap, which had live data to preserve) — there is no live functionality here to
-- preserve. If a real "who do I call at this stop" need shows up later, it belongs on the vendor
-- record (one canonical POC per place, already staff-gated) via the existing vendor_id link, not
-- re-added to the public stop row.

-- Guard: abort instead of silently dropping data if anything slipped in between the audit above
-- and this running (belt-and-suspenders — same shape as the 0238 duplicate guard).
do $$
begin
  if exists (
    select 1 from public.stops
    where poc_name is not null or poc_phone is not null or poc_email is not null or service_dates is not null
  ) then
    raise exception '0240 guard: stops has non-null poc/service_dates data — this migration only drops proven-dead columns; investigate before re-running';
  end if;
  if exists (
    select 1 from public.field_ops where kind = 'stop'
      and (poc_name is not null or poc_phone is not null or poc_email is not null or service_dates is not null)
  ) then
    raise exception '0240 guard: field_ops has non-null poc/service_dates data — investigate before re-running';
  end if;
end $$;

-- 1. the mirror trigger function must stop referencing these columns BEFORE they're dropped from
--    stops — a NEW.poc_name reference would error at runtime the moment the source column is gone.
--    (events never had these columns — mirror_event_to_field_ops() is untouched.)
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
    note, notes, sort, vendor_id, archived_at, tenant_id
  ) values (
    new.id, 'stop', new.name, new.starts_at, new.ends_at, new.when_label, new.time_label, new.tag_label, new.plan_days, new.default_buffer_min, new.completed_at,
    new.location_text, new.address, new.lat, new.lng, new.status, new.menu_tier, new.rig,
    new.power_available, new.water_available, new.menu_nitro, new.menu_nature_aid, new.menu_salted_maple, new.menu_bottles, new.menu_broth,
    new.order_ahead_enabled, new.pickup_enabled, new.order_ahead_lead_min,
    new.note, new.notes, new.sort, new.vendor_id, new.archived_at, new.tenant_id
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
    sort = excluded.sort, vendor_id = excluded.vendor_id,
    archived_at = excluded.archived_at, tenant_id = excluded.tenant_id
  where public.field_ops.kind = 'stop';
  return new;
end $$;

-- 2. drop the dead columns from both the source row and the mirror row.
alter table public.stops     drop column if exists poc_name;
alter table public.stops     drop column if exists poc_phone;
alter table public.stops     drop column if exists poc_email;
alter table public.stops     drop column if exists service_dates;
alter table public.field_ops drop column if exists poc_name;
alter table public.field_ops drop column if exists poc_phone;
alter table public.field_ops drop column if exists poc_email;
alter table public.field_ops drop column if exists service_dates;

-- verify:
--   select count(*) from information_schema.columns where table_name in ('stops','field_ops')
--     and column_name in ('poc_name','poc_phone','poc_email','service_dates');  -- expect 0
--   select tgname from pg_trigger where tgname = 'mirror_stop_to_field_ops_tg';  -- still 1 row, still fires
--   update public.stops set name = name where id = (select id from public.stops limit 1);  -- trigger fires clean
--   anon probe: GET /rest/v1/stops?select=poc_name      -- 42703 undefined column (gone, not just hidden)
--   anon probe: GET /rest/v1/field_ops?select=poc_name  -- 42703 undefined column
