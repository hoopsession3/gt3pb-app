-- 0062 — PRODUCTS as a managed, relational catalog (replaces the hardcoded lib/menu.ts as the
-- source of truth for price + attributes). Relational by design:
--   products ──< product_components >── inventory_items   (recipe / bill-of-materials)
--   products.slug = product_economics.product / square name key                (cost + price sync)
--   content_items.product_id ── products                                       (Studio ↔ a drink)
-- Public can READ active products (the customer menu + cash pricing); staff manage. Apply after 0061.

create table if not exists public.products (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  slug          text not null unique,                 -- 'rise' — matches DrinkId + Square name key + product_economics
  name          text not null,
  line          text,                                 -- Activation | Hydration | Recovery
  price_cents   int not null default 0,
  active        boolean not null default true,
  sort          int not null default 0,
  what          text,                                 -- short description
  why           text,
  ingredients   text[] not null default '{}',
  excludes      text[] not null default '{}',         -- "no sugar / dairy / …"
  timing        text,                                 -- BEFORE | DURING | AFTER
  accent        text,                                 -- hex dot/accent
  square_item_id text,                                -- price-sync link to Square catalog
  image_url     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists products_tenant on public.products(tenant_id);

-- Recipe / BOM: a serving of a product consumes inventory items. Drives forecasting + readiness.
create table if not exists public.product_components (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  product_id        uuid not null references public.products(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  qty_per_serving   numeric,
  unit              text,
  unique (product_id, inventory_item_id)
);
create index if not exists product_components_product on public.product_components(product_id);

-- Studio ↔ product: a piece of content can be about a specific drink.
alter table public.content_items add column if not exists product_id uuid references public.products(id) on delete set null;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end; $$;
drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products for each row execute function public.touch_updated_at();

alter table public.products enable row level security;
drop policy if exists "products public read" on public.products;
create policy "products public read" on public.products for select using (active or (select public.is_staff()));
drop policy if exists "products staff write" on public.products;
create policy "products staff write" on public.products for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

alter table public.product_components enable row level security;
drop policy if exists "pc staff read"  on public.product_components;
create policy "pc staff read"  on public.product_components for select using ((select public.is_staff()));
drop policy if exists "pc staff write" on public.product_components;
create policy "pc staff write" on public.product_components for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- Seed the catalog from the locked lib/menu.ts (idempotent on slug).
insert into public.products (slug, name, line, price_cents, sort, what, why, ingredients, excludes, timing, accent) values
  ('rise','RISE','Activation',700,10,'Cold-extracted coffee in mineral water, finished with organic coconut water.','A clean, even lift to start the morning.', $${"Single-origin cold extraction","Mineral water base","Organic coconut water"}$$, $${"Sugar","Dairy","Syrups","Preservatives"}$$,'BEFORE','#C49A5E'),
  ('flow','FLOW','Activation',700,11,'Cold-extracted coffee in mineral water, infused with organic cacao nibs.','Cacao to keep the focus going a little longer.', $${"Single-origin cold extraction","Mineral water base","Organic cacao nibs"}$$, $${"Sugar","Dairy","Syrups","Preservatives"}$$,'BEFORE','#6B4429'),
  ('dusk','DUSK','Activation',700,12,'Cold-extracted coffee in mineral water with Ceylon cinnamon & green cardamom.','Cinnamon and cardamom for a warmer, spiced cup.', $${"Single-origin cold extraction","Mineral water base","Ceylon cinnamon","Green cardamom"}$$, $${"Sugar","Dairy","Syrups","Preservatives"}$$,'BEFORE','#9C6B3F'),
  ('tide','TIDE','Hydration',800,20,'Young coconut water + Thai coconut meat, finished with a touch of raw honey.','Real hydration that goes down easy.', $${"Organic young coconut water","Organic Thai coconut meat","Raw honey","Blended to order"}$$, $${"Marine collagen","Powders","Concentrate"}$$,'DURING','#2F7D74'),
  ('forge','FORGE','Recovery',900,30,'Slow-simmered, pasture-raised beef bone broth.','Deep and rich, full of minerals for the rebuild.', $${"Slow-simmered beef bone broth","Pasture-raised"}$$, $${"Bouillon","Additives","Powders","Filler"}$$,'AFTER','#B8423C'),
  ('hunt','HUNT','Recovery',900,31,'Slow-simmered, pasture-raised bison bone broth.','Leaner than beef, with a little more iron and zinc.', $${"Slow-simmered bison bone broth","Pasture-raised"}$$, $${"Bouillon","Additives","Powders","Filler"}$$,'AFTER','#8A5C7D'),
  ('wild','WILD','Recovery',900,32,'Slow-simmered, pasture-raised ostrich bone broth.','A lighter, leaner broth for an easy rebuild.', $${"Slow-simmered ostrich bone broth","Pasture-raised"}$$, $${"Bouillon","Additives","Powders","Filler"}$$,'AFTER','#A89150')
on conflict (slug) do nothing;
