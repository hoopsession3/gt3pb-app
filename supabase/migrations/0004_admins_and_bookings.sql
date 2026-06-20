-- 0004 — multiple admins (by email) + booking-request capture & management

-- 1) maintainable admin email list (RLS on, no select policy → not readable via API)
create table if not exists public.admin_emails (email text primary key);
alter table public.admin_emails enable row level security;
insert into public.admin_emails (email) values
  ('ryanthompkins@icloud.com'), ('ryan@gt3pb.com'), ('ryan@tech-drip.com'), ('kayla@gt3pb.com')
on conflict do nothing;

-- promote any existing matching profiles to admin
update public.profiles set is_admin = true
 where id in (select u.id from auth.users u join public.admin_emails a on lower(u.email) = a.email);

-- new signups auto-admin if their email is on the list
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare nm text; base text; ref text; adm boolean;
begin
  nm := coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), initcap(split_part(new.email, '@', 1)));
  base := upper(regexp_replace(split_part(nm, ' ', 1), '[^A-Za-z0-9]', '', 'g'));
  if base = '' then base := 'GT3'; end if;
  ref := left(base, 8) || '-' || upper(substr(md5(new.id::text), 1, 4));
  adm := lower(new.email) in (select email from public.admin_emails);
  begin
    insert into public.profiles (id, display_name, referral_code, is_admin)
    values (new.id, nm, ref, adm) on conflict (id) do nothing;
  exception when unique_violation then
    insert into public.profiles (id, display_name, referral_code, is_admin)
    values (new.id, nm, left(base, 8) || '-' || upper(substr(md5(new.id::text || clock_timestamp()::text), 1, 8)), adm) on conflict (id) do nothing;
  end;
  return new;
end; $$;

-- 2) booking requests (B2B "book the bar" + event requests)
create table if not exists public.booking_requests (
  id            uuid primary key default gen_random_uuid(),
  name          text,
  email         text,
  phone         text,
  event_date    date,
  headcount     int,
  location_text text,
  notes         text,
  status        text not null default 'new' check (status in ('new', 'contacted', 'booked', 'declined')),
  created_at    timestamptz not null default now()
);
alter table public.booking_requests enable row level security;

-- anyone can submit a request; only admins can read / manage them
drop policy if exists "anyone request" on public.booking_requests;
create policy "anyone request" on public.booking_requests for insert with check (true);
drop policy if exists "admin manage requests" on public.booking_requests;
create policy "admin manage requests" on public.booking_requests for all using (public.is_admin()) with check (public.is_admin());

alter publication supabase_realtime add table public.booking_requests;
