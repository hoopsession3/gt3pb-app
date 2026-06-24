-- 0064 — COMPANY CALENDAR: one pane for everything dated. Adds a category to events and a free-
-- standing, dated to-do that can link to an event or a note (for click-through). Apply after 0049.

alter table public.events add column if not exists category text not null default 'event';  -- event | admin | ops

create table if not exists public.todos (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  title           text not null,
  category        text not null default 'ops',           -- admin | ops | event | content
  due_on          date,
  assignee        uuid references auth.users(id) on delete set null,
  done            boolean not null default false,
  done_at         timestamptz,
  event_id        uuid references public.events(id) on delete set null,        -- click-through target
  meeting_note_id uuid references public.meeting_notes(id) on delete set null, -- click-through target
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists todos_due on public.todos(due_on);
drop trigger if exists todos_touch on public.todos;
create trigger todos_touch before update on public.todos for each row execute function public.touch_updated_at();

alter table public.todos enable row level security;
drop policy if exists "todos leadership read"  on public.todos;
create policy "todos leadership read"  on public.todos for select
  using ((select exists (select 1 from public.profiles where id = auth.uid() and role in ('event_manager','admin','owner'))));
drop policy if exists "todos leadership write" on public.todos;
create policy "todos leadership write" on public.todos for all to authenticated
  using ((select exists (select 1 from public.profiles where id = auth.uid() and role in ('event_manager','admin','owner'))))
  with check ((select exists (select 1 from public.profiles where id = auth.uid() and role in ('event_manager','admin','owner'))));

do $$ begin alter publication supabase_realtime add table public.todos; exception when duplicate_object then null; end $$;
