-- 0216 — Tenant-scope the SECURITY DEFINER money family + ONE revenue definition.
-- Two jobs, done together because they rewrite the same functions:
--
-- (1) TENANT SCOPING. These functions run SECURITY DEFINER (bypass RLS) and were tenant-blind —
--     safe single-tenant, wrong the moment a second tenant exists. Every aggregate now filters by
--     public.effective_tenant() (which falls back to the founding tenant when there's no JWT, so
--     cron/service contexts keep working single-tenant).
--
-- (2) THE REVENUE BASIS (the reconciled truth, one definition everywhere):
--       revenue = every PAID app order, once, from its own table (orders + drop_orders +
--                 delivery_orders + business_orders — paid, not void/canceled)
--               + Square WALK-UPS: event_sales rows whose square_payment_id matches NO app order's
--                 payment_id (the app charges through Square too, and the webhook mirrors EVERY
--                 completed payment into event_sales — summing both raw would double-count; the
--                 pre-prod review panel caught exactly that).
--     Known gap, documented: office text-to-pay payments aren't id-linked yet, so a paid office
--     order's Square mirror still counts as a "walk-up" until office stores its payment id (office
--     volume ≈ 0 at launch). App-order tips live in Square only (goods revenue here).
--     report_sales, founder_digest_alert, and the on-demand digest route all compute THIS number.
--     MoneyKpis reads report_sales instead of re-summing client-side.
-- Idempotent (create or replace); shapes are supersets of the old ones.

-- delivery charges produce a Square payment id that was never stored — needed for the walk-up dedupe.
alter table public.delivery_orders add column if not exists payment_id text;

-- ── 1. blended catalog COGS, per tenant ─────────────────────────────────────────────────────────
create or replace function public.catalog_cogs_pct() returns numeric
  language sql stable security definer set search_path = public as $$
  with per_product as (
    select p.id, p.price_cents,
      sum(coalesce(ii.unit_cost, 0) * coalesce(pc.qty_per_serving, 0) * 100) as cost_cents
    from products p
    join product_components pc on pc.product_id = p.id
    join inventory_items ii on ii.id = pc.inventory_item_id
    where p.price_cents > 0
      and p.tenant_id  = public.effective_tenant()
      and ii.tenant_id = public.effective_tenant()
    group by p.id, p.price_cents
  )
  select coalesce(round(sum(cost_cents) / nullif(sum(price_cents), 0), 3), 0.30) from per_product;
$$;
grant execute on function public.catalog_cogs_pct() to authenticated;

-- ── 2. report_sales — the reconciled revenue, tenant-scoped, with a channel breakdown ───────────
create or replace function public.report_sales(p_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  since timestamptz := (current_date - (greatest(p_days, 1) - 1))::timestamptz;   -- day-aligned so by_day ties to revenue_cents
  tid uuid := public.effective_tenant();
  sq bigint; cup bigint; packs bigint; deliv bigint; office bigint;
begin
  if not public.is_staff() then return jsonb_build_object('error', 'unauthorized'); end if;
  -- walk-ups only: Square payments that are NOT a mirror of an app order (payment-id dedupe)
  sq     := coalesce((select sum(es.amount_cents) from event_sales es
              where es.created_at >= since and es.tenant_id = tid
                and not exists (select 1 from orders o where o.payment_id = es.square_payment_id)
                and not exists (select 1 from drop_orders d where d.payment_id = es.square_payment_id)
                and not exists (select 1 from delivery_orders dv where dv.payment_id = es.square_payment_id)), 0);
  cup    := coalesce((select sum(total_cents) from orders where paid and status <> 'void' and created_at >= since and tenant_id = tid), 0);
  packs  := coalesce((select sum(total_cents) from drop_orders where paid and canceled_at is null and created_at >= since and tenant_id = tid), 0);
  deliv  := coalesce((select sum(total_cents) from delivery_orders where payment_status = 'paid' and canceled_at is null and created_at >= since and tenant_id = tid), 0);
  office := coalesce((select sum(total_cents) from business_orders where payment_status = 'paid' and canceled_at is null and created_at >= since and tenant_id = tid), 0);
  return jsonb_build_object(
    'days', p_days,
    'revenue_basis', 'reconciled',      -- every paid app order once + Square walk-ups (payment-id deduped)
    'revenue_cents', sq + cup + packs + deliv + office,
    'by_channel', jsonb_build_object('square_walkup', sq, 'cup', cup, 'packs', packs, 'delivery', deliv, 'office', office),
    'order_count', (select count(*) from orders where paid and status <> 'void' and created_at >= since and tenant_id = tid),
    'cogs_pct', public.catalog_cogs_pct(),
    'by_product', coalesce((select jsonb_agg(jsonb_build_object('key', item, 'n', n, 'cents', cents) order by n desc) from (
        select unnest(items) item, count(*) n,
               sum(total_cents / greatest(coalesce(array_length(items, 1), 1), 1)) cents
        from orders where paid and status <> 'void' and created_at >= since and tenant_id = tid group by 1
      ) p), '[]'::jsonb),
    'by_event', coalesce((select jsonb_agg(jsonb_build_object('event', coalesce(e.title, '(unlinked)'), 'cents', s.cents, 'orders', s.n) order by s.cents desc) from (
        select event_id, sum(amount_cents) cents, sum(item_count) n from event_sales where created_at >= since and tenant_id = tid group by 1
      ) s left join events e on e.id = s.event_id), '[]'::jsonb),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', to_char(d, 'MM-DD'), 'cents', coalesce(c, 0)) order by d) from (
        select g::date d,
          (select coalesce(sum(es.amount_cents), 0) from event_sales es where es.created_at::date = g::date and es.tenant_id = tid
             and not exists (select 1 from orders o where o.payment_id = es.square_payment_id)
             and not exists (select 1 from drop_orders dd2 where dd2.payment_id = es.square_payment_id)
             and not exists (select 1 from delivery_orders dv where dv.payment_id = es.square_payment_id))
          + (select coalesce(sum(total_cents), 0) from orders o where o.paid and o.status <> 'void' and o.created_at::date = g::date and o.tenant_id = tid)
          + (select coalesce(sum(total_cents), 0) from drop_orders where paid and canceled_at is null and created_at::date = g::date and tenant_id = tid)
          + (select coalesce(sum(total_cents), 0) from delivery_orders where payment_status = 'paid' and canceled_at is null and created_at::date = g::date and tenant_id = tid)
          + (select coalesce(sum(total_cents), 0) from business_orders where payment_status = 'paid' and canceled_at is null and created_at::date = g::date and tenant_id = tid) c
        from generate_series(since::date, current_date, interval '1 day') g
      ) dd), '[]'::jsonb)
  );
