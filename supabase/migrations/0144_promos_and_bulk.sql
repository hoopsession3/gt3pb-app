-- 0144 — MARKETING SPLASH + DYNAMIC BULK-ORDER MENU. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- Two owner-controlled surfaces, both cohesive backend → UI → DB:
--  A) promos — the marketing card the app opens to. Owner edits headline/body/CTA/image; the app
--     shows the most recent ACTIVE one to guests, once per day, closeable. Nothing hardcoded.
--  B) products.bulk_orderable / bulk_price_cents — the owner flags ANY menu item as available for
--     the delivery pack builder. The $14 premium bottles (Salted Latte and any future add) come
--     from this flag, not from code — flip it in Money → Menu & products and it appears in the flow.

-- A) promos
create table if not exists public.promos (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  active      boolean not null default false,
  headline    text not null,
  body        text,
  cta_label   text,
  cta_href    text,                          -- in-app path, e.g. /delivery
  image_url   text,
  updated_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists promos_active_idx on public.promos(active, updated_at desc);
alter table public.promos enable row level security;
grant select on public.promos to anon, authenticated;
drop policy if exists "promos public read active" on public.promos;
create policy "promos public read active" on public.promos for select using (active = true or (select public.is_staff()));
drop policy if exists "promos owner write" on public.promos;
create policy "promos owner write" on public.promos for all
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and (p.role in ('owner','admin') or p.is_admin)))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and (p.role in ('owner','admin') or p.is_admin)));

-- seed one active promo (the packs pitch) if the table is empty
insert into public.promos (active, headline, body, cta_label, cta_href)
select true, 'Save more with a pack.', 'Mix and match all three brews — Rise, Flow, Dusk — plus the Salted Latte. Bring your bottles back and every bottle drops to $8. Delivered to your porch Sunday morning.', 'Build your pack →', '/delivery'
where not exists (select 1 from public.promos);

-- B) dynamic bulk-order flag on the catalog
alter table public.products add column if not exists bulk_orderable  boolean not null default false;
alter table public.products add column if not exists bulk_price_cents int;      -- per-bottle bulk price; null → tier default
alter table public.products add column if not exists bulk_tier       text not null default 'premium' check (bulk_tier in ('brew','premium'));
alter table public.products add column if not exists bulk_sort       int not null default 0;

-- seed: the three daypart brews are the refillable core; Salted Latte is the first $14 premium.
update public.products set bulk_orderable = true, bulk_tier = 'brew'    where slug in ('rise','flow','dusk');
update public.products set bulk_orderable = true, bulk_tier = 'premium', bulk_price_cents = 1400
  where slug in ('salted-latte','salted_latte','salted-maple-latte') and bulk_price_cents is null;
-- if no Salted Latte product exists yet, create one so it can be flagged/priced like any item
insert into public.products (slug, name, line, price_cents, active, sort, what, bulk_orderable, bulk_tier, bulk_price_cents)
select 'salted-latte', 'Salted Latte', 'Recovery', 1400, true, 900, 'A salted, slow-sipped latte — the premium pour.', true, 'premium', 1400
where not exists (select 1 from public.products where slug in ('salted-latte','salted_latte'));

-- durability + tenancy for promos (products already covered)
do $$ begin
  execute 'drop trigger if exists audit_promos on public.promos';
  execute 'create trigger audit_promos after insert or update or delete on public.promos for each row execute function public.audit_row()';
  execute 'drop trigger if exists stamp_tenant_tg on public.promos';
  execute 'create trigger stamp_tenant_tg before insert on public.promos for each row execute function public.stamp_tenant()';
  execute 'drop policy if exists "tenant isolation" on public.promos';
  execute 'create policy "tenant isolation" on public.promos as restrictive for all using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant())';
end $$;

-- verify:
--   select count(*) from public.promos where active;                                          -- >= 1
--   select slug, bulk_orderable, bulk_tier, bulk_price_cents from public.products where bulk_orderable order by bulk_tier, bulk_sort;
--   select count(*) from information_schema.columns where table_name='products' and column_name='bulk_orderable';  -- 1
