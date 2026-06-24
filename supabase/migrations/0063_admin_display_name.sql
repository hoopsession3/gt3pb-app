-- 0063 — let an admin rename a member (profiles update RLS is self-only, so this goes via an RPC).
create or replace function public.admin_set_display_name(member uuid, name text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.profiles set display_name = nullif(btrim(name), '') where id = member;
end; $$;