end; $$;
grant execute on function public.report_sales(int) to authenticated;

-- ── 3. report_events — per-event P&L, tenant-scoped ─────────────────────────────────────────────
create or replace function public.report_events()
returns jsonb language plpgsql security definer set search_path = public as $$
declare blended numeric := public.catalog_cogs_pct(); tid uuid := public.effective_tenant();
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
    left join (select event_id, sum(amount_cents) cents, sum(item_count) n from event_sales where tenant_id = tid group by event_id) s on s.event_id = e.id
    left join event_economics ec on ec.event_id = e.id
    where e.archived_at is null and e.tenant_id = tid), '[]'::jsonb);
end; $$;
grant execute on function public.report_events() to authenticated;

-- ── 4. report_spend — tenant-scoped ─────────────────────────────────────────────────────────────
create or replace function public.report_spend(p_month date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare mstart date := date_trunc('month', p_month)::date; mend date := (date_trunc('month', p_month) + interval '1 month')::date;
        tid uuid := public.effective_tenant();
begin
  if not public.is_staff() then return jsonb_build_object('error', 'unauthorized'); end if;
  return jsonb_build_object(
    'month', to_char(mstart, 'YYYY-MM'),
    'total_spent_cents',  coalesce((select sum(amount_cents) from expenses where spent_on >= mstart and spent_on < mend and tenant_id = tid), 0),
    'total_budget_cents', coalesce((select sum(monthly_limit_cents) from budgets where tenant_id = tid), 0),
    'by_category', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category', c.category,
        'budget_cents', coalesce(b.monthly_limit_cents, 0),
        'spent_cents',  coalesce(s.spent, 0)
      ) order by coalesce(s.spent, 0) desc, c.category)
      from (select distinct category from (
              select category from budgets where tenant_id = tid
              union all
              select category from expenses where tenant_id = tid) u) c
      left join budgets b on b.category = c.category and b.tenant_id = tid
      left join (select category, sum(amount_cents) spent from expenses where spent_on >= mstart and spent_on < mend and tenant_id = tid group by category) s on s.category = c.category
    ), '[]'::jsonb)
  );
end; $$;
grant execute on function public.report_spend(date) to authenticated;

-- ── 5. founder digest — one digest PER TENANT, reconciled basis, real money formatting ──────────
create or replace function public.founder_digest_alert() returns void
  language plpgsql security definer set search_path = public as $$
declare
  cadence text; t record; rev bigint; blockers int; reorders int; crit int;
  rdy_blocked int; rdy_total int; verdict text; msg text;
