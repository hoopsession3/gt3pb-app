-- ⚠️ NEVER include files from supabase/pending/ in this bundle — those are soak-gated (see
-- supabase/pending/0224_field_ops_contract.sql) and applying them early is irreversible.
--
-- ── GENERATED FILE — DO NOT EDIT BY HAND ─────────────────────────────────────────────────────
-- Regenerate with:  npm run migrations:pending -- --write
--
-- This file is the OUTPUT of comparing supabase/migrations/ against what production's ledger
-- (public.schema_migrations, via /api/migrations) says has actually been applied. Its previous
-- hand-maintained version said "apply all pending migrations" and stopped at 0035 while this
-- directory held 326 files — wrong by 291 migrations, referenced by nothing, checked by nothing.
--
-- The line below is what stops that happening again: scripts/drift.check.mjs fails the release
-- if supabase/migrations/ ever holds a migration numbered above it.
-- pending-from: 0379
-- generated-at: 2026-10-11
-- pending-count: 8
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- ============================================================
-- 0372_an_alert_already_open_is_counted_not_sent_again.sql
-- ============================================================
-- ── 0372 — AN ALERT ALREADY OPEN IS COUNTED, NOT SENT AGAIN ─────────────────────────────────────────────────────
-- 2026-10-11 (wave 2 of the KDS audit · alerts).
--
-- WHY. alert_open_once (0336) keeps one open line per (kind, subject) for the producers that call it — the pass's
-- waiting alert, the shop-stall watchdog, the uptime check, the office runs. Every other producer is a plain INSERT:
-- the server routes (lib/serverAlerts raiseAlert), the crew's screens (lib/clientAlerts), the brew ladder, the
-- cancel functions. Raising the same thing again while the first was still open wrote a second row, and the INSERT
-- is what fans out (0157): a second line in the inbox, a second push, a second Teams card and, for a critical, a
-- second email. raiseAlertOnce (lib/serverAlerts) asked first, for the webhooks and the error intake; nothing else did.
--
-- WHAT. One rule in the table, for every producer. A raise while an alert with the same key is still open folds
-- into it: occurrences + 1, last_seen_at now (0340: "when this was last true"), and its title, body and link become
-- the latest raise's — alert_open_once's own refresh (0336, 0340). No row is written, so nothing fans out: no push,
-- no Teams, no email. The first raise is a row and rings, as it always did. 0369's re-ring of the pass alert is
-- untouched: it closes the open line before alert_open_once opens the next, so the next is a first raise and rings.
--
-- THE KEY is the business (tenant_id), the kind, the subject, and who the alert is addressed to.
--   · Kind and subject both. A kind says what it is about and a subject which one (0174). An alert with no kind has
--     no key, and is never folded — nothing here matches on a sentence (0336). An alert with a kind and no subject
--     is either a condition about the whole app, whose producer folds it through alert_open_once already, or a
--     one-off with no row to name — a paid order that did not save — and two of those are two orders, each owed its
--     line, so it is not folded either.
--   · Who it is addressed to. One producer writes a line per person, with one kind and subject: a thread reply to
--     each follower, a sign-off request to each approver (app/crew/page.tsx), a proposal to each reviewer
--     (components/ProposalDesk). Each person is owed their own line. A broadcast (no target) is the team's, its own key.
--
-- A LOUDER RAISE IS NOT FOLDED. A critical raised while an fyi about the same thing is open would vanish into the
-- quieter line, unpushed. It closes that line instead (ack_at, ack_by left null — a mechanism, not a person, 0258)
-- and is written, carrying the count: still one open line, and the louder one rings.
--
-- Two raises of one key at the same moment take a transaction lock on the key, so the second sees the first.
-- SECURITY DEFINER: the line a raise folds into can be one the raiser cannot read (a crew member's reply on a
-- leader's thread is addressed to the leader). It reads and writes only a line of the same business, kind, subject
-- and person, and through the API it folds only for someone 0157's insert policy lets raise an alert at all — that
-- policy is checked after this trigger, never for a raise that folds. It runs before 0134's stamp_tenant (triggers
-- fire in name order), so it reads the business the way stamp_tenant writes it: the signed-in raiser's tenant first.
--
-- THE LINES ALREADY OPEN. 0333's lesson: a fix to how rows are written leaves the rows already written as they were.
-- Open lines sharing a key are folded the way the trigger folds a raise: the loudest, newest one stays open and
-- takes the others' counts; the others close by the mechanism and stay for history. Nothing is deleted, no severity
-- is rewritten, and nothing rings: an UPDATE does not fan out.
--
-- Idempotent: run twice, the second run finds no open lines that share a key, and the changelog line is written once.

