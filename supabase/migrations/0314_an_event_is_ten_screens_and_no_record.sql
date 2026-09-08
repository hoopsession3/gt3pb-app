-- 0314 — AN EVENT IS TEN SCREENS AND NO RECORD (2026-09-07)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Audit item two, and the worst scattering in the app. Surveyed properly rather than from memory:
--
--   NINE tables      events, event_tasks, event_staff, event_approvals, event_sales,
--                    event_economics, event_menu_items, event_ops, event_schedule_items (+ rsvps)
--   24 components    read or write one of them
--   21 API routes    the same
--   ONE detail view  PrepDetail — 581 lines living INSIDE app/crew/page.tsx
--
-- And PrepDetail has no address. You reach it by writing a localStorage key and switching sections:
--
--     localStorage.setItem("gt3-prep-open", id); setSection("prep");
--
-- Five call sites do that (My Day, the prep list, DeliveryOps, EventPnlReport, CompanyCalendar) in
-- TWO different encodings — four write a bare uuid, CompanyCalendar writes "event:<uuid>" — and the
-- reader carries a conditional to paper over the difference. It happens to parse both, which I
-- checked before calling it a bug; it is drift, not breakage. But the consequence is the same as
-- everywhere else in this audit: no URL, so no link, no back button, and a reload loses your place.
--
-- ── WHAT NOT SEEING AN EVENT WHOLE HAS COST ────────────────────────────────────────────────────
-- Measured against production today, not inferred:
--
--   * TWO live events sit at 'confirmed' with dates 38 and 23 days in the PAST. Either they
--     happened and nobody wrapped them, or they did not and nobody said so.
--   * One completed event has no takings recorded and no after-action note.
--   * 41 of 84 event_tasks belong to neither an event nor a stop, and all_tasks — which My Day, the
--     workload board and the command board all read — shows every one of them.
--
-- And two corrections I owe to running the queries rather than trusting the first pass. The raw
-- table also holds a duplicate pair, a blank title, three undated rows and one event marked done a
-- month before its date — but every one of those is ARCHIVED. Filed, not outstanding, which is why
-- v_event_gaps excludes archived rows and why the honest headline is "two things to chase", not
-- "the event data is a mess". And all 41 loose tasks turn out to have come from a meeting: they are
-- action items, a legitimate standalone shape, not orphans. The view says which is which rather
-- than calling them all strays.
--
-- One more thing checked rather than assumed: event_ops (recaps, crew briefs) is completely empty,
-- and the obvious conclusion — that the wrap flow's write is broken — is wrong. I ran the exact
-- upsert app/crew/page.tsx sends against production as a real owner account, inside a transaction I
-- rolled back. It succeeds and the tenant stamp lands. It is empty because nobody has wrapped an
-- event, not because it cannot be done. Worth knowing before somebody "fixes" a working path.
--
-- ── WHAT THIS DOES, AND DELIBERATELY DOES NOT ──────────────────────────────────────────────────
-- Does not: add a state machine. 0075 already owns the event lifecycle (lead → confirmed → prep →
-- live → done) with a sync trigger, and a second one would be the exact duplication this audit is
-- about. Does not: rebuild PrepDetail. That view is good; it is 581 lines of real operational work
-- and it is only unreachable. CustomerRecord took the same line in 0311 and it was right.
--
-- Does: give the event a record — what it is, when, where, who is on it, what is owed, what it made
-- — that opens from anywhere by ?r=event:<id>, and links INTO PrepDetail for the checklist. And
-- turns every gap above into a query, because a number nobody can see is a number nobody fixes.

-- ── 1) THE EVENT, WHOLE ────────────────────────────────────────────────────────────────────────
-- security_invoker per 0312: events carries its own RLS, and this must not walk around it.
--
-- Every count is a lateral rather than a join+group, so an event with no tasks reads 0 instead of
-- disappearing, and adding the next satellite table is one more lateral rather than a rewrite.
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
  case when e.day is null then 'undated'
       when e.day > current_date then 'upcoming'
       when e.day = current_date then 'today'
       else 'past' end                                                 as phase,
  case when e.day is null then null else (e.day - current_date) end    as days_away
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

comment on view public.v_event_record is
  'One event, whole: identity, when and where, the vendor, the crew brief, every satellite count and what it took. Nine tables touch an event and nothing put them on one row before 0314.';

