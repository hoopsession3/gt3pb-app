-- 0005 — orders / back-of-kitchen (KDS)
create table if not exists public.orders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  customer    text,
  items       text[] not null,
  total_cents int not null,
  paid        boolean not null default false,
  payment_id  text,
  status      text not null default 'new' check (status in ('new', 'preparing', 'ready', 'done', 'void')),
  created_at  timestamptz not null default now()
);

alter table public.orders enable row level security;
grant insert, select on public.orders to anon, authenticated;

-- anyone can place an order; a signed-in member can read their own; admins manage all
drop policy if exists "anyone place order" on public.orders;
create policy "anyone place order" on public.orders for insert to anon, authenticated with check (true);
drop policy if exists "own orders read" on public.orders;
create policy "own orders read" on public.orders for select using (auth.uid() = user_id);
drop policy if exists "admin manage orders" on public.orders;
create policy "admin manage orders" on public.orders for all using (public.is_admin()) with check (public.is_admin());

alter publication supabase_realtime add table public.orders;
