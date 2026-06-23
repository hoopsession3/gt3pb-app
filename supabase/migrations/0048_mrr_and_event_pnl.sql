-- 0048 — MRR (plan→price) + per-event P&L. Paste → Run. Idempotent.
-- subscriptions.plan is 'coffee_6' | 'coffee_12' | 'coffee_18'; price/period live in an
-- editable subscription_plans table so the owner owns the numbers. report_snapshot gains
-- mrr_cents; report_events() is the per-event plan-vs-actual scaffold.

create table if not exists public.subscription_plans (
  key         text primary key,
  label       text not null,
  price_cents int not null default 0,
  period_days int not null default 14,
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);
alter table public.subscription_plans enable row level security;
drop policy if exists "sub_plans staff read"  on public.subscription_plans;
create policy "sub_plans staff read"  on public.subscription_plans for select using ((select public.is_staff()));
drop policy if exists "sub_plans staff write" on public.subscription_plans;
create policy "sub_plans staff write" on public.subscription_plans for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
insert into public.subscription_plans (key, label, price_cents, period_days) values
  ('coffee_6', '6-pack', 3600, 14), ('coffee_12', '12-pack', 6600, 14), ('coffee_18', '18-pack', 9000, 14)
on conflict (key) do nothing;

-- report_snapshot + mrr_cents (active subs × plan price normalized to a month: ×365/period/12)
create or replace function public.report_snapshot()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then return jsonb_build_object('error', 'unauthorized'); end if;
  return jsonb_build_object(
    'inventory', jsonb_build_object(
      'item_count', (select count(*) from inventory_items),
      'value_cents', coalesce((select round(sum(coalesce(qty,0) * coalesce(unit_cost,0)) * 100)
                                 from inventory_items where coalesce(status,'On Hand') not in ('Returned','Consumed')), 0),
      'low_stock', (select count(*) from inventory_items where qty is not null and reorder_point is not null and qty <= reorder_point),
      'by_category', coalesce((select jsonb_agg(jsonb_build_object('cat', coalesce(category,'Uncategorized'), 'value_cents', round(v * 100)) order by v desc) from (
          select category, sum(coalesce(qty,0) * coalesce(unit_cost,0)) v from inventory_items
          where coalesce(status,'On Hand') not in ('Returned','Consumed') group by category having sum(coalesce(qty,0) * coalesce(unit_cost,0)) > 0
        ) c), '[]'::jsonb)
    ),
    'subs', jsonb_build_object(
      'active',   (select count(*) from subscriptions where status = 'active'),
      'past_due', (select count(*) from subscriptions where status = 'past_due'),
      'paused',   (select count(*) from subscriptions where status = 'paused'),
      'total',    (select count(*) from subscriptions),
      'mrr_cents', coalesce((select round(sum(sp.price_cents * 365.0 / nullif(sp.period_days,0) / 12))
                               from subscriptions s join subscription_plans sp on sp.key = s.plan where s.status = 'active'), 0),
      'by_plan', coalesce((select jsonb_agg(jsonb_build_object('plan', plan, 'n', n) order by n desc) from (
          select plan, count(*) n from subscriptions where status = 'active' group by plan
        ) p), '[]'::jsonb)
    ),
    'loyalty', jsonb_build_object(
      'members',          (select count(*) from profiles),
      'points_out',       coalesce((select sum(points) from profiles), 0),
      'buyers',           (select count(distinct user_id) from orders where status <> 'void' and user_id is not null),
      'repeat_customers', (select count(*) from (
          select user_id from orders where status <> 'void' and user_id is not null group by user_id having count(*) > 1
        ) r)
    )
  );
end; $$;

-- per-event plan-vs-actual: actual revenue (Square mirror) vs the event_economics cost model.
create or replace function public.report_events()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then return jsonb_build_object('error', 'unauthorized'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'event', e.title,
      'actual_cents', coalesce(s.cents, 0),
      'orders', coalesce(s.n, 0),
      'cogs_pct', coalesce(ec.cogs_pct, 0.30),
      'fixed_cents', coalesce(ec.booth_cents,0) + coalesce(ec.transport_cents,0) + coalesce(ec.permit_cents,0) + coalesce(ec.consumables_cents,0),
      'margin_cents', round(coalesce(s.cents,0) * (1 - coalesce(ec.cogs_pct,0.30)))
                      - (coalesce(ec.booth_cents,0) + coalesce(ec.transport_cents,0) + coalesce(ec.permit_cents,0) + coalesce(ec.consumables_cents,0))
    ) order by coalesce(s.cents,0) desc, e.sort)
    from events e
    left join (select event_id, sum(amount_cents) cents, sum(item_count) n from event_sales group by event_id) s on s.event_id = e.id
    left join event_economics ec on ec.event_id = e.id
    where e.archived_at is null), '[]'::jsonb);
end; $$;

grant execute on function public.report_snapshot() to authenticated;
grant execute on function public.report_events() to authenticated;
