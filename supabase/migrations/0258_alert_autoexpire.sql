-- 0258 · ALERT AUTO-EXPIRY (2026-07-30 — the alerts 7→10 round, Ryan: "alerting system is not
-- useful atp"). The badge said 15 because nothing ever aged out: an unacked fyi from three weeks
-- ago outranked today's news forever, and a feed that hoards is a feed nobody reads. Hourly
-- sweep: fyi quietly acks after 7 days, important after 21. CRITICALS NEVER AUTO-EXPIRE — they
-- email, they escalate, and silencing one is a human's call, not a timer's. ack_at (not delete):
-- the row stays for history/reports; it just leaves everyone's live feed, same as tapping Got it.

create or replace function public.alert_autoexpire() returns void
language sql security definer set search_path = public as $$
  update public.alerts set ack_at = now()
   where ack_at is null
     and ((severity = 'fyi'       and created_at < now() - interval '7 days')
       or (severity = 'important' and created_at < now() - interval '21 days'));
$$;

do $$ begin
  perform cron.schedule('alert-autoexpire', '17 * * * *', 'select public.alert_autoexpire()');
exception when others then null; end $$;
