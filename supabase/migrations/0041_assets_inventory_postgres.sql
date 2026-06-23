-- 0041 — ASSETS + INVENTORY in Postgres (system-of-record), replacing the read-only Notion bridge.
-- Paste into Supabase → SQL Editor → Run. Idempotent. Tenant-scoped from birth (0040).
-- Data is migrated separately (read from Notion, inserted here); the app then reads Postgres.
-- RLS uses the plan-stable (select public.is_staff()) form (see 0039).

create table if not exists public.assets (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  name        text not null,
  make_model  text,
  brand       text,                       -- 'GT3 Performance Bar' | 'GT3 Brew' | 'Shared'
  category    text[] not null default '{}',
  use_case    text,                       -- GT3 Use Case
  manual_url  text,                       -- Manual / Source
  kb_status   text,                       -- Drafted | Reviewed | Needs manual
  qty         int,
  notion_url  text,                       -- provenance link back to the old Notion record
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists assets_tenant_idx on public.assets(tenant_id);
create index if not exists assets_brand_idx  on public.assets(brand);
alter table public.assets enable row level security;
drop policy if exists "assets staff read"  on public.assets;
create policy "assets staff read"  on public.assets for select using ((select public.is_staff()));
drop policy if exists "assets staff write" on public.assets;
create policy "assets staff write" on public.assets for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

create table if not exists public.inventory_items (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  name            text not null,
  qty             numeric,
  qty_event_ready numeric,
  reorder_point   numeric,
  status          text,                   -- On Hand | In Transit | ...
  unit            text,
  category        text,
  use_cases       text[] not null default '{}',  -- Event Use Case
  required_for    text[] not null default '{}',  -- Required For Event Type
  critical        boolean not null default false,
  reorder_link    text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists inventory_tenant_idx on public.inventory_items(tenant_id);
alter table public.inventory_items enable row level security;
drop policy if exists "inventory staff read"  on public.inventory_items;
create policy "inventory staff read"  on public.inventory_items for select using ((select public.is_staff()));
drop policy if exists "inventory staff write" on public.inventory_items;
create policy "inventory staff write" on public.inventory_items for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- keep updated_at fresh
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end; $$;
drop trigger if exists assets_touch on public.assets;
create trigger assets_touch before update on public.assets for each row execute function public.touch_updated_at();
drop trigger if exists inventory_touch on public.inventory_items;
create trigger inventory_touch before update on public.inventory_items for each row execute function public.touch_updated_at();