create or replace function public.alert_severity_rank(p_severity text) returns int
  language sql immutable set search_path = public as $$
  select case p_severity when 'critical' then 3 when 'important' then 2 when 'fyi' then 1 else 2 end
$$;
revoke all on function public.alert_severity_rank(text) from public, anon, authenticated;

create or replace function public.alert_fold_repeat() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_open   public.alerts%rowtype;
begin
  if new.kind is null or new.subject_id is null or new.ack_at is not null then
    return new;
  end if;

  -- WHO MAY FOLD: whoever may raise. Postgres checks an insert against its policy AFTER the row's BEFORE triggers,
  -- and a raise that folds is never inserted — so it would never be checked, and anyone the API lets in could fold a
  -- "raise" into a line they may not raise or even read, rewriting its words (shown in scripts/db.alertwave2.test.mjs
  -- with this check taken out). Through the API (anon, authenticated) only those 0157's insert policy admits fold —
  -- its role list, word for word; anyone else's row goes on to that policy, which refuses it. The server's routes
  -- (service_role), pg_cron and the database's own functions are not the API.
  if coalesce(current_setting('role', true), 'none') in ('anon', 'authenticated')
     and not exists (select 1 from public.profiles p where p.id = auth.uid()
                      and p.role in ('server', 'contractor', 'operator', 'event_manager', 'admin', 'owner')) then
    return new;
  end if;

  -- The business this row will carry: stamp_tenant's rule (0134), the signed-in raiser's tenant first.
  v_tenant := coalesce(public.current_tenant(), new.tenant_id, '00000000-0000-0000-0000-000000000001'::uuid);

  perform pg_advisory_xact_lock(hashtextextended(
    'alert:' || v_tenant::text || ':' || new.kind || ':' || new.subject_id::text || ':' || coalesce(new.target_user_id::text, 'team'), 0));

  select a.* into v_open
    from public.alerts a
   where a.tenant_id = v_tenant
     and a.kind = new.kind
     and a.subject_id = new.subject_id
     and a.target_user_id is not distinct from new.target_user_id
     and a.ack_at is null
   order by a.created_at desc, a.id desc
   limit 1
   for update;
  if not found then
    return new;                                   -- the first raise: written, and it rings (0157)
  end if;

  if public.alert_severity_rank(new.severity) > public.alert_severity_rank(v_open.severity) then
    -- Louder than the open line: that line closes by the mechanism, and this one is written with the count.
    update public.alerts set ack_at = now() where id = v_open.id;
    new.occurrences  := coalesce(v_open.occurrences, 1) + coalesce(new.occurrences, 1);
    new.last_seen_at := now();
    return new;
  end if;

  -- Still the same thing, still open: the line counts it and says the latest words. No row, so no push.
  update public.alerts
     set occurrences  = coalesce(occurrences, 1) + coalesce(new.occurrences, 1),
         last_seen_at = now(),
         title        = coalesce(new.title, title),
         body         = coalesce(new.body, body),
         link         = coalesce(new.link, link)
   where id = v_open.id;
  return null;
end $$;
revoke all on function public.alert_fold_repeat() from public, anon, authenticated;

comment on function public.alert_fold_repeat() is
  'BEFORE INSERT on alerts (0372): a raise with a kind and a subject, while an alert with the same tenant, kind, subject and target is open, folds into it (occurrences + 1, last_seen_at now, latest title/body/link) and writes no row — so nothing fans out. A louder raise closes the open line (ack_at, ack_by null) and is written with the count. No kind or no subject: never folded.';

drop trigger if exists alerts_fold_repeats on public.alerts;
create trigger alerts_fold_repeats before insert on public.alerts
  for each row execute function public.alert_fold_repeat();

