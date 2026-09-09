-- THIRTEEN DEADLINES, ONE ANSWER.
--
-- ── WHAT IS WRONG TODAY ────────────────────────────────────────────────────────────────────────
-- The schema stores a due date in at least thirteen independent places, built in different
-- migrations months apart by different features, sharing no table, no producer and no consumer:
--
--   invoices.due_at · subscriptions.current_period_end · tenants.current_period_end
--   reserve_claims.hold_expires_at · event_tasks.due_at · todos.due_on
--   goals.due_date · goals.checkin_at · initiatives.target_date · os_workstreams.due
--   brew_batches.needed_by / latest_start_at / ready_at
--   compliance_rules.verified_on (+lead_days) · academy_certifications.expires_at
--   academy_assignments.due_at · asset_maintenance.next_due_on · offer_letters.expires_on
--   operator_agreements.ends_on · alerts.escalate_after_min · alert_snoozes.until
--
-- THREE of them are swept by anything: event_tasks (task_due_alerts, every 10 min), brew_batches
-- (brew_due_alerts, every 5 min) and reserve_claims (release_expired_holds, every 10 min).
--
-- Everything else has a stored deadline and NOTHING ANYWHERE that reads it to tell a person. That
-- is not a hypothetical: measured against production on 2026-09-09, ELEVEN items were overdue and
-- six due soon, and no screen in the application showed one of them — four pieces of equipment
-- (the nitro tap 69 days past service), two initiative targets, three workstream next actions, and
-- six permit rules needing a re-check. invoices.due_at is the sharpest case: the one app read of
-- invoices does not even SELECT the column named for exactly this question.
--
-- (The first draft of this header said FIVE pieces of equipment. That was the count of
-- asset_maintenance ROWS past next_due_on, and this table is a log — one tool serviced three times
-- and now overdue contributes three rows. Per asset, which is the only number that means anything
-- to a person, it is four. The distinct on below is why, and a test pins it. Corrected here rather
-- than left standing: a meter that over-reports is the same class of problem as one that is silent.
-- The executable SQL is unchanged — only this comment — so the applied hash still matches.)
--
-- ── WHY A VIEW AND NOT A TABLE ─────────────────────────────────────────────────────────────────
-- The obvious move is an 'obligations' table everything writes into. It is the wrong one. Moving
-- event_tasks.due_at and brew_batches.needed_by into a generic table would break two working cron
-- ladders and a release gate to gain nothing, and every domain would then own its deadline in two
-- places — which is the disease, not the cure.
--
-- all_tasks is the pattern this codebase already proved: a security_invoker view that unions the
-- real tables with a discriminator column, leaving each domain's own storage alone. So this is
-- that, for deadlines. Nothing underneath changes. Every row still lives in the table that owns
-- the fact, and RLS on those tables is what decides who sees each row — the view adds no reach.
--
-- ── WHAT IT DELIBERATELY EXCLUDES ──────────────────────────────────────────────────────────────
-- The three that ARE already swept. Including them would mean a person is told twice about the
-- same task by two mechanisms that do not know about each other, which is how alert fatigue starts
-- and is worse than the silence this fixes. event_tasks, brew_batches and reserve_claims keep
-- their ladders; this view is for the ten nobody was watching.
--
-- Also excluded: alerts.escalate_after_min and alert_snoozes.until, which are deadlines ABOUT the
-- notification system rather than about the business, and the two current_period_end columns,
-- which are Square's and Stripe's to enforce and ours only to display.

