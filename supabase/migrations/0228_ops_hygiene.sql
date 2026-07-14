-- 0228 — ops hygiene: stops clean up after themselves (Ryan, 2026-07-14).
-- Two standing behaviors, both in-DB via pg_cron (the established scheduler here — 0017/0084/0104/0208):
--   1. AUTO-ARCHIVE: a stop still 'upcoming' 3+ days after its scheduled time never ran — archive it
--      nightly so the Route and pickers stay truthful without anyone tidying by hand.
--   2. RECAP ASK: ~3 hours after a stop that RAN wraps, ping leadership once — "log the debrief while
--      it's fresh." Anchor = completed_at (crew wrap-up, 0125) or ends_at, +3h; if neither is known,
--      starts_at + 6h (typical 2-3h stop + the 3h breather). A 48h lookback cap means deploying this
--      never retro-spams alerts for historic stops. One ask per stop (stops.recap_asked_at).
-- ⚠ 0224 (field_ops writer flip): both functions read/write STOPS (correct pre-flip; mirrors sync
--   the spine). The 0224 checklist gains: re-point archive_stale_stops() + stop_recap_alerts() to
--   field_ops and move recap_asked_at with the other stop columns.

alter table public.stops add column if not exists recap_asked_at timestamptz;

create or replace function public.archive_stale_stops() returns void
language sql security definer set search_path = public as $$
  update public.stops
     set archived_at = now()
   where archived_at is null
     and status = 'upcoming'
     and starts_at is not null
     and starts_at < now() - interval '3 days';
$$;

create or replace function public.stop_recap_alerts() returns void
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with due as (
    -- NOT filtered on archived_at: the standard close-out (go offline in LiveControl) archives the
    -- stop at the moment it wraps — exactly the stop we want a recap for (panel catch). One-ask is
    -- guaranteed by recap_asked_at; retro-spam by the 48h cap; and a recap already captured in the
    -- wrap dialog (stop_ops.recap — stops.recap was dropped in 0195) means nothing to ask for.
    select s.id, s.name
    from public.stops s
    where s.recap_asked_at is null
      and (s.status in ('live','done') or s.completed_at is not null)
      and not exists (select 1 from public.stop_ops so
                       where so.stop_id = s.id and coalesce(so.recap, '') <> '')
      and coalesce(s.completed_at + interval '3 hours',
                   s.ends_at      + interval '3 hours',
                   s.starts_at    + interval '6 hours') <= now()
      and coalesce(s.completed_at + interval '3 hours',
                   s.ends_at      + interval '3 hours',
                   s.starts_at    + interval '6 hours') > now() - interval '48 hours'
  ), marked as (
    update public.stops s set recap_asked_at = now()
    from due d where s.id = d.id
    returning d.id, d.name
  )
  insert into public.alerts (severity, category, title, body, link)
  select 'important', 'task', 'Recap: ' || coalesce(m.name, 'truck stop'),
         'The stop wrapped - log a 2-minute debrief note (what sold, what to change) while it''s fresh.',
         '/crew'
  from marked m;
  get diagnostics n = row_count;
end $$;

do $$ begin perform cron.schedule('archive-stale-stops', '17 6 * * *', 'select public.archive_stale_stops()'); exception when others then null; end $$;
do $$ begin perform cron.schedule('stop-recap-asks', '*/15 * * * *', 'select public.stop_recap_alerts()'); exception when others then null; end $$;

-- verify:
--   select jobname from cron.job where jobname in ('archive-stale-stops','stop-recap-asks');  -- 2 rows
--   select column_name from information_schema.columns where table_name='stops' and column_name='recap_asked_at';  -- 1 row
