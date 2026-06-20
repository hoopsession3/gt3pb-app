-- 0003 — admin role + admin-only writes + management RPCs
-- The owner's login gets admin rights; admins manage truck/stops/events/members in realtime.

-- 1) admin flag on profiles
alter table public.profiles add column if not exists is_admin boolean not null default false;

-- 2) is_admin() — SECURITY DEFINER so it can be used inside RLS policies without recursion
create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- 3) admins may write the operational tables (members see changes in realtime)
drop policy if exists "admin write stops" on public.stops;
create policy "admin write stops" on public.stops for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin write live" on public.live_status;
create policy "admin write live" on public.live_status for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin write events" on public.events;
create policy "admin write events" on public.events for all using (public.is_admin()) with check (public.is_admin());

-- 4) admins may read all member profiles (members still read only their own)
drop policy if exists "admin read profiles" on public.profiles;
create policy "admin read profiles" on public.profiles for select using (public.is_admin());

-- 5) member management via a DEFINER RPC (bypasses the display_name-only column grant; admin-gated)
create or replace function public.admin_set_member(member uuid, new_points int, new_credit_cents int, new_founding boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.profiles
     set points = coalesce(new_points, points),
         credit_cents = coalesce(new_credit_cents, credit_cents),
         founding_member = coalesce(new_founding, founding_member)
   where id = member;
end; $$;

-- 6) "go live at this stop" — atomic across stops + live_status (admin-gated)
create or replace function public.admin_set_live(stop uuid, live boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.stops set status = case when id = stop then 'live' else 'upcoming' end;
  update public.live_status set current_stop_id = stop, is_live = live where id = 1;
end; $$;

grant execute on function public.admin_set_member(uuid, int, int, boolean) to authenticated;
grant execute on function public.admin_set_live(uuid, boolean) to authenticated;
grant execute on function public.is_admin() to authenticated, anon;

-- 7) designate the owner as admin (existing profile + future signups)
update public.profiles set is_admin = true
 where id in (select id from auth.users where lower(email) = 'ryanthompkins@icloud.com');

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  nm   text;
  base text;
  ref  text;
begin
  nm := coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), initcap(split_part(new.email, '@', 1)));
  base := upper(regexp_replace(split_part(nm, ' ', 1), '[^A-Za-z0-9]', '', 'g'));
  if base = '' then base := 'GT3'; end if;
  ref := left(base, 8) || '-' || upper(substr(md5(new.id::text), 1, 4));
  begin
    insert into public.profiles (id, display_name, referral_code, is_admin)
    values (new.id, nm, ref, lower(new.email) = 'ryanthompkins@icloud.com')
    on conflict (id) do nothing;
  exception when unique_violation then
    insert into public.profiles (id, display_name, referral_code, is_admin)
    values (new.id, nm, left(base, 8) || '-' || upper(substr(md5(new.id::text || clock_timestamp()::text), 1, 8)), lower(new.email) = 'ryanthompkins@icloud.com')
    on conflict (id) do nothing;
  end;
  return new;
end; $$;
