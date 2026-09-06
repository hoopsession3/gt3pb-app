-- 0279 — CARRY MARKET THROUGH TO THE ROAD. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- THE BUG THIS CLOSES, plainly: 0275 added `market` to both `stops` and `field_ops`, but field_ops
-- is not written by hand — it is a MIRROR, maintained by after-triggers on stops and events (0222).
-- Those two trigger functions copy an explicit list of ~40 columns, and `market` was never added to
-- either list. So a stop tagged 'atlanta' mirrored into field_ops as 'greenville' (the column
-- default), because the mirror simply never mentioned the column.
--
-- That is worse than the market column not existing at all: every customer-facing screen reads
-- field_ops, so filtering Find Us by market would have looked correct, passed review, and shown
-- Atlanta's stops to Greenville anyway — silently, with no error to notice. The spine reached the
-- database in 0275 and stopped one table short of the road.
--
-- ZERO REGRESSION: with one market every row is 'greenville' on both sides, so the added column
-- changes no value that exists today. The backfill is a no-op resync in that state (it only touches
-- rows where the mirror actually disagrees with its source), and it is safe to run repeatedly.
--
-- Apply after 0278.

-- ── 1. The stop mirror learns the column ─────────────────────────────────────────────────────────
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
    note, notes, poc_name, poc_phone, poc_email, service_dates, sort, vendor_id, archived_at, tenant_id, market
  ) values (
    new.id, 'stop', new.name, new.starts_at, new.ends_at, new.when_label, new.time_label, new.tag_label, new.plan_days, new.default_buffer_min, new.completed_at,
    new.location_text, new.address, new.lat, new.lng, new.status, new.menu_tier, new.rig,
    new.power_available, new.water_available, new.menu_nitro, new.menu_nature_aid, new.menu_salted_maple, new.menu_bottles, new.menu_broth,
    new.order_ahead_enabled, new.pickup_enabled, new.order_ahead_lead_min,
    new.note, new.notes, new.poc_name, new.poc_phone, new.poc_email, new.service_dates, new.sort, new.vendor_id, new.archived_at, new.tenant_id, new.market
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
    archived_at = excluded.archived_at, tenant_id = excluded.tenant_id, market = excluded.market
  where public.field_ops.kind = 'stop';
  return new;
end $$;

-- ── 2. The event mirror learns it too ────────────────────────────────────────────────────────────
-- Rebuilt from the live catalog rather than retyped, so this cannot drift from whatever columns the
-- event mirror carries today: it copies the existing function body and splices `market` into the
-- three places it belongs (column list, values list, conflict set). If the body ever stops matching
-- the expected shape the DO block raises instead of writing a half-correct trigger.
do $$
declare
  src text;
  patched text;
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'mirror_event_to_field_ops';

  if src is null then
    raise notice '0279: mirror_event_to_field_ops() not present — skipping (nothing to patch).';
    return;
  end if;

  if position('market' in src) > 0 then
    raise notice '0279: event mirror already carries market — no change.';
    return;
  end if;

  -- archived_at, tenant_id is the tail of all three lists in 0222's event mirror.
  if position('archived_at, tenant_id' in src) = 0
     or position('new.archived_at, new.tenant_id' in src) = 0
     or position('archived_at = excluded.archived_at, tenant_id = excluded.tenant_id' in src) = 0 then
    raise exception '0279: event mirror body is not the shape this migration expects — patch it by hand rather than let this guess.';
  end if;

  patched := replace(src, 'archived_at, tenant_id', 'archived_at, tenant_id, market');
  patched := replace(patched, 'new.archived_at, new.tenant_id, market', 'new.archived_at, new.tenant_id, new.market');
  patched := replace(patched,
    'archived_at = excluded.archived_at, tenant_id = excluded.tenant_id, market',
    'archived_at = excluded.archived_at, tenant_id = excluded.tenant_id, market = excluded.market');
  execute patched;
end $$;

-- ── 3. Resync any mirror row that already disagrees with its source ──────────────────────────────
-- With one market this matches nothing. It exists so the fix is complete rather than only forward-
-- looking: any row written between 0275 and this migration carries the default, not its real market.
update public.field_ops fo
   set market = s.market
  from public.stops s
 where fo.id = s.id and fo.kind = 'stop' and fo.market is distinct from s.market;

do $$
begin
  if to_regclass('public.events') is not null
     and exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'events' and column_name = 'market') then
    update public.field_ops fo
       set market = e.market
      from public.events e
     where fo.id = e.id and fo.kind = 'event' and fo.market is distinct from e.market;
  end if;
end $$;

-- ── the record (no-drift gate) ───────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The road knows which city it belongs to','improvement','Ops',
   'Stops and events can now be tagged with the market they belong to, and that tag follows them all the way to the customer screens — so Find Us shows the city you are actually in, and whether ordering is open is decided by your city''s next stop rather than by whichever stop happens to be next anywhere. Nothing changes while only one city is running: with a single market every screen behaves exactly as it did, and the city switcher only appears once a second city genuinely has something on the road.',
   '2026-09-06', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- ── verify (run after) ────────────────────────────────────────────────────────────────────────────
--   -- both mirrors now mention the column:
--   select proname, position('market' in pg_get_functiondef(p.oid)) > 0 as carries_market
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname='public' and proname like 'mirror_%_to_field_ops' order by 1;   -- expect: both true
--
--   -- no mirror row disagrees with its source:
--   select count(*) from public.field_ops fo join public.stops s on s.id = fo.id
--    where fo.kind='stop' and fo.market is distinct from s.market;                  -- expect: 0
--
--   -- and the round trip actually works (safe: it sets a stop to its own current market):
--   update public.stops set market = market where id = (select id from public.stops limit 1);
--   select fo.market from public.field_ops fo where fo.id = (select id from public.stops limit 1);
--
--   -- everything still reads as one market until someone tags a stop:
--   select market, count(*) from public.field_ops group by 1 order by 1;
