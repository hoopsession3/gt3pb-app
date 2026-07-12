-- 0197 — Money truth (audit P2, per owner decisions): Square = book of record, blended catalog COGS,
-- ledger↔catalog link. Three coupled changes:
--   1. catalog_cogs_pct() — the real blended cost % from the product BOM (product_components ×
--      inventory_items.unit_cost, in dollars → ×100 to cents), replacing the flat 30% guess.
--   2. report_sales(): revenue is now SQUARE (event_sales) as the book of record PLUS app orders that
--      were placed OFF a live event (event_id is null) — so on-event app orders aren't double-counted
--      with Square, and the online/order-ahead channel still adds in. COGS % uses catalog_cogs_pct().
--   3. report_events(): the per-event COGS fallback is the blended catalog % (an event's own
--      event_economics.cogs_pct still overrides). And inventory_ledger gets a real FK to the item
--      catalog (was joined by a text label) so brew consumption can key to the item, not a string.

-- 1 ── blended catalog COGS % ─────────────────────────────────────────────────────────────────────
create or replace function public.catalog_cogs_pct() returns numeric
  language sql stable security definer set search_path = public as $$
  with per_product as (
    select p.id, p.price_cents,
      sum(coalesce(ii.unit_cost, 0) * coalesce(pc.qty_per_serving, 0) * 100) as cost_cents
    from products p
    join product_components pc on pc.product_id = p.id
    join inventory_items ii on ii.id = pc.inventory_item_id
    where p.price_cents > 0
    group by p.id, p.price_cents
  )
  select coalesce(round(sum(cost_cents) / nullif(sum(price_cents), 0), 3), 0.30) from per_product;
$$;
grant execute on function public.catalog_cogs_pct() to authenticated;

-- 2 ── report_sales: Square-authoritative revenue + blended COGS ───────────────────────────────────
create or replace function public.report_sales(p_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare since timestamptz := now() - (greatest(p_days, 1) || ' days')::interval;
begin
  if not public.is_staff() then return jsonb_build_object('error', 'unauthorized'); end if;
  return jsonb_build_object(
    'days', p_days,
    'revenue_basis', 'square_plus_offevent',
    -- BOOK OF RECORD: Square per-event mirror, PLUS app orders placed off a live event (not already
    -- captured by Square). On-event app orders (event_id set) are assumed rung through Square → not added.
    'revenue_cents',
      coalesce((select sum(amount_cents) from event_sales where created_at >= since), 0)
      + coalesce((select sum(total_cents) from orders where status <> 'void' and event_id is null and created_at >= since), 0),
    'order_count', (select count(*) from orders where status <> 'void' and created_at >= since),
    'cogs_pct', public.catalog_cogs_pct(),
    'by_product', coalesce((select jsonb_agg(jsonb_build_object('key', item, 'n', n, 'cents', cents) order by n desc) from (
        select unnest(items) item, count(*) n,
               sum(total_cents / greatest(coalesce(array_length(items, 1), 1), 1)) cents
        from orders where status <> 'void' and created_at >= since group by 1
      ) p), '[]'::jsonb),
    'by_event', coalesce((select jsonb_agg(jsonb_build_object('event', coalesce(e.title, '(unlinked)'), 'cents', s.cents, 'orders', s.n) order by s.cents desc) from (
        select event_id, sum(amount_cents) cents, sum(item_count) n from event_sales where created_at >= since group by 1
      ) s left join events e on e.id = s.event_id), '[]'::jsonb),
    -- daily trend on the same reconciled basis (Square + off-event app orders)
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', to_char(d, 'MM-DD'), 'cents', coalesce(c, 0)) order by d) from (
        select g::date d,
          (select coalesce(sum(amount_cents), 0) from event_sales es where es.created_at::date = g::date)
          + (select coalesce(sum(total_cents), 0) from orders o where o.status <> 'void' and o.event_id is null and o.created_at::date = g::date) c
        from generate_series(since::date, now()::date, interval '1 day') g
      ) dd), '[]'::jsonb)
  );
end; $$;
grant execute on function public.report_sales(int) to authenticated;

-- 3a ── report_events: blended catalog % as the COGS fallback (event's own % still wins) ────────────
create or replace function public.report_events()
returns jsonb language plpgsql security definer set search_path = public as $$
declare blended numeric := public.catalog_cogs_pct();
begin
  if not public.is_staff() then return jsonb_build_object('error', 'unauthorized'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id,
      'event', e.title,
      'actual_cents', coalesce(s.cents, 0),
      'orders', coalesce(s.n, 0),
      'cogs_pct', coalesce(ec.cogs_pct, blended),
      'fixed_cents', coalesce(ec.booth_cents,0) + coalesce(ec.transport_cents,0) + coalesce(ec.permit_cents,0) + coalesce(ec.consumables_cents,0),
      'margin_cents', round(coalesce(s.cents,0) * (1 - coalesce(ec.cogs_pct, blended)))
                      - (coalesce(ec.booth_cents,0) + coalesce(ec.transport_cents,0) + coalesce(ec.permit_cents,0) + coalesce(ec.consumables_cents,0))
    ) order by coalesce(s.cents,0) desc, e.sort)
    from events e
    left join (select event_id, sum(amount_cents) cents, sum(item_count) n from event_sales group by event_id) s on s.event_id = e.id
    left join event_economics ec on ec.event_id = e.id
    where e.archived_at is null), '[]'::jsonb);
end; $$;
grant execute on function public.report_events() to authenticated;

-- 3b ── link the consumption ledger to the item catalog by real id (was a text label only) ──────────
alter table public.inventory_ledger add column if not exists inventory_item_id uuid references public.inventory_items(id) on delete set null;
create index if not exists inventory_ledger_item_id_idx on public.inventory_ledger(inventory_item_id);

-- verify:
--   select public.catalog_cogs_pct();  -- a ratio 0..1
--   select (public.report_sales(30) ->> 'revenue_basis');  -- square_plus_offevent
--   select column_name from information_schema.columns where table_name='inventory_ledger' and column_name='inventory_item_id'; -- 1 row
