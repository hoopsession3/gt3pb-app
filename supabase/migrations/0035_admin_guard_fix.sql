-- 0035_admin_guard_fix.sql
-- Fix silently-failing admin writes. The client grants back-office access via the
-- legacy profiles.is_admin boolean (roleOf() falls back to it), but is_admin() /
-- is_staff() only checked the role column. A user with is_admin=true and role='member'
-- could open the back office yet have every admin WRITE filtered by RLS to 0 rows —
-- e.g. "Go offline" returns no error but is_live never flips. Honor BOTH signals,
-- and re-sync any legacy admin whose role was never backfilled.

create or replace function public.is_admin() returns boolean
  language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and (role in ('admin','owner') or is_admin = true)
  );
$$;

create or replace function public.is_staff() returns boolean
  language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and (role <> 'member' or is_admin = true)
  );
$$;

-- promote legacy admins that were left at the default role (the bug case)
update public.profiles set role = 'owner' where is_admin = true and role = 'member';
