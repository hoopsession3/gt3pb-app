-- 0022 - live truck GPS position (the moving map dot). Ported from the edits-pvmqdc
-- branch, reconciled with main's 0019/0021 (keeps the upsert + admin_set_offline split).
-- Idempotent. Apply in Supabase > SQL Editor.

-- 1) Live position columns on the single live_status row. live_status is already in the
--    realtime publication, so updates to these stream to the public Truck page for free.
alter table public.live_status add column if not exists truck_lat      double precision;
alter table public.live_status add column if not exists truck_lng      double precision;
alter table public.live_status add column if not exists pos_updated_at timestamptz;

-- 2) Admin-gated RPC the truck's phone calls to drop / update its live position.
create or replace function public.admin_set_truck_pos(lat double precision, lng double precision)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.live_status set truck_lat = lat, truck_lng = lng, pos_updated_at = now() where id = 1;
end; $$;
grant execute on function public.admin_set_truck_pos(double precision, double precision) to authenticated;

-- 3) Go-live: keep main's upsert (so a missing live_status row can't make it a no-op),
--    AND preserve already-finished stops instead of resetting them to 'upcoming'.
create or replace function public.admin_set_live(stop uuid, live boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.stops
     set status = case
                    when id = stop and live then 'live'
                    when status = 'done'    then 'done'
                    else 'upcoming'
                  end;
  insert into public.live_status (id, current_stop_id, is_live) values (1, stop, live)
  on conflict (id) do update set current_stop_id = excluded.current_stop_id, is_live = excluded.is_live;
end; $$;

-- 4) Go offline: clear the live position too, so the dot disappears the moment the
--    truck stops (in addition to nulling the current stop from 0021).
create or replace function public.admin_set_offline()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.stops set status = 'upcoming' where status = 'live';
  insert into public.live_status (id, is_live, current_stop_id, truck_lat, truck_lng, pos_updated_at)
    values (1, false, null, null, null, null)
  on conflict (id) do update set is_live = false, current_stop_id = null, truck_lat = null, truck_lng = null, pos_updated_at = null;
end; $$;
