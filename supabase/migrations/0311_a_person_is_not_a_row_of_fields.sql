-- 0311 — A person is not a row of fields, and "onboarded" is not a moment.
--
-- Ryan, looking at the Team screen: "I should be able to click on employee and manage everything.
-- I did finish onboarding Ryan as a test and I can't find where to resume it? Or how to manage the
-- profile, everything still seems so complex in fields, it feels so cluster minded."
--
-- He is right on both counts, and the second one is worse than he thinks.
--
-- WHERE TO RESUME. I looked at the test operator he made. Here is the whole record:
--
--     role operator · market atlanta · LEADS atlanta
--     offers 0 · agreements 0 · academy assigned 0 · progress 0 · acknowledgements 0 · sign-ins 0
--
-- There is nothing to resume, because nothing was ever started. promote_to_crew sets role, market
-- and market-lead in one transaction and that is ALL onboarding has ever meant. The panel then
-- showed two links — draft their offer letter, see their Academy path — and navigating away lost
-- them, because they were links and not steps. The flow announced itself finished at the exact
-- moment the actual work began. Note what that produced: a person holding market lead over Atlanta
-- with no offer, no agreement, no training and no account they have ever signed into.
--
-- CLUSTER MINDED. And there is no person anywhere in this app. A human is scattered across the
-- roster row, the utilization list, the org chart, the workload board, an agreement in Money, an
-- offer letter in Money, hours inside the agreement, and a course path in the Academy. The one
-- place you can tap a staff member opens Points, Credit and Founding — loyalty fields, on an
-- employee. That is the cluster: not too many fields, but no centre for them to sit around.
--
-- This migration builds the missing spine: onboarding as a DERIVED state rather than a stored flag,
-- so it can never drift from what is actually true, and so "where do I resume" has an answer that
-- reads itself out of the database every time it is asked.
--
-- WHO IS HOLDING IT UP is the column that makes it useful. Half these steps are yours and half are
-- theirs, and "waiting on them" is a completely different situation from "waiting on you" — which
-- is precisely the thing an owner staring at a half-finished hire needs told.

create or replace view public.v_crew_onboarding_steps as
with staff as (
  select p.id, p.display_name, p.role, p.market, p.leads_market
    from public.profiles p
   where p.role <> 'member' or p.is_admin
),
facts as (
  select s.*,
         (select count(*) from public.offer_letters o where o.candidate_user_id = s.id) as offers,
         (select o.status from public.offer_letters o where o.candidate_user_id = s.id
           order by o.created_at desc limit 1)                                          as offer_status,
         (select count(*) from public.operator_agreements a where a.operator_user_id = s.id) as agreements,
         (select a.status from public.operator_agreements a where a.operator_user_id = s.id
           order by a.created_at desc limit 1)                                          as agreement_status,
         (select count(*) from public.academy_assignments a where a.user_id = s.id)     as assigned,
         (select count(*) from public.academy_progress a where a.user_id = s.id)        as progress,
         (select count(*) from public.academy_acknowledgements a where a.user_id = s.id) as acks,
         (select count(*) from public.user_activity u where u.user_id = s.id)           as activity
    from staff s
)
select f.id as user_id, f.display_name, f.role, v.step, v.n as step_order, v.label, v.owed_by, v.done, v.detail
  from facts f
 cross join lateral (values
   -- yours
   (1, 'market',      'Which market they work',            'you',
       f.market is not null and btrim(f.market) <> '',
       coalesce(nullif(btrim(f.market), ''), 'not set')),
   -- NOBODY HIRES THE FOUNDER. Reading this view against the real crew for the first time had it
   -- asking both owners for an offer letter, which is a letter they would be writing to themselves.
   -- A step that cannot be completed is worse than a missing one: it holds the card permanently
   -- short of done and trains people to ignore the number.
   (2, 'offer',       'Offer letter drafted and sent',     'you',
       f.role = 'owner'
         or (f.offers > 0 and coalesce(f.offer_status,'') in ('sent','accepted','countered')),
       case when f.role = 'owner' then 'not needed — they are the company'
            when f.offers = 0 then 'none drafted'
            else coalesce(f.offer_status, 'draft') end),
   -- operators and event managers carry an agreement; a server does not, so it counts as done
   (3, 'agreement',   'Operator agreement signed',         'you',
       f.role not in ('operator','event_manager')
         or (f.agreements > 0 and coalesce(f.agreement_status,'') in ('signed','active')),
       case when f.role not in ('operator','event_manager') then 'not needed for this role'
            when f.agreements = 0 then 'none drafted'
            else coalesce(f.agreement_status, 'draft') end),
   -- Same reasoning: assigning the owner their own training is not a step anybody takes.
   (4, 'academy',     'Academy path assigned',             'you',
       f.role = 'owner' or f.assigned > 0,
       case when f.role = 'owner' then 'not needed — they set the path'
            when f.assigned = 0 then 'nothing assigned'
            else f.assigned::text || ' assigned' end),
   -- theirs
   (5, 'signed_in',   'They have signed in at least once', 'them',
       f.activity > 0,
       case when f.activity = 0 then 'never signed in' else f.activity::text || ' active days on record' end),
   (6, 'training',    'Started their training',            'them',
       f.progress > 0,
       case when f.progress = 0 then 'not started' else f.progress::text || ' lesson(s) touched' end),
   -- This one DOES apply to an owner. Whoever touches the product signs it, and the person who
   -- owns the company is not exempt from the thing the company is inspected on.
   (7, 'food_safety', 'Food-safety acknowledgement',       'them',
       f.acks > 0,
       case when f.acks = 0 then 'not signed' else 'on file' end)
 ) as v(n, step, label, owed_by, done, detail);

