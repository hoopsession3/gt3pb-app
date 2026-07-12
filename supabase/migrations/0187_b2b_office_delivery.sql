-- 0187 — B2B OFFICE DELIVERY foundation (all three phases, one coherent schema so nothing is bolted
-- on later). Deliberately does NOT overload delivery_orders (its pack_size in (12,24,36) + counts-sum
-- constraints are residential-specific); business orders get purpose-built tables, and the crew
-- surfaces (calendar, money, driver run) MERGE both at the read layer — cohesion at presentation,
-- clean schemas at storage.
--
--   business_accounts — the office entity (company, contact, terms, standing order, jug balance)   [P1/P2]
--   business_orders   — one Monday bulk delivery: gallons, amber jugs, window, billing              [P1]
--   jug_ledger        — reusable amber-jug swap balance per account (empty-for-full)                [P2]
--   invoices          — net-terms billing for standing accounts                                     [P3]

-- ─────────────────────────── business accounts ───────────────────────────
create table if not exists public.business_accounts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  user_id       uuid references auth.users(id),            -- the member who manages this office
  customer_id   uuid references public.customers(id),
  company       text not null,
  contact_name  text,
  contact_phone text,
  contact_email text,
  address_street text,
  address_city  text,
  address_zip   text,
  headcount     int,
  billing_terms text not null default 'prepaid' check (billing_terms in ('prepaid','net15','net30')),
  preferred_window text not null default 'mon_0500_0800',
  standing_active  boolean not null default false,         -- recurring weekly Monday order (P2)
  standing_gallons numeric check (standing_gallons is null or standing_gallons >= 3),
  jug_balance   int not null default 0,                    -- amber jugs currently in the office's hands
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ─────────────────────────── business orders (office bulk) ───────────────────────────
create table if not exists public.business_orders (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  business_id   uuid references public.business_accounts(id),
  user_id       uuid references auth.users(id),
  company       text not null,
  contact_name  text,
  contact_phone text,
  address_street text not null,
  address_city  text not null,
  address_zip   text not null,
  access_instructions text,
  delivery_date date not null,                              -- ET business-day key (a Monday)
  delivery_window text not null default 'mon_0500_0800',
  container     text not null default 'amber_gallon' check (container in ('amber_gallon')),
  gallons       numeric not null check (gallons >= 3),      -- 3-gallon minimum, enforced at the DB
  price_per_gallon_cents int not null default 4500,
  subtotal_cents int not null,
  delivery_fee_cents int not null default 0,
  tax_cents     int not null default 0,
  total_cents   int not null,
  billing_terms text not null default 'prepaid' check (billing_terms in ('prepaid','net15','net30')),
  payment_status text not null default 'pending' check (payment_status in ('pending','paid','invoiced','failed','refunded')),
  status        text not null default 'received' check (status in ('received','brewed','out_for_delivery','delivered','held_for_pickup','issue')),
  driver_outcome text check (driver_outcome in ('delivered_swapped','delivered_no_swap','held','not_available')),
  jugs_out      int not null default 0,                     -- full jugs dropped
  jugs_in       int,                                        -- empty jugs collected (driver-logged)
  driver_note   text,
  standing      boolean not null default false,             -- generated from a standing order (P2)
  canceled_at   timestamptz,
  created_at    timestamptz not null default now()
);

-- ─────────────────────────── jug ledger (swap balance) ───────────────────────────
create table if not exists public.jug_ledger (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  business_id   uuid references public.business_accounts(id),
  business_order_id uuid references public.business_orders(id),
  jugs_out      int not null default 0,
  jugs_in       int not null default 0,
  balance_after int,
  note          text,
  created_at    timestamptz not null default now()
);

-- ─────────────────────────── invoices (net terms) ───────────────────────────
create table if not exists public.invoices (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  business_id   uuid references public.business_accounts(id),
  business_order_id uuid references public.business_orders(id),
  amount_cents  int not null,
  terms         text not null default 'net15',
  status        text not null default 'open' check (status in ('open','sent','paid','void')),
  issued_at     timestamptz not null default now(),
  due_at        date,
  paid_at       timestamptz,
  note          text,
  created_at    timestamptz not null default now()
);

-- ─────────────────────────── indexes ───────────────────────────
create index if not exists business_orders_date_idx  on public.business_orders(delivery_date) where canceled_at is null;
create index if not exists business_orders_user_idx  on public.business_orders(user_id);
create index if not exists business_accounts_user_idx on public.business_accounts(user_id);
create index if not exists invoices_business_idx      on public.invoices(business_id);

-- ─────────────────────────── tenant stamp (house pattern) ───────────────────────────
do $$ declare t text; begin
  foreach t in array array['business_accounts','business_orders','jug_ledger','invoices'] loop
    execute format('drop trigger if exists stamp_tenant_tg on public.%1$I', t);
    execute format('create trigger stamp_tenant_tg before insert on public.%1$I for each row execute function public.stamp_tenant()', t);
  end loop;
end $$;

-- ─────────────────────────── RLS ───────────────────────────
alter table public.business_accounts enable row level security;
alter table public.business_orders   enable row level security;
alter table public.jug_ledger        enable row level security;
alter table public.invoices          enable row level security;

-- business_accounts: the managing member owns their row; staff manage all.
drop policy if exists "biz acct own" on public.business_accounts;
create policy "biz acct own" on public.business_accounts
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "biz acct staff" on public.business_accounts;
create policy "biz acct staff" on public.business_accounts
  for all using ((select public.is_staff())) with check ((select public.is_staff()));

-- business_orders: the member reads/creates/cancels their own; staff manage all.
drop policy if exists "biz order own read" on public.business_orders;
create policy "biz order own read" on public.business_orders
  for select using (user_id = (select auth.uid()));
drop policy if exists "biz order own insert" on public.business_orders;
create policy "biz order own insert" on public.business_orders
  for insert with check (user_id = (select auth.uid()));
drop policy if exists "biz order own cancel" on public.business_orders;
create policy "biz order own cancel" on public.business_orders
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "biz order staff" on public.business_orders;
create policy "biz order staff" on public.business_orders
  for all using ((select public.is_staff())) with check ((select public.is_staff()));

-- jug_ledger + invoices: staff-managed; members read their own (via their orders).
drop policy if exists "jug staff" on public.jug_ledger;
create policy "jug staff" on public.jug_ledger
  for all using ((select public.is_staff())) with check ((select public.is_staff()));
drop policy if exists "jug own read" on public.jug_ledger;
create policy "jug own read" on public.jug_ledger
  for select using (business_id in (select id from public.business_accounts where user_id = (select auth.uid())));
drop policy if exists "invoice staff" on public.invoices;
create policy "invoice staff" on public.invoices
  for all using ((select public.is_staff())) with check ((select public.is_staff()));
drop policy if exists "invoice own read" on public.invoices;
create policy "invoice own read" on public.invoices
  for select using (business_id in (select id from public.business_accounts where user_id = (select auth.uid())));

-- ─────────────────────────── grants ───────────────────────────
grant select, insert, update on public.business_accounts to authenticated;
grant select, insert, update on public.business_orders   to authenticated;
grant select on public.jug_ledger to authenticated;
grant select on public.invoices   to authenticated;

-- verify:
-- select table_name from information_schema.tables where table_schema='public'
--   and table_name in ('business_accounts','business_orders','jug_ledger','invoices');  -- expect 4
