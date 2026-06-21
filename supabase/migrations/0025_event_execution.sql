-- 0025 — event execution: per-event pack/task checklist + crew roster.
-- The validated slice of the owner's R1/R3/R5 ask (ruthless panel verdict):
-- event-SCOPED checklist tied to the live event — NOT a standalone task manager, NOT a
-- configurable workflow engine, NOT CSAT/on-time staff scoring (all explicitly killed).

-- Per-event checklist: pack-list items (auto-derived from the event's rig/menu) + ad-hoc
-- tasks. Tied to one event, role-scoped, realtime — exactly what Notion fails at mid-rush.
create table if not exists public.event_tasks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  label text not null,
  section text,                         -- Power / Nitro / Bottles / Water / Service / Compliance / Task
  kind text not null default 'pack' check (kind in ('pack', 'task')),
  critical boolean not null default false,
  assignee uuid references auth.users(id) on delete set null,
  done boolean not null default false,
  done_by uuid references auth.users(id) on delete set null,
  done_at timestamptz,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists event_tasks_event on public.event_tasks(event_id);
alter table public.event_tasks enable row level security;
drop policy if exists "event_tasks staff read" on public.event_tasks;
create policy "event_tasks staff read" on public.event_tasks for select using (public.is_staff());
drop policy if exists "event_tasks staff update" on public.event_tasks;
create policy "event_tasks staff update" on public.event_tasks for update to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "event_tasks admin write" on public.event_tasks;
create policy "event_tasks admin write" on public.event_tasks for insert to authenticated with check (public.is_admin());
drop policy if exists "event_tasks admin delete" on public.event_tasks;
create policy "event_tasks admin delete" on public.event_tasks for delete to authenticated using (public.is_admin());

-- Crew roster: who's on this event (assign any staff member). No scoring — just coverage.
create table if not exists public.event_staff (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_label text,                      -- lead / cart / bottles / nitro / runner
  created_at timestamptz not null default now(),
  unique (event_id, user_id)
);
create index if not exists event_staff_event on public.event_staff(event_id);
alter table public.event_staff enable row level security;
drop policy if exists "event_staff staff read" on public.event_staff;
create policy "event_staff staff read" on public.event_staff for select using (public.is_staff());
drop policy if exists "event_staff admin write" on public.event_staff;
create policy "event_staff admin write" on public.event_staff for all to authenticated using (public.is_admin()) with check (public.is_admin());
