-- ── 0369 — THE PASS ALERT RINGS UNTIL THE PASS IS CLEAR ────────────────────────────────────────────────
-- 2026-10-11 (the audit of the kitchen display, "the Pass").
--
-- alert_stale_orders (0120; on alert_open_once since 0336; every five minutes from pg_cron) is the one alert for a
-- pass nobody is working: tickets still in 'new' ten minutes on. Three things about it were wrong.
--
-- 1. IT COUNTED A PRE-ORDER FROM WHEN IT WAS PLACED. orders.ready_from (0343) is "when the truck said it would make
--    this order": an order placed ahead of a stop is made from the stop's start, and the customer is told so — "We
--    make it when we open — Sat at 11:00am" (lib/ordering, readyWords). It is the time the order MAY BE STARTED FROM,
--    not a time it must be READY BY: before it, nobody is late, and the pass shows the ticket as "for 11:00am" and
--    starts its clock there (lib/ordering, orderClockFrom: ready_from when it is later than created_at). Read as
--    "ready by", the alert would have to fire before the stop opened, about an order the truck had promised to make
--    after it. The alert counted from created_at, so a 7am order for an 11am stop rang the owners' phones at 7:10.
--    An order is now due at the later of when it was placed and ready_from — the instant the pass's clock starts, so
--    the ticket reading "12m" on the pass is the one the alert counts — and it is counted once it has been due for ten
--    minutes or more.
--
-- 2. IT RANG ONCE. The push and the Teams post fan out from an INSERT on alerts (0157), and alert_open_once keeps its
--    one open line by UPDATING it for as long as it stays true. So the first late ticket rang, and then the line sat
--    in the inbox, refreshed every five minutes and never heard again — until somebody acknowledged it, or 0258's
--    sweep did, 21 days on — however long the tickets went on waiting. "Got it" on a broadcast hides it only from the
--    person who tapped it (0157), and they were never told again either. Now, while tickets are still waiting, it
--    rings again every fifteen minutes: the open line is closed and a fresh one opened, because a new row is what the
--    push function hears (unchanged — it fans out on INSERT, as it always has). There is never more than one open
--    line, so the inbox holds one line, not a pile. 0336's dedupe and 0174's cooldown hold: between rings the open
--    line is refreshed, not repeated, and a line someone acknowledged is not reopened until fifteen minutes after it
--    rang.
--
-- 3. IT NEVER CLEARED. An empty pass went on saying tickets were waiting. A run that finds none waiting now closes
--    the line, the way 0340's stalled-shop-order watchdog closes its own: ack_at set, ack_by left null — a
--    mechanism, not a person (0258) — and the row kept for history.
--
-- Fifteen minutes is measured with half a minute to spare. The cron is */5 (0120) and pg_cron starts each run a
-- moment after its minute — a different moment each time — so the run fifteen minutes on can find the last ring
-- 14:59.8 old; measured strictly, about half the re-rings would wait for the next run, twenty minutes after the last.
--
-- Unchanged on purpose: who is told (no target — leadership's phones, the Teams channel; 0157), how loudly
-- ('important', the 'order' category), the words, the link, the schedule, and what counts as waiting (status 'new',
-- across the whole pass).
--
-- The producer runs once at the end, so a line left open over a pass that is already clear closes when this is
-- applied, and an open line is restated as the cron would restate it within five minutes.

create or replace function public.alert_stale_orders(grace_min int default 10) returns int
  language plpgsql security definer set search_path = public as $$
declare
  n          int;
  last_rung  timestamptz;
  ring_every constant interval := interval '15 minutes' - interval '30 seconds';
begin
  -- Due: the later of when it was placed and when the truck said it would make it (greatest() passes over a null
  -- ready_from) — lib/ordering's orderClockFrom. greatest(grace_min, 2) as 0120 wrote it, so a mistaken 0 cannot
  -- ring for every ticket the moment it lands.
  select count(*) into n from public.orders
   where status = 'new'
     and greatest(created_at, ready_from) <= now() - make_interval(mins => greatest(grace_min, 2));

  -- Nothing waiting: the line closes itself (0340), the mechanism's ack — ack_by stays null.
  if n = 0 then
    update public.alerts set ack_at = now()
     where kind = 'order_stale' and subject_id is null and ack_at is null;
    return 0;
  end if;

  -- Still waiting, and the pass was last rung fifteen minutes ago or more: the open line closes, so the one
  -- alert_open_once opens below is a new row, and a new row is what rings (0157).
  select max(a.created_at) into last_rung from public.alerts a where a.kind = 'order_stale' and a.subject_id is null;
  if last_rung <= now() - ring_every then
    update public.alerts set ack_at = now()
     where kind = 'order_stale' and subject_id is null and ack_at is null;
  end if;

  -- One open line (0336): refreshed while it is open; opened when there is none — but not within fifteen minutes of
  -- the last ring, so a line someone acknowledged stays down until then (0174's cooldown).
  perform public.alert_open_once(
    'order_stale', null, 'important', 'order',
    '🧾 ' || n || ' order' || case when n = 1 then '' else 's' end || ' waiting on the pass',
    'A ticket has been sitting 10+ minutes in "new" — someone open the kitchen pass.',
    '/admin',
    ring_every);
  return n;
end $$;

-- A cron job's, as 0120 and 0123 said: nothing in the app calls it, and a stranger must not ring the owners' phones.
revoke all on function public.alert_stale_orders(int) from public, anon, authenticated;

comment on function public.alert_stale_orders(int) is
  'The pass''s waiting alert (kind order_stale, no subject, important, to leadership): counts tickets in ''new'' that have been due grace_min minutes (due = greatest(created_at, ready_from), lib/ordering orderClockFrom). Rings through alert_open_once; while tickets wait it rings again every fifteen minutes by closing the open line and opening a new one (the push fans out on INSERT, 0157), so one line is ever open; a pass with nothing waiting closes it (0369).';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The pass alert rings until the pass is clear','fix','Ops',
   'The alert that tells you tickets are waiting on the pass rang once and then sat quietly in the inbox — for up to three weeks — however long the tickets went on waiting, and it still said they were waiting after the pass had been cleared. It now rings again every fifteen minutes while tickets are still waiting, as one line rather than a pile, and closes itself when nothing is waiting. An order placed ahead of a stop counts from when the truck said it would make it, so a pre-order no longer sets the alert off hours before the stop opens.',
   '2026-10-11', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- The rows it already wrote, restated by the producer itself (scripts/smoke.cjs: a re-emitted producer restates them).
select public.alert_stale_orders(10);

-- verify:
--   select kind, title, created_at, ack_at, ack_by from public.alerts where kind = 'order_stale' order by created_at desc limit 3;
--     -- at most one row with ack_at null; none at all when nothing is waiting
--   select has_function_privilege('authenticated', 'public.alert_stale_orders(int)', 'execute');   -- f
select public.record_migration('0369_the_pass_alert_rings_until_the_pass_is_clear');