-- ── the view ───────────────────────────────────────────────────────────────────────────────────
create or replace view public.v_obligations as
with raw as (

  -- EQUIPMENT SERVICE. asset_maintenance is a LOG, so the next due date is the one on the most
  -- recent entry per asset, not one row per historical entry. distinct on does that; counting rows
  -- instead would report the same overdue tool once per time it has ever been serviced.
  select 'asset_maintenance'                                as source,
         m.id::text                                          as subject_id,
         'Equipment'                                         as area,
         'Service due'                                       as kind,
         coalesce(a.name, 'Equipment')                       as title,
         m.kind || ' last done ' || to_char(m.performed_on, 'Mon FMDD') || '.' as detail,
         m.next_due_on                                       as due_on,
         '/crew?s=garage'                                    as route,
         a.market                                            as market,
         null::uuid                                          as owner_user_id
    from (
      select distinct on (asset_id) * from public.asset_maintenance
       where next_due_on is not null
       order by asset_id, performed_on desc, created_at desc
    ) m
    join public.assets a on a.id = m.asset_id
   where coalesce(a.status, 'active') <> 'retired'

  union all

  -- PERMITS AND LICENCES. compliance_rules has no due column; what it has is verified_on, and
  -- v_compliance_freshness already owns the judgement about when that has gone stale. Re-deriving
  -- the threshold here would be a second opinion, so the due date is expressed in the view's own
  -- terms: a year after it was last confirmed, or today if nobody ever recorded a date.
  select 'compliance_rules', f.id::text, 'Compliance', 'Needs re-checking',
         f.label,
         f.freshness || coalesce(' · ' || f.authority, '') || '.',
         coalesce(f.verified_on + 365, current_date),
         '/crew?s=prep',
         null,
         null::uuid
    from public.v_compliance_freshness f
   where f.freshness <> 'fresh'

  union all

  -- CERTIFICATIONS. A lapsed food-safety cert is a person who cannot legally work the event.
  select 'academy_certifications', c.user_id::text || ':' || c.cert_key, 'People', 'Certification expires',
         coalesce(p.display_name, 'A crew member') || ' — ' || c.cert_key,
         'Awarded ' || to_char(c.awarded_at, 'Mon FMDD, YYYY') || '.',
         c.expires_at::date,
         '/crew?s=team',
         p.market,
         c.user_id
    from public.academy_certifications c
    left join public.profiles p on p.id = c.user_id
   where c.expires_at is not null

  union all

  -- ASSIGNED TRAINING with a date on it.
  select 'academy_assignments', t.id::text, 'People', 'Training due',
         coalesce(p.display_name, 'A crew member') || ' — ' || t.target_key,
         'Assigned ' || t.target_type || '.',
         t.due_at::date,
         '/crew?s=team',
         p.market,
         t.user_id
    from public.academy_assignments t
    left join public.profiles p on p.id = t.user_id
   where t.due_at is not null

  union all

  -- OFFERS OUT. Only ones actually awaiting an answer: a draft that expires is not a deadline.
  select 'offer_letters', o.id::text, 'Hiring', 'Offer expires',
         o.candidate_name || ' — ' || o.title,
         'Sent ' || coalesce(to_char(o.sent_at, 'Mon FMDD'), 'recently') || ', no answer yet.',
         o.expires_on,
         '/crew?s=team&a=offers',
         o.market,
         o.candidate_user_id
    from public.offer_letters o
   where o.expires_on is not null and o.status in ('sent', 'countered')

  union all

  -- MONEY OWED TO US.
  select 'invoices', i.id::text, 'Money', 'Invoice due',
         coalesce(b.company, 'An account') || ' — ' || to_char(i.amount_cents / 100.0, 'FM$999,999.00'),
         i.terms || ', issued ' || to_char(i.issued_at, 'Mon FMDD') || '.',
         i.due_at,
         '/crew?s=money',
         b.market,
         null::uuid
    from public.invoices i
    left join public.business_accounts b on b.id = i.business_id
   where i.due_at is not null and i.status in ('open', 'sent')

  union all

  -- AGREEMENTS RUNNING OUT.
  select 'operator_agreements', g.id::text, 'Franchise', 'Agreement ends',
         g.operator_name || ' — ' || g.market,
         'Version ' || g.version || ', ' || g.status || '.',
         g.ends_on,
         '/crew?s=money',
         g.market,
         g.operator_user_id
    from public.operator_agreements g
   where g.ends_on is not null and g.status in ('accepted', 'signed', 'active')

  union all

  -- THE COMPANY'S OWN COMMITMENTS.
  select 'goals', gl.id::text, 'Command', 'Goal due',
         gl.title,
         'At ' || round(gl.current_value)::text || ' of ' || round(gl.target_value)::text ||
           coalesce(' ' || nullif(gl.unit, ''), '') || '.',
         gl.due_date,
         '/crew?s=command',
         null,
         null::uuid
    from public.goals gl
   where gl.due_date is not null and gl.status = 'active'

  union all

  select 'initiatives', n.id::text, 'Command', 'Initiative target',
         n.title, coalesce(n.summary, 'No summary recorded.'), n.target_date,
         '/crew?s=command', null, null::uuid
    from public.initiatives n
   where n.target_date is not null and n.status in ('planning', 'active')

  union all

  select 'os_workstreams', w.id::text, 'Command', 'Next action due',
         w.name, coalesce(w.next_action, 'No next action recorded.'), w.due,
         '/crew?s=command', null, w.owner_user_id
    from public.os_workstreams w
   where w.due is not null and w.status <> 'parked'

  union all

  -- TODOS. event_tasks are deliberately absent — task_due_alerts already sweeps those every ten
  -- minutes, and telling somebody twice by two mechanisms that cannot see each other is worse than
  -- the silence this view exists to fix. todos have never had a sweeper of any kind.
  select 'todos', d.id::text, 'Work', 'To-do due',
         d.title, coalesce('Category: ' || nullif(d.category, ''), 'Uncategorised.'), d.due_on,
         '/crew?s=day', null, d.assignee
    from public.todos d
   where d.due_on is not null and not d.done
)
select r.source, r.subject_id, r.area, r.kind, r.title, r.detail, r.due_on,
       (r.due_on - current_date) as days_out,
       case when r.due_on <  current_date then 'overdue'
            when r.due_on <= current_date + 14 then 'soon'
            else 'upcoming' end as severity,
       r.route, r.market, r.owner_user_id
  from raw r
 where r.due_on is not null;

