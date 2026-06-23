-- 0049 — meeting notes as in-app, operational system of record (+ action items as tasks).
-- Tenant-scoped to match the 0040 multi-tenant foundation (tenant_id defaults to the founding
-- GT3PB tenant; per-tenant RLS enforcement stays deferred like the rest of the app). Notes are
-- leadership content: the Plan-section audience (event_manager / admin / owner) reads/writes them.
-- A note's follow-ups reuse the ENTIRE prep engine (assign, My Tasks, push) by extending the
-- polymorphic event_tasks owner to a third kind — a row now belongs to exactly one of: an event,
-- a truck stop, OR a meeting note. Idempotent; apply after 0040–0048.

create table if not exists public.meeting_notes (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  met_on     date not null default current_date,
  summary    text,                                                   -- quick recap (e.g. the notee summary)
  body       text,                                                   -- full transcript / detailed notes (optional)
  source     text not null default 'manual',                         -- 'manual' (composer) or 'email' (notee Share Text → Mail → inbound)
  event_id   uuid references public.events(id) on delete set null,   -- optional relational link to an event
  created_by uuid references auth.users(id) on delete set null,
  tenant_id  uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- defensive (table may pre-exist from an earlier attempt without these)
alter table public.meeting_notes add column if not exists source text not null default 'manual';
alter table public.meeting_notes add column if not exists tenant_id uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001';
update public.meeting_notes set tenant_id = '00000000-0000-0000-0000-000000000001' where tenant_id is null;
create index if not exists meeting_notes_met_on on public.meeting_notes(met_on desc);
create index if not exists meeting_notes_tenant_idx on public.meeting_notes(tenant_id);

-- touch_updated_at() already exists (0028) — reuse it.
drop trigger if exists meeting_notes_touch on public.meeting_notes;
create trigger meeting_notes_touch before update on public.meeting_notes
  for each row execute function public.touch_updated_at();

alter table public.meeting_notes enable row level security;

-- Leadership tier = event_manager / admin / owner (same audience as the Plan section).
-- Scalar-subquery wrap keeps the RLS plan stable under PostgREST (the 0039 lesson).
drop policy if exists "notes leadership read" on public.meeting_notes;
create policy "notes leadership read" on public.meeting_notes for select
  using ((select exists (select 1 from public.profiles where id = auth.uid() and role in ('event_manager','admin','owner'))));
drop policy if exists "notes leadership write" on public.meeting_notes;
create policy "notes leadership write" on public.meeting_notes for all to authenticated
  using ((select exists (select 1 from public.profiles where id = auth.uid() and role in ('event_manager','admin','owner'))))
  with check ((select exists (select 1 from public.profiles where id = auth.uid() and role in ('event_manager','admin','owner'))));

-- Extend the polymorphic checklist owner (0040 made it event XOR stop) to a THIRD kind: a meeting
-- note. event_tasks already carries tenant_id (0040 multi-tenant), so note-owned tasks inherit it.
alter table public.event_tasks add column if not exists meeting_note_id uuid references public.meeting_notes(id) on delete cascade;
alter table public.event_tasks drop constraint if exists event_tasks_one_owner;
alter table public.event_tasks add constraint event_tasks_one_owner
  check (((event_id is not null)::int + (stop_id is not null)::int + (meeting_note_id is not null)::int) = 1);
create index if not exists event_tasks_meeting_note on public.event_tasks(meeting_note_id);

-- The 0038 re-open-approval trigger deletes approvals by event_id; meeting-note rows have a null
-- event_id, so it's a harmless no-op for them (notes don't use the event sign-off flow).

do $$ begin
  alter publication supabase_realtime add table public.meeting_notes;
exception when duplicate_object then null; end $$;
