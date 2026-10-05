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
-- pending-from: 0348
-- generated-at: 2026-10-05
-- pending-count: 1
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- ============================================================
-- 0348_tonight_is_not_the_past.sql
-- ============================================================
-- ── TONIGHT IS NOT THE PAST ───────────────────────────────────────────────────────────────────
-- 2026-10-05. Two things in the views behind Plan › Needs sorting and the event record sheet, found
-- reading them against the screenshots Ryan sent of Plan › Events.
--
-- 1. THE VIEWS' "TODAY" WAS UTC'S. v_event_record says where an event sits in time with
--    `current_date`, and the database keeps UTC — the same instant reads 7:00am in the app and 11:00
--    in the SQL editor (lib/dates' clockTime records it). So from 8pm Eastern (7pm in winter) every
--    event dated today was already 'past', and stayed past until midnight:
--
--      · Needs sorting listed it: "The day has passed and this is still in a planning stage."
--      · if its live flag was out — the one evening it is supposed to be — it was a HIGH finding:
--        "Still flagged live, but the day has passed", with "Turn the live flag off" as the fix.
--      · the record sheet's days_away went to -1, so its "Today" block (Make it live / It's over —
--        wrap it up, 2026-10-04) disappeared mid-event, and the line above it read "The day has
--        passed and this is still being planned."
--
--    Any event still running after 8pm walks straight into it, and so does anyone wrapping one up
--    that night. The stops beside these never did: v_stop_record compares instants with now(),
--    which has no time zone to get wrong.
--
--    The day the business runs on is Eastern, and the app already says so (lib/dates.etToday; 0330,
--    0340, 0341 and 0342 each write `(now() at time zone 'America/New_York')::date` inline). This
--    gives that expression a name, public.business_day(), and puts the two event views on it.
--    `done_early` reads it too — a row marked done tonight is not "dated in the future".
--    The other views that still say current_date (0320's deadlines among them) are not changed
--    here; each is its own question about which day it means, and this commit does not guess.
--
-- 2. THE ADVICE, TWICE. stale_stage's detail ended "Wrap it or drop it." and every reader appends
--    lib/eventRecord's fix after the detail — "Wrap it if it happened, archive it if it didn't." —
--    so the row said what to do twice, and on a phone the second, better one is the part a two-line
--    clamp cut ("Wrap it if…", Ryan's screenshot). The view says what is wrong; the fix sentence
--    has one home, and it is not here. The other eight details already only diagnose.
--
-- Both views are 0339's text with those changes and nothing else: same columns in the same order
-- (create or replace view may not move one), same grants. scripts/db.event.test.mjs executes this
-- after 0314 and 0339 and asserts every rule both ways again, with the business day pinned to an
-- evening where UTC has already turned over.

-- ── 1) the business day, named once ───────────────────────────────────────────────────────────
create or replace function public.business_day() returns date
  language sql stable set search_path = public as $$
  select (now() at time zone 'America/New_York')::date
$$;

comment on function public.business_day() is
  'The calendar day the business is on: Eastern time, like lib/dates.etToday. current_date is the database''s (UTC), which turns over at 8pm Eastern in summer and 7pm in winter.';

-- ── 2) the record, on the business day ─────────────────────────────────────────────────────────
create or replace view public.v_event_record with (security_invoker = on) as
select
  e.id, e.title, e.public_title, e.type, e.category, e.archetype, e.stage,
  e.day, e.day_label, e.start_time, e.end_time, e.duration_hrs, e.plan_days,
  e.location_text, e.state, e.county, e.market, e.rig,
  e.blurb, e.capacity, e.expected_attendance, e.staff_count,
  e.member_only, e.is_public, e.published_at, e.is_live,
  e.power_available, e.water_available,
  e.completed_at, e.archived_at, e.vendor_id,
  v.name                                                               as vendor_name,
  o.crew_brief, o.dress_code, o.recap,
  t.tasks, t.tasks_done, (t.tasks - t.tasks_done)                      as tasks_open, t.tasks_critical_open,
  s.staff, a.approvals, r.rsvps, m.menu_items, sch.schedule_items,
  sa.sales_cents, sa.sales_count, sa.items_sold,
  (ec.event_id is not null)                                            as has_economics,
  -- WHERE IT SITS IN TIME. Not the same question as `stage`, which is what a person set; this is
  -- what the calendar says. The two disagreeing is itself a finding — see v_event_gaps.
  -- 0348: against the BUSINESS day, so tonight's event is 'today' until midnight Eastern.
  case when e.day is null then 'undated'
       when e.day > public.business_day() then 'upcoming'
       when e.day = public.business_day() then 'today'
       else 'past' end                                                 as phase,
  case when e.day is null then null else (e.day - public.business_day()) end as days_away,
  -- 0339: "it took nothing", said once. Appended LAST — create or replace view only adds at the end.
  o.took_nothing_at
