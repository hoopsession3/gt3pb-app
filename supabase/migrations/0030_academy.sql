-- 0030_academy.sql
-- GT3 Academy: per-user training progress + certifications.
-- Content (modules, products, cookbook, quizzes) is authored in code
-- (lib/academy.ts) and keyed by slug; this table stores who has done what,
-- their scores, and which certifications they've earned. Role-based paths and
-- operational-readiness are derived from these rows.

-- ── per-module progress (one row per user per module) ──────────────────
create table if not exists public.academy_progress (
  user_id      uuid not null references auth.users(id) on delete cascade,
  module_slug  text not null,
  status       text not null default 'in_progress' check (status in ('in_progress','complete')),
  score        int,                 -- last quiz score %, null if module has no quiz
  best_score   int,
  completed_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (user_id, module_slug)
);
alter table public.academy_progress enable row level security;
-- each person owns their progress; admins/owners read all for the team dashboard
drop policy if exists "own progress" on public.academy_progress;
create policy "own progress" on public.academy_progress
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "staff read progress" on public.academy_progress;
create policy "staff read progress" on public.academy_progress
  for select using (is_admin());

-- ── earned certifications (one row per user per cert) ──────────────────
create table if not exists public.academy_certifications (
  user_id     uuid not null references auth.users(id) on delete cascade,
  cert_key    text not null,
  awarded_at  timestamptz not null default now(),
  expires_at  timestamptz,          -- null = no expiry; set for time-boxed certs
  primary key (user_id, cert_key)
);
alter table public.academy_certifications enable row level security;
drop policy if exists "own certs" on public.academy_certifications;
create policy "own certs" on public.academy_certifications
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "staff read certs" on public.academy_certifications;
create policy "staff read certs" on public.academy_certifications
  for select using (is_admin());

-- realtime so the admin team-readiness board updates as people learn
alter publication supabase_realtime add table public.academy_progress;
alter publication supabase_realtime add table public.academy_certifications;
