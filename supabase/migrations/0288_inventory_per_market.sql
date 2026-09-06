-- 0288 — TWO CITIES, TWO SHELVES. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- The other half of the supply question, and the half that is a straightforward bug.
--
-- inventory_items and inventory_ledger carry a tenant but not a market. on-hand is summed by item
-- NAME across everything. So the moment Atlanta stocks a case of Mountain Valley, Greenville's
-- on-hand for that item goes up by a case — of water sitting 150 miles away. The reorder trigger
-- reads that combined number, decides Greenville is fine, and does not fire. The first time anyone
-- notices is when a truck arrives at a stop without water.
--
-- This is the same class of defect 0215 fixed for tenants, in the same three places: the catalog
-- lookup by name, the ledger sum, and — worst of the three — the alert dedup by title, where one
-- city's restock silently acknowledges the other city's low-stock alert. 0215's own header called
-- that out as the worst part. It is worth fixing before there is a second city, not after.
--
-- ZERO REGRESSION, three ways:
--   * both columns land NOT NULL DEFAULT 'greenville', so every existing row is Greenville and every
--     existing sum returns the number it returns today
--   * the views keep their column names and add one, so a select of named columns is unaffected
--   * the alert TITLE is unchanged for the founding market and only gains a suffix for others —
--     which means the open Greenville reorder alerts sitting in the inbox right now still match,
--     still dedup, and still clear on restock
--
-- Apply after 0287.

-- ── 1. A shelf belongs to a city ─────────────────────────────────────────────────────────────────
alter table public.inventory_items  add column if not exists market text not null default 'greenville';
alter table public.inventory_ledger add column if not exists market text not null default 'greenville';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_items_market_fk') then
    alter table public.inventory_items add constraint inventory_items_market_fk
      foreign key (market) references public.markets(slug);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inventory_ledger_market_fk') then
    alter table public.inventory_ledger add constraint inventory_ledger_market_fk
      foreign key (market) references public.markets(slug);
  end if;
end $$;

create index if not exists inventory_items_market_idx  on public.inventory_items(market);
create index if not exists inventory_ledger_market_idx on public.inventory_ledger(item, market);

comment on column public.inventory_items.market is
  'Which city holds this stock. Two cities can carry an item of the same name and they are different shelves.';

-- ── 2. On-hand is per shelf ──────────────────────────────────────────────────────────────────────
-- DROP then create, not create-or-replace. Both views gain a column in the MIDDLE of their column
-- list — inventory_on_hand grows a market, and inventory_status expands i.* which now carries one
-- too — and create-or-replace can only append columns at the end. It fails with "cannot change name
-- of view column", which is what scripts/db.market.test.mjs reported before this was drops.
-- Order matters: inventory_status depends on inventory_on_hand, so it goes first and comes back last.
-- No cascade, deliberately: if some object nobody remembered depends on these, this should stop and
-- say so rather than quietly delete it.
drop view if exists public.inventory_status;
drop view if exists public.inventory_on_hand;

-- security_invoker preserved from 0090 so the view keeps honouring RLS.
create view public.inventory_on_hand with (security_invoker = on) as
  select item, market, sum(qty) as on_hand, max(created_at) as last_movement
  from public.inventory_ledger group by item, market;

-- The join gains the market. Without it a Greenville item would pick up an Atlanta balance — the
-- exact defect this file exists to close.
create view public.inventory_status with (security_invoker = on) as
  select i.*,
    coalesce(oh.on_hand, i.qty)        as effective_on_hand,
    oh.last_movement,
    (i.reorder_point is not null
       and coalesce(oh.on_hand, i.qty) is not null
       and coalesce(oh.on_hand, i.qty) <= i.reorder_point) as needs_reorder
  from public.inventory_items i
  left join public.inventory_on_hand oh
         on oh.item = i.name and oh.market = i.market;
grant select on public.inventory_status to authenticated;

-- ── 3. The reorder trigger stops mixing cities ───────────────────────────────────────────────────
-- Rewritten from 0215's live body. Every tenant filter 0215 added is preserved exactly; each one
-- gains a market filter beside it. The alert title keeps its existing form for Greenville so the
-- alerts already open in the inbox continue to match, dedup and clear.
create or replace function public.inventory_reorder_alert() returns trigger
  language plpgsql security definer set search_path = public as $$
declare it public.inventory_items; oh numeric; ttl text;
begin
  select * into it from public.inventory_items
   where name = new.item and tenant_id = new.tenant_id and market = new.market limit 1;
  if not found or it.reorder_point is null then return new; end if;

  select coalesce(sum(qty), 0) into oh from public.inventory_ledger
   where item = new.item and tenant_id = new.tenant_id and market = new.market;

  -- Unchanged for the founding market; suffixed for any other, so two cities cannot share one alert.
  ttl := '📦 Reorder — ' || it.name
         || case when it.market <> 'greenville' then ' (' || it.market || ')' else '' end;

  if oh <= it.reorder_point then
    if not exists (select 1 from public.alerts
                     where ack_at is null and category = 'prep' and tenant_id = it.tenant_id and title = ttl) then
      insert into public.alerts (severity, category, title, body, link, target_user_id, tenant_id)
      values (case when oh <= 0 then 'critical' else 'important' end,
              'prep', ttl,
              it.name || ' is down to ' || oh::text || coalesce(' ' || it.unit, '') ||
                ' (reorder at ' || it.reorder_point::text || ').' ||
                case when it.reorder_link is not null then ' Reorder link is on the item.' else '' end,
              '/admin', null, it.tenant_id);
    end if;
  else
    update public.alerts set ack_at = now(), ack_by = new.created_by
      where ack_at is null and category = 'prep' and tenant_id = it.tenant_id and title = ttl;
  end if;
  return new;
end $$;

-- ── the record (no-drift gate) ───────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Stock counts are per city now','fix','Prep',
   'Inventory was counted by item name across the whole company, so a case of water stocked in one city would have counted toward the other city''s on-hand and quietly stopped its low-stock warning from firing. Worse, a restock in one city could have cleared the other city''s reorder alert. Each city now keeps its own count and its own alerts. Greenville''s numbers and its open alerts are unchanged.',
   '2026-09-06', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- ── verify (run after) ────────────────────────────────────────────────────────────────────────────
--   -- everything landed in the founding market (expect: one row, greenville):
--   select market, count(*) from public.inventory_items group by 1;
--
--   -- the trigger scopes to market as well as tenant (expect: true):
--   select prosrc like '%market = new.market%' as scoped from pg_proc where proname = 'inventory_reorder_alert';
--
--   -- and on-hand still returns the same numbers it did before:
--   select count(*) from public.inventory_status where needs_reorder;
