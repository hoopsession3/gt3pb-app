-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0264 · GT3 COMMAND — THE WORKSTREAM REGISTRY + MONDAY 10/10 AUDIT + KPI SNAPSHOTS
-- (2026-08-03 — Ryan shipped the Executive OS v1 + Playbook v1 PDFs and asked "is there a place
-- to manage all components and streams?" → architecture call: the app IS GT3 Command; the one
-- missing object is this registry. Ryan: "build.")
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The OS's Layer-2 coordination objects that don't already exist in the app:
--
--   os_workstreams    — the managed portfolio: TEN streams, each with exactly one owner, a status
--                       (Active/Blocked/Parked), health 0–10 (the latest audit total), the dated
--                       next action, and the blocker. This is "the one place." Distinct from the
--                       work_streams UI-lane table on purpose — different animals.
--   workstream_audits — Monday's 10/10 audit, history kept. Five criteria × 2 points (Owner ·
--                       Next action · Blockers · Artifacts · Signal). The score is a search
--                       function for where management attention goes this week, not a grade.
--   kpi_snapshots     — Layer 3's Monday manual entry (metric · period · value) until each
--                       metric goes live-computed. Unique per metric+period; re-entry updates.
--
-- Seeded with the 8/2 portfolio VERBATIM from the Executive OS PDF (scores, owners, next actions,
-- blockers) — the audit that "already wrote Monday's agenda" is in the system it belongs to.
-- Cadence: a Monday pg_cron pings leadership to run the audit (0208/0263 pattern).
-- Idempotent; apply after 0263.

