-- 0270 — EVENT PUBLISH GATE (2026-08-03, Ryan: "allow access to make events available to guest,
-- not all events should be front and center… even confirmed, allow manual selection to user view.")
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Today visibility is AUTOMATIC: 0233 made is_public a generated column (not archived · category
-- 'event' · not a private booking), so every confirmed public-category event shows the moment it
-- exists. Ryan wants visibility to be a DECISION — publish by choice, even for a confirmed event.
--
-- The architecture already has the right two-layer shape; we add the second layer, we don't rebuild:
--   • is_public (0233, generated, UNCHANGED) stays the PRIVACY FLOOR — it still hides private
--     bookings and internal ops rows at the database, mirror-proof, on both events and field_ops.
--   • published_at (NEW, manual) is the PUBLISH GATE — null = guests never see it (the default for
--     every new event, however created), set = you published it, with the date as provenance.
-- The guest door becomes "is_public AND published" for events; truck stops (field_ops kind='stop')
-- stay auto-public — Find Us's whole job is "where's the truck," never gated. One rule, both doors,
-- no per-surface filters to drift. Server routes (agents, outlook, webhook) use the service role and
-- are untouched. Apply after 0269.

-- ── the publish gate + optional guest-facing name, on BOTH doors ─────────────────────────────────
alter table public.events    add column if not exists published_at timestamptz;
alter table public.events    add column if not exists public_title text;
alter table public.field_ops add column if not exists published_at timestamptz;
alter table public.field_ops add column if not exists public_title text;

-- ── the mirror learns the two new columns (0222) so events→field_ops never drifts ────────────────
create or replace function public.mirror_event_to_field_ops() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    delete from public.field_ops where id = old.id and kind = 'event';
    return old;
  end if;
  if tg_op = 'UPDATE' and new.id is distinct from old.id then
    delete from public.field_ops where id = old.id and kind = 'event';
  end if;
  insert into public.field_ops (
    id, kind, name, day, start_time, end_time, day_label, plan_days, default_buffer_min, completed_at,
    location_text, state, county, type, category, archetype, stage, rig,
    power_available, water_available, menu_nitro, menu_nature_aid, menu_salted_maple, menu_bottles, menu_broth,
    member_only, capacity, claimed, going_count, blurb, expected_attendance, duration_hrs, staff_count,
    is_live, outlook_event_id, outlook_synced_at, sort, vendor_id, archived_at, tenant_id,
    published_at, public_title
  ) values (
    new.id, 'event', new.title, new.day, new.start_time, new.end_time, new.day_label, new.plan_days, new.default_buffer_min, new.completed_at,
    new.location_text, new.state, new.county, new.type, new.category, new.archetype, new.stage, new.rig,
    new.power_available, new.water_available, new.menu_nitro, new.menu_nature_aid, new.menu_salted_maple, new.menu_bottles, new.menu_broth,
    new.member_only, new.capacity, new.claimed, new.going_count, new.blurb, new.expected_attendance, new.duration_hrs, new.staff_count,
    new.is_live, new.outlook_event_id, new.outlook_synced_at, new.sort, new.vendor_id, new.archived_at, new.tenant_id,
    new.published_at, new.public_title
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
    sort = excluded.sort, vendor_id = excluded.vendor_id, archived_at = excluded.archived_at, tenant_id = excluded.tenant_id,
    published_at = excluded.published_at, public_title = excluded.public_title
  where public.field_ops.kind = 'event';
  return new;
end $$;

-- ── migration-day continuity: everything guests can see RIGHT NOW gets stamped published, so the ──
--    public calendar looks identical the moment this ships. You then curate DOWN, one tap per event
--    you'd rather not advertise. (The alternative — ship dark, republish by hand — would blank the
--    public calendar for a day. Rejected.) is_public already = the exact set guests see today.
update public.events set published_at = now()
  where is_public and published_at is null;                 -- fires the mirror for each row
update public.field_ops set published_at = now()
  where kind = 'event' and is_public and published_at is null;   -- belt-and-suspenders for un-touched mirror rows

-- ── the door — events now need the publish gate; stops stay auto-public ──────────────────────────
drop policy if exists "public read events" on public.events;
create policy "public read events" on public.events for select
  using ((is_public and published_at is not null) or (select public.is_staff()));

drop policy if exists "field ops read" on public.field_ops;
create policy "field ops read" on public.field_ops for select
  using ((is_public and (kind = 'stop' or published_at is not null)) or (select public.is_staff()));

create index if not exists events_published_idx on public.events (day) where (is_public and published_at is not null);

-- ── the record (the no-drift gate requires this) ─────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('You choose which events guests see','feature','Crew',
   'Events are now published by choice, not by default — a confirmed event stays private until you publish it, with one tap in the calendar pop-out (and an optional guest-facing name). Truck stops still show automatically. Everything already visible stayed visible when this shipped; private bookings became genuinely protected at the database, not just hidden in the page.',
   '2026-08-03', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- Verify (prod, after apply):
--   anon: GET /rest/v1/events?select=id&published_at=is.null    -- 0 rows (guests never see unpublished)
--   select count(*) from events where is_public and published_at is null;   -- 0 right after apply (backfill covered them)
--   select count(*) from field_ops fo join events e on e.id=fo.id where (fo.published_at is null) <> (e.published_at is null);  -- 0 (mirror holds)
