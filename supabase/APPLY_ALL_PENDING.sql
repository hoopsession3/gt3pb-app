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
-- pending-from: 0337
-- generated-at: 2026-10-01
-- pending-count: 2
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- ============================================================
-- 0336_the_guard_that_matched_on_a_sentence.sql
-- ============================================================
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

-- ============================================================
-- 0337_how_small_can_this_vessel_go.sql
-- ============================================================
-- ── HOW SMALL CAN THIS VESSEL GO ──────────────────────────────────────────────────────────────
-- 2026-10-01. Ryan: "Recipe should be able to scale down as small as possible to not waste and
-- expand as needed." Asked how small: "Start at 3 servings 30OZ." Asked how to handle the vessel's
-- own minimum, which nobody has ever measured: "Add the column, I'll measure."
--
-- This is that column, and it is the one lib/brewMath's vesselFit already asked for in writing on
-- 2026-09-07:
--
--     "TOO SMALL is NOT a fact and this does not pretend it is. The real minimum depends on where
--      the basket sits, which is not recorded anywhere and which I have not measured. A third of
--      capacity is a prompt to go and look at the vessel, not a specification of it... If the true
--      minimum is ever measured it belongs on brew_vessels as a column, and this heuristic should
--      be deleted the day it is."
--
-- The heuristic is not deleted here, because deleting it today would leave BOTH vessels with no
-- minimum at all — the column ships empty and stays empty until somebody goes and measures. What
-- changes is precedence: a measured minimum wins, and the capacity/3 guess applies only while the
-- column is null, saying so in the copy. The day both rows carry a number, the guess is dead code
-- and can go.
--
-- ── WHY NULLABLE, WITH NO DEFAULT ──────────────────────────────────────────────────────────────
-- Because "not measured" and "measured at zero" are different facts and a default would merge them.
-- A default of capacity/3 would be the guess again, written into the database where it would look
-- like a measurement and outlive the comment explaining that it was not one. Null means nobody has
-- looked, the app says so, and nothing is blocked.
alter table public.brew_vessels add column if not exists min_gal numeric;

-- A minimum at or above capacity is not a minimum, it is a broken row — and it would make every
-- batch in that vessel read as too small, forever, with no way to tell why. Caught here rather than
-- in a form, because the form is not the only thing that writes rows.
alter table public.brew_vessels drop constraint if exists brew_vessels_min_under_capacity;
alter table public.brew_vessels
  add constraint brew_vessels_min_under_capacity
  check (min_gal is null or (min_gal > 0 and min_gal < capacity_gal));

comment on column public.brew_vessels.min_gal is
  'The smallest batch this vessel can actually brew, in gallons — MEASURED, never estimated. For a basket vessel it is the volume at which the liquid first reaches the filter basket; for a bag vessel it is the volume that covers the bag. NULL means nobody has measured it yet, which is a different fact from zero and must stay distinguishable: lib/brewMath.vesselFit falls back to a capacity/3 PROMPT only while this is null, and the prompt is meant to be retired once every vessel carries a real number. Half a gallon in the 5 gal Cold Brew Avenue is the batch that started this — correct arithmetic, not brewable.';

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Batches can be planned small without wasting coffee','fix','Brew',
   'Planning a batch used to round it up to the nearest quarter gallon, which quietly threw away up to three servings of coffee on every single brew — ask for three servings and it would brew five. Batches now round to a much finer step, so what you ask for is what you make. The smallest batch is three servings, worked out through each recipe''s own yield so that three servings means three actually come out. Each vessel can also record the smallest batch it can physically brew, once that has been measured.',
   '2026-10-01', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0337_how_small_can_this_vessel_go',
  'brew_vessels.min_gal — the measured smallest batch a vessel can brew, nullable with no default because "not measured" and "zero" are different facts. Delivers the column vesselFit asked for in writing on 2026-09-07 ("if the true minimum is ever measured it belongs on brew_vessels as a column"). The capacity/3 heuristic is NOT deleted yet: the column ships empty, so deleting it today would leave both vessels with no minimum at all. Precedence instead — a measured minimum wins, the guess applies only while null, and the guess becomes dead code the day Toddy and Cold Brew Avenue both carry a number. CHECK refuses a minimum at or above capacity, which would make every batch in that vessel read as too small forever. Shipped with the app-side change Ryan asked for: gallonsForBottles rounded up to 0.25 gal and wasted up to 2 bottles at EVERY size (3 bottles requested brewed 0.5 gal and made 5, 67% over); the step is now 0.05 gal and the waste is 0 across counts 1-120 at four yield factors. The floor is 3 servings computed THROUGH the yield — 30 oz of water at a 0.92 yield pours 27.6 oz, which is two servings, so a 30 oz floor would have handed somebody who asked for three a batch that makes two.');

-- verify:
--   select name, capacity_gal, min_gal, filter_type from public.brew_vessels order by sort;
--   -- both min_gal are NULL until measured; the app says so rather than guessing
--   update public.brew_vessels set min_gal = capacity_gal where name = 'Toddy (commercial)';  -- must FAIL
--   select conname from pg_constraint where conrelid = 'public.brew_vessels'::regclass and conname like '%min_under%';
