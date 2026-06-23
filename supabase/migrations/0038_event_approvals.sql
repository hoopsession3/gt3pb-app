-- 0038 — per-event prep approval (owner + the managers tagged on the event)
-- Paste into Supabase → SQL Editor → Run. Idempotent.
-- A "manager" of an event = an event_staff row whose role_label = 'manager'.
-- Prep is fully approved when an owner has approved AND every tagged manager has approved.

create table if not exists public.event_approvals (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  approver_id uuid not null references auth.users(id) on delete cascade,
  approved_at timestamptz not null default now(),
  unique (event_id, approver_id)
);
create index if not exists event_approvals_event on public.event_approvals(event_id);

alter table public.event_approvals enable row level security;

-- Any staff can see the sign-off state; an approver may write/remove only their OWN approval.
drop policy if exists "approvals staff read" on public.event_approvals;
create policy "approvals staff read" on public.event_approvals for select using (public.is_staff());
drop policy if exists "approvals self write" on public.event_approvals;
create policy "approvals self write" on public.event_approvals for insert to authenticated with check (auth.uid() = approver_id and public.is_staff());
drop policy if exists "approvals self delete" on public.event_approvals;
create policy "approvals self delete" on public.event_approvals for delete using (auth.uid() = approver_id);

-- Editing the checklist CONTENT (adding/removing/renaming items, criticality) re-opens
-- sign-off by clearing approvals. Note: checking items off (done) and assigning crew do
-- NOT re-open — those are execution, not a plan change.
create or replace function public.clear_event_approvals()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.event_approvals where event_id = coalesce(new.event_id, old.event_id);
  return null;
end; $$;

drop trigger if exists event_tasks_reopen_approval on public.event_tasks;
create trigger event_tasks_reopen_approval
  after insert or delete or update of label, section, critical on public.event_tasks
  for each row execute function public.clear_event_approvals();

-- Realtime so the sign-off strip updates live on every operator's screen.
do $$ begin
  alter publication supabase_realtime add table public.event_approvals;
exception when duplicate_object then null; end $$;
