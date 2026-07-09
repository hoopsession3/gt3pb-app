-- 0149 — DRIVER TAG. A crew member can be tagged as a delivery driver, independent of their role
-- (an operator or server can also drive). Powers the /driver run screen and delivery-run assignment.
-- Direct profile writes are RLS-locked, so the toggle goes through a security-definer RPC gated to
-- admins/owners — same shape as admin_set_role (0023).

alter table public.profiles add column if not exists is_driver boolean not null default false;

create or replace function public.admin_set_driver(member uuid, val boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.profiles set is_driver = coalesce(val, false) where id = member;
end; $$;
grant execute on function public.admin_set_driver(uuid, boolean) to authenticated;

-- verify:
--   select count(*) from information_schema.columns where table_name='profiles' and column_name='is_driver';  -- 1
--   select count(*) from pg_proc where proname='admin_set_driver';  -- 1
select
  (select count(*) from information_schema.columns where table_name='profiles' and column_name='is_driver') as col,
  (select count(*) from pg_proc where proname='admin_set_driver') as fn;
