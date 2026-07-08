-- 0140 — STRATEGY COLLABORATION + GOVERNANCE. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- The playbook stops being read-only: owners discuss any block or play live (the existing
-- realtime comments engine gains a strategy subject), every strategic call lands in an
-- append-only decision log (governance: no decision without a log line), and the builder
-- wizard saves draft plays in the debrief's GTM record shape. Owner/admin write, staff read —
-- managers can comment (comments stay staff-wide by design, per the ops-layer role table).

-- 1) comments learn a strategy subject (same engine as alerts/tasks/notes threads)
alter table public.comments add column if not exists strategy_key text;
create index if not exists comments_strategy_idx on public.comments(strategy_key) where strategy_key is not null;

-- 2) the decision log — append-only; who decided what, why, when
create table if not exists public.strategy_decisions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  key         text not null,             -- which block/play ("pricing", "gtm:sunday-direct-delivery", "rev")
  decision    text not null,
  why         text,
  author_id   uuid references auth.users(id),
  author_name text,
  created_at  timestamptz not null default now()
);
create index if not exists strategy_decisions_key_idx on public.strategy_decisions(key, created_at desc);
alter table public.strategy_decisions enable row level security;
drop policy if exists "decisions staff read" on public.strategy_decisions;
create policy "decisions staff read" on public.strategy_decisions
  for select using ((select public.is_staff()));
drop policy if exists "decisions owner write" on public.strategy_decisions;
create policy "decisions owner write" on public.strategy_decisions
  for insert with check (
    (select auth.uid()) is not null and exists (
      select 1 from public.profiles p where p.id = (select auth.uid())
        and (p.role in ('owner','admin') or p.is_admin)
    )
  );
-- append-only on purpose: no update/delete policies exist — the log cannot be rewritten.

-- 3) draft plays — the builder wizard's output, in the debrief's GTM record shape
create table if not exists public.gtm_drafts (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  name              text not null,
  category          text not null check (category in ('channel','partnership','campaign','community','retention')),
  overhauls         text,               -- name of the locked play this revises, if an overhaul
  audience          text,
  what              text not null,      -- the play, plain English
  execution_steps   text[] not null default '{}',
  projected_revenue text,
  projected_cost    text,
  projected_cac     text,
  payback           text,
  in_app            text,               -- where the app runs (or will run) it
  status            text not null default 'draft' check (status in ('draft','proposed','adopted','retired')),
  author_id         uuid references auth.users(id),
  author_name       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.gtm_drafts enable row level security;
drop policy if exists "drafts staff read" on public.gtm_drafts;
create policy "drafts staff read" on public.gtm_drafts
  for select using ((select public.is_staff()));
drop policy if exists "drafts owner write" on public.gtm_drafts;
create policy "drafts owner write" on public.gtm_drafts
  for all using (
    exists (select 1 from public.profiles p where p.id = (select auth.uid()) and (p.role in ('owner','admin') or p.is_admin))
  ) with check (
    exists (select 1 from public.profiles p where p.id = (select auth.uid()) and (p.role in ('owner','admin') or p.is_admin))
  );

-- verify:
--   select count(*) from information_schema.columns where table_name='comments' and column_name='strategy_key';  -- 1
--   select to_regclass('public.strategy_decisions'), to_regclass('public.gtm_drafts');                           -- both non-null
--   select count(*) from pg_policy where polrelid='public.strategy_decisions'::regclass;                          -- >= 2 (+ isolation after 0134 re-run)
