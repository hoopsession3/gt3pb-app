-- ONE SCHEDULE, ONE LIST.
--
-- Applied to production 2026-09-10. The SQL below is byte-identical to what ran except for
-- this header block, which the paste abbreviated; every statement is the same.
--
-- Ryan, looking at Plan on his phone: "Events and routes now redundant." He is right, and the
-- measurement is worse than the impression.
--
-- ── WHAT HE WAS SEEING ─────────────────────────────────────────────────────────────────────────
-- Plan has an Events tab and a Route tab. Each opens with a panel headed "N things need sorting",
-- built from the same component, reading a per-entity gap view. So the same construct renders
-- twice, once per tab, with its own headline and its own tab badge:
--
--   Route   badge 5   "5 things need sorting across your stops."    ->  5 rows for 3 STOPS
--   Events  badge 4   "4 things need sorting across your events."   ->  4 rows for 3 EVENTS
--
-- Nine rows for six subjects. "Wine Express - Five Forks" is listed twice (its venue name drifted
-- AND it has no recap); so is "Restore Hyper Wellness"; so is "Sassafras Flower Farm". A person
-- reading that sees the same thing again, because it IS the same thing again.
--
-- ── WHY THE FIX IS A VIEW AND NOT A COMPONENT TWEAK ────────────────────────────────────────────
-- The renderer was already shared - components/RecordGaps.tsx, written that way on purpose, with a
-- header explaining that EventGaps and StopGaps must not be two copies. That was the right call and
-- it did not go far enough: the CODE was consolidated while the PRODUCT still showed it twice.
--
-- An event and a stop are the same thing to the person scanning this: a dated commitment the truck
-- has to show up to, which can disagree with itself. So the list is one list, and the place it
-- comes from is one view. Same shape as v_obligations (0320) - many sources, one answer to one
-- question - and for the same reason: a question with two answers is a question you ask twice.
--
-- The per-entity views stay. v_event_gaps and v_stop_gaps are still the truth for ONE record, read
-- by EventRecord and StopRecord to say what is wrong with the thing you have open. This unions them
-- for the LIST case, which is a different question with a different reader.
--
-- ── A NOTE ON THE WORD "ROUTE", BECAUSE IT IS OVERLOADED ───────────────────────────────────────
-- Ryan, mid-round: "routes were supposed to be for corporate deliveries and residential deliveries."
-- Checked, and worth writing down because the word does two jobs in this product:
--
--   Plan > Route        LiveControl + the stop gap list      = where the truck PARKS
--   Live Ops            DeliveryOps (residential porches)
--                       OfficeOrders (corporate)             = the delivery RUN
--   /driver             DriverRun                            = the run sheet itself
--   the calendar        "Delivery run - N porches"
--                       "Office route - N gal"               = the same runs, as day aggregates
--
-- So deliveries have a home and always did; it is Live Ops, not Plan. But calling the stop schedule
-- "Route" while the actual route runs somewhere else is a name doing two jobs, which is the same
-- defect as a list doing two jobs. Folding stops in beside events retires the word here and leaves
-- "route" to mean the thing that is driven.

create or replace view public.v_schedule_gaps as
select 'event'::text                        as kind,
       g.event_id                           as subject_id,
       g.title                              as subject,
       g.day                                as on_date,
       -- events carry a date and (usually) no time; stops carry a timestamp. Both are exposed so a
       -- reader can sort one way and render the other, instead of guessing from a formatted string.
       null::timestamptz                    as at,
       g.stage                              as state,
       g.phase, g.gap, g.detail, g.severity,
       null::text                           as canonical_name,
       null::uuid                           as vendor_id
  from public.v_event_gaps g
union all
select 'stop',
       g.stop_id,
       g.name,
       (g.starts_at at time zone 'America/New_York')::date,
       g.starts_at,
       g.status,
       g.phase, g.gap, g.detail, g.severity,
       g.canonical_name,
       g.vendor_id
  from public.v_stop_gaps g;

alter view public.v_schedule_gaps set (security_invoker = on);
grant select on public.v_schedule_gaps to authenticated;

comment on view public.v_schedule_gaps is
  'Every way a dated commitment disagrees with itself, events and stops together. One list, because to the person scanning it an event and a stop are the same kind of thing: something the truck has to show up to. The per-entity views it unions stay the truth for a single open record; this is the truth for the list. Grouping several gaps onto one row per subject is the READER''s job - the view reports what is actually wrong, one row per problem.';

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Events and stops now share one "needs sorting" list','improvement','Plan',
   'The Events tab and the Route tab each opened with their own list of things to fix, and a venue or event with two problems was listed twice. There is now one list covering both, with everything wrong on a given day gathered under the thing it is wrong about - so nine rows that described six real problems read as six.',
   '2026-09-10', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0324_one_schedule_one_list',
  'v_schedule_gaps unions v_event_gaps and v_stop_gaps into one list. The renderer was already shared (RecordGaps); the product still showed it twice, once per Plan tab, with two badges and two headlines - nine rows for six subjects. security_invoker so the base tables keep deciding who sees what.');

-- verify:
--   select kind, count(*) from public.v_schedule_gaps group by kind;   -- expect event 4, stop 5
--   select count(distinct subject_id) from public.v_schedule_gaps;      -- expect 6
--   select * from public.v_invoker_view_gaps;                           -- expect ZERO rows
