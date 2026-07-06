-- 0120 — "order waiting on the pass" alert. New orders are visible on the live KDS (realtime chime)
-- when someone has it open. The gap: a ticket arrives and NOBODY is on the pass (solo operator busy,
-- between rushes). Rather than alert on every order (which would bury the critical money alerts under
-- noise and make the inbox useless under stress), we raise ONE consolidated alert only when an order
-- has been sitting in 'new' past a grace window — the real signal that the pass isn't being worked.
create or replace function public.alert_stale_orders(grace_min int default 10) returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(*) into n from public.orders
   where status = 'new' and created_at < now() - make_interval(mins => greatest(grace_min, 2));
  if n > 0 then
    -- Dedupe: don't re-raise while an un-acked "order waiting" alert from the last 15 min is still open.
    if not exists (
      select 1 from public.alerts
       where category = 'order' and ack_at is null and created_at > now() - interval '15 minutes'
    ) then
      insert into public.alerts (severity, category, title, body, link)
      values ('important', 'order',
              '🧾 ' || n || ' order' || case when n = 1 then '' else 's' end || ' waiting on the pass',
              'A ticket has been sitting 10+ minutes in "new" — someone open the kitchen pass.',
              '/admin');
    end if;
  end if;
  return n;
end $$;

revoke all on function public.alert_stale_orders(int) from public, anon, authenticated;

-- every 5 minutes; idempotent (re-schedule is a no-op). Guarded so the migration applies even if
-- pg_cron isn't enabled.
do $$ begin
  perform cron.schedule('alert-stale-orders', '*/5 * * * *', 'select public.alert_stale_orders(10)');
exception when others then null; end $$;
