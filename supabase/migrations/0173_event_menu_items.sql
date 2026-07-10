-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0173 · EVENT MENU ITEMS — the menu an event/stop pours becomes a relation, not five booleans
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The five hardcoded menu_* booleans (0024 events, 0095 stops) can't say WHICH product pours —
-- "menu_bottles" is really rise/flow/dusk, "menu_broth" is forge/hunt/wild — and every new product
-- (KING ME, NATURE'S AIDE, the $14 specialties from 0127) needs a schema change to appear on an
-- event's menu. This table links an event XOR a stop to a product by products.slug (0062's key:
-- slug = DrinkId = Square name key = product_economics.product), so the menu editor can offer the
-- whole live catalog.
--
-- The menu_* boolean columns STAY for now: lib/economics.ts, lib/inventory.ts, and the agent
-- routes still read them, and the app keeps writing them alongside this relation so old readers
-- never drift. Dropping the booleans is a later cutover once every reader walks the relation.
-- Tenant trio + staff policy mirror 0169_content_links.sql exactly.

create table if not exists public.event_menu_items (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  event_id     uuid references public.events(id) on delete cascade,
  stop_id      uuid references public.stops(id)  on delete cascade,
  product_slug text not null,   -- products.slug ('kingme', 'rise', …) — text, not FK: products are operator-deletable, menu history isn't
  created_at   timestamptz not null default now(),
  constraint event_menu_items_one_owner
    check (((event_id is not null)::int + (stop_id is not null)::int) = 1)
);
create unique index if not exists event_menu_items_uniq_event on public.event_menu_items(event_id, product_slug) where event_id is not null;
create unique index if not exists event_menu_items_uniq_stop  on public.event_menu_items(stop_id,  product_slug) where stop_id  is not null;

alter table public.event_menu_items enable row level security;
drop policy if exists "event_menu_items staff all" on public.event_menu_items;
create policy "event_menu_items staff all" on public.event_menu_items
  for all using ((select public.is_staff())) with check ((select public.is_staff()));

drop trigger if exists stamp_tenant_tg on public.event_menu_items;
create trigger stamp_tenant_tg before insert on public.event_menu_items for each row execute function public.stamp_tenant();
drop policy if exists "tenant isolation" on public.event_menu_items;
create policy "tenant isolation" on public.event_menu_items as restrictive for all
  using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());

-- ── Backfill: booleans → product slugs, for events AND stops. The flag→slug map is read off the
-- real catalog (0062 seed + 0127 reprice board): menu_nitro = KING ME ('kingme', the nitro pour),
-- menu_nature_aid = NATURE'S AIDE ('aide'), menu_salted_maple = SALTED MAPLE LATTE ('maple'),
-- menu_bottles = the $10 glass-bottled coffees ('rise'/'flow'/'dusk'), menu_broth = the three
-- bone broths ('forge'/'hunt'/'wild'). Idempotent via the unique indexes.
insert into public.event_menu_items (tenant_id, event_id, product_slug)
select e.tenant_id, e.id, m.slug
from public.events e
join lateral (values
  ('kingme', e.menu_nitro),
  ('aide',   e.menu_nature_aid),
  ('maple',  e.menu_salted_maple),
  ('rise',   e.menu_bottles),
  ('flow',   e.menu_bottles),
  ('dusk',   e.menu_bottles),
  ('forge',  e.menu_broth),
  ('hunt',   e.menu_broth),
  ('wild',   e.menu_broth)
) as m(slug, flagged) on m.flagged
on conflict do nothing;

insert into public.event_menu_items (tenant_id, stop_id, product_slug)
select s.tenant_id, s.id, m.slug
from public.stops s
join lateral (values
  ('kingme', s.menu_nitro),
  ('aide',   s.menu_nature_aid),
  ('maple',  s.menu_salted_maple),
  ('rise',   s.menu_bottles),
  ('flow',   s.menu_bottles),
  ('dusk',   s.menu_bottles),
  ('forge',  s.menu_broth),
  ('hunt',   s.menu_broth),
  ('wild',   s.menu_broth)
) as m(slug, flagged) on m.flagged
on conflict do nothing;

-- verify:
--   select (select count(*) from pg_policies where tablename = 'event_menu_items');                                    -- 2
--   select (select count(*) from public.event_menu_items where event_id is not null) as event_rows,
--          (select count(*) from public.event_menu_items where stop_id  is not null) as stop_rows;                     -- >= flagged events/stops
--   select (select count(*) from public.events where menu_nitro) = (select count(*) from public.event_menu_items where product_slug = 'kingme' and event_id is not null);  -- true
--   select (select count(*) from public.events where menu_bottles) * 3 = (select count(*) from public.event_menu_items where product_slug in ('rise','flow','dusk') and event_id is not null);  -- true
