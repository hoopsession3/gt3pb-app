-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0263 · EXECUTIVE OPERATING RHYTHM (2026-08-02 — exec-infrastructure audit scored 7/10 overall
-- with retro/look-ahead at 2/10; Ryan: "Build all recommended improvements.")
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Data layer for the P1–P6 build. The reviews and strategy sessions themselves land as
-- meeting_notes (source 'review' / 'strategy') — the continuation-ready system of record from
-- 0262 — so the exec layer converges on ONE spine instead of growing a new one. What needs schema:
--
--   goals          — a check-in lane (on_track / at_risk) separate from the hit/missed lifecycle,
--                    so "how's it going" has a one-tap answer and stalls surface the week they
--                    happen. at_risk rolls onto the Command Board's Blockers line.
--   decisions      — provenance (which note it was made in) + follow-through (the task it spawned),
--                    so the append-only ledger shows WHAT HAPPENED NEXT, not just what was said.
--   initiatives    — a link to the goals a program serves (many-to-many), so the Command Board
--                    tells one story: this program, moving these numbers.
--   the nudge      — a Monday pg_cron (the 0208 founder-digest pattern) that pings each owner of
--                    a quiet goal: check in — on track, at risk, or done?
-- Idempotent; apply after 0262.

-- ── goals: the check-in lane ────────────────────────────────────────────────────────────────────
alter table public.goals add column if not exists checkin_status text;
alter table public.goals drop constraint if exists goals_checkin_status_check;
alter table public.goals add constraint goals_checkin_status_check
  check (checkin_status is null or checkin_status in ('on_track','at_risk'));
alter table public.goals add column if not exists checkin_at timestamptz;
alter table public.goals add column if not exists checkin_by uuid;

-- ── decisions: provenance + follow-through ──────────────────────────────────────────────────────
alter table public.strategy_decisions add column if not exists note_id uuid references public.meeting_notes(id) on delete set null;
alter table public.strategy_decisions add column if not exists follow_up_task_id uuid references public.event_tasks(id) on delete set null;
create index if not exists strategy_decisions_note_idx on public.strategy_decisions(note_id) where note_id is not null;

-- ── programs ↔ outcomes: which goals an initiative serves ───────────────────────────────────────
create table if not exists public.initiative_goals (
  initiative_id uuid not null references public.initiatives(id) on delete cascade,
  goal_id       uuid not null references public.goals(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (initiative_id, goal_id)
);
alter table public.initiative_goals enable row level security;
drop policy if exists "initiative goals staff read" on public.initiative_goals;
create policy "initiative goals staff read" on public.initiative_goals for select using ((select public.is_staff()));
drop policy if exists "initiative goals admin write" on public.initiative_goals;
create policy "initiative goals admin write" on public.initiative_goals for all
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ── the Monday check-in nudge (0208's pg_cron pattern) ──────────────────────────────────────────
-- Each ACTIVE goal with an owner that has been quiet a week (no value logged, no check-in) pings
-- its owner once: one tap answers it. Dedupe: an unacknowledged nudge for the same goal blocks a
-- repeat, so a slow week never stacks alerts.
create or replace function public.goal_checkin_nudges() returns void
language plpgsql security definer set search_path = public as $$
declare g record; n int := 0;
begin
  for g in
    select id, title, owner_user_id from public.goals
     where status = 'active' and owner_user_id is not null
       and (checkin_at is null or checkin_at < now() - interval '6 days')
       and updated_at < now() - interval '7 days'
  loop
    if not exists (
      select 1 from public.alerts a
       where a.ack_at is null and a.category = 'strategy' and a.target_user_id = g.owner_user_id
         and a.title = ('🎯 Check in: ' || g.title)
    ) then
      insert into public.alerts (severity, category, title, body, link, target_user_id, tenant_id)
      values ('important', 'strategy', '🎯 Check in: ' || g.title,
              'This goal has been quiet for a week. One tap on the board: on track, at risk, or done?',
              '/crew?s=command&a=goals', g.owner_user_id, '00000000-0000-0000-0000-000000000001');
      n := n + 1;
    end if;
  end loop;
end $$;

-- Monday 13:00 UTC (~breakfast ET). Guarded: re-runs and cron-less environments both no-op.
do $$ begin perform cron.unschedule('goal-checkin'); exception when others then null; end $$;
do $$ begin perform cron.schedule('goal-checkin', '0 13 * * 1', 'select public.goal_checkin_nudges()'); exception when others then null; end $$;

-- Verify (prod, after apply):
--   select count(*) from information_schema.columns where table_name='goals' and column_name='checkin_status';        -- 1
--   select count(*) from information_schema.columns where table_name='strategy_decisions' and column_name='note_id';  -- 1
--   select count(*) from pg_policies where tablename = 'initiative_goals';                                            -- 2
--   select jobname from cron.job where jobname = 'goal-checkin';                                                      -- scheduled
