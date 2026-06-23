-- 0051 — discussion threads: polymorphic comments on tasks, meeting notes, and alerts.
-- Turns one-way signals into two-way collaboration. A comment belongs to exactly one subject
-- (an event_task XOR a meeting_note XOR an alert). Replies/@mentions notify via the alert spine.
-- Tenant-scoped to match 0040. Idempotent; apply after 0050.

create table if not exists public.comments (
  id              uuid primary key default gen_random_uuid(),
  body            text not null,
  author_id       uuid references auth.users(id) on delete set null,
  event_task_id   uuid references public.event_tasks(id) on delete cascade,
  meeting_note_id uuid references public.meeting_notes(id) on delete cascade,
  alert_id        uuid references public.alerts(id) on delete cascade,
  mentions        uuid[] not null default '{}',
  tenant_id       uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  created_at      timestamptz not null default now(),
  constraint comments_one_subject check (
    ((event_task_id is not null)::int + (meeting_note_id is not null)::int + (alert_id is not null)::int) = 1
  )
);
create index if not exists comments_task   on public.comments(event_task_id);
create index if not exists comments_note   on public.comments(meeting_note_id);
create index if not exists comments_alert  on public.comments(alert_id);
create index if not exists comments_tenant_idx on public.comments(tenant_id);

alter table public.comments enable row level security;

-- Mirror the subject's visibility: task threads → any staff (crew work on prep together);
-- note/alert threads → leadership only. Scalar-subquery wrap = plan-stable (0039).
drop policy if exists "comments read" on public.comments;
create policy "comments read" on public.comments for select using (
  case when event_task_id is not null then (select public.is_staff())
       else (select exists (select 1 from public.profiles where id = auth.uid() and role in ('event_manager','admin','owner'))) end
);
drop policy if exists "comments write" on public.comments;
create policy "comments write" on public.comments for insert to authenticated with check (
  (select auth.uid()) = author_id and
  case when event_task_id is not null then (select public.is_staff())
       else (select exists (select 1 from public.profiles where id = auth.uid() and role in ('event_manager','admin','owner'))) end
);
drop policy if exists "comments delete own" on public.comments;
create policy "comments delete own" on public.comments for delete using ((select auth.uid()) = author_id);

do $$ begin
  alter publication supabase_realtime add table public.comments;
exception when duplicate_object then null; end $$;
