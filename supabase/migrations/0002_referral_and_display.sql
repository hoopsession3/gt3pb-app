-- 0002 — collision-safe referral codes + display labels for the live truck/events screens
-- Paste into Supabase → SQL Editor → Run. Idempotent.

-- 1) Collision-safe profile creation.
-- The previous trigger could raise unique_violation on referral_code (two members with the
-- same first name → same code), which aborts signup. This version derives the suffix from the
-- user id (unique) and falls back to a longer suffix on the rare clash.
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
    insert into public.profiles (id, display_name, referral_code)
    values (new.id, nm, ref)
    on conflict (id) do nothing;
  exception when unique_violation then
    insert into public.profiles (id, display_name, referral_code)
    values (new.id, nm, left(base, 8) || '-' || upper(substr(md5(new.id::text || clock_timestamp()::text), 1, 8)))
    on conflict (id) do nothing;
  end;
  return new;
end; $$;

-- 2) Display labels the live screens render.
alter table public.stops  add column if not exists when_label text;
alter table public.stops  add column if not exists time_label text;
alter table public.stops  add column if not exists tag_label  text;
alter table public.events add column if not exists day_label  text;

update public.stops set when_label='NOW', time_label='til 3p', tag_label='Live' where name='Duncan Town Square';
update public.stops set when_label='SUN', time_label='10–2',   tag_label='Sun'  where name='Greenville Run Club';
update public.stops set when_label='WED', time_label='7–11',   tag_label='Wed'  where name='Spartanburg Market';
update public.stops set when_label='SAT', time_label='2:30',   tag_label='Next' where name='Founding First Pour';

update public.events set day_label='SAT' where title='Duncan Town Square';
update public.events set day_label='SAT' where title='Founding First Pour';
update public.events set day_label='SUN' where title='Greenville Run Club';
