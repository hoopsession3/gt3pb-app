-- 0275 — MARKET SPINE (additive, non-breaking). Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- Adds the one concept three separate audits each found missing independently: a MARKET.
--
-- WHY NOT A TENANT. A tenant (0040 spine, 0134 enforcement) is a different BUSINESS on the platform,
-- and 0134 enforces it with a RESTRICTIVE RLS policy — tenant A physically cannot read tenant B.
-- That isolation is the opposite of what a second city of the SAME business needs: Atlanta's numbers
-- must be tellable apart from Greenville's AND still roll up into one company total. Adding a second
-- tenant row would also activate the service-role routes that bypass RLS without scoping, which are
-- harmless today only because exactly one tenant exists. A market is a segment INSIDE one tenant.
--
-- ZERO-REGRESSION CONTRACT
--   * Every column added is NOT NULL DEFAULT 'greenville'. Postgres applies that default without a
--     table rewrite, and it makes every pre-existing row mean exactly what it already means.
--   * Nothing is dropped. No RLS policy is changed. No existing constraint is narrowed.
--   * The only constraint touched is kpi_snapshots' unique key, which is WIDENED from
--     (metric, period) to (metric, period, market). Every existing row stays unique under the wider
--     key, so the add cannot fail on existing data.
--   * No application code requires these columns, so this migration is safe to run BEFORE or AFTER
--     the accompanying deploy, in either order, with no window where the app is broken.
--
-- verify at the bottom.

-- ── 1. The market registry ────────────────────────────────────────────────────────────────────────
create table if not exists public.markets (
  slug        text primary key,
  name        text not null,
  region      text,
  timezone    text not null default 'America/New_York',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

insert into public.markets (slug, name, region) values
  ('greenville', 'Greenville', 'Greenville, SC'),
  ('atlanta',    'Atlanta',    'Atlanta, GA')
on conflict (slug) do nothing;

alter table public.markets enable row level security;
drop policy if exists "markets staff read" on public.markets;
create policy "markets staff read" on public.markets
  for select using ((select public.is_staff()));

-- ── 2. Stamp market onto everything that carries city-specific meaning ────────────────────────────
-- Guarded with to_regclass so this runs safely whichever optional migrations a given project has
-- applied — the same idiom 0040 and 0134 use.
do $$
declare
  t text;
  tables text[] := array[
    -- field operations (what a customer sees on the road)
    'field_ops','stops','events',
    -- strategy + rollup (so a market goal can be told apart from a company goal)
    'goals','initiatives','os_workstreams','kpi_snapshots',
    -- pipeline + corporate delivery (Atlanta's actual book of work)
    'vendors','opportunities','proposals','business_accounts','business_orders','account_activities',
    -- inbound demand
    'booking_requests'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.'||t) is not null then
      execute format(
        'alter table public.%I add column if not exists market text not null default %L', t, 'greenville');
      execute format(
        'create index if not exists %I on public.%I(market)', t||'_market_idx', t);
    end if;
  end loop;
end $$;

-- ── 3. Let two markets hold the same KPI for the same period ──────────────────────────────────────
-- kpi_snapshots is keyed unique(metric, period), which makes per-market KPIs structurally impossible:
-- Greenville and Atlanta cannot both store an 'mrr' row for 2026-09. Widen the key. Existing rows all
-- carry 'greenville', so they remain unique under the wider key and this cannot fail on live data.
do $$
declare
  c record;
begin
  if to_regclass('public.kpi_snapshots') is null then return; end if;

  -- Drop whichever unique constraint currently covers exactly (metric, period), whatever it's named.
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'kpi_snapshots'
      and con.contype = 'u'
      and (
        select array_agg(att.attname order by att.attname)
        from unnest(con.conkey) k
        join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k
      ) = array['metric','period']
  loop
    execute format('alter table public.kpi_snapshots drop constraint %I', c.conname);
  end loop;

  -- Add the widened key (no-op when it already exists).
  if not exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'kpi_snapshots'
      and con.conname = 'kpi_snapshots_metric_period_market_key'
  ) then
    alter table public.kpi_snapshots
      add constraint kpi_snapshots_metric_period_market_key unique (metric, period, market);
  end if;
end $$;

-- ── the record (no-drift gate) ───────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A second city is now a first-class idea, not a workaround','ops','Ops',
   'Every operating record — stops, routes, goals, gear, money, targets — now knows which market it belongs to, and Atlanta is registered alongside Greenville. Nothing changed for Greenville: every record that already existed reads as Greenville and every screen behaves exactly as before. What this buys is the ability to run a second market inside the same business, on the same books, without standing up a second copy of anything. The market-aware screens follow on top of this.',
   '2026-09-06', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- ── verify (run after) ────────────────────────────────────────────────────────────────────────────
--   -- both markets registered:
--   select slug, name, region, active from public.markets order by slug;
--
--   -- every table that took the column, and that nothing is null:
--   select c.relname,
--          (select count(*) from pg_attribute a
--            where a.attrelid = c.oid and a.attname = 'market' and not a.attisdropped) as has_market
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'public' and c.relkind = 'r'
--     and exists (select 1 from pg_attribute a
--                  where a.attrelid = c.oid and a.attname = 'market' and not a.attisdropped)
--   order by 1;
--
--   -- the KPI key is now three columns:
--   select conname from pg_constraint con join pg_class rel on rel.oid = con.conrelid
--   where rel.relname = 'kpi_snapshots' and con.contype = 'u';
--
--   -- regression check — every pre-existing row still reads as Greenville:
--   select market, count(*) from public.field_ops group by 1;
--   select market, count(*) from public.goals group by 1;
