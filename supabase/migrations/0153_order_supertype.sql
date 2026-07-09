-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0153 · ORDER SUPERTYPE + TENANT COMPLETION  (Layer 1, order model cohesion)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Two gaps the audit named: (1) orders/drop_orders never got tenant_id, so they sit outside the
-- 0134 isolation model entirely; (2) five status vocabularies with no shared "show me all
-- unfulfilled orders today" query. Both fixed additively — no existing column renamed, no data
-- rewritten, no live crew screen's read path touched. The three per-table cancel RPCs (0118 cup,
-- 0136 pickup, 0139 delivery) are untouched internally; this adds ONE dispatcher in front of them
-- so a customer-facing surface has one call to make regardless of channel.
--
-- Deliberately NOT in this migration: making `orders` server-write-only. Checkout.tsx's pay-at-
-- pickup path inserts directly from the client (RLS-gated to unpaid rows only, 0016) and
-- /api/checkout has no server path for it today — dropping that RLS door would break a live
-- revenue path without a replacement route built + tested first. Tracked as a follow-up, not
-- rushed here.

-- ── 1. tenant_id completion — same pattern as 0134's initial loop, extended to the order tables
--       that predate it. Backfilled to the founding tenant so today's single-tenant behavior is
--       byte-identical; only matters the moment a second tenant exists. ────────────────────────
do $$
declare t text;
begin
  foreach t in array array['orders','drop_orders','reserve_claims','subscriptions'] loop
    if to_regclass('public.'||t) is not null then
      execute format('alter table public.%I add column if not exists tenant_id uuid references public.tenants(id) default %L', t, '00000000-0000-0000-0000-000000000001');
      execute format('update public.%I set tenant_id = %L where tenant_id is null', t, '00000000-0000-0000-0000-000000000001');
      execute format('create index if not exists %I on public.%I(tenant_id)', t||'_tenant_idx', t);
    end if;
  end loop;
end $$;

-- ── 2. re-run 0134's discovery loop — dynamic, so it picks up every table that now carries
--       tenant_id (orders, drop_orders, reserve_claims, subscriptions, customers from 0151, and
--       anything from 0139/0144 that was added after 0134 last ran). Idempotent: drop-then-create
--       on each table, so re-running changes nothing where it's already wired. ──────────────────
do $$
declare r record;
begin
  for r in
    select c.relname as tbl, c.relrowsecurity as rls_on
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'tenants'
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)
  loop
    execute format('drop trigger if exists stamp_tenant_tg on public.%I', r.tbl);
    execute format('create trigger stamp_tenant_tg before insert on public.%I for each row execute function public.stamp_tenant()', r.tbl);
    if r.rls_on then
      execute format('drop policy if exists "tenant isolation" on public.%I', r.tbl);
      execute format('create policy "tenant isolation" on public.%I as restrictive for all using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant())', r.tbl);
    end if;
  end loop;
end $$;

-- ── 3. the unified read: one fulfillment_status + one payment_status across the 3 real order
--       tables (cup / pickup pack / delivery). security_invoker so the CALLER's own RLS still
--       applies — a member sees only their rows, staff sees everyone's, exactly like querying the
--       underlying table directly. Purely additive: no existing column changes meaning. ─────────
create or replace view public.all_orders with (security_invoker = on) as
  select 'cup'::text as channel, id, customer_id, user_id, tenant_id,
    case status when 'void' then 'canceled' when 'done' then 'fulfilled' when 'new' then 'placed' else 'in_prep' end as fulfillment_status,
    case when paid then 'paid' else 'pending' end as payment_status,
    total_cents, created_at
  from public.orders
  union all
  select 'pickup', id, customer_id, user_id, tenant_id,
    case when canceled_at is not null then 'canceled' when picked_up then 'fulfilled' else 'placed' end,
    case when paid then 'paid' else 'pending' end,
    total_cents, created_at
  from public.drop_orders
  union all
  select 'delivery', id, customer_id, user_id, tenant_id,
    case
      when canceled_at is not null then 'canceled'
      when status = 'delivered' then 'fulfilled'
      when status = 'received' then 'placed'
      else 'in_prep'  -- brewed / out_for_delivery / held_for_pickup / issue
    end,
    case payment_status when 'paid' then 'paid' when 'refunded' then 'refunded' when 'failed' then 'failed' else 'pending' end,
    total_cents, created_at
  from public.delivery_orders;

-- ── 4. one client-facing cancel dispatcher — the 3 real per-table cancel functions (0118, 0136,
--       0139) keep their own tested logic unchanged; this just gives every customer-facing surface
--       ONE call to make regardless of channel, instead of memorizing 3 different RPC names. ─────
create or replace function public.cancel_any_order(p_channel text, p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  case p_channel
    when 'cup'      then return public.cancel_own_order(p_id);
    when 'pickup'   then return public.cancel_own_reservation(p_id);
    when 'delivery' then return public.cancel_own_delivery(p_id);
    else return false;
  end case;
end $$;
revoke all on function public.cancel_any_order(text, uuid) from public, anon;
grant execute on function public.cancel_any_order(text, uuid) to authenticated;

-- verify:
--   select column_name from information_schema.columns where table_name='orders' and column_name='tenant_id';        -- 1 row
--   select column_name from information_schema.columns where table_name='drop_orders' and column_name='tenant_id';   -- 1 row
--   select polrelid::regclass from pg_policy where polname = 'tenant isolation' order by 1;   -- includes orders, drop_orders
--   select channel, fulfillment_status, count(*) from public.all_orders group by 1,2 order by 1,2;
--   select proname from pg_proc where proname = 'cancel_any_order';  -- 1 row
