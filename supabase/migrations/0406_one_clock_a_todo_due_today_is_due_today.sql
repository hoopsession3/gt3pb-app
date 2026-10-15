-- ── 0406 — ONE CLOCK: A TO-DO DUE TODAY IS DUE TODAY UNTIL MIDNIGHT EASTERN ──────────────────────────────────────────────
-- 2026-10-15. Release 3 of the Today, Command, Audit & Catalog audit, "one clock in the database" — the second of the
-- crew's database rules, one yes and one migration each (Ryan, 2026-10-15: "Crew database rules"). Paste into Supabase →
-- SQL Editor → Run. A second run changes nothing.
--
-- WHY. The screens count the business's day — Eastern (Release 1's "one Eastern day", lib/dates etToday; the database's
-- business_day(), 0348). Two views still counted the database's: current_date and a timestamp's ::date are UTC there,
-- and UTC's day turns over at 8 pm Eastern in summer, 7 pm in winter. So after 8 pm:
--   · v_obligations — My Day's Needs you, Money's deadlines — said a to-do due today was "1 day late" (days_out
--     -1, severity overdue), a certificate expiring tonight expired yesterday, and a permit with no check date was due
--     tomorrow (0330:327, :189);
--   · all_tasks — My tasks, Command's week — filed a task due at 9 pm under tomorrow (0237: due_at::date).
--
-- WHAT. The same two views, restated with the business's day: v_obligations counts days_out and its severity from
-- business_day(), a permit never checked is due on the business's today, and a certificate's expiry and a training's
-- due date are their Eastern day; all_tasks files an event task under the Eastern day of its due_at. And two routes
-- name the panel they mean, as every link must (scripts/smoke.cjs, deep links): an invoice's is Money › Get paid, which
-- lists invoices since 2026-10-15, and an agreement's is Team › Operator agreements, where it is since the same day.
-- Every branch otherwise byte for byte 0330's and 0237's — spliced from those files, not retyped. Columns, their order
-- and their types are unchanged, so nothing that reads them changes.
-- changelog: below.

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
         coalesce(f.verified_on + 365, public.business_day()),
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
         (c.expires_at at time zone 'America/New_York')::date,
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
         (t.due_at at time zone 'America/New_York')::date,
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
         '/crew?s=money&a=pay',
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
         '/crew?s=team&a=operators',
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

  -- CHARGEBACK EVIDENCE (0330). The one deadline in this app where silence costs the full amount
  -- plus a fee: a dispute has a date by which evidence must be with Square, and missing it loses by
  -- default. It can only arrive from Square's webhook, and before 0330 nothing here knew a dispute
  -- existed at all. Excludes the states that are already decided.
  union all
  select 'square_disputes'                                    as source,
         d.id                                                as subject_id,
         'Money'                                              as area,
         'Chargeback evidence due'                            as kind,
         coalesce(nullif(btrim(so.ship_name), ''), so.email, 'A card dispute') as title,
         'A customer disputed ' || to_char(coalesce(d.amount_cents, 0) / 100.0, 'FM999999990.00')
           || '. Evidence has to be with Square by this date or it is lost by default.' as detail,
         (d.due_at at time zone 'America/New_York')::date    as due_on,
         '/crew?s=money&a=shoporders'                        as route,
         null::text                                          as market,
         null::uuid                                          as owner_user_id
    from public.square_disputes d
    left join public.shop_orders so on so.payment_id = d.payment_id
   where d.due_at is not null
     and coalesce(d.state, '') not in ('WON', 'LOST', 'ACCEPTED')
)
select r.source, r.subject_id, r.area, r.kind, r.title, r.detail, r.due_on,
       (r.due_on - public.business_day()) as days_out,
       case when r.due_on <  public.business_day() then 'overdue'
            when r.due_on <= public.business_day() + 14 then 'soon'
            else 'upcoming' end as severity,
       r.route, r.market, r.owner_user_id
  from raw r
 where r.due_on is not null;
-- security_invoker so every base table's RLS still decides who sees each row (0312's rule). Restated
-- because `create or replace view` does NOT preserve the setting when the definition is replaced.
alter view public.v_obligations set (security_invoker = on);

revoke all on public.v_obligations from public, anon;
grant select on public.v_obligations to authenticated;
comment on view public.v_obligations is
  'Every business deadline the app stores and nothing was watching, in one shape. Deliberately EXCLUDES event_tasks, brew_batches and reserve_claims — those already have cron sweepers, and being told twice by two mechanisms that cannot see each other is worse than the silence this fixes. 0330 added chargeback evidence deadlines, which are the only ones here that cost money by default if missed. 0406: days are the business''s (Eastern, business_day()), not the database''s UTC.';

create or replace view public.all_tasks with (security_invoker = on) as
  with u as (
    select 'event'::text as source, id, label as title, assignee, (due_at at time zone 'America/New_York')::date as due,
           done, done_at, created_at, critical, section as category, event_id, goal_id, meeting_note_id,
           due_at, warn, sort, stop_id, field_op_id, initiative_id
    from public.event_tasks
    union all
    select 'todo', id, title, assignee, due_on as due,
           done, done_at, created_at, false as critical, category, event_id, null::uuid, meeting_note_id,
           null::timestamptz, false, null::int, null::uuid, field_op_id, initiative_id
    from public.todos
  )
  select u.source, u.id, u.title, u.assignee, u.due,
         u.done, u.done_at, u.created_at, u.critical, u.category, u.event_id, u.goal_id, u.meeting_note_id,
         u.due_at, u.warn, u.sort, u.stop_id, u.field_op_id,
         fo.kind                     as op_kind,
         fo.name                     as op_name,
         fo.day                      as op_day,
         fo.starts_at                as op_starts_at,
         coalesce(fo.is_live, false) as op_is_live,
         mn.title                    as meeting_note_title,
         g.title                     as goal_title,
         -- appended (0237): the program a task rolls up to
         u.initiative_id,
         i.title                     as initiative_title,
         i.emoji                     as initiative_emoji,
         i.status                    as initiative_status,
         i.target_date               as initiative_target
  from u
  left join public.field_ops     fo on fo.id = coalesce(u.field_op_id, u.event_id, u.stop_id)
  left join public.meeting_notes mn on mn.id = u.meeting_note_id
  left join public.goals         g  on g.id  = u.goal_id
  left join public.initiatives   i  on i.id  = u.initiative_id;

grant select on public.all_tasks to authenticated;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A to-do due today is due today until midnight', 'fix', 'Today',
   'After 8 pm, Needs you said a to-do due today was a day late, and a task due that evening showed under tomorrow: two lists counted the day in UTC. Every list counts the business''s day now — Eastern, midnight to midnight.',
   '2026-10-15', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select pg_get_viewdef('public.v_obligations'::regclass) like '%business_day()%';          -- true
--   select pg_get_viewdef('public.v_obligations'::regclass) like '%CURRENT_DATE%';            -- false
--   select pg_get_viewdef('public.all_tasks'::regclass) like '%America/New_York%';            -- true
select public.record_migration('0406_one_clock_a_todo_due_today_is_due_today');
