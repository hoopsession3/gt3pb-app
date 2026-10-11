-- ── 0374 — RING THIS PHONE ─────────────────────────────────────────────────────────────────────────────────────
-- 2026-10-11 (wave 2 of the KDS audit · alerts).
--
-- WHY. The only way for someone on the crew to find out whether their phone rings for an alert was to wait for a
-- real one — or to place an order. Settings said "On" from the browser's permission alone (components/DeviceAlerts),
-- which says nothing about whether this phone is still kept for them (0366) or whether a push reaches it.
--
-- WHAT. ring_my_devices(): a real alert, sent to the signed-in person's own devices and nobody else's — the button in
-- Settings › You › Notifications and in the inbox's notification sheet (components/RingThisPhone).
--   · An alert like any other — the INSERT is the whole contract (0157) — targeted at the caller, kind 'device_test',
--     critical, so it is pushed the way a critical is: with sound, and shown even with the app open
--     (supabase/functions/push/policy.ts: "Test alert"). The push function sends it to the caller's devices only, and
--     never to Teams or by email. It is never escalated (0373).
--   · The crew only (is_staff, 0035), signed in, and once a minute a person: a second press inside the minute is
--     refused with how long to wait (PT429 — PostgREST answers 429, a refusal, never a server error: 0360).
--   · A person with no device kept for them gets 0 and nothing is written: there is nothing to ring.
--   · The answer is how many devices it went to.
--   · Acknowledged by itself two minutes on (close_device_tests, every minute: ack_at set, ack_by null — a mechanism,
--     not a person, 0258), and a new press closes the last one first, so the inbox holds one at most.
--   · Never shown to anyone else. Leadership reads every alert (0157), so three restrictive policies hold a device test
--     to its person: only they read it, only they acknowledge it, and nobody writes one through the API — only this
--     function does (as its owner, which row-level security does not stop). Realtime asks the same policies.
--
-- ORDER. Deploy the push function first. A device test reaching the function in production today would be a critical
-- like any other: posted to the Teams channel and emailed. The new one knows it.
--
-- existing rows: ring_my_devices — the kind is new; none has ever been written.

create or replace function public.ring_my_devices() returns int
  language plpgsql security definer set search_path = public as $$
declare
  v_user   uuid := auth.uid();
  v_last   timestamptz;
  v_wait   int;
  v_n      int;
begin
  if v_user is null then
    raise exception 'Sign in to ring your phone.' using errcode = '42501';
  end if;
  if not public.is_staff() then
    raise exception 'Only the crew can ring a phone from here.' using errcode = '42501';
  end if;

  -- One press at a time per person, so two at once cannot both pass the minute below.
  perform pg_advisory_xact_lock(hashtextextended('device_test:' || v_user::text, 0));

  select max(a.created_at) into v_last from public.alerts a
   where a.kind = 'device_test' and a.target_user_id = v_user;
  if v_last > now() - interval '1 minute' then
    v_wait := greatest(1, ceil(extract(epoch from (v_last + interval '1 minute' - now())))::int);
    raise exception 'You rang your phone a moment ago — try again in % second%.', v_wait, case when v_wait = 1 then '' else 's' end
      using errcode = 'PT429', detail = v_wait::text;
  end if;

  select count(*) into v_n from public.push_subscriptions s where s.user_id = v_user;
  if v_n = 0 then
    return 0;                                    -- no device is kept for this person: nothing to ring
  end if;

  -- The last test closes first (the mechanism), so one is open at most.
  update public.alerts set ack_at = now()
   where kind = 'device_test' and target_user_id = v_user and ack_at is null;

  insert into public.alerts (severity, category, kind, title, body, link, target_user_id, created_by, tenant_id)
  values ('critical', 'system', 'device_test', 'Test alert',
          'You asked your phone to ring. If it did, alerts reach you there. This clears itself in two minutes.',
          '/crew?s=settings&a=set-notify', v_user, v_user, public.effective_tenant());
  return v_n;
end $$;
revoke all on function public.ring_my_devices() from public, anon;
grant execute on function public.ring_my_devices() to authenticated;

comment on function public.ring_my_devices() is
  'Settings › Notifications › Ring this phone (0374): a critical alert of kind device_test targeted at the caller, pushed to their own devices only (never Teams or email, never escalated), closed by close_device_tests after two minutes. Crew only; once a minute a person (PT429 with the seconds to wait in DETAIL). Returns how many devices are kept for the caller (0 = none: nothing written).';

create or replace function public.close_device_tests() returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.alerts set ack_at = now()
   where kind = 'device_test' and ack_at is null and created_at <= now() - interval '2 minutes';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.close_device_tests() from public, anon, authenticated;

do $$ begin perform cron.unschedule('device-tests-close'); exception when others then null; end $$;
do $$ begin perform cron.schedule('device-tests-close', '* * * * *', 'select public.close_device_tests()'); exception when others then null; end $$;

-- A device test is its person's own. Restrictive, so they narrow every permissive rule above them (0050, 0084, 0104,
-- 0157) for this one kind and leave every other alert exactly as it was.
drop policy if exists "a device test is read by its person alone" on public.alerts;
create policy "a device test is read by its person alone" on public.alerts as restrictive for select
  using (kind is distinct from 'device_test' or target_user_id = (select auth.uid()));
drop policy if exists "a device test is acknowledged by its person alone" on public.alerts;
create policy "a device test is acknowledged by its person alone" on public.alerts as restrictive for update
  using (kind is distinct from 'device_test' or target_user_id = (select auth.uid()))
  with check (kind is distinct from 'device_test' or target_user_id = (select auth.uid()));
drop policy if exists "a device test is rung by ring_my_devices alone" on public.alerts;
create policy "a device test is rung by ring_my_devices alone" on public.alerts as restrictive for insert
  with check (kind is distinct from 'device_test');

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Ring this phone','feature','Alerts',
   'Settings › Notifications has a Ring this phone button: it sends a real alert to your own phone — nobody else sees it — so you can hear that alerts reach you without waiting for an order. The button says what happened ("Sent — your phone should ring now"), and the test clears itself after two minutes. Once a minute.',
   '2026-10-11', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select has_function_privilege('anon', 'public.ring_my_devices()', 'execute'),
--          has_function_privilege('authenticated', 'public.ring_my_devices()', 'execute');            -- f, t
--   select polname from pg_policy where polrelid = 'public.alerts'::regclass and polname like 'a device test%';   -- three
--   select jobname, schedule from cron.job where jobname = 'device-tests-close';                        -- * * * * *
--   select count(*) from public.alerts where kind = 'device_test' and ack_at is null and created_at < now() - interval '3 minutes';   -- 0
select public.record_migration('0374_ring_this_phone');
