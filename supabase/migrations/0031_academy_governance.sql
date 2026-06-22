-- 0031_academy_governance.sql
-- Academy governance: real expanded roles, training assignments with due dates,
-- and food-safety e-sign acknowledgements. Builds on 0030 (academy core) and
-- 0023 (roles / is_admin / is_owner / is_staff).

-- ── 1) expanded account roles ──────────────────────────────────────────
-- Make event managers, operators and contractors real account roles so their
-- Academy learning paths light up (was: member/server/admin/owner only).
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('member','server','operator','event_manager','contractor','admin','owner'));

-- any non-member is staff (Academy + service access); admin/owner unchanged
create or replace function public.is_staff() returns boolean
  language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role <> 'member');
$$;

-- owner-only role setter, expanded value set
create or replace function public.admin_set_role(member uuid, new_role text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'owner only'; end if;
  if new_role not in ('member','server','operator','event_manager','contractor','admin','owner')
    then raise exception 'invalid role: %', new_role; end if;
  update public.profiles set role = new_role where id = member;
end; $$;

-- ── 2) training assignments (admin assigns work + a due date) ───────────
create table if not exists public.academy_assignments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('module','cert','path')),
  target_key  text not null,
  due_at      timestamptz,
  assigned_by uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
alter table public.academy_assignments enable row level security;
drop policy if exists "assignee read" on public.academy_assignments;
create policy "assignee read" on public.academy_assignments
  for select using (auth.uid() = user_id or is_admin());
drop policy if exists "admin assign" on public.academy_assignments;
create policy "admin assign" on public.academy_assignments
  for all using (is_admin()) with check (is_admin());

-- ── 3) signed acknowledgements (food-safety e-sign, etc.) ──────────────
create table if not exists public.academy_acknowledgements (
  user_id     uuid not null references auth.users(id) on delete cascade,
  doc_key     text not null,
  signed_name text not null,
  signed_at   timestamptz not null default now(),
  primary key (user_id, doc_key)
);
alter table public.academy_acknowledgements enable row level security;
drop policy if exists "own acks" on public.academy_acknowledgements;
create policy "own acks" on public.academy_acknowledgements
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "staff read acks" on public.academy_acknowledgements;
create policy "staff read acks" on public.academy_acknowledgements
  for select using (is_admin());

alter publication supabase_realtime add table public.academy_assignments;
alter publication supabase_realtime add table public.academy_acknowledgements;