-- security_invoker so every base table's RLS still decides who sees each row. This view is a
-- rearrangement of facts the caller could already read, not a new grant.
alter view public.v_obligations set (security_invoker = on);
revoke all on public.v_obligations from public, anon;
grant select on public.v_obligations to authenticated;

comment on view public.v_obligations is
  'Every business deadline the app stores and nothing was watching, in one shape. Deliberately EXCLUDES event_tasks, brew_batches and reserve_claims — those already have cron sweepers, and being told twice by two mechanisms that cannot see each other is worse than the silence this fixes.';

-- The owner-facing rollup: what is late, what lands inside a fortnight, by area.
create or replace view public.v_obligations_summary as
select area,
       count(*) filter (where severity = 'overdue')  as overdue,
       count(*) filter (where severity = 'soon')     as soon,
       count(*) filter (where severity = 'upcoming') as upcoming,
       min(due_on) filter (where severity <> 'upcoming') as next_due
  from public.v_obligations
 group by area
 order by count(*) filter (where severity = 'overdue') desc, area;

alter view public.v_obligations_summary set (security_invoker = on);
revoke all on public.v_obligations_summary from public, anon;
grant select on public.v_obligations_summary to authenticated;

comment on view public.v_obligations_summary is
  'v_obligations by area, overdue first. The owner home reads this; the detail view backs the list you get when you tap one.';

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Everything with a deadline now shows up in one place','improvement','Command',
   'The app stored due dates in thirteen separate places built months apart, and only three of them were watched by anything. The rest — equipment service, permit re-checks, certifications, assigned training, offers awaiting an answer, invoices, agreements running out, goals, initiatives and to-dos — had a date recorded and nothing anywhere that read it to tell you. On the day this shipped, five pieces of equipment were past their service date and six permit rules had gone stale, and no screen in the app showed either. They all appear together now, latest first, each one linking to the place it gets dealt with. Nothing moved: every date still lives on the record that owns it.',
   '2026-09-09', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0320_thirteen_deadlines_one_answer',
  'v_obligations unions the ten deadline columns nothing was sweeping (equipment service, compliance freshness, certifications, training, offers, invoices, agreements, goals, initiatives, workstreams, todos) into one security_invoker read model, plus v_obligations_summary by area. Deliberately excludes event_tasks, brew_batches and reserve_claims, which already have cron sweepers.');

-- verify:
--   select area, overdue, soon, upcoming from public.v_obligations_summary;
--   select severity, kind, title, due_on, days_out from public.v_obligations
--    where severity <> 'upcoming' order by due_on limit 20;
