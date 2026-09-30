-- ── THE GUARD THAT MATCHED ON A SENTENCE ──────────────────────────────────────────────────────
-- 2026-09-30. 0174's alert_stale_orders decides whether the café already has an open "orders are
-- piling up" alert like this:
--
--     if not exists (select 1 from public.alerts
--                     where category = 'order' and title like '%waiting on the pass%' ...)
--
-- And three lines later it writes the row:
--
--     insert into public.alerts (severity, category, kind, title, body, link)
--     values ('important', 'order', 'order_stale', '🧾 ' || n || ' order... waiting on the pass', ...)
--                                    ^^^^^^^^^^^^
-- The key is RIGHT THERE, written by the same statement, and the guard does not use it. It matches
-- on a sentence instead — so the dedupe holds only as long as nobody edits the copy. Rename "the
-- pass" to "the counter", make it read better, translate it, and the guard silently stops matching.
-- The cron is */5, so that is 288 alerts a day, arriving during the exact service rush the alert is
-- about, with nothing anywhere to say why.
--
-- Read out of production before writing this: 0 café orders currently stale, 0 order_stale alerts
-- ever raised. It has never fired. That is not reassurance — it means the flood would arrive on the
-- first busy morning, in an app whose owner has spent two days learning that his alerts are noise.
--
-- ── WHY A SHARED FUNCTION AND NOT A BETTER WHERE CLAUSE ────────────────────────────────────────
-- Because 19 migrations in this repo contain a guard of this shape, each written slightly
-- differently — by kind, by kind and subject, by exact title, by title LIKE, by category and a time
-- window. They disagree about what "already open" means, and every new producer invents a twentieth.
--
-- This is the one home. It keys on (kind, subject_id), which are the columns 0174 added FOR this
-- purpose, and it refuses to be given a title to match on — there is no parameter for that, so the
-- mistake cannot be spelled here.
--
-- ── WHAT THIS DELIBERATELY DOES NOT DO ─────────────────────────────────────────────────────────
-- It does not touch heartbeat_watchdog (0327) or shop_order_stall_watchdog (0329/0331). Both are
-- CORRECT — they already key on kind and subject — and re-emitting two working watchdogs to satisfy
-- tidiness is how a good night's work breaks something that was fine. Earlier tonight retyping one
-- function from memory silently changed five behaviours, including a refund floor. The gate added
-- alongside this carries a FLOOR at 0336 for the same reason: history is not retro-judged, and the
-- other 18 are recorded as a backlog rather than rewritten at three in the morning.
--
-- It does not touch occurrences. 0327 counts distinct episodes by stashing the heartbeat stamp in
-- last_seen_at; 0329 writes now() into the same column meaning "still stuck". That is one column
-- with two meanings and it is a real finding, but fixing it means changing 0327's counting, which
-- is not a 3am change. Named here so it is a known pair and not a discovery.

