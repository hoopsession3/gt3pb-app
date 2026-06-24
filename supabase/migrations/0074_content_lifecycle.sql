-- 0074 — CONTENT LIFECYCLE: retire stale content instead of letting it linger on the calendar.
-- archived_at parallels events; a tidy sweep auto-files content whose scheduled date passed long ago
-- and never published; a count powers the "review overdue" nudge. Owner can run tidy on demand, and
-- pg_cron runs it weekly if available (best-effort — won't fail the migration without cron).

alter table public.content_items add column if not exists archived_at timestamptz;
create index if not exists content_items_archived on public.content_items(archived_at);

-- Archive scheduled content whose date passed `grace_days` ago and never reached 'published'.
-- Reversible (archived, not deleted). Returns how many were filed. Admin-gated.
create or replace function public.tidy_stale_content(grace_days int default 14) returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
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

-- Overdue-but-not-yet-tidied: scheduled in the past, unpublished, not archived → the "review" nudge.
create or replace function public.stale_content_count() returns int
  language sql security definer stable set search_path = public as $$
  select count(*)::int from public.content_items
   where archived_at is null and status <> 'published'
     and scheduled_for is not null and scheduled_for < now();
$$;
grant execute on function public.stale_content_count() to authenticated;

-- Auto-tidy weekly (Mon 07:00) if pg_cron is present; silently skip if it isn't.
do $$ begin
  perform cron.schedule('tidy-stale-content', '0 7 * * 1', 'select public.tidy_stale_content(14)');
exception when others then null; end $$;
