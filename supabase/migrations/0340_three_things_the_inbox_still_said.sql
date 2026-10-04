-- ── THREE THINGS THE INBOX STILL SAID ─────────────────────────────────────────────────────────
-- 2026-10-04. Ryan sent a screenshot of the crew inbox with no words on it. It read "3 critical",
-- and none of the three lines said a true thing about now:
--
--   1. "A paid order has not moved in 12 hours" over a body saying 119 — about the SAME order, on
--      the same card. 0329 refreshes an open alert's BODY every half hour and never its TITLE, so
--      the title froze at the age the order had the night it was first raised and the body kept
--      counting. 0336 wrote the rule for this down ("a stale body on an open alert is its own small
--      lie") and then left this producer alone on purpose; the title is the same lie, one line up.
--      The body also read "Ryan paid 32.00". Every other money sentence in these migrations writes
--      the dollar sign. This one did not, twice (0329, 0331).
--
--   2. Two "App error — a screen crashed", July 16 and September 6, both still CRITICAL. Their
--      messages are the stale-build family — "module factory is not available", "Failed to load
--      chunk … from module 74850" — which 0303 ruled is a tab one deploy behind, healed by a reload:
--      an fyi, not an incident. 0303 fixed the PRODUCER (app/error.tsx now classifies before it
--      reports) and never the rows that producer had already written, and 0258 exempts criticals
--      from expiry at every age. That is 0333's lesson exactly — "a migration that corrects a
--      producer and not the rows the producer already wrote leaves the product broken in precisely
--      the way the migration was written to fix" — arriving one migration late for 0303.
--
--   3. "No uptime monitor is watching the app ×63". There IS one, since 2026-10-02:
--      .github/workflows/production.yml runs verify:prod --quick every thirty minutes, and every run
--      stamps the heartbeat through /api/health. The watchdog calls a stamp stale after THIRTY
--      minutes. A check that runs every 30 minutes, judged by a rule that fires after 30 minutes of
--      silence, fires every time the check is late at all — and GitHub's scheduler is late as a
--      matter of documented policy: "The schedule event can be delayed during periods of high loads
--      … High load times include the start of every hour. If the load is sufficiently high enough,
--      some queued jobs may be dropped." Our cron fired at :00 and :30. So the count went up on
--      every late run, under a title saying the monitor did not exist.
--
-- ── WHAT THIS DOES ─────────────────────────────────────────────────────────────────────────────
-- 1. shop_order_stall_watchdog moves onto alert_open_once (0336's one home), which refreshes the
--    TITLE with the body. The title states what v_shop_orders actually measures — time since
--    payment, said the way the shop panel says it (shop_age_words mirrors lib/shopOrder's ageLabel;
--    the db test runs both and fails if they ever disagree). The body follows the order's status:
--    0329's one body said "this app sent it" about every order waiting on us — including the cap
--    itself, which 0334 had moved to needs_fulfillment precisely because nothing showed it was sent.
--    And an alert whose order is no longer waiting on us now closes itself, because "Got it" on a
--    broadcast alert only hides it for the person who tapped it (0157), and 0258 never expires a
--    critical — so a stall that was RESOLVED stayed open in the table for ever.
--
-- 2. The pre-0303 crash rows with a stale-build message are restated to what 0303 decided they
--    are, and the hourly sweep is run once so they leave the feed now rather than at :17.
--
-- 3. heartbeat_watchdog waits 90 minutes — three of the monitor's half-hours — before it calls the
--    check quiet; the workflow moves off the top of the hour in the same commit; and scripts/smoke
--    reads both files and fails if the threshold is ever less than three periods again. The copy
--    says what is true now that a monitor exists. The ×63 line is retired: its title is false and
--    its count is mostly late runs.
--
-- ── WHAT THIS DELIBERATELY DOES NOT DO ─────────────────────────────────────────────────────────
-- It does not clear any critical that nothing has ruled on. The crash rows it restates are matched
-- on the error MESSAGE they carry (data the client sent), against the same signatures lib/
-- deploySkew treats as unambiguous — not on the alert's own title, which is the mistake 0336 exists
-- to forbid — and only rows written before 0303's producer existed (8201b47, 2026-09-07 03:10 UTC).
-- A skew crash raised AFTER that is the one 0303 kept critical on purpose: the reload did not fix
-- it. Those stay exactly as they are, and so does every other critical.

-- ── 1 · THE STALLED-ORDER ALERT ────────────────────────────────────────────────────────────────

-- The age of an order, in the words the shop panel already uses for it. A MIRROR of
-- lib/shopOrder.ts ageLabel — a known pair, because the cron producer cannot call TypeScript and
-- the panel cannot call this. scripts/db.stalledorder.test.mjs compiles the TypeScript and runs
-- both over every hour from 0 to 1000; if they ever disagree the suite fails. Disagreeing is not
-- hypothetical: rounding here would have titled the cap "5 days" while the queue headline above it
-- read "the oldest for 4 days", about the same order, on the same screen.
create or replace function public.shop_age_words(hours int) returns text
  language sql immutable set search_path = public as $$
  select case
    when hours is null or hours < 0 then ''
    when hours < 1  then 'just now'
    when hours < 24 then hours || 'h'
    when hours / 24 = 1 then '1 day'
    else (hours / 24) || ' days'
  end
$$;
revoke all on function public.shop_age_words(int) from public, anon, authenticated;

create or replace function public.shop_order_stall_watchdog(stale_hours int default 24)
  returns int language plpgsql security definer set search_path = public as $$
declare
  r        record;
  was_open boolean;
  v_ago    text;
  v_title  text;
  v_body   text;
  raised   int := 0;
begin
  -- AN ALERT ABOUT AN ORDER THAT IS NO LONGER STUCK IS NOT AN ALERT. Closed by the mechanism that
  -- raised it (ack_at, ack_by left null — 0258's way of saying no person did it), and first, so a
  -- row is never closed and reopened in the same run. "Not waiting on us" is the view's decision,
  -- not this function's: in production, at the printer, shipped, refunded, cancelled, or gone.
  update public.alerts a
     set ack_at = now()
   where a.kind = 'shop_order_stalled'
     and a.ack_at is null
     and not exists (select 1 from public.v_shop_orders o where o.id = a.subject_id and o.waiting_on_us);

  -- greatest(...,1) so a mistaken 0 cannot turn this into "alert on every order the moment it is paid".
  for r in
    select o.id, o.who, o.status, o.age_hours, o.total_cents, o.items, o.created_at, o.status_changed_at
      from public.v_shop_orders o
     where o.waiting_on_us
       and o.age_hours >= greatest(stale_hours, 1)
     order by o.age_hours desc
  loop
    was_open := exists (select 1 from public.alerts a
                         where a.kind = 'shop_order_stalled' and a.subject_id = r.id and a.ack_at is null);

    v_ago := case when r.age_hours >= 1 then public.shop_age_words(r.age_hours) || ' ago' else 'just now' end;
    -- The title carries the AGE, so it is rewritten on every run along with everything else —
    -- alert_open_once refreshes title, body and link together. A number in a title that nothing
    -- refreshes is how "12 hours" sat over "119".
    v_title := r.who || ' paid $' || to_char(coalesce(r.total_cents, 0) / 100.0, 'FM999,999,990.00')
             || ' ' || v_ago || ' — still waiting on us';
    -- One sentence per status, in the shop panel's own words (lib/shopOrder.ts SHOP_STATUS_META —
    -- scripts/smoke.cjs fails if a status the view calls waiting-on-us has no branch here, or if a
    -- branch stops quoting that status's label). 0329 had one body for all three, and it said "this
    -- app sent it" about Paid and Needs-fulfilment orders too — the cap's own alert said it.
    v_body := coalesce(r.items, 'This order') || '. ' || case r.status
      when 'submitted' then
        'The shop shows it as "Sent, not confirmed": it went to Apliiq on '
        || to_char(coalesce(r.status_changed_at, r.created_at) at time zone 'America/New_York', 'Dy, Mon FMDD')
        || ' and nothing has come back since. Apliiq refuses an order by emailing the account owner — '
        || 'never this app — so open Apliiq and make sure it is really there.'
      when 'needs_fulfillment' then
        'The shop shows it as "Needs fulfilment": paid, and nothing shows the printer has it. Open '
        || 'the order and send it to the printer, or refund it.'
      when 'paid' then
        'The shop shows it as "Paid": the card cleared and nothing has gone to the printer. Open the '
        || 'order and send it to the printer, or refund it.'
      else
        'It is still waiting on us.'
    end;

    -- ONE open alert per ORDER (kind, subject). Critical on purpose — 0329's reasoning stands: it
    -- cannot exist unless a real customer paid and was not served. No cooldown: an alert closed
    -- above was closed because the order moved, and an order that stalls again is news again.
    perform public.alert_open_once('shop_order_stalled', r.id, 'critical', 'order', v_title, v_body,
                                   '/crew?s=money&a=shoporders');
    if not was_open then raised := raised + 1; end if;
  end loop;
  return raised;
end $$;

revoke all on function public.shop_order_stall_watchdog(int) from public, anon, authenticated;

comment on function public.shop_order_stall_watchdog(int) is
  'ONE critical alert per merch order that v_shop_orders says is waiting on us and was paid at least stale_hours ago (default 24). Raised and refreshed through alert_open_once, so the title — which carries the age — is rewritten with the body on every run (0340: the title had frozen at "12 hours" over a body reading 119). Closes its own alert when the order stops waiting on us. Not public.orders: that is the cafe pass, watched by alert_stale_orders.';

-- THE ROWS ALREADY IN THE INBOX. Running the producer once IS the restatement: every open alert
-- for an order still stuck gets the title and body it should have had, through the same
-- alert_open_once call the cron makes, and an alert for an order that has moved closes. Nothing
-- new can be raised that the cron would not raise within half an hour anyway.
select public.shop_order_stall_watchdog(24);


-- ── 2 · THE SCREENS THAT HEALED THEMSELVES ─────────────────────────────────────────────────────
-- Restated, not cleared by a person and not deleted: severity becomes what 0303 decided this
-- family is, and the hourly sweep — 0258's, the only mechanism that expires anything — runs once
-- below, so these leave the live feed when this is applied. ack_by stays null. Title and body stay
-- as they were: what they said at the time is the record of what Ryan was shown (0333's rule).
--
-- WHICH ROWS, AND WHY EACH CONDITION IS THERE:
--   kind is null, category system   the shape the error intake wrote: it never set a kind
--                                   (lib/errorIntake now does — 'client_error' + the row's id —
--                                   so nobody has to match on a message to find these again)
--   created_at < 8201b47            only the producer that reported BEFORE classifying. After it, a
--                                   critical skew row means three reloads failed, which is real.
--   the message                     the same unambiguous signatures lib/deploySkew lists as EXACT,
--                                   plus its chunk-and-failure structure. NOT its REBUILT family
--                                   ("x is not a function"): that one is broad on purpose because a
--                                   wrong guess costs one reload, and here a wrong guess would cost
--                                   a real crash its alert. The db test runs every message below
--                                   through lib/deploySkew too, and fails if this ever claims a
--                                   message that the app itself would not call skew.
update public.alerts
   set severity = 'fyi'
 where ack_at is null
   and severity = 'critical'
   and kind is null
   and category = 'system'
   and created_at < timestamptz '2026-09-07 03:10:27+00'
   and (
         body ~* '(ChunkLoadError|module factory is not available|Importing a module script failed|error loading dynamically imported module|Failed to fetch dynamically imported module)'
      or (body ~* '\ychunks?\y'
          and body ~* '(\yfail(ed|ure)?\y|\yerror\y|\ycould not\y|\yunable\y|\yloading\y|\yload(ing)?\y)')
   );

-- The sweep, run once now rather than at :17. It is the cron's own function, so nothing here
-- decides a window: an fyi older than 7 days is acknowledged because 0258 says so.
select public.alert_autoexpire();


-- ── 3 · THE UPTIME CHECK ───────────────────────────────────────────────────────────────────────
-- Where the watchdog remembers which silence it has already counted. 0327 kept that in
-- alerts.last_seen_at, which gave the column two meanings — the heartbeat stamp here, the wall
-- clock in 0329 — and the inbox reads it as the second (0336 named the pair; this ends it). It
-- belongs with the heartbeat, so it lives with the heartbeat.
alter table public.ops_heartbeat add column if not exists counted_stamp timestamptz;
comment on column public.ops_heartbeat.counted_stamp is
  'The seen_at whose silence heartbeat_watchdog has already counted. A new silence is a stamp that differs from this one. Moved out of alerts.last_seen_at in 0340, which now means only "when this was last true".';

-- heartbeat-stale-after: 90
-- That marker is read by scripts/smoke.cjs, which also reads the quick schedule out of
-- .github/workflows/production.yml and fails unless this is at least THREE of its periods: one
-- late run and one dropped run, which is what GitHub's documentation says to expect, must not be
-- an alert. Thirty against thirty is how the count reached 63.
create or replace function public.heartbeat_watchdog() returns void
language plpgsql security definer set search_path = public as $$
declare
  hb         timestamptz;
  counted    timestamptz;
  open_id    uuid;
  last_quiet timestamptz;
  v_back     text;
  quiet      interval;
  quiet_in   text;
  et         constant text := 'America/New_York';
begin
  select seen_at, counted_stamp into hb, counted from public.ops_heartbeat where id = 1;
  if hb is null then return; end if;

  -- last_seen_at is "when this was last true" (alert_open_once writes the wall clock), so for this
  -- kind it is the last run that found the check quiet.
  select a.id, a.last_seen_at into open_id, last_quiet
    from public.alerts a
   where a.kind = 'heartbeat_stale' and a.subject_id is null and a.ack_at is null
   order by a.created_at desc
   limit 1;

  if hb > now() - interval '90 minutes' then
    -- Checking in. An open line from an earlier silence must stop saying "nothing has checked" —
    -- that sentence is now false. The text carries no clock that moves, so it is written once and
    -- a healthy hour is not six realtime updates to every open console.
    if open_id is not null then
      v_back := 'It went quiet after '
        || to_char(coalesce(counted, hb) at time zone et, 'Dy, Mon FMDD, FMHH12:MI AM')
        || ' ET and was still quiet at '
        || to_char(coalesce(last_quiet, now()) at time zone et, 'FMHH12:MI AM')
        || ' ET. It has been checking in again since. Nothing to do unless it repeats — the count '
        || 'on this line says how often it has.';
      update public.alerts a set body = v_back
       where a.id = open_id and a.body is distinct from v_back;
    end if;
    return;
  end if;

  quiet := now() - hb;
  -- Exact while it is minutes; past two hours the number is rounded DOWN, and the word "over"
  -- says so — "2 hours" for two and a half would be a small lie in the one sentence about time.
  quiet_in := case
    when quiet < interval '2 hours'  then floor(extract(epoch from quiet) / 60)::int            || ' minutes'
    when quiet < interval '48 hours' then 'over ' || floor(extract(epoch from quiet) / 3600)::int  || ' hours'
    else                                  'over ' || floor(extract(epoch from quiet) / 86400)::int || ' days'
  end;

  -- 'important', as 0327 decided: a check that has gone quiet is a gap worth fixing, not a payment
  -- failing. The title is past tense so it stays true after the check comes back.
  perform public.alert_open_once(
    'heartbeat_stale', null, 'important', 'system',
    'The uptime check went quiet',
    'Nothing has checked /api/health since '
      || to_char(hb at time zone et, 'Dy, Mon FMDD, FMHH12:MI AM') || ' ET — ' || quiet_in
      || ', against a check that runs every half hour from GitHub (Actions › Production). Either '
      || 'that schedule has stopped — GitHub pauses it after 60 days without a push — or it cannot '
      || 'reach the app, and its runs are red. The database is up: this alert could not exist otherwise.',
    '/crew');

  -- COUNT SILENCES, NOT RUNS (0327's rule, kept): a new silence is a stamp this watchdog has not
  -- counted. And a new silence RE-SURFACES the line. "Got it" on a broadcast alert records a
  -- per-person read and never sets ack_at (0157), so without this a person who dismissed the last
  -- silence would never see the next one — it would fold, silently, into a line they had cleared.
  if open_id is not null and counted is distinct from hb then
    update public.alerts set occurrences = occurrences + 1 where id = open_id;
    delete from public.alert_reads where alert_id = open_id;
  end if;

  update public.ops_heartbeat set counted_stamp = hb where id = 1 and counted_stamp is distinct from hb;
end $$;

-- 0255 and 0327 left this executable by anyone PostgREST lets in. It is a cron job; nothing in the
-- app calls it, and a stranger should not be able to make it write to the owners' inbox.
revoke all on function public.heartbeat_watchdog() from public, anon, authenticated;

comment on function public.heartbeat_watchdog() is
  'Raises ONE important alert (alert_open_once, kind heartbeat_stale, no subject) when nothing has stamped /api/health for 90 minutes — three periods of the half-hourly GitHub check (production.yml), a pair scripts/smoke.cjs enforces. Counts distinct silences via ops_heartbeat.counted_stamp, re-surfaces the line for everyone on a new one, and rewrites it to say so when checks resume.';

-- THE ROW ALREADY IN THE INBOX. Retired, not restated: its title says no monitor exists, which has
-- been false since 2026-10-02, and its count of 63 is mostly a thirty-minute check judged by a
-- thirty-minute rule. A count you cannot trust is worse than none, so it is not carried over.
-- ack_at, ack_by null — a mechanism, not a person — and the row stays for history.
update public.alerts
   set ack_at = now()
 where kind = 'heartbeat_stale'
   and ack_at is null;


-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The alert inbox only says things that are still true','fix','Ops',
   'Three alerts in the inbox had stopped describing the present. The stalled-order alert''s title had frozen at "12 hours" while its body counted to 119 — it now rewrites both together, shows the dollar sign, says what the order''s status actually means, and closes itself once the order moves. Two crash alerts from July and September were the harmless reload-after-an-update kind, which the app reclassified in September for new alerts but never for these two; they are now filed as the non-events they were. And the uptime alert claimed no monitor existed when one has been running every half hour since October 2 — it was judging a half-hourly check by a half-hour rule, so every late run counted as an outage. It now waits for three missed checks and says what that means.',
   '2026-10-04', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0340_three_things_the_inbox_still_said',
  'Three alerts no longer true. (1) shop_order_stall_watchdog onto alert_open_once: 0329 refreshed body and never title, so "12 hours" sat over "119"; money gains its $ (every other producer had it); body per status (0329 said "this app sent it" about Paid orders never sent); alerts close when the order stops waiting on us (broadcast Got-it never sets ack_at and 0258 never expires a critical, so a resolved stall stayed open for ever); shop_age_words mirrors lib/shopOrder ageLabel, run against it in the db test. Open rows restated by running the producer. (2) pre-0303 (8201b47, 2026-09-07 03:10 UTC) kind-less critical system alerts whose message is an unambiguous stale-build signature restated to fyi — 0303 fixed the producer, not its rows (0333''s lesson) — then the sweep run once. REBUILT-family messages and every post-0303 critical untouched. (3) heartbeat_watchdog: 90-minute threshold (three periods of the */30 GitHub check; 30 against 30 fired on every late run — 63 counted), workflow moved off :00 per GitHub''s documented top-of-hour load, gated as a pair in smoke; copy true now that a monitor exists; episode key moved to ops_heartbeat.counted_stamp so alerts.last_seen_at has one meaning; a new silence deletes alert_reads so a dismissed line resurfaces; recovery rewrites the body once. The x63 row retired by ack (false title, untrustworthy count).');

-- verify:
--   select title, left(body, 90), last_seen_at from public.alerts where kind = 'shop_order_stalled' and ack_at is null;
--     -- "<who> paid $32.00 <n> days ago — still waiting on us", body by status
--   select count(*) from public.alerts where ack_at is null and severity = 'critical';
--     -- the two pre-0303 crash rows are gone from this count
--   select kind, title, occurrences, ack_at from public.alerts where kind = 'heartbeat_stale' order by created_at desc limit 2;
--     -- the x63 row acknowledged; a new one only after 90 quiet minutes
--   select seen_at, counted_stamp from public.ops_heartbeat;
