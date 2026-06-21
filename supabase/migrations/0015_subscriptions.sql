-- 0015 — subscriptions (Square owns recurring billing + card vault; Supabase keeps
-- a thin read-only status mirror for fast entitlement reads). Written ONLY by the
-- service role (webhook + server routes); members can never forge 'active'.

alter table public.profiles add column if not exists square_customer_id text;

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  square_subscription_id text unique,
  plan text not null default 'rise_flow',
  cadence text,
  status text not null default 'pending'
    check (status in ('pending','active','paused','canceled','past_due')),
  current_period_end timestamptz,
  square_card_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subscriptions_user on public.subscriptions(user_id);
alter table public.subscriptions enable row level security;
drop policy if exists "subs read own" on public.subscriptions;
create policy "subs read own" on public.subscriptions for select
  using (auth.uid() = user_id or public.is_admin());
-- NO client insert/update/delete: only the service role (webhook/server) writes.

alter publication supabase_realtime add table public.subscriptions;
