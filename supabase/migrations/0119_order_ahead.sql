-- 0119 — order-ahead reservations (the Saturday-drop model). Additive + non-destructive: a new
-- table alongside the walk-up `orders` table. One-off pre-orders only — no subscription, no deposit,
-- no recurring billing. Reservations are recorded SERVER-SIDE with the service role (like paid
-- orders), so a client can never forge a paid reservation.
create table if not exists public.drop_orders (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users(id) on delete set null,   -- null for guest reserve
  name              text not null,
  phone             text,
  size              int  not null check (size in (3, 6, 12)),
  glass             text not null check (glass in ('return', 'new')),
  mix               jsonb not null default '{}'::jsonb,                  -- { RISE, FLOW, DUSK }
  total_cents       int  not null,
  paid              boolean not null default false,
  payment_id        text,
  drop_date         date not null,                                       -- the Saturday this is for
  picked_up         boolean not null default false,
  bottles_returned  boolean not null default false,
  created_at        timestamptz not null default now()
);
create index if not exists drop_orders_drop_idx on public.drop_orders(drop_date, created_at);
create index if not exists drop_orders_user_idx on public.drop_orders(user_id, created_at desc);

alter table public.drop_orders enable row level security;
grant select on public.drop_orders to anon, authenticated;
-- No client INSERT policy: only the reserve API (service role) writes, so `paid` is trustworthy.
grant update on public.drop_orders to authenticated;   -- staff toggles (RLS-gated below)

-- a signed-in member reads their own reservations; staff read + manage all (pickup / bottles toggles)
drop policy if exists "own drops read" on public.drop_orders;
create policy "own drops read" on public.drop_orders for select using (auth.uid() = user_id);
drop policy if exists "staff read drops" on public.drop_orders;
create policy "staff read drops" on public.drop_orders for select using ((select public.is_staff()));
drop policy if exists "staff manage drops" on public.drop_orders;
create policy "staff manage drops" on public.drop_orders for update using ((select public.is_staff())) with check ((select public.is_staff()));

-- ops board is realtime, like the kitchen pass
alter publication supabase_realtime add table public.drop_orders;
