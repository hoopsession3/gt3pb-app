-- ── THE SENTENCE THAT DESCRIBED A DOOR ───────────────────────────────────────────────────────
-- 2026-10-03. Ryan opened Plan › Needs sorting, tapped the WineXpress stop, and the record sheet
-- said:
--
--     Finished, with no after-action note.
--     Two lines on how it went, while you still remember.
--
-- and offered nowhere to write them. Measured against the code rather than assumed: the only wrap
-- flow in the app (OwnerDetails, behind the prep checklist) shows "Complete" while a stop is NOT
-- done and shows the note's "edit" button only when a note already exists. A stop closed without
-- one — which is every stop LiveControl closes on go-offline — had no way to get one, anywhere.
-- v_event_gaps' own no_recap detail said "The wrap flow writes one and works." It did, for the
-- people who used it in the right order.
--
-- The event side was worse. no_sales' fix sentence reads "Add what it took, or confirm it took
-- nothing." Nothing in the console writes event_sales except the Square webhook (0024: "written
-- only by the service role"), and nothing anywhere records "it took nothing" — so a finished event
-- that honestly took no money at the window was chased for a number for ever.
--
-- The app side of this (lib/wrap.ts, the record sheets' ways out) is in the same commit. This file
-- is the two things only the database can give it:
--
--   1. "IT TOOK NOTHING", SAID ONCE. event_ops.took_nothing_at — on the staff-only sibling where
--      the note already lives (0195), not on the public events row. Set once, the no_sales gap
--      stops asking; a sale recorded later simply wins (sales_count > 0 ends the rule first).
--
--   2. A PERSON MAY RECORD WHAT SQUARE DID NOT SEE. One insert policy on event_sales for staff,
--      admitting exactly the shape a person can honestly claim: source = 'manual', no payment id,
--      a non-negative amount, on an event, in their own tenant. A client cannot forge a 'square'
--      row, cannot attach a payment id (so it can never collide with the webhook's unique key),
--      and cannot write a negative. Deletion stays where 0308 left it — admin only, behind the
--      permanent-record guard: a wrong manual figure is corrected by an admin, not disappeared by
--      whoever typed it. stamp_tenant lands on the table for the first time, so a manual row
--      carries its writer's tenant rather than the column default; the webhook's service-role
--      writes are untouched by it (no profile → the default stays).
--
-- v_event_record is restated in full so the new column rides on it — `create or replace view` may
-- only APPEND, so it is last — and v_event_gaps is restated so no_sales honours the answer and
-- no_recap loses its note-to-self. Both are 0314's text with those changes and nothing else; the
-- test that executes 0314 now executes this after it and asserts every rule both ways again.

-- ── 1) "it took nothing" ───────────────────────────────────────────────────────────────────────
alter table public.event_ops add column if not exists took_nothing_at timestamptz;
comment on column public.event_ops.took_nothing_at is
  'Set when a person says a finished event took no money at the window. Answers the no_sales gap once; a sale recorded later wins over it.';

-- ── 2) the record, with the answer on it ───────────────────────────────────────────────────────
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
  case when e.day is null then null else (e.day - current_date) end    as days_away,
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

-- ── 3) the gaps, honouring the answer ─────────────────────────────────────────────────────────
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
    ('stale_stage','The day has passed and this is still in a planning stage. Wrap it or drop it.', 'medium',
       r.phase = 'past' and r.stage in ('lead','confirmed','prep')),
    ('open_tasks', 'Complete, with critical prep still unticked.', 'low',
       r.stage = 'done' and r.tasks_critical_open > 0)
  ) as g(gap, detail, severity, hit)
 where g.hit
   and r.archived_at is null;

revoke all on public.v_event_gaps from anon;
grant select on public.v_event_gaps to authenticated;

-- ── 4) what Square did not see ─────────────────────────────────────────────────────────────────
-- The grant is Supabase's default anyway; written so the policy below reads as the whole gate.
grant select, insert on public.event_sales to authenticated;

drop policy if exists "event_sales staff manual" on public.event_sales;
create policy "event_sales staff manual" on public.event_sales for insert
  with check (
    (select public.is_staff())
    and source = 'manual'
    and square_payment_id is null
    and event_id is not null
    and amount_cents >= 0
    and item_count >= 0
    and tenant_id = public.effective_tenant()
  );
comment on policy "event_sales staff manual" on public.event_sales is
  'A person may record takings Square did not see: source manual, no payment id, non-negative, on an event, in their tenant. Square rows stay service-role only (0024).';

drop trigger if exists stamp_tenant_tg on public.event_sales;
create trigger stamp_tenant_tg before insert on public.event_sales
  for each row execute function public.stamp_tenant();

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Every finding on an event or stop now has its fix right there','improvement','Plan',
   'Opening something from Needs sorting used to tell you what was wrong and what to do about it, and leave you to find where. Now the control is under the sentence: wrap it with an after-action note, say it didn''t happen, add what it took in cash, or say it took nothing — and a stop or event that was already finished without a note can finally get one. Taking the truck offline, linking a venue and editing dates still happen on the screens that own them; the sheet takes you straight there.',
   '2026-10-03', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0339_the_sentence_that_described_a_door',
  'event_ops.took_nothing_at, and an insert policy letting staff record takings Square did not see (source manual, no payment id, non-negative, on an event, own tenant). Ryan tapped the WineXpress stop in Needs sorting and the sheet said "Two lines on how it went, while you still remember" with nowhere to write them — and measured against the code, nowhere in the app either: the only wrap flow hides its note editor unless a note already exists, and nothing but the Square webhook could ever write event_sales, so "add what it took, or confirm it took nothing" was two doors that did not exist. v_event_record restated with the new column appended; v_event_gaps restated so no_sales stops asking once the answer is given and no_recap loses "The wrap flow writes one and works." Deletion of a manual row stays admin-only behind 0308''s guard. stamp_tenant added to event_sales (first time), harmless to the webhook''s service-role writes. The app side — lib/wrap.ts as the one write path for done/archive/note/takings, the record sheets'' ways out — ships in the same commit.');

-- verify:
--   select column_name from information_schema.columns where table_name='event_ops' and column_name='took_nothing_at';  -- 1 row
--   select policyname, cmd from pg_policies where tablename='event_sales' order by 1;  -- staff manual (INSERT), staff read (SELECT), delete_admin_only
--   select gap from public.v_event_gaps where gap='no_recap' and detail like '%wrap flow%';   -- 0 rows
--   -- as an owner, in the app: open a done event with no takings, tap "It took nothing" → the finding leaves the list
