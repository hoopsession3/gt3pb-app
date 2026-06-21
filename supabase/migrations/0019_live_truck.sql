-- 0019 — robust live-truck control. admin_set_live now UPSERTS the single live_status
-- row (so it can't silently no-op if the row is missing), and a dedicated
-- admin_set_offline lets the operator pause/stop without needing a current stop.
create or replace function public.admin_set_live(stop uuid, live boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.stops set status = case when id = stop then 'live' else 'upcoming' end;
  insert into public.live_status (id, current_stop_id, is_live) values (1, stop, live)
  on conflict (id) do update set current_stop_id = excluded.current_stop_id, is_live = excluded.is_live;
end; $$;

create or replace function public.admin_set_offline()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.stops set status = 'upcoming' where status = 'live';
  insert into public.live_status (id, is_live) values (1, false)
  on conflict (id) do update set is_live = false;
end; $$;

grant execute on function public.admin_set_offline() to authenticated;