-- The lines already open, folded as a raise would be: per key, the loudest and newest stays open with every count.
with open_lines as (
  select a.id, a.occurrences, a.created_at, a.last_seen_at,
         first_value(a.id) over w as keeper,
         row_number() over w as nth
    from public.alerts a
   where a.ack_at is null and a.kind is not null and a.subject_id is not null
  window w as (partition by a.tenant_id, a.kind, a.subject_id, a.target_user_id
               order by public.alert_severity_rank(a.severity) desc, a.created_at desc, a.id desc)
), closed as (
  update public.alerts a set ack_at = now()
    from open_lines o
   where a.id = o.id and o.nth > 1
  returning o.keeper, o.occurrences, greatest(o.created_at, coalesce(o.last_seen_at, o.created_at)) as seen
)
update public.alerts k
   set occurrences  = coalesce(k.occurrences, 1) + f.n,
       last_seen_at = greatest(coalesce(k.last_seen_at, k.created_at), f.seen)
  from (select keeper, sum(coalesce(occurrences, 1))::int as n, max(seen) as seen from closed group by keeper) f
 where k.id = f.keeper;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('An alert that is already open is counted, not sent again','fix','Alerts',
   'When something already waiting in the inbox is raised again before anyone has dealt with it, its line counts it and shows the latest words — no second line, no second push, Teams card or email. A raise that is louder than the line it matches (a critical about something that was only an FYI) still rings, and takes that line''s place. Alerts sent to several people, like a reply to everyone on a thread, stay one line each.',
   '2026-10-11', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select tgname from pg_trigger where tgrelid = 'public.alerts'::regclass and tgname = 'alerts_fold_repeats';   -- one
--   select tenant_id, kind, subject_id, target_user_id, count(*) from public.alerts
--    where ack_at is null and kind is not null and subject_id is not null
--    group by 1, 2, 3, 4 having count(*) > 1;                                                                      -- none
--   select has_function_privilege('authenticated', 'public.alert_fold_repeat()', 'execute');                      -- f
select public.record_migration('0372_an_alert_already_open_is_counted_not_sent_again');

-- ============================================================
-- 0373_a_critical_nobody_picks_up_rings_the_owners_again.sql
-- ============================================================
-- ── 0373 — A CRITICAL NOBODY PICKS UP RINGS THE OWNERS AGAIN ───────────────────────────────────────────────────
-- 2026-10-11 (wave 2 of the KDS audit · alerts).
--
-- WHY. A critical is the alert that must not go cold: a paid order that did not record, a refund to make, a charge
-- nobody can account for, a brew about to be ruined. The ladder meant to catch one nobody answered never rang:
--   · escalate_unacked_criticals (0162, restated by 0174) waited thirty minutes, then wrote a copy of a broadcast
--     critical to its lane's owner (work_streams.owner_user_id) and marked the original escalated either way. No lane
--     has an owner — 0159 seeds none — so it marked, and sent nothing. No critical has ever escalated.
--   · It counted a broadcast as unanswered while "Got it" on a broadcast is one person's read (alert_reads, 0157)
--     that never sets ack_at: the day a lane had an owner, a refund someone had already marked done would have gone up.
--   · Anyone could run it: it was never revoked from the API roles.
--
-- WHAT. escalate_unacked_criticals, every minute: a critical nobody has acknowledged ten minutes after it was raised
-- is marked escalated — once — and alerts_push_escalation hands that UPDATE to the push function, which sends the
-- alert again to its own people and to every admin and owner of its business ("Still open — …", a notification of
-- its own, so it rings beside the first: supabase/functions/push). Nothing is inserted. It is the same line, marked,
-- so the inbox does not grow, and acknowledging it once clears it.
--   · Acknowledged: ack_at is set (by the person it is for, or a mechanism), or — on a broadcast — anyone has tapped
--     Got it (an alert_reads row): somebody has it. Acknowledging stops it: before ten minutes nothing is sent, and the
--     push function asks again just before it sends.
--   · Which criticals: every broadcast — the team's to pick up — and a person's own critical that carries a window
--     to escalate on (escalate_after_min, 0050's "re-ping window for criticals": the brew ladder's start-now and
--     bottle-now). A task handed to someone and flagged critical is theirs to answer; escalating it would ring the
--     owner who assigned it, ten minutes after they did.
--   · Never a device test (0374): it is one person's own, shown to nobody else.
--   · Not one raised more than twelve hours ago — 0344's rule, a moment long gone is history, not an alarm — so a cron
--     that stopped overnight does not ring the owners about yesterday when it starts again. A critical never expires
--     (0258); it stays in the inbox, unescalated.
-- The brew ladder's own "🔁 Still open" copy (0344) is left as written: it waits 20 or 30 minutes for an alert this
-- marks at ten, so it no longer fires — one line, escalated once. Rewriting the ladder to delete a branch that can no
-- longer run is how a good night breaks something (0336); named here so it is known, not found.
--
-- THE DOOR. The escalation reaches the push function the way every alert does — supabase_functions.http_request, on
-- the alerts table — and the trigger is made from 0157's alerts_push_fanout itself (its call, as the database holds
-- it), so this file carries no address and no key of its own and the two cannot point at different places. Without
-- 0157's trigger there is no door; none is made, and the notice says so.
--
-- ORDER. Deploy the push function first: it learns the UPDATE in the same change. Pasted before it, an escalation is
-- marked and the function in production ignores it — and a marked critical is never sent again.
--
-- existing rows: none restated. A broadcast critical older than thirty minutes was already marked by 0162's run (owner
-- or not), one older than twelve hours is past the window, and the brew ladder's were marked by 0344 or by its own run.
-- The few left — raised in the last half hour, or a brew alarm within the day — are live, and ring on the first run.

