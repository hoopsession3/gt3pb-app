-- 0271 — STOREFRONT SPINE (2026-08-03, Ryan: "build all lets go … stays visually systematic, don't
-- lose the idea only improve, 10/10 improvements to all.")
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- One /shop, two product lines (physical merch via Apliiq · digital program tiers), ONE spine. This
-- round lays the spine + the merch line + the Apliiq integration + webhook idempotency. Round 0272
-- adds the /primal program, Square-subscription tiers, and the MindNode importer on the SAME tables.
--
-- Reuses, never clones: the customer identity (0151 resolve_customer), the Square checkout engine,
-- the publish gate (0270 published_at — merch is born hidden, published by choice), the notify
-- engine (ship mail), the design system. New here: the shop catalog/orders, the fulfillment record,
-- and a webhook_events idempotency ledger so a retried Apliiq/Square webhook can never double-act.
-- Apply after 0270.

-- ── the unified catalog (kind is the only branch: merch now, program_tier in 0272) ───────────────
create table if not exists public.shop_products (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  kind              text not null default 'merch' check (kind in ('merch','program_tier')),
  apliiq_product_id text,                                              -- merch: Apliiq's id (sync key)
  title             text not null,
  blurb             text,
  price_cents       int  not null default 0 check (price_cents >= 0), -- 0 = free (e.g. Rookie)
  cost_cents        int  check (cost_cents is null or cost_cents >= 0), -- Apliiq's charge → margin math
  image_url         text,
  images            jsonb not null default '[]'::jsonb,               -- gallery
  variants          jsonb not null default '[]'::jsonb,               -- [{size,color,sku,apliiq_variant_id}]
  program_tier      text,                                             -- program_tier rows: 'rookie' | 'pro' | …
  published_at      timestamptz,                                      -- 0270 publish gate — born hidden
  public_title      text,                                             -- optional guest-facing name
  sort              int not null default 0,
  archived_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists shop_products_apliiq on public.shop_products(apliiq_product_id) where apliiq_product_id is not null;
create index if not exists shop_products_live on public.shop_products(kind, sort) where (published_at is not null and archived_at is null);

-- ── orders (one row per purchase; free program grants write an amount-0 order for a complete record)
create table if not exists public.shop_orders (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  customer_id    uuid references public.customers(id) on delete set null,
  user_id        uuid references auth.users(id) on delete set null,
  email          text,
  payment_id     text,                                                -- Square payment id (null for free grants)
  subtotal_cents int not null default 0,
  total_cents    int not null default 0,
  ship_name      text,
  ship_address   jsonb,                                               -- {street,city,state,zip}
  status         text not null default 'paid'
                   check (status in ('paid','needs_fulfillment','submitted','in_production','shipped','delivered','refunded','canceled')),
  apliiq_order_id text,
  benefit_code   text,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists shop_orders_payment on public.shop_orders(payment_id) where payment_id is not null;
create index if not exists shop_orders_customer on public.shop_orders(customer_id, created_at desc);
create index if not exists shop_orders_status on public.shop_orders(status) where status in ('paid','needs_fulfillment');

create table if not exists public.shop_order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.shop_orders(id) on delete cascade,
  product_id  uuid references public.shop_products(id) on delete set null,
  title       text not null,
  variant     jsonb,
  qty         int  not null default 1 check (qty > 0),
  unit_cents  int  not null default 0,
  cost_cents  int
);
create index if not exists shop_order_items_order on public.shop_order_items(order_id);

-- ── fulfillment record (fed by Apliiq's fulfillment webhook) ─────────────────────────────────────
create table if not exists public.merch_fulfillments (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.shop_orders(id) on delete cascade,
  carrier         text,
  tracking_number text,
  tracking_url    text,
  shipped_at      timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists merch_fulfillments_order on public.merch_fulfillments(order_id);

-- ── webhook idempotency — REUSE the existing 0230 inbox (public.webhook_events, id = provider event
--    id). We do NOT create a second table: lib/apliiq inserts id = 'apliiq:<event>' (namespaced so
--    Apliiq and Square ids never collide), and the primary-key clash IS the dedup. One inbox, both
--    providers — the anti-piecemeal choice.

-- ── program access ledger — created now, USED in 0272 (subscriptions grant/revoke it) ────────────
create table if not exists public.program_access (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  customer_id uuid not null references public.customers(id) on delete cascade,
  tier        text not null,                                          -- 'rookie' | 'pro' | …
  source      text not null default 'free' check (source in ('free','purchase','subscription','comp','coach')),
  granted_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  unique (customer_id, tier)
);
create index if not exists program_access_customer on public.program_access(customer_id) where revoked_at is null;

-- ── RLS ──────────────────────────────────────────────────────────────────────────────────────────
-- catalog: public sees PUBLISHED only (0270 publish-gate shape); staff see all; staff write.
alter table public.shop_products enable row level security;
drop policy if exists "shop products public read" on public.shop_products;
create policy "shop products public read" on public.shop_products for select
  using ((published_at is not null and archived_at is null) or (select public.is_staff()));
drop policy if exists "shop products staff write" on public.shop_products;
create policy "shop products staff write" on public.shop_products for all
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- orders + items: a customer sees their own; staff see all; writes are server-side (service role).
alter table public.shop_orders enable row level security;
drop policy if exists "shop orders owner read" on public.shop_orders;
create policy "shop orders owner read" on public.shop_orders for select
  using (user_id = (select auth.uid()) or (select public.is_staff()));
drop policy if exists "shop orders staff manage" on public.shop_orders;
create policy "shop orders staff manage" on public.shop_orders for all
  using ((select public.is_staff())) with check ((select public.is_staff()));
alter table public.shop_order_items enable row level security;
drop policy if exists "shop items read" on public.shop_order_items;
create policy "shop items read" on public.shop_order_items for select
  using (exists (select 1 from public.shop_orders o where o.id = order_id
    and (o.user_id = (select auth.uid()) or (select public.is_staff()))));
drop policy if exists "shop items staff manage" on public.shop_order_items;
create policy "shop items staff manage" on public.shop_order_items for all
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- fulfillments: staff read/write (server writes via service role).
alter table public.merch_fulfillments enable row level security;
drop policy if exists "fulfillments staff" on public.merch_fulfillments;
create policy "fulfillments staff" on public.merch_fulfillments for all
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- webhook_events: NO client access at all — the service role is the only writer/reader (dedup ledger).
alter table public.webhook_events enable row level security;

-- program_access: a customer sees their own entitlements; staff see all; writes server-side.
alter table public.program_access enable row level security;
drop policy if exists "access owner read" on public.program_access;
create policy "access owner read" on public.program_access for select
  using ((select public.is_staff()) or exists (
    select 1 from public.customers c where c.id = customer_id and c.user_id = (select auth.uid())));
drop policy if exists "access staff manage" on public.program_access;
create policy "access staff manage" on public.program_access for all
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- ── tenant stamp on the tenant-scoped tables (house pattern) ─────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['shop_products','shop_orders','program_access'] loop
    execute format('drop trigger if exists stamp_tenant_tg on public.%I', t);
    execute format('create trigger stamp_tenant_tg before insert on public.%I for each row execute function public.stamp_tenant()', t);
  end loop;
end $$;

-- ── the record (no-drift gate) ───────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Storefront foundation + print-on-demand integration','feature','Ordering',
   'The groundwork for a GT3 shop landed: a unified product catalog (born hidden, published by choice like events), an order + fulfillment spine, and a secure, idempotent Apliiq print-on-demand integration — so branded apparel can be sold with no inventory to hold and tracking reaches the customer automatically when it ships. The same spine carries the coming nutrition program, so the store grows without a rebuild. The customer-facing shop and the program follow next.',
   '2026-08-03', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- Verify (prod, after apply):
--   select count(*) from pg_policies where tablename in ('shop_products','shop_orders','shop_order_items','merch_fulfillments','program_access');  -- 9
--   insert into public.webhook_events (id, provider, type) values ('apliiq:test','apliiq','fulfillment'); -- ok; the same id again → unique violation (idempotent, reuses the 0230 inbox)
--   select count(*) from shop_products where published_at is null;  -- born hidden