-- ── the registry ────────────────────────────────────────────────────────────────────────────────
create table if not exists public.os_workstreams (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  owner         text not null,                          -- exactly one name; shared ownership scores zero (rubric #1)
  status        text not null default 'active' check (status in ('active','blocked','parked')),
  health        int  not null default 0 check (health between 0 and 10),
  next_action   text,
  due           date,
  blocker       text,
  last_audited  date,
  sort          int not null default 0,
  created_at    timestamptz not null default now()
);
alter table public.os_workstreams enable row level security;
drop policy if exists "os workstreams staff read" on public.os_workstreams;
create policy "os workstreams staff read" on public.os_workstreams for select using ((select public.is_staff()));
drop policy if exists "os workstreams admin write" on public.os_workstreams;
create policy "os workstreams admin write" on public.os_workstreams for all
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ── the audit history ───────────────────────────────────────────────────────────────────────────
create table if not exists public.workstream_audits (
  id            uuid primary key default gen_random_uuid(),
  workstream_id uuid not null references public.os_workstreams(id) on delete cascade,
  week_of       date not null,
  c_owner       smallint check (c_owner    in (0,1,2)),   -- exactly one name
  c_next        smallint check (c_next     in (0,1,2)),   -- specific, dated, ≤7 days out
  c_blockers    smallint check (c_blockers in (0,1,2)),   -- none stale past 7 days without escalation
  c_artifacts   smallint check (c_artifacts in (0,1,2)),  -- latest version linked, no unversioned edits
  c_signal      smallint check (c_signal   in (0,1,2)),   -- a linked KPI or gate moved since last audit
  total         int not null check (total between 0 and 10),
  note          text,
  audited_by    uuid,
  created_at    timestamptz not null default now(),
  unique (workstream_id, week_of)
);
create index if not exists workstream_audits_ws on public.workstream_audits(workstream_id, week_of desc);
alter table public.workstream_audits enable row level security;
drop policy if exists "ws audits staff read" on public.workstream_audits;
create policy "ws audits staff read" on public.workstream_audits for select using ((select public.is_staff()));
drop policy if exists "ws audits admin write" on public.workstream_audits;
create policy "ws audits admin write" on public.workstream_audits for all
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ── layer 3: KPI snapshots (Monday manual entry until live) ─────────────────────────────────────
create table if not exists public.kpi_snapshots (
  id         uuid primary key default gen_random_uuid(),
  metric     text not null,                              -- key from the Playbook's 12-KPI framework
  period     date not null,                              -- the Monday (week-of) the value covers
  value      numeric not null,
  note       text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (metric, period)
);
alter table public.kpi_snapshots enable row level security;
drop policy if exists "kpi staff read" on public.kpi_snapshots;
create policy "kpi staff read" on public.kpi_snapshots for select using ((select public.is_staff()));
drop policy if exists "kpi admin write" on public.kpi_snapshots;
create policy "kpi admin write" on public.kpi_snapshots for all
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ── seed: the 8/2 portfolio, verbatim from the Executive OS v1 audit table ──────────────────────
insert into public.os_workstreams (name, owner, health, next_action, due, blocker, last_audited, sort) values
  ('Pipeline & Corporate',    'Kayla', 9, 'QT Tue 8/4; Upstate drop dated — first stage move is the signal', '2026-08-04', null, '2026-08-02', 10),
  ('D2C Delivery Ops',        'Ryan',  9, 'Routes locked and running — Loop % is the KPI to move',           null,         null, '2026-08-02', 20),
  ('GT3PB App',               'Ryan',  8, 'Seed with Playbook data (the dated next action)',                 '2026-08-03', null, '2026-08-02', 30),
  ('Webflow / Site',          'Ryan',  8, 'Verify corrections shipped',                                      null,         null, '2026-08-02', 40),
  ('Product & Compliance',    'Ryan',  7, 'Keep the dairy gate owned and dated',                             null,         'Salted Latte dairy flags open', '2026-08-02', 50),
  ('Flagship / Investor',     'Ryan',  7, 'Park it by decision — or date the next action',                   null,         null, '2026-08-02', 60),
  ('Partner / Cooler Program','Ryan',  6, 'Decide the commission %',                                          null,         'Commission % undecided — blocks options sheet and both pitches', '2026-08-02', 70),
  ('Print & Brand Assets',    'Ryan',  6, 'Unblock the Friday print run',                                    '2026-08-07', 'Blocked by commission % + loyalty-mechanic reconcile', '2026-08-02', 80),
  ('Events',                  'Kayla', 5, 'Resolve the 8/15 double-book',                                    '2026-08-08', '8/15 Wine Xpress truck stop vs Soul Yoga workshop — assign or move', '2026-08-02', 90),
  ('Trailer & Venue',         'Ryan',  5, 'Date the wrap + menu-layout decisions',                           null,         'Wrap not fabricator-ready; menu layout unconfirmed', '2026-08-02', 100)
on conflict (name) do nothing;

-- the 8/2 audit lines (totals + the "why it's not a 10" as the note; criteria arrive with the
-- first in-app audit — the PDF recorded totals only)
insert into public.workstream_audits (workstream_id, week_of, total, note)
select w.id, '2026-08-02'::date, w.health, w.blocker
  from public.os_workstreams w
 where not exists (select 1 from public.workstream_audits a where a.workstream_id = w.id and a.week_of = '2026-08-02');

-- ── the Monday audit nudge ──────────────────────────────────────────────────────────────────────
create or replace function public.os_audit_nudge() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.alerts a
     where a.ack_at is null and a.category = 'strategy' and a.target_user_id is null
       and a.title = '🗂 Monday audit: score the ten workstreams'
  ) then
    insert into public.alerts (severity, category, title, body, link, target_user_id, tenant_id)
    values ('important', 'strategy', '🗂 Monday audit: score the ten workstreams',
            'Two minutes each: Owner · Next action · Blockers · Artifacts · Signal. Below 8 gets named in the review; below 8 two weeks running demands a kill / pause / recover decision in the ledger.',
            '/crew?s=command&a=os-registry', null, '00000000-0000-0000-0000-000000000001');
  end if;
end $$;
do $$ begin perform cron.unschedule('monday-audit'); exception when others then null; end $$;
do $$ begin perform cron.schedule('monday-audit', '0 12 * * 1', 'select public.os_audit_nudge()'); exception when others then null; end $$;

-- Verify (prod, after apply):
--   select count(*) from public.os_workstreams;                                   -- 10
--   select round(avg(health),1) from public.os_workstreams;                       -- 7.0
--   select count(*) from public.workstream_audits where week_of = '2026-08-02';   -- 10
--   select jobname from cron.job where jobname = 'monday-audit';                  -- scheduled
