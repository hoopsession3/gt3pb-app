-- 0474 ROLLBACK — the crew's read of every customer back (0151's "customers staff read") and 0473's vision_shared
-- (a dead link raises PT404 again; misses not counted). Apply BEFORE rolling the app back past the review branch.
-- Leaves 0473 as it is. Its one limit: miss counts already made age out in ten minutes.
set lock_timeout = '5s';
begin;
drop policy if exists "customers admin read" on public.customers;
drop policy if exists "customers staff read" on public.customers;
create policy "customers staff read" on public.customers for select using ((select public.is_staff()));
create or replace function public.vision_shared(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.vision_shares; v_from text;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'This link isn''t live.' using errcode = 'PT404';
  end if;
  select * into s from public.vision_shares
   where token = p_token and revoked_at is null and (expires_at is null or expires_at > now()) and published is not null;
  if not found then
    raise exception 'This link isn''t live.' using errcode = 'PT404';
  end if;
  -- 0473: counted only when the open would succeed (a raise below would undo the count anyway).
  v_from := public.caller_address();
  if v_from is not null and not public.rate_limit_hit('vision_shared:' || v_from, 600000, 60) then
    raise exception 'Too many opens from this network — try again in a few minutes.' using errcode = 'PT429';
  end if;
  perform set_config('gt3.share_open', 'on', true);
  update public.vision_shares set opens = opens + 1, last_opened_at = now() where id = s.id;
  perform set_config('gt3.share_open', 'off', true);
  return public.vision_share_live(s);
end $$;
revoke all on function public.vision_shared(text) from public, anon, authenticated;
grant execute on function public.vision_shared(text) to anon, authenticated;
delete from public.schema_migrations where version = '0474_a_customer_book_is_the_owners_and_a_wrong_link_is_counted';
commit;
reset lock_timeout;
