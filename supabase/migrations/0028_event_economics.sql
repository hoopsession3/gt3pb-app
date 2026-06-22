-- 0028_event_economics.sql
-- Event ROI / P&L layer. Revenue is already tracked (event_sales + orders);
-- this adds the COST side + projection knobs so the owner can answer
-- "is this event worth doing?" before committing, and reconcile after.
--
-- SECURITY: costs/margins are owner-sensitive and the public.events row is
-- world-readable (guests browse events). So economics live in SEPARATE
-- admin-only tables  cost data never rides on the public event row.

--  per-event projection knobs + cost lines (admin-only) 
create table if not exists public.event_economics (
  event_id          uuid primary key references public.events(id) on delete cascade,
  capture_pct       numeric not null default 0.35,   -- share of attendance that buys
  items_per_guest   numeric not null default 1.2,    -- units per buying guest
  cogs_pct          numeric not null default 0.30,   -- blended COGS fallback when a line is un-costed
  labor_rate_cents  int     not null default 1800,   -- $/hr per crew member
  booth_cents       int     not null default 0,      -- vendor / space fee
  transport_cents   int     not null default 0,      -- fuel / getting the rig there
  permit_cents      int     not null default 0,      -- temp permit / insurance
  consumables_cents int     not null default 0,      -- cups / lids / ice / CO2
  updated_at        timestamptz not null default now()
);

alter table public.event_economics enable row level security;
-- admin/owner only (servers must NOT see margins)
drop policy if exists "evecon admin all" on public.event_economics;
create policy "evecon admin all" on public.event_economics
  for all using (is_admin()) with check (is_admin());

--  product economics catalog: representative price + unit cost per menu
--    line (admin-edited, "layered" model). null unit cost  blended fallback.
create table if not exists public.product_economics (
  product_key      text primary key,   -- nitro | nature_aid | salted_maple | bottles | broth
  label            text not null,
  price_cents      int  not null default 0,
  unit_cost_cents  int,                 -- null = fall back to event cogs_pct
  active           boolean not null default true,
  sort             int not null default 0,
  updated_at       timestamptz not null default now()
);

alter table public.product_economics enable row level security;
drop policy if exists "prodecon admin all" on public.product_economics;
create policy "prodecon admin all" on public.product_economics
  for all using (is_admin()) with check (is_admin());

-- representative seed (price + ~30% cost)  owner tunes to real numbers.
insert into public.product_economics (product_key, label, price_cents, unit_cost_cents, sort) values
  ('nitro',        'Nitro cold brew', 700, 210, 1),
  ('nature_aid',   'Nature Aid',      800, 250, 2),
  ('salted_maple', 'Salted Maple',    750, 235, 3),
  ('bottles',      'Bottles',        1200, 430, 4),
  ('broth',        'Broth',           900, 300, 5)
on conflict (product_key) do nothing;

-- keep updated_at honest
create or replace function public.touch_updated_at() returns trigger
  language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists trg_evecon_touch on public.event_economics;
create trigger trg_evecon_touch before update on public.event_economics
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_prodecon_touch on public.product_economics;
create trigger trg_prodecon_touch before update on public.product_economics
  for each row execute function public.touch_updated_at();
