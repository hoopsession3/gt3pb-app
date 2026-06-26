-- 0099 — add Kayla Thompkins (kayla@gt3pb.com) as an OWNER. Owners are seeded by email in the
-- new-signup trigger (alongside Ryan). This adds her to that allowlist so she's an owner the moment
-- she signs in, AND promotes her now if she already has an account.

-- 1) New-signup trigger: treat Kayla's email as owner too (mirrors 0023's handle_new_user).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare nm text; base text; ref text; is_own boolean;
begin
  is_own := lower(new.email) in ('ryanthompkins@icloud.com', 'kayla@gt3pb.com');
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

-- 2) If she's already signed up, promote her profile to owner now + set her name.
update public.profiles p
set role = 'owner', is_admin = true, display_name = 'Kayla Thompkins'
from auth.users u
where u.id = p.id and lower(u.email) = 'kayla@gt3pb.com';