revoke all on public.v_crew_onboarding_steps from public, anon;
grant select on public.v_crew_onboarding_steps to authenticated;

comment on view public.v_crew_onboarding_steps is
  'One row per crew member per onboarding step: what it is, whether it is done, and WHICH SIDE owes it. Derived from the real tables every time it is read, so it cannot drift from the truth the way a stored "onboarded" flag would.';

-- ── the one-line answer, for a list ────────────────────────────────────────────────────────────
create or replace view public.v_crew_onboarding as
select s.user_id, s.display_name, s.role,
       count(*) filter (where s.done)     as steps_done,
       count(*)                           as steps_total,
       count(*) filter (where not s.done and s.owed_by = 'you')  as waiting_on_you,
       count(*) filter (where not s.done and s.owed_by = 'them') as waiting_on_them,
       -- The next thing to actually do, and who has to do it. This is the "where do I resume"
       -- that had no answer: not a link somebody has to remember, a fact read off the data.
       (array_agg(s.label order by s.step_order) filter (where not s.done))[1]   as next_step,
       (array_agg(s.owed_by order by s.step_order) filter (where not s.done))[1] as next_step_owed_by,
       bool_and(s.done) as fully_onboarded
  from public.v_crew_onboarding_steps s
 group by s.user_id, s.display_name, s.role;

revoke all on public.v_crew_onboarding from public, anon;
grant select on public.v_crew_onboarding to authenticated;

comment on view public.v_crew_onboarding is
  'Per crew member: how far onboarding actually got, how much is waiting on you versus on them, and the next step by name. Answers "where do I resume" without anybody having to remember where they left off.';

-- ── everything about one person, in one place ──────────────────────────────────────────────────
-- The scattering is the complaint, so this is the join that un-scatters it: identity, role, market,
-- onboarding position, their agreement, the hours they have logged, and when they were last seen —
-- the seven screens a person is currently spread across, as one row.
create or replace view public.v_crew_person as
select p.id as user_id,
       p.display_name, p.role, p.market, p.leads_market, p.referral_code,
       coalesce(p.is_driver, false) as is_driver,
       o.steps_done, o.steps_total, o.waiting_on_you, o.waiting_on_them,
       o.next_step, o.next_step_owed_by, o.fully_onboarded,
       a.id            as agreement_id,
       a.status        as agreement_status,
       a.scope_basis   as agreement_scope_basis,
       a.scope_until   as agreement_scope_until,
       array_to_string(a.covers, ', ') as agreement_covers,
       h.hours_total, h.hours_on_interim_work,
       (select max(u.last_seen_at) from public.user_activity u where u.user_id = p.id) as last_seen_at,
       (select count(*) from public.user_activity u where u.user_id = p.id
         and u.seen_on >= current_date - 30)                                            as active_days_30
  from public.profiles p
  left join public.v_crew_onboarding o on o.user_id = p.id
  left join lateral (
    select * from public.operator_agreements x
     where x.operator_user_id = p.id order by x.created_at desc limit 1
  ) a on true
  left join public.v_agreement_hours h on h.agreement_id = a.id
 where p.role <> 'member' or p.is_admin;

revoke all on public.v_crew_person from public, anon;
grant select on public.v_crew_person to authenticated;

comment on view public.v_crew_person is
  'One row per crew member holding what is currently spread across seven screens — roster, utilization, org chart, workload, their agreement, their hours and their training. The centre the fields were missing.';

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Bringing someone on is a checklist now, not a single click','improvement','Command',
   'Promoting someone set their role and market and then announced itself finished — which is the moment the real work starts. The offer letter and the Academy path were offered as links, so navigating away lost them, and there was no way to find out how far anyone had actually got. Onboarding is now read from the real records every time you look: what is done, what is left, and which of the two of you is holding each step up. Nothing is stored, so it can never drift from what is actually true.',
   '2026-09-07', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0311_a_person_is_not_a_row_of_fields',
  'v_crew_onboarding_steps / v_crew_onboarding / v_crew_person — onboarding derived, and one row per person instead of seven screens.');

-- verify:
--   select display_name, role, steps_done || '/' || steps_total as at, next_step, next_step_owed_by
--     from public.v_crew_onboarding order by steps_done;
--   select * from public.v_crew_onboarding_steps where not done order by display_name, step_order;
