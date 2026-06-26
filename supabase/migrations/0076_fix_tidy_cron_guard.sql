-- 0076 — fix the tidy_stale_content() admin guard so the weekly pg_cron auto-tidy actually runs.
-- 0074 scheduled a Monday 07:00 job ("select public.tidy_stale_content(14)"), but the function
-- raised 'admin only' under cron: cron has no JWT, so auth.uid() is NULL, is_admin() returns false,
-- and the guard tripped — the sweep failed silently every week. Gate the guard on a present session
-- instead: real API callers always have auth.uid() set (so non-admins are still blocked), and only the
-- internal cron / service-role context (auth.uid() IS NULL) is allowed through. Idempotent (replace).
create or replace function public.tidy_stale_content(grace_days int default 14) returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  -- block authenticated non-admins; allow the no-JWT internal path (pg_cron) through
  if auth.uid() is not null and not public.is_admin() then raise exception 'admin only'; end if;
  update public.content_items
     set archived_at = now()
   where archived_at is null
     and status <> 'published'
     and scheduled_for is not null
     and scheduled_for < now() - make_interval(days => greatest(grace_days, 0));
  get diagnostics n = row_count;
  return n;
end; $$;
grant execute on function public.tidy_stale_content(int) to authenticated;
