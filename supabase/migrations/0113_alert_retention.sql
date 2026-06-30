-- 0113 — alert retention: keep the inbox managed. A dismissed (acked) alert has done its job;
-- after a grace window it's just history, so prune it weekly. OPEN (unacked) alerts are NEVER
-- touched, so nothing an operator still needs can be removed. Mirrors the tidy_stale_content cron.
create or replace function public.tidy_acked_alerts(keep_days int default 30) returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.alerts
   where ack_at is not null
     and ack_at < now() - make_interval(days => greatest(keep_days, 1));
  get diagnostics n = row_count;
  return n;
end $$;

-- weekly, Monday 07:00 — same cadence as tidy-stale-content. Idempotent (re-schedule is a no-op).
do $$ begin
  perform cron.schedule('tidy-acked-alerts', '0 7 * * 1', 'select public.tidy_acked_alerts(30)');
exception when others then null; end $$;