-- ── THE ONE HOME ───────────────────────────────────────────────────────────────────────────────
-- Returns the alert's id, so a caller can tell what it touched. NULL subject is a legitimate key —
-- a condition about the whole app rather than one row (the heartbeat is one) — which is why the
-- match uses IS NOT DISTINCT FROM rather than =, since `subject_id = null` is never true and would
-- silently make every such alert a fresh row. That is exactly the flood, rebuilt by accident.
create or replace function public.alert_open_once(
  p_kind     text,
  p_subject  uuid   default null,
  p_severity text   default 'important',
  p_category text   default 'system',
  p_title    text   default null,
  p_body     text   default null,
  p_link     text   default '/crew',
  -- THE COOLDOWN 0174 HAD AND I ALMOST DROPPED. Its guard read
  --   (ack_at is null OR created_at > now() - interval '15 minutes')
  -- and that OR is not redundant: it means "do not reopen this within 15 minutes EVEN IF somebody
  -- acknowledged it". Without it, acking a */5 alert gets you a fresh one five minutes later, which
  -- is the flood again at a politer cadence. Caught by diffing the re-emitted function against
  -- 0174's own text rather than trusting that I had copied it faithfully — the same check that
  -- caught a refund floor going from `<= 0` to `< 0` earlier tonight.
  -- NULL means no cooldown: once acknowledged, the next occurrence opens immediately (0327's rule,
  -- and the right one for a condition an owner has explicitly cleared).
  p_reopen_after interval default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare open_id uuid;
begin
  if coalesce(btrim(p_kind), '') = '' then
    raise exception 'alert_open_once needs a kind — that is the key the whole dedupe turns on.';
  end if;

  select a.id into open_id
    from public.alerts a
   where a.kind = p_kind
     and a.subject_id is not distinct from p_subject
     and a.ack_at is null
   order by a.created_at desc
   limit 1;

  if open_id is not null then
    -- Still true. Refresh what it SAYS — a stale body on an open alert is its own small lie, and
    -- 0329 had to learn that separately — and record that we just saw it. Severity and category are
    -- deliberately not rewritten: an operator who is looking at a critical should not have it
    -- change class under them mid-read.
    update public.alerts
       set title        = coalesce(p_title, title),
           body         = coalesce(p_body, body),
           link         = coalesce(p_link, link),
           last_seen_at = now()
     where id = open_id;
    return open_id;
  end if;

  -- Nothing open. Before opening one, respect the cooldown if the caller asked for it.
  if p_reopen_after is not null and exists (
    select 1 from public.alerts a
     where a.kind = p_kind
       and a.subject_id is not distinct from p_subject
       and a.created_at > now() - p_reopen_after
  ) then
    return null;   -- suppressed on purpose; the caller just cleared this recently
  end if;

  insert into public.alerts (severity, category, kind, subject_id, title, body, link, last_seen_at)
  values (p_severity, p_category, p_kind, p_subject, p_title, p_body, p_link, now())
  returning id into open_id;
  return open_id;
end $$;

comment on function public.alert_open_once(text, uuid, text, text, text, text, text, interval) is
  'THE one way to raise an alert that must not repeat. Keys on (kind, subject_id) — the columns 0174 added for exactly this — and has no parameter for a title to match on, so the 0174 mistake (title like ''%waiting on the pass%'') cannot be spelled here. 19 migrations contain a hand-written version of this guard, each slightly different about what "already open" means; scripts/smoke.cjs now refuses new ones from 0336 forward.';

-- ── THE LANDMINE, DISARMED ─────────────────────────────────────────────────────────────────────
-- Re-emitted from 0174 with the guard replaced and NOTHING else changed: same signature, same
-- greatest(grace_min, 2) floor, same count, same copy, same link. The only difference is that it
-- now asks the question using the key it was already writing.
create or replace function public.alert_stale_orders(grace_min int default 10) returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(*) into n from public.orders
   where status = 'new' and created_at < now() - make_interval(mins => greatest(grace_min, 2));
  if n > 0 then
    -- subject is null on purpose: this is one condition about the whole pass, not about one ticket.
    -- The count moves as tickets land, so the title is refreshed rather than duplicated.
    perform public.alert_open_once(
      'order_stale', null, 'important', 'order',
      '🧾 ' || n || ' order' || case when n = 1 then '' else 's' end || ' waiting on the pass',
      'A ticket has been sitting 10+ minutes in "new" — someone open the kitchen pass.',
      '/admin',
      -- 0174's 15-minute cooldown, carried over exactly. The cron is */5, so without this an
      -- acknowledged alert returns in five minutes instead of fifteen.
      interval '15 minutes');
  end if;
  return n;
end $$;

-- Staff read alerts; nothing calls these from a browser. The cron producers run as the job owner.
revoke all on function public.alert_open_once(text, uuid, text, text, text, text, text, interval) from public, anon, authenticated;

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The "orders are backing up" alert can no longer flood you','fix','Ops',
   'The alert that tells you tickets are piling up at the pass checked whether it had already warned you by searching for its own wording. Editing that sentence — even just to make it read better — would have quietly broken the check, and the alert repeats every five minutes, so it would have arrived hundreds of times during exactly the rush it was warning about. It now recognises itself properly, and there is one shared way to raise any alert that must not repeat.',
   '2026-09-30', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0336_the_guard_that_matched_on_a_sentence',
  'alert_open_once() as the ONE home for "raise it once", and alert_stale_orders migrated onto it. 0174 guarded with `title like ''%waiting on the pass%''` while WRITING kind=''order_stale'' three lines later — the key was there and unused, so the dedupe held only until somebody edited the copy, and the cron is */5 (288 alerts a day, during the rush the alert is about). Never fired in production: 0 stale orders, 0 order_stale alerts ever. 19 migrations contain a hand-written guard of this shape and they disagree about what "already open" means; the gate carries a FLOOR at 0336 and the other 18 are a recorded backlog, not a 3am rewrite. heartbeat_watchdog and shop_order_stall_watchdog are deliberately untouched — both already key on (kind, subject) and are correct. 0174''s 15-minute post-acknowledgement cooldown is carried over as p_reopen_after — dropping it would have turned a */5 cron into a five-minute reopen, caught by diffing against 0174''s own text. Named but NOT fixed: 0327 stores an episode key in last_seen_at while 0329 stores a wall clock there, one column with two meanings.');

-- verify:
--   select public.alert_stale_orders(10);            -- returns the count; raises at most one alert
--   select public.alert_stale_orders(10);            -- again: still ONE row, last_seen_at moved
--   select kind, subject_id, title, occurrences, last_seen_at from public.alerts where kind='order_stale';
--   select has_function_privilege('authenticated','public.alert_open_once(text,uuid,text,text,text,text,text,interval)','execute');  -- false
