-- 0124 — fix "Couldn't go live — UPDATE requires a WHERE clause". admin_set_live (0022) swept
-- the whole stops table with an unqualified UPDATE (set the target live, everything else back to
-- upcoming). Supabase's safe-update guard now rejects UPDATEs without a WHERE, so going live
-- failed outright. Same semantics, scoped to the only rows that can actually change: the target
-- stop, and whatever is currently live (which steps back to 'upcoming'). 'done' stays 'done';
-- everything else is already 'upcoming' and doesn't need touching.
create or replace function public.admin_set_live(stop uuid, live boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.stops
     set status = case
                    when id = stop and live then 'live'
                    when status = 'done'    then 'done'
                    else 'upcoming'
                  end
   where id = stop or status = 'live';
  insert into public.live_status (id, current_stop_id, is_live) values (1, stop, live)
  on conflict (id) do update set current_stop_id = excluded.current_stop_id, is_live = excluded.is_live;
end; $$;
