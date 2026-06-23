-- 0046 — report_snapshot(): staff-gated RPC for the non-time-series business metrics —
-- inventory value + low-stock, subscriber health, loyalty. Paste → Run. Idempotent.
-- inventory_items.unit_cost is in dollars; value is returned in CENTS (×100) so the client's
-- usd() helper renders it consistently.

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

grant execute on function public.report_snapshot() to authenticated;