-- ── 2) THE GAPS, AS A QUERY ────────────────────────────────────────────────────────────────────
-- The house idiom (v_crew_onboarding_steps, v_receipt_gaps): a lateral values list, one row per
-- problem, so the screen renders a list instead of the screen re-deriving the rules.
--
-- Only real problems. "No RSVPs" is not a gap — plenty of events do not take RSVPs. "Done with no
-- sales recorded" IS one: the event happened, money moved, and nothing in this database says so.
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
    ('done_early', 'Marked done, but dated in the future. One of the two is wrong.', 'high',
       r.stage = 'done' and r.day is not null and r.day > current_date),
    ('twin',       'Another event shares this title and date. One of them is probably the real one.', 'high',
       exists (select 1 from public.events e2
                where e2.id <> r.id and e2.archived_at is null
                  and lower(btrim(coalesce(e2.title, ''))) = lower(btrim(coalesce(r.title, '')))
                  and coalesce(btrim(coalesce(r.title, '')), '') <> ''
                  and e2.day is not distinct from r.day)),
    ('no_sales',   'Complete, with nothing recorded as taken. If it sold, the number is missing.', 'medium',
       r.stage = 'done' and r.sales_count = 0),
    ('no_recap',   'Complete, with no after-action note. The wrap flow writes one and works.', 'low',
       r.stage = 'done' and coalesce(btrim(r.recap), '') = ''),
    ('live_past',  'Still flagged live, but the day has passed. The public site may still show it.', 'high',
       r.is_live and r.phase = 'past'),
    -- Added AFTER running this view against production, which is where I found it. Two live events
    -- sat at 'confirmed' with dates 38 and 23 days in the past. Either they happened and nobody
    -- wrapped them, or they did not and nobody said so — and every other rule here was blind to it
    -- because each row is internally consistent. It is the calendar it disagrees with.
    ('stale_stage','The day has passed and this is still in a planning stage. Wrap it or drop it.', 'medium',
       r.phase = 'past' and r.stage in ('lead','confirmed','prep')),
    ('open_tasks', 'Complete, with critical prep still unticked.', 'low',
       r.stage = 'done' and r.tasks_critical_open > 0)
  ) as g(gap, detail, severity, hit)
 where g.hit
   and r.archived_at is null;

revoke all on public.v_event_gaps from anon;
grant select on public.v_event_gaps to authenticated;

comment on view public.v_event_gaps is
  'Every way an event row currently contradicts itself or the calendar. Archived events are excluded — an archived mistake is filed, not outstanding.';

-- ── 3) THE TASKS THAT BELONG TO NOTHING ────────────────────────────────────────────────────────
-- 41 of 84. They are in event_tasks, they show up in all_tasks, and My Day, the workload board and
-- the command board all read all_tasks — so half this table is visible everywhere and attached to
-- nowhere. Not fixed here: which event each one belongs to is a judgement call, and guessing would
-- put somebody's prep on the wrong day. Made VISIBLE here, which is the step that has been missing.
create or replace view public.v_event_orphan_tasks with (security_invoker = on) as
select t.id, t.label, t.section, t.kind, t.critical, t.done, t.assignee, t.due_at, t.created_at,
       (t.goal_id is not null)      as on_a_goal,
       (t.initiative_id is not null) as on_an_initiative,
       (t.meeting_note_id is not null) as from_a_meeting
  from public.event_tasks t
 where t.event_id is null and t.stop_id is null and t.field_op_id is null;

revoke all on public.v_event_orphan_tasks from anon;
grant select on public.v_event_orphan_tasks to authenticated;

comment on view public.v_event_orphan_tasks is
  'event_tasks rows attached to no event, stop or field op. Many are legitimately standalone (a goal or meeting action item); the point is that nothing showed you which were which.';

-- ── 4) what changed ────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('An event finally has one place that shows it whole','feature','Plan',
   'Nine tables describe an event — the event itself, its prep tasks, its crew, its sign-offs, its sales, its economics, its menu, its run of show and its after-action note — and twenty-four screens touch one or another of them. Not one of those screens showed you an event. The closest thing was the prep checklist, which you could only reach by tapping through to a different section and which had no address, so you could not link to it, send it to anyone, or get back to it after a refresh. There is now a record for an event: what it is, when and where, who is on it, what is still owed, what it took, and a way into the prep checklist from there.',
   '2026-09-07', true),
  ('The app now tells you when an event contradicts itself','fix','Plan',
   'Because nothing showed an event whole, there was no way to notice a row that disagreed with itself or with the calendar. There is now a short list that names the specific problem on each one — no date, no title, marked done before the day, still flagged live after it, a duplicate of another entry, complete with nothing recorded as taken, or sitting in a planning stage weeks after it was supposed to happen. Running it against the real data found two events still marked confirmed more than three weeks after their date, and one completed event with no takings and no after-action note. Everything older than that turned out to be already archived, which is the right place for it.',
   '2026-09-07', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0314_an_event_is_ten_screens_and_no_record',
  'v_event_record (nine tables on one row), v_event_gaps (contradictions as a query), v_event_orphan_tasks. No new state machine — 0075 already owns the event lifecycle.');

-- verify:
--   select title, stage, phase, tasks, tasks_done, rsvps, menu_items, sales_cents from public.v_event_record order by day nulls last;
--   select gap, severity, count(*) from public.v_event_gaps group by 1,2 order by 2, 1;
--   select count(*) from public.v_event_orphan_tasks;
