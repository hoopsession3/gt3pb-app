-- ── 0376 — NOBODY ON THE PASS DURING SERVICE IS AN ALERT ─────────────────────────────────────────────────────
-- 2026-10-11 (the KDS program, wave 2: devices).
--
-- WHY. The one alert for a Pass nobody is working counts tickets ten minutes old (alert_stale_orders, 0369). By the
-- time it rings a customer has waited ten minutes, and it rings only if an order came. A Pass that went deaf — an
-- iPad that slept, a feed that dropped, a phone somebody closed — said nothing at all, however long service went on.
--
-- WHAT. pass_watchdog(), every minute from pg_cron. While service is on — the truck is live (live_status.is_live) or
-- an event is (events.is_live) — and no device has said, in the last five minutes, that it has the Pass open with its
-- orders feed live (device_heartbeats, 0375), it raises ONE critical alert, kind pass_unwatched, through
-- alert_open_once (0336): to leadership's phones, the Teams channel and email, as every critical goes (0157). Its
-- words say which it is and who:
--   "Nobody is on the Pass"           no device has had the Pass open in five minutes (and who had it last, and when);
--   "The Pass isn't hearing orders"   a device has it open and its feed is not live (which device, and its feed).
-- Its link is Live Ops, where the Pass opens and the truck goes offline (/crew?s=now): the two answers to it.
--
-- IT CLOSES ITSELF. The run that finds a device back on the Pass with its feed live — or service over — closes the
-- line: ack_at set, ack_by left null, a mechanism and not a person (0258, 0340), the row kept for history.
--
-- ONE LINE, QUIET BETWEEN. alert_open_once keeps one open line: kind pass_unwatched, no subject — a condition about the
-- whole Pass, as order_stale is. While it stays true the line is rewritten when its words change, and otherwise once
-- every five minutes, because every write is a realtime update to every open console; so "when this was last true"
-- (last_seen_at) is never more than five minutes old. A line that has closed is not opened again until fifteen
-- minutes after it rang (0174's cooldown, as 0336 keeps it): a Pass that comes back for a minute and goes again rings
-- once a quarter hour at most, not every six minutes — and a line closed by hand waits the same. It does not ring
-- again while it stays open; an open critical goes to its lane's owner after thirty minutes, where the lane has one
-- (0174's escalate_unacked_criticals, every fifteen minutes from 0162), and the run that closes the line closes that
-- copy too, since it is the same kind.
--
-- FIVE MINUTES, EVERY MINUTE. A device on the Pass checks in once a minute (components/usePassHeartbeat), so five
-- minutes is five missed beats: a phone switching apps for a moment, a feed reconnecting, a page reloading are not an
-- alert. It runs every minute because a deaf Pass is a customer waiting: it rings five to six minutes after the Pass
-- last heard, where every five minutes would be up to ten — no sooner than the ticket alert it is here to beat.
--
-- ONE BUSINESS. Like every producer on alert_open_once, it watches the business the cron's call resolves to:
-- effective_tenant() with no caller is the founding tenant (0134), whose inbox the alert lands in (alerts' own
-- default). A second business needs alert_open_once to carry a tenant first — named here, not done.
--
-- ORDER — READ THIS BEFORE PASTING. Paste it after 0375, and after the deploy in which the Pass reports its feed (the
-- gt3:pass-feed event components/usePassHeartbeat listens for). Before that every device on the Pass says its feed is
-- 'unknown', which is not live, and the first service would ring "The Pass isn't hearing orders" however well the
-- Pass was doing. Pasted before 0375 it does not load at all: it reads device_heartbeats.
--
-- existing rows: pass_watchdog — a new producer; nothing has ever written a pass_unwatched alert.

create or replace function public.pass_watchdog() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_tenant    uuid := public.effective_tenant();
  et          constant text := 'America/New_York';
  v_truck     boolean;
  v_event     text;
  v_what      text;
  v_list      text;
  v_last_who  text;
  v_last_app  text;
  v_last_at   timestamptz;
  v_title     text;
  v_body      text;
  v_open      uuid;
  v_was_title text;
  v_was_body  text;
  v_was_seen  timestamptz;
begin
  select coalesce(bool_or(l.is_live), false) into v_truck from public.live_status l where l.tenant_id = v_tenant;
  select e.title into v_event from public.events e
   where e.is_live and e.tenant_id = v_tenant order by e.day desc nulls last limit 1;

  -- Watched — a device on the Pass, its feed live, heard from in the last five minutes — or no service at all: the line
  -- closes (0340's way: the mechanism's ack, ack_by null).
  if not (v_truck or v_event is not null) or exists (
       select 1 from public.device_heartbeats h
        where h.tenant_id = v_tenant and h.surface = 'pass' and h.feed = 'live'
          and h.last_seen > now() - interval '5 minutes') then
    update public.alerts set ack_at = now()
     where kind = 'pass_unwatched' and subject_id is null and ack_at is null;
    return 0;
  end if;

  v_what := case
    when v_truck and v_event is not null then 'The truck is live and ' || v_event || ' is on'
    when v_truck then 'The truck is live'
    else v_event || ' is live'
  end;

  -- On the Pass and not hearing: the devices heard from on it in the last five minutes, newest first, three at most.
  select string_agg(d.words, ', ' order by d.last_seen desc) into v_list
    from (select coalesce(nullif(btrim(p.display_name), ''), 'a crew member')
                 || case h.app when 'ios' then ' in the app' else ' in a browser' end
                 || ' (' || case h.feed when 'reconnecting' then 'reconnecting'
                                        when 'down'         then 'feed down'
                                        when 'signed-out'   then 'signed out'
                                        else 'feed not reported' end || ')' as words,
                 h.last_seen
            from public.device_heartbeats h
            left join public.profiles p on p.id = h.user_id
           where h.tenant_id = v_tenant and h.surface = 'pass' and h.last_seen > now() - interval '5 minutes'
           order by h.last_seen desc
           limit 3) d;

  if v_list is not null then
    v_title := 'The Pass isn''t hearing orders';
    v_body := v_what || ', and the Pass is open on ' || v_list || ' — a new order may not reach it. '
      || 'Close the Pass and open it again on that device, or check its signal.';
  else
    v_title := 'Nobody is on the Pass';
    select coalesce(nullif(btrim(p.display_name), ''), 'a crew member'),
           case h.app when 'ios' then 'in the app' else 'in a browser' end, h.last_seen
      into v_last_who, v_last_app, v_last_at
      from public.device_heartbeats h
      left join public.profiles p on p.id = h.user_id
     where h.tenant_id = v_tenant and h.surface = 'pass'
     order by h.last_seen desc
     limit 1;
    v_body := v_what || ', and no phone or iPad has had the Pass open for five minutes — nobody is watching for new orders. '
      || case when v_last_at is null then ''
              else 'The last to have it open was ' || v_last_who || ' (' || v_last_app || '), at '
                   || case when (v_last_at at time zone et)::date = (now() at time zone et)::date
                           then to_char(v_last_at at time zone et, 'FMHH12:MI AM')
                           else to_char(v_last_at at time zone et, 'Dy, Mon FMDD, FMHH12:MI AM') end
                   || ' ET. ' end
      || 'Open the Pass on the phone or iPad at the window, or go offline if service is over.';
  end if;

  -- Quiet between: an open line already saying exactly this, written in the last five minutes, is left alone. Keyed on
  -- the kind (0336) — the words are only compared to see whether they changed.
  select a.id, a.title, a.body, a.last_seen_at into v_open, v_was_title, v_was_body, v_was_seen
    from public.alerts a
   where a.kind = 'pass_unwatched' and a.subject_id is null and a.ack_at is null
   order by a.created_at desc
   limit 1;
  if v_open is not null and v_was_title = v_title and v_was_body is not distinct from v_body
     and v_was_seen > now() - interval '5 minutes' then
    return 1;
  end if;

  perform public.alert_open_once(
    'pass_unwatched', null, 'critical', 'order', v_title, v_body, '/crew?s=now',
    interval '15 minutes');
  return 1;
end $$;

-- A cron job's: nothing in the app calls it, and a stranger must not ring the owners' phones.
revoke all on function public.pass_watchdog() from public, anon, authenticated;

comment on function public.pass_watchdog() is
  'The Pass watchdog (0376): while the truck or an event is live and no device has checked in on the Pass with its feed live for five minutes (device_heartbeats, 0375), ONE critical alert, kind pass_unwatched, no subject, through alert_open_once — "Nobody is on the Pass", or "The Pass isn''t hearing orders" naming the devices on it. Rewritten when its words change and otherwise every five minutes; closes itself (ack_at, ack_by null) when a Pass device is back or service ends. Every minute from pg_cron.';

-- Every minute (the header says why). Unscheduled first so a second run leaves one job; guarded so this applies where
-- pg_cron is not enabled.
do $$ begin perform cron.unschedule('pass-watchdog'); exception when others then null; end $$;
do $$ begin perform cron.schedule('pass-watchdog', '* * * * *', 'select public.pass_watchdog()'); exception when others then null; end $$;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('An alert when nobody is on the Pass','feature','Ops',
   'While the truck or an event is live, the app now notices when no phone or iPad has had the Pass open with its orders coming in for five minutes, and sends one critical alert: "Nobody is on the Pass", or "The Pass isn''t hearing orders" with the device that has it open. It closes itself the moment a device is back on the Pass, or when service ends.',
   '2026-10-11', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select jobname, schedule from cron.job where jobname = 'pass-watchdog';                                -- one, * * * * *
--   select has_function_privilege('authenticated', 'public.pass_watchdog()', 'execute');                  -- f
--   select title, left(body, 90), created_at, ack_at, ack_by from public.alerts where kind = 'pass_unwatched'
--    order by created_at desc limit 3;     -- at most one with ack_at null, and only while service is on and the Pass deaf
select public.record_migration('0376_nobody_on_the_pass_during_service_is_an_alert');
