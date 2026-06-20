-- 0006 — native web-push subscriptions + loyalty-from-Square mirror

-- push subscriptions (native Web Push; the Edge Function sends to these)
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade,
  is_admin   boolean not null default false,
  endpoint   text unique not null,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
grant insert, select, update, delete on public.push_subscriptions to anon, authenticated;

drop policy if exists "sub insert" on public.push_subscriptions;
create policy "sub insert" on public.push_subscriptions for insert to anon, authenticated with check (true);
drop policy if exists "sub update" on public.push_subscriptions;
create policy "sub update" on public.push_subscriptions for update to anon, authenticated using (true) with check (true);
drop policy if exists "own sub read" on public.push_subscriptions;
create policy "own sub read" on public.push_subscriptions for select using (auth.uid() = user_id or public.is_admin());
drop policy if exists "own sub delete" on public.push_subscriptions;
create policy "own sub delete" on public.push_subscriptions for delete using (auth.uid() = user_id or public.is_admin());

-- loyalty single source = Square. Mirror only the link; points/credit are READ from Square.
alter table public.profiles add column if not exists square_customer_id text;