begin
  select digest_cadence into cadence from public.live_status where id = 1;
  if cadence is null or cadence = 'off' then return; end if;
  if cadence = 'weekly' and extract(dow from now()) <> 1 then return; end if;

  for t in select id from public.tenants loop
    -- the reconciled basis (same as report_sales): every paid app order once + payment-id-deduped Square walk-ups
    select coalesce((select sum(es.amount_cents) from event_sales es
             where es.created_at >= (current_date - 6)::timestamptz and es.tenant_id = t.id
               and not exists (select 1 from orders o where o.payment_id = es.square_payment_id)
               and not exists (select 1 from drop_orders d where d.payment_id = es.square_payment_id)
               and not exists (select 1 from delivery_orders dv where dv.payment_id = es.square_payment_id)), 0)
         + coalesce((select sum(total_cents) from orders           where paid and status <> 'void' and created_at >= (current_date - 6)::timestamptz and tenant_id = t.id), 0)
         + coalesce((select sum(total_cents) from drop_orders      where paid and canceled_at is null and created_at >= (current_date - 6)::timestamptz and tenant_id = t.id), 0)
         + coalesce((select sum(total_cents) from delivery_orders  where payment_status = 'paid' and canceled_at is null and created_at >= (current_date - 6)::timestamptz and tenant_id = t.id), 0)
         + coalesce((select sum(total_cents) from business_orders  where payment_status = 'paid' and canceled_at is null and created_at >= (current_date - 6)::timestamptz and tenant_id = t.id), 0)
      into rev;

    select count(*) into blockers from public.incident_log where resolved = false and severity = 'blocker' and tenant_id = t.id;
    select count(*) into reorders from public.alerts where ack_at is null and category = 'prep' and title like '📦 Reorder%' and tenant_id = t.id;
    select count(*) into crit     from public.alerts where ack_at is null and severity = 'critical' and tenant_id = t.id;
    select count(*) filter (where critical and status = 'blocked'), count(*) filter (where critical)
      into rdy_blocked, rdy_total from public.readiness_checks where tenant_id = t.id;
    verdict := case when rdy_total = 0 then 'no criteria yet' when rdy_blocked > 0 then 'NO-GO' else 'on track' end;

    msg := 'Revenue 7d: $' || to_char(rev / 100.0, 'FM999,999,990.00')
        || '  ·  Launch: ' || verdict || case when rdy_blocked > 0 then ' (' || rdy_blocked::text || ' blocked)' else '' end
        || '  ·  Blockers: ' || blockers::text
        || '  ·  Reorders: ' || reorders::text
        || '  ·  Needs you: ' || crit::text;

    insert into public.alerts (severity, category, title, body, link, target_user_id, tenant_id)
    values ('fyi', 'money', '📊 Daily founder digest', msg, '/admin', null, t.id);
  end loop;
end $$;

-- ── 6. resolve_customer — stamp + scope the identity spine ──────────────────────────────────────
alter table public.customers alter column tenant_id set default '00000000-0000-0000-0000-000000000001';
update public.customers set tenant_id = '00000000-0000-0000-0000-000000000001' where tenant_id is null;

create or replace function public.resolve_customer(p_user_id uuid, p_phone text, p_email text, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; norm_phone text; norm_email text; tid uuid := public.effective_tenant();
begin
  norm_phone := nullif(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), '');
  norm_email := nullif(lower(trim(coalesce(p_email,''))), '');

  if p_user_id is not null then
    select id into cid from public.customers where user_id = p_user_id limit 1;
  end if;
  if cid is null and norm_phone is not null then
    select id into cid from public.customers
      where regexp_replace(coalesce(phone,''), '\D', '', 'g') = norm_phone and tenant_id = tid
      order by (user_id is not null) desc, created_at asc limit 1;
  end if;
  if cid is null and norm_email is not null then
    select id into cid from public.customers
      where lower(email) = norm_email and tenant_id = tid
      order by (user_id is not null) desc, created_at asc limit 1;
  end if;

  if cid is null then
    insert into public.customers (user_id, name, phone, email, tenant_id)
      values (p_user_id, nullif(trim(coalesce(p_name,'')),''), p_phone, norm_email, tid)
      returning id into cid;
  else
    update public.customers set
      user_id    = coalesce(user_id, p_user_id),
      name       = coalesce(name, nullif(trim(coalesce(p_name,'')),'')),
      phone      = coalesce(phone, p_phone),
      email      = coalesce(email, norm_email),
      updated_at = now()
    where id = cid;
  end if;
  return cid;
end $$;
revoke execute on function public.resolve_customer(uuid, text, text, text) from anon, authenticated;
grant  execute on function public.resolve_customer(uuid, text, text, text) to service_role;

-- verify:
--   select proname from pg_proc p where proname in ('catalog_cogs_pct','report_sales','report_events','report_spend','founder_digest_alert','resolve_customer')
--     and prosrc like '%tenant%';                                                                   -- 6 rows
--   select (public.report_sales(7)->>'revenue_basis') = 'reconciled';                               -- run as staff: true
--   select count(*) from public.customers where tenant_id is null;                                  -- 0
