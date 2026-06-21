-- 0023 — owner / admin / server roles (replaces binary is_admin god-mode).
-- member  : default, no back-office.
-- server  : KDS only (advance order status). No member data, pricing, or live-truck.
-- admin   : all ops (KDS, live truck, events, reserves, bookings, subscription fulfillment).
-- owner   : everything, incl. member credit/points + assigning roles + finance.
-- is_admin() is redefined to mean admin OR owner, so every existing operational RLS
-- policy keeps working unchanged. The is_admin boolean column is kept as a synced mirror.

alter table public.profiles add column if not exists role text not null default 'member'
  check (role in ('member', 'server', 'admin', 'owner'));

-- Backfill: the only admin today is the owner. Keep the boolean column in sync going forward.
update public.profiles set role = 'owner' where is_admin = true and role <> 'owner';
update public.profiles set is_admin = (role in ('admin', 'owner'));

-- is_admin() = admin or owner (all existing operational policies/RPCs keep working).
create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select role in ('admin', 'owner') from public.profiles where id = auth.uid()), false);
$$;
-- is_owner() = the sensitive tier (member credit/points, role assignment, finance).
create or replace function public.is_owner()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select role = 'owner' from public.profiles where id = auth.uid()), false);
$$;
-- is_staff() = server and up (KDS access).
create or replace function public.is_staff()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select role in ('server', 'admin', 'owner') from public.profiles where id = auth.uid()), false);
$$;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.is_staff() to authenticated, anon;

-- Editing a member's points/credit/founding is OWNER-only now (was admin).
create or replace function public.admin_set_member(member uuid, new_points int, new_credit_cents int, new_founding boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'not authorized'; end if;
  update public.profiles
     set points = coalesce(new_points, points),
         credit_cents = coalesce(new_credit_cents, credit_cents),
         founding_member = coalesce(new_founding, founding_member)
   where id = member;
end; $$;

-- Assigning roles is OWNER-only. Keeps the is_admin mirror in sync.
create or replace function public.admin_set_role(member uuid, new_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'not authorized'; end if;
  if new_role not in ('member', 'server', 'admin', 'owner') then raise exception 'invalid role'; end if;
  update public.profiles set role = new_role, is_admin = (new_role in ('admin', 'owner')) where id = member;
end; $$;
grant execute on function public.admin_set_role(uuid, text) to authenticated;

-- Staff (server+) can READ all orders for the KDS, and advance status through a DEFINER
-- RPC only — a server gets no broad table write (can't touch total_cents/paid).
drop policy if exists "staff read orders" on public.orders;
create policy "staff read orders" on public.orders for select using (public.is_staff());

create or replace function public.staff_set_order_status(p_order uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  if p_status not in ('new', 'preparing', 'ready', 'done', 'void') then raise exception 'invalid status'; end if;
  update public.orders set status = p_status where id = p_order;
end; $$;
grant execute on function public.staff_set_order_status(uuid, text) to authenticated;

-- New signups: role mirrors the owner-email seed (everyone else is a member).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare nm text; base text; ref text; is_own boolean;
begin
  is_own := lower(new.email) = 'ryanthompkins@icloud.com';
  nm := coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), initcap(split_part(new.email, '@', 1)));
  base := upper(regexp_replace(split_part(nm, ' ', 1), '[^A-Za-z0-9]', '', 'g'));
  if base = '' then base := 'GT3'; end if;
  ref := left(base, 8) || '-' || upper(substr(md5(new.id::text), 1, 4));
  begin
    insert into public.profiles (id, display_name, referral_code, is_admin, role)
    values (new.id, nm, ref, is_own, case when is_own then 'owner' else 'member' end)
    on conflict (id) do nothing;
  exception when unique_violation then
    insert into public.profiles (id, display_name, referral_code, is_admin, role)
    values (new.id, nm, left(base, 8) || '-' || upper(substr(md5(new.id::text || clock_timestamp()::text), 1, 8)), is_own, case when is_own then 'owner' else 'member' end)
    on conflict (id) do nothing;
  end;
  return new;
end; $$;
