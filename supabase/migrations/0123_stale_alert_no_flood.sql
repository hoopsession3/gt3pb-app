-- 0123 — the pass watchdog must not flood. 0120's dedupe only looked back 15 minutes, so a
-- never-cleared stale order slipped past the window and re-alerted every 15 minutes forever
-- (52 copies observed in the live inbox). New rule: while a "waiting on the pass" alert sits
-- UN-ACKED, never raise another — one open flag represents the whole condition. After an ack,
-- a 15-minute cooldown still applies before re-raising if an order is *still* stuck, so an
-- acked-but-unhandled pass nags gently instead of never or constantly.
create or replace function public.alert_stale_orders(grace_min int default 10) returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(*) into n from public.orders
   where status = 'new' and created_at < now() - make_interval(mins => greatest(grace_min, 2));
  if n > 0 then
    if not exists (
      select 1 from public.alerts
       where category = 'order' and title like '%waiting on the pass%'
         and (ack_at is null or created_at > now() - interval '15 minutes')
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