create or replace function public.escalate_unacked_criticals() returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  -- A cron job's, across every business: each escalation names its own tenant, and the push function sends it only
  -- to that tenant's people.
  with due as (
    select a.id
      from public.alerts a
     where a.severity = 'critical'
       and a.ack_at is null
       and a.escalated_at is null
       and a.kind is distinct from 'device_test'
       and (a.target_user_id is null or a.escalate_after_min is not null)
       and a.created_at <= now() - interval '10 minutes'
       and a.created_at >  now() - interval '12 hours'
       and not exists (select 1 from public.alert_reads r where r.alert_id = a.id)
     order by a.created_at
     limit 50
     for update skip locked
  )
  update public.alerts a set escalated_at = now() from due where a.id = due.id;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.escalate_unacked_criticals() from public, anon, authenticated;

comment on function public.escalate_unacked_criticals() is
  'Every minute (pg_cron escalate-criticals, 0373): marks escalated_at on a critical nobody has acknowledged ten minutes after it was raised (ack_at null and, for a broadcast, no alert_reads row) — every broadcast, and a targeted one that carries escalate_after_min; never a device_test; within twelve hours of being raised. alerts_push_escalation hands the mark to the push function, which sends it once more to its people and every admin and owner of its tenant. Inserts nothing.';

-- The door: 0157's fan-out call, on the moment escalated_at is first set.
do $$
declare v_def text; v_call text;
begin
  select pg_get_triggerdef(t.oid) into v_def
    from pg_trigger t
   where t.tgrelid = 'public.alerts'::regclass and t.tgname = 'alerts_push_fanout' and not t.tgisinternal;
  v_call := substring(coalesce(v_def, '') from 'EXECUTE (?:FUNCTION|PROCEDURE) .*$');
  if v_call is null then
    raise notice '0373: public.alerts has no alerts_push_fanout (0157), so an escalation has no way to the push function — none made.';
    return;
  end if;
  execute 'drop trigger if exists alerts_push_escalation on public.alerts';
  execute 'create trigger alerts_push_escalation after update of escalated_at on public.alerts for each row '
       || 'when (old.escalated_at is null and new.escalated_at is not null and new.severity = ''critical'' '
       || 'and new.ack_at is null and new.kind is distinct from ''device_test'') '
       || v_call;
end $$;