from public.events e
left join public.vendors    v  on v.id = e.vendor_id
left join public.event_ops  o  on o.event_id = e.id
left join public.event_economics ec on ec.event_id = e.id
left join lateral (
  select count(*)::int                                            as tasks,
         count(*) filter (where x.done)::int                      as tasks_done,
         count(*) filter (where x.critical and not x.done)::int    as tasks_critical_open
    from public.event_tasks x where x.event_id = e.id
) t on true
left join lateral (select count(*)::int as staff          from public.event_staff x          where x.event_id = e.id) s   on true
left join lateral (select count(*)::int as approvals      from public.event_approvals x      where x.event_id = e.id) a   on true
left join lateral (select count(*)::int as rsvps          from public.rsvps x                where x.event_id = e.id) r   on true
left join lateral (select count(*)::int as menu_items     from public.event_menu_items x     where x.event_id = e.id) m   on true
left join lateral (select count(*)::int as schedule_items from public.event_schedule_items x where x.event_id = e.id) sch on true
left join lateral (
  select coalesce(sum(x.amount_cents), 0)::bigint as sales_cents,
         count(*)::int                            as sales_count,
         coalesce(sum(x.item_count), 0)::int      as items_sold
    from public.event_sales x where x.event_id = e.id
) sa on true;

revoke all on public.v_event_record from anon;
grant select on public.v_event_record to authenticated;

-- ── 3) the gaps: diagnosis only, on the business day ───────────────────────────────────────────
create or replace view public.v_event_gaps with (security_invoker = on) as
select r.id as event_id,
       coalesce(nullif(btrim(r.title), ''), '(untitled)') as title,
       r.day, r.stage, r.phase, g.gap, g.detail, g.severity
  from public.v_event_record r
  cross join lateral (values
    ('no_title',   'This event has no title. Every list in the app shows it as a blank row.', 'high',
       coalesce(btrim(r.title), '') = ''),
    ('no_day',     'No date, so it appears on no calendar and in no week.', 'high',
       r.day is null),
    -- 0348: the business day, so a row wrapped tonight is not "dated in the future" after 8pm.
    ('done_early', 'Marked done, but dated in the future. One of the two is wrong.', 'high',
       r.stage = 'done' and r.day is not null and r.day > public.business_day()),
    ('twin',       'Another event shares this title and date. One of them is probably the real one.', 'high',
       exists (select 1 from public.events e2
                where e2.id <> r.id and e2.archived_at is null
                  and lower(btrim(coalesce(e2.title, ''))) = lower(btrim(coalesce(r.title, '')))
                  and coalesce(btrim(coalesce(r.title, '')), '') <> ''
                  and e2.day is not distinct from r.day)),
    -- 0339: "it took nothing" is an answer. A row that carries it is not chased for a number.
    ('no_sales',   'Complete, with nothing recorded as taken. If it sold, the number is missing.', 'medium',
       r.stage = 'done' and r.sales_count = 0 and r.took_nothing_at is null),
    -- 0339: the detail lost its note-to-self ("The wrap flow writes one and works."), which was
    -- true for anyone who used it in the right order and read as a taunt to everyone else.
    ('no_recap',   'Complete, with no after-action note.', 'low',
       r.stage = 'done' and coalesce(btrim(r.recap), '') = ''),
    ('live_past',  'Still flagged live, but the day has passed. The public site may still show it.', 'high',
       r.is_live and r.phase = 'past'),
    -- Added AFTER running this view against production, which is where I found it. Two live events
    -- sat at 'confirmed' with dates 38 and 23 days in the past. Either they happened and nobody
    -- wrapped them, or they did not and nobody said so — and every other rule here was blind to it
    -- because each row is internally consistent. It is the calendar it disagrees with.
    -- 0348: the diagnosis alone. "Wrap it or drop it." was the fix, said here and then again by
    -- lib/eventRecord's gapFix right after it.
    ('stale_stage','The day has passed and this is still in a planning stage.', 'medium',
       r.phase = 'past' and r.stage in ('lead','confirmed','prep')),
    ('open_tasks', 'Complete, with critical prep still unticked.', 'low',
       r.stage = 'done' and r.tasks_critical_open > 0)
  ) as g(gap, detail, severity, hit)
 where g.hit
   and r.archived_at is null;

revoke all on public.v_event_gaps from anon;
grant select on public.v_event_gaps to authenticated;

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('An evening event is no longer in the past by 8pm','fix','Plan',
   'From 8pm Eastern (7pm in winter) the database had already moved on to tomorrow, so an event happening that night showed up under Needs sorting as if its day had passed — and a live one as "still flagged live", with advice to turn the flag off — while its record lost the buttons for running the day. Events now go by the business''s own day, Eastern time, until midnight. The advice under an event left in planning after its date also no longer says the same thing twice.',
   '2026-10-05', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0348_tonight_is_not_the_past',
  'public.business_day() (Eastern) names the business''s calendar day; v_event_record''s phase and days_away and v_event_gaps'' done_early use it instead of current_date (UTC), so an event tonight is not past from 8pm. stale_stage''s detail drops "Wrap it or drop it." — the fix sentence is lib/eventRecord''s. Same columns, same grants.');

-- verify:
--   select public.business_day(), current_date;                                                     -- equal by day, a day apart from 8pm Eastern
--   select count(*) from public.v_event_gaps where detail like '%drop it%';                          -- 0
--   select title, day, phase, days_away from public.v_event_record where day >= public.business_day() - 1 order by day limit 5;
