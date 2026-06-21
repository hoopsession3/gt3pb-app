-- 0004 — live truck position, single-source live status, and de-duplicated RSVPs
-- Paste into Supabase → SQL Editor → Run. Idempotent.

-- ───────────────────────── 1) live truck GPS position ─────────────────────────
-- The truck's phone publishes its location; members see the dot move in realtime.
alter table public.live_status add column if not exists truck_lat      double precision;
alter table public.live_status add column if not exists truck_lng      double precision;
alter table public.live_status add column if not exists pos_updated_at timestamptz;

-- admin-gated RPC the truck calls to drop/update its live position
create or replace function public.admin_set_truck_pos(lat double precision, lng double precision)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.live_status
     set truck_lat = lat, truck_lng = lng, pos_updated_at = now()
   where id = 1;
end; $$;
grant execute on function public.admin_set_truck_pos(double precision, double precision) to authenticated;

-- ───────────────────────── 2) go-live / pause: single source of truth ─────────────────────────
-- Previous version always set the chosen stop to 'live' (even when pausing) and reset every
-- other stop to 'upcoming' (wiping 'done' history). Now status reflects the live flag and
-- already-finished stops stay 'done'.
create or replace function public.admin_set_live(stop uuid, live boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.stops
     set status = case
                    when id = stop and live then 'live'
                    when status = 'done'    then 'done'   -- preserve finished stops
                    else 'upcoming'
                  end;
  update public.live_status set current_stop_id = stop, is_live = live where id = 1;
end; $$;

-- ───────────────────────── 3) de-duplicated, reversible RSVPs ─────────────────────────
-- One RSVP per signed-in member per event, and members can cancel (delete) their own.
-- Not partial: NULL user_ids (anonymous RSVPs) are distinct in a unique index, so anon can
-- still RSVP, signed-in members are de-duped, and PostgREST upsert can target this index.
create unique index if not exists rsvps_user_event_uniq
  on public.rsvps (event_id, user_id);

drop policy if exists "own rsvps update" on public.rsvps;
create policy "own rsvps update" on public.rsvps for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own rsvps delete" on public.rsvps;
create policy "own rsvps delete" on public.rsvps for delete using (auth.uid() = user_id);

-- ───────────────────────── 4) give the seed stops coordinates + real open times ─────────────────────────
-- Coordinates so the route map (and the live truck dot) actually render on a real backend;
-- starts_at so the "Next stop in" countdown is driven by data, not a hardcoded clock.
update public.stops set lat = 34.9382, lng = -82.1426 where name = 'Duncan Town Square'  and lat is null;
update public.stops set lat = 34.8526, lng = -82.3940 where name = 'Greenville Run Club'  and lat is null;
update public.stops set lat = 34.9496, lng = -81.9320 where name = 'Spartanburg Market'   and lat is null;
update public.stops set lat = 34.9387, lng = -82.2271 where name = 'Founding First Pour'  and lat is null;

update public.stops set starts_at = (current_date + time '15:00'), ends_at = (current_date + time '15:00') where name = 'Duncan Town Square' and starts_at is null;
update public.stops set starts_at = (current_date + interval '1 day' + time '10:00'), ends_at = (current_date + interval '1 day' + time '14:00') where name = 'Greenville Run Club' and starts_at is null;
update public.stops set starts_at = (current_date + interval '4 day' + time '07:00'), ends_at = (current_date + interval '4 day' + time '11:00') where name = 'Spartanburg Market' and starts_at is null;
update public.stops set starts_at = (current_date + interval '6 day' + time '14:30'), ends_at = (current_date + interval '6 day' + time '17:00') where name = 'Founding First Pour' and starts_at is null;