do $$ begin perform cron.unschedule('escalate-criticals'); exception when others then null; end $$;
do $$ begin perform cron.schedule('escalate-criticals', '* * * * *', 'select public.escalate_unacked_criticals()'); exception when others then null; end $$;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A critical nobody picks up rings the owners again','fix','Alerts',
   'A critical alert that nobody has picked up ten minutes after it came in is sent once more — "Still open" — to the people it was for and to every owner and admin, as a new notification that rings. Tapping Got it stops it; on an alert for the whole team, anyone tapping it does. Before, it waited half an hour for a lane owner nobody had been given, so no critical ever escalated.',
   '2026-10-11', true),
  ('FYI alerts stay in the inbox','fix','Alerts',
   'An FYI — a new shop order, a sign-up, the daily digest — no longer buzzes anyone''s phone, posts to Teams or sends an email; it waits in the inbox. Important and critical alerts ring as before, and a new reservation or Sunday delivery is important now, so it still rings — once, where it used to come with a second Teams card.',
   '2026-10-11', false),
  ('A locked phone shows what happened, not who','security','Alerts',
   'A notification no longer shows a customer''s name, phone number, address, email or an amount where anyone near the phone can read it — a new order says "New order · 2 items · tap to open", a stalled shop order says just that. The details are in the app, for the crew who are signed in. And each order or alert is its own notification now, so a second one no longer silently replaces the first.',
   '2026-10-11', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select tgname, pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'public.alerts'::regclass and tgname like 'alerts_push_%';
--     -- two, calling the same function with the same arguments: fan-out on insert, escalation on update of escalated_at
--   select jobname, schedule from cron.job where jobname = 'escalate-criticals';                        -- * * * * *
--   select has_function_privilege('anon', 'public.escalate_unacked_criticals()', 'execute');            -- f
--   select id, title, created_at, escalated_at from public.alerts where severity = 'critical' and escalated_at > now() - interval '1 day';
select public.record_migration('0373_a_critical_nobody_picks_up_rings_the_owners_again');

-- ============================================================
-- 0374_ring_this_phone.sql
-- ============================================================
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

-- ============================================================
-- 0375_a_device_on_the_pass_checks_in_every_minute.sql
-- ============================================================
-- ── 0375 — A DEVICE ON THE PASS CHECKS IN EVERY MINUTE ───────────────────────────────────────────────────────
-- 2026-10-11 (the KDS program, wave 2: devices).
--
-- WHY. Nothing anywhere said which phone or iPad had the Pass open, or whether it could hear an order. The Pass's
-- orders feed has no health check of its own, a sleeping iPad looks exactly like a working one, and the only sign the
-- Pass had gone deaf was a ticket ten minutes old (alert_stale_orders, 0369) — or a customer at the window asking.
-- The audit of the kitchen display put it in two lines: each device's last sync is "never recorded anywhere", and a
-- Pass device offline or on a stale feed raises "none".
--
-- WHAT. Each device that has the Pass open says so once a minute, and again the moment anything about it changes
-- (components/usePassHeartbeat, lib/heartbeat). The database keeps the latest word, one row per device and screen:
--
--   device_heartbeats     keyed (tenant_id, device_id, surface)
--     device_id           a random id the app keeps per install (localStorage). A page that cannot keep one sends a
--                         new id each visit; its rows age out like any other.
--     surface             which screen: 'pass' today ('live_ops' and 'driver' have room to come)
--     app, app_build      'web' or 'ios', and which build: the web's commit, the app's version (build)
--     feed                the Pass's own word on its orders feed — live, reconnecting, down, signed-out — or unknown:
--                         not said yet (a build whose Pass does not report it, or the first moment after it opens)
--     alerts_on           whether this device can be pushed a new order: the answer Live Ops' alerts-off line reads
--                         (components/DeviceAlerts, components/AppAlerts)
--     wake_lock           whether the screen is being kept on (lib/useWakeLock)
--     user_id, last_seen  who was signed in on it, and when it last said so, by the database's clock
--
--   crew_heartbeat(...)          the only write. It stamps the tenant (effective_tenant(), 0134) and the person
--                                (auth.uid()) itself, so a page names neither, and refuses anyone not on the crew:
--                                is_staff(), the test staff_set_order_status asks (0368). A device that changes hands
--                                is whoever is signed in on it now, as a push device is (0366).
--   crew_devices()               what Live Ops' Devices card reads (components/crew/DevicesCard): the devices heard
--                                from in the last ten minutes, each with the name of whoever is on it. For the leaders
--                                — event_manager, admin, owner, the people the card is drawn for (canManage). profiles
--                                shows an event manager nobody's row but their own (0001, 0003), so the names come
--                                through here, and only these.
--   prune_device_heartbeats(7)   daily, from pg_cron: a row not heard from in seven days goes.
--
-- WHO READS IT. The crew, of their own business: the select policy is is_staff(), under 0134's restrictive tenant
-- isolation, as job_runs' is (0356). Nobody writes it but the function. anon holds nothing and authenticated holds
-- select alone — Supabase grants every new table to both, so the rest is revoked by name (0371). Deleting an account
-- takes its devices' rows with it (on delete cascade): they say nothing but where that person's devices were.
--
-- NOT REALTIME, ON PURPOSE. The card asks every thirty seconds instead of joining supabase_realtime: a beat a minute
-- from every Pass device would be an update a minute to every open console, for a card that is read at a glance.
--
-- ORDER. Paste it any time. Before the deploy that sends the beats, nothing writes here. Pasted after, the beats that
-- failed until now (PGRST202, quietly — lib/heartbeat sendBeat) land with the next one, a minute later at most, and the
-- card appears. The watchdog that reads this table is 0376's, and its header says when to paste it.

create table if not exists public.device_heartbeats (
  tenant_id  uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  device_id  text not null check (device_id ~ '^[A-Za-z0-9-]{8,64}$'),
  surface    text not null check (surface ~ '^[a-z][a-z_]{1,23}$'),
  user_id    uuid not null references auth.users(id) on delete cascade,
  app        text not null check (app in ('web', 'ios')),
  app_build  text check (app_build is null or char_length(app_build) between 1 and 40),
  feed       text not null default 'unknown' check (feed in ('live', 'reconnecting', 'down', 'signed-out', 'unknown')),
  alerts_on  boolean not null default false,
  wake_lock  boolean not null default false,
  last_seen  timestamptz not null default now(),
  primary key (tenant_id, device_id, surface)
);
create index if not exists device_heartbeats_recent on public.device_heartbeats (tenant_id, surface, last_seen desc);

-- 0134's two, which its own loop gave only the tables that existed when it ran: the caller's tenant stamped on insert,
-- and rows of another business out of reach.
drop trigger if exists stamp_tenant_tg on public.device_heartbeats;
create trigger stamp_tenant_tg before insert on public.device_heartbeats for each row execute function public.stamp_tenant();

alter table public.device_heartbeats enable row level security;
drop policy if exists "device heartbeats staff read" on public.device_heartbeats;
create policy "device heartbeats staff read" on public.device_heartbeats for select using ((select public.is_staff()));
drop policy if exists "tenant isolation" on public.device_heartbeats;
create policy "tenant isolation" on public.device_heartbeats as restrictive for all
  using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
-- No insert, update or delete policy, on purpose: crew_heartbeat is the one write. The grants say the same.
revoke all on public.device_heartbeats from public, anon, authenticated;
grant select on public.device_heartbeats to authenticated;
grant select, insert, update, delete on public.device_heartbeats to service_role;

comment on table public.device_heartbeats is
  'The latest word from each crew device on each screen (0375): which device, who was signed in on it, the app and build, the Pass''s orders feed (live/reconnecting/down/signed-out/unknown), whether it can be pushed an order, whether its screen is kept on, and when it last said so. Written only by crew_heartbeat; read by Live Ops'' Devices card (crew_devices) and the Pass watchdog (0376). Pruned after seven days.';

-- ── THE ONE WRITE ────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.crew_heartbeat(
  p_device    text,
  p_surface   text,
  p_app       text,
  p_app_build text    default null,
  p_feed      text    default 'unknown',
  p_alerts_on boolean default false,
  p_wake_lock boolean default false)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v_user   uuid := auth.uid();
  v_tenant uuid := public.effective_tenant();
  v_build  text := left(nullif(btrim(coalesce(p_app_build, '')), ''), 40);
  v_at     timestamptz := now();
begin
  if v_user is null or not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- The table's own checks, said first in words a person can read (22023, a 4xx — 0360).
  if coalesce(p_device, '') !~ '^[A-Za-z0-9-]{8,64}$' then
    raise exception 'That isn''t a device id.' using errcode = '22023';
  end if;
  if coalesce(p_surface, '') !~ '^[a-z][a-z_]{1,23}$' then
    raise exception 'That isn''t a screen.' using errcode = '22023';
  end if;
  if p_app is null or p_app not in ('web', 'ios') then
    raise exception 'That isn''t an app.' using errcode = '22023';
  end if;
  if p_feed is null or p_feed not in ('live', 'reconnecting', 'down', 'signed-out', 'unknown') then
    raise exception 'That isn''t a feed.' using errcode = '22023';
  end if;

  insert into public.device_heartbeats as h
         (tenant_id, device_id, surface, user_id, app, app_build, feed, alerts_on, wake_lock, last_seen)
  values (v_tenant, p_device, p_surface, v_user, p_app, v_build, p_feed, coalesce(p_alerts_on, false), coalesce(p_wake_lock, false), v_at)
  on conflict (tenant_id, device_id, surface) do update set
    user_id   = excluded.user_id,      -- whoever is signed in on it now (0366's rule for a device)
    app       = excluded.app,
    app_build = excluded.app_build,
    feed      = excluded.feed,
    alerts_on = excluded.alerts_on,
    wake_lock = excluded.wake_lock,
    last_seen = excluded.last_seen;
  return v_at;
end $$;
revoke all on function public.crew_heartbeat(text, text, text, text, text, boolean, boolean) from public, anon;
grant execute on function public.crew_heartbeat(text, text, text, text, text, boolean, boolean) to authenticated;

comment on function public.crew_heartbeat(text, text, text, text, text, boolean, boolean) is
  'A crew device says it is on a screen (0375): the one write to device_heartbeats. Stamps the tenant (effective_tenant) and the person (auth.uid) itself; refuses anyone not on the crew (is_staff); answers the database''s time of the beat.';

-- ── WHAT THE DEVICES CARD READS ──────────────────────────────────────────────────────────────────────────────────
create or replace function public.crew_devices()
returns table (device_id text, surface text, user_id uuid, display_name text, role text, app text, app_build text,
               feed text, alerts_on boolean, wake_lock boolean, last_seen timestamptz, seen_s integer)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not (public.is_admin() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'event_manager')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- seen_s is counted here, by the clock that stamped last_seen, so a phone whose own clock is off still reads
  -- "seen 12 s ago" truly.
  return query
    select h.device_id, h.surface, h.user_id, p.display_name, p.role, h.app, h.app_build, h.feed, h.alerts_on, h.wake_lock,
           h.last_seen, greatest(0, floor(extract(epoch from (now() - h.last_seen))))::integer
      from public.device_heartbeats h
      left join public.profiles p on p.id = h.user_id
     where h.tenant_id = public.effective_tenant()
       and h.last_seen > now() - interval '10 minutes'
     order by (h.surface = 'pass') desc, h.last_seen desc;
end $$;
revoke all on function public.crew_devices() from public, anon;
grant execute on function public.crew_devices() to authenticated;

comment on function public.crew_devices() is
  'Live Ops'' Devices card (0375): every device of the caller''s business heard from in the last ten minutes, with the name and role of whoever is on it and seconds since it last checked in. Leaders only (event_manager, admin, owner).';

-- ── SEVEN DAYS, THEN GONE ────────────────────────────────────────────────────────────────────────────────────────
-- Every business's rows: the clock is the rule here, not the caller, as it is for 0258's sweep. greatest(…, 1) so a
-- mistaken 0 cannot empty the table of devices that are on the Pass right now.
create or replace function public.prune_device_heartbeats(p_days int default 7) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.device_heartbeats
   where last_seen < now() - make_interval(days => greatest(coalesce(p_days, 7), 1));
  get diagnostics n = row_count;
  return n;
end $$;
-- A cron job's: nothing in the app calls it.
revoke all on function public.prune_device_heartbeats(int) from public, anon, authenticated;

-- Daily, off the top of the hour. Unscheduled first so a second run leaves one job; guarded so this applies where
-- pg_cron is not enabled.
do $$ begin perform cron.unschedule('prune-device-heartbeats'); exception when others then null; end $$;
do $$ begin perform cron.schedule('prune-device-heartbeats', '29 4 * * *', 'select public.prune_device_heartbeats(7)'); exception when others then null; end $$;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Live Ops shows which devices are on the Pass','feature','Ops',
   'Live Ops has a Devices card for managers: every phone or iPad that has had the Pass open in the last ten minutes, who is signed in on it, whether its orders feed is live, whether it can get order alerts, and when it last checked in. A device on the Pass checks in once a minute, and the moment any of that changes.',
   '2026-10-11', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select relrowsecurity from pg_class where oid = 'public.device_heartbeats'::regclass;                       -- t
--   select has_table_privilege('anon', 'public.device_heartbeats', 'select'),
--          has_table_privilege('authenticated', 'public.device_heartbeats', 'insert');                          -- f, f
--   select has_function_privilege('anon', 'public.crew_heartbeat(text,text,text,text,text,boolean,boolean)', 'execute');  -- f
--   select jobname, schedule from cron.job where jobname = 'prune-device-heartbeats';                           -- one, daily
--   select surface, feed, count(*) from public.device_heartbeats where last_seen > now() - interval '10 minutes' group by 1, 2;
select public.record_migration('0375_a_device_on_the_pass_checks_in_every_minute');

-- ============================================================
-- 0376_nobody_on_the_pass_during_service_is_an_alert.sql
-- ============================================================
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

-- ============================================================
-- 0377_the_porch_run_updates_live.sql
-- ============================================================
-- ── 0377 — THE PORCH RUN UPDATES LIVE ──────────────────────────────────────────────────────────────────
-- 2026-10-11 (the dispatch round).
--
-- Supabase sends a screen a table's changes only when two switches are on: the page subscribes (useRealtimeTable),
-- and the table is in the supabase_realtime publication. delivery_orders — the Sunday porches — was never added. The
-- 34 tables migrations added before 0248 are exactly the 34 that 0248 counted in production's publication, and
-- delivery_orders is not one of them; no migration since has added it. Three screens subscribe to it and hear nothing:
--
--   the Sunday card on Live Ops (components/DeliveryOps), and Due next's one list, which is built from what that card
--     reads: a porch the driver logged — delivered, held, not home — read as still out for delivery, or late, until
--     the console read again;
--   the driver's run (components/DriverRun): a porch the console marked out for delivery, or moved onto today's run,
--     did not appear until the driver's phone read again;
--   the customer's own delivery card (components/MyDeliveries): "On the way" and "Delivered" did not move in front of
--     the customer, which is what its subscription was written for.
--
-- The office route got this in 0357 ("the driver's run and the crew's route hear each other"); this is the porch run's.
-- The table joins the publication the way 0357, 0359 and 0370 add theirs: only if it is not a member already, and only
-- if the publication exists, so this runs the same on a database without realtime and runs twice without error.
--
-- What a screen is sent follows the table's own read rules, which do not change: realtime checks every inserted or
-- updated row against the subscriber's policies, so the crew are sent every porch (delivery staff read, 0139) and a
-- customer only their own (delivery own read, 0139). A delete, which no policy can check, would be sent as the row's id
-- alone, as for every table already in the publication — and a porch is never deleted (0141's guard refuses it).

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'delivery_orders') then
    alter publication supabase_realtime add table public.delivery_orders;
  end if;
end $$;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The Sunday porch run updates on every screen','fix','Delivery',
   'A porch the driver logged — delivered, held, not home — still read as out for delivery on Live Ops until someone reloaded it, a porch the crew sent out or moved onto today''s run did not appear on the driver''s phone, and a customer''s delivery card did not move from "Received" to "On the way". The run, the driver''s screen and the customer''s card now change the moment a porch does.',
   '2026-10-11', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'delivery_orders');   -- t
select public.record_migration('0377_the_porch_run_updates_live');

-- ============================================================
-- 0378_only_got_it_is_a_crew_members_to_write_on_an_alert.sql
-- ============================================================
-- ── 0378 — ONLY "GOT IT" IS A CREW MEMBER'S TO WRITE ON AN ALERT ──────────────────────────────────────────────────
-- 0157's policy "alerts staff update" lets a crew member update an alert of their own business, and Supabase grants
-- every column of every table to authenticated, so through PostgREST a crew member could rewrite another person's alert
-- (its title, its body, who it is for) or set escalated_at, which 0373 answers with one more push to every owner. The
-- app writes two columns from a phone: ack_at and ack_by (lib/useMyAlerts: "Got it", "Got it" on all, and its undo).
-- So a signed-in person may update those two and nothing else. Everything else that writes an alert is the service role
-- (the server's raises) or a security definer function (0372's fold, 0373's escalation, 0374's ring), which run as the
-- table's owner: column grants do not reach them. The policies are unchanged — which rows a person may acknowledge is
-- still 0157's question. Found by the wave-2 alerts review (2026-10-11).
-- changelog: none — a permission narrowed to what the app already does; nothing a person sees changes.

revoke update on table public.alerts from anon, authenticated;
grant update (ack_at, ack_by) on table public.alerts to authenticated;

-- verify:
--   select has_column_privilege('authenticated', 'public.alerts', 'ack_at', 'UPDATE');   -- t
--   select has_column_privilege('authenticated', 'public.alerts', 'title', 'UPDATE');    -- f
--   select has_column_privilege('anon', 'public.alerts', 'ack_at', 'UPDATE');            -- f
select public.record_migration('0378_only_got_it_is_a_crew_members_to_write_on_an_alert');

-- ============================================================
-- 0379_the_pass_finds_its_picked_up_orders_by_index.sql
-- ============================================================
-- ── 0379 — THE PASS FINDS ITS PICKED-UP ORDERS BY INDEX ──────────────────────────────────────────────────────────
-- The Pass reads the orders picked up in the last 30 minutes (the Ready lane's recall tray, components/pass) every 15
-- seconds on every device that has it open, with status = 'done' and status_changed_at after a moment. No index covers
-- that, so each read walks the whole orders table, and the table only grows. A partial index on the done orders' change
-- time answers it from the newest end. Small table today; the point is that the read stays the same size as it grows.
-- changelog: none — a read gets cheaper; nothing a person sees changes.

create index if not exists orders_done_by_change on public.orders (status_changed_at desc) where status = 'done';

-- verify:
--   select indexdef from pg_indexes where schemaname = 'public' and indexname = 'orders_done_by_change';
select public.record_migration('0379_the_pass_finds_its_picked_up_orders_by_index');
