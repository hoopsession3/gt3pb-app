-- 0231 — real order LINE ITEMS. orders.items is a text[] of drink slugs, so every per-product
-- report guesses: report_sales splits a ticket's revenue EQUALLY across its items — a $14 latte +
-- $4 water reads as two $9 items. The product-mix numbers are wrong today (audit #3).
--
-- Canonical fix: an order_items relation, exploded FROM orders.items by trigger — server-side, so
-- every writer of orders (checkout paid/unpaid paths, retries, future ones) gets correct lines with
-- zero app-code changes, and the backfill is the same math. Price is snapshotted from products at
-- write time (menu edits later can't rewrite history). Items missing from products (the Square
-- catalog-gap case) get estimated=true with a null price — reporting can treat them honestly instead
-- of silently averaging. orders.items stays (compat: UI, existing readers).

create table if not exists public.order_items (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  order_id         uuid not null references public.orders(id) on delete cascade,
  slug             text not null,
  name             text,
  qty              int  not null default 1 check (qty > 0),
  unit_price_cents int,                                -- snapshot at write; null when unknown
  estimated        boolean not null default false,     -- true = price unknown at write (catalog gap)
  created_at       timestamptz not null default now()
);
create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists order_items_slug_idx  on public.order_items (slug);

alter table public.order_items enable row level security;
drop policy if exists "order items staff read" on public.order_items;
create policy "order items staff read" on public.order_items for select using ((select public.is_staff()));
drop policy if exists "tenant isolation" on public.order_items;
create policy "tenant isolation" on public.order_items as restrictive
  for all using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
grant select on public.order_items to authenticated;   -- writes only via the trigger (definer)

-- ── the exploder — delete + reinsert per order, so it is idempotent and edit-safe ─────────────────
create or replace function public.explode_order_items() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.order_items where order_id = new.id;
  insert into public.order_items (order_id, slug, name, qty, unit_price_cents, estimated)
  select new.id, i.slug, p.name, count(*)::int, p.price_cents, (p.id is null)
  from unnest(new.items) as i(slug)
  left join public.products p on p.slug = i.slug
  group by i.slug, p.id, p.name, p.price_cents;
  return new;
end $$;
drop trigger if exists trg_explode_order_items on public.orders;
create trigger trg_explode_order_items after insert or update of items on public.orders
  for each row execute function public.explode_order_items();

-- ── backfill every existing order through the same math ───────────────────────────────────────────
insert into public.order_items (order_id, slug, name, qty, unit_price_cents, estimated)
select o.id, i.slug, p.name, count(*)::int, p.price_cents, (p.id is null)
from public.orders o
cross join unnest(o.items) as i(slug)
left join public.products p on p.slug = i.slug
where not exists (select 1 from public.order_items oi where oi.order_id = o.id)
group by o.id, i.slug, p.id, p.name, p.price_cents;

-- ── the honest mix report ─────────────────────────────────────────────────────────────────────────
-- Covers PAID app cup orders (walk-up POS sales carry no line items — they live in event_sales as
-- totals). revenue_cents sums the snapshotted prices; has_estimates=true flags any slug whose rows
-- include unknown-price lines, so the reader knows which numbers are floors, not truth.
create or replace function public.report_product_mix(p_days int default 30)
returns table (slug text, name text, qty bigint, revenue_cents bigint, has_estimates boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  return query
  select oi.slug, max(coalesce(oi.name, oi.slug)) as name,
         sum(oi.qty)::bigint as qty,
         (sum(coalesce(oi.unit_price_cents, 0)::bigint * oi.qty))::bigint as revenue_cents,
         bool_or(oi.estimated) as has_estimates
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.paid = true
    and oi.tenant_id = public.effective_tenant()
    and o.created_at >= now() - make_interval(days => greatest(p_days, 1))
  group by oi.slug
  order by revenue_cents desc, qty desc;
end $$;
grant execute on function public.report_product_mix(int) to authenticated;

-- verify:
--   select count(*) from order_items;                                        -- > 0 (backfilled)
--   select o.id from orders o where coalesce(array_length(o.items,1),0) <> (select coalesce(sum(oi.qty),0) from order_items oi where oi.order_id = o.id);  -- 0 rows
--   select * from report_product_mix(365);
