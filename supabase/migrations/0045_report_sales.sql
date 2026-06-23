-- 0045 — report_sales(): one staff-gated RPC that returns the sales-actuals dashboard as JSON.
-- Reads real orders + the Square per-event mirror (event_sales); margin uses the blended COGS %
-- from event_economics (same assumption the projection panel already uses). Paste → Run. Idempotent.

create or replace function public.report_sales(p_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare since timestamptz := now() - (greatest(p_days, 1) || ' days')::interval;
begin
  if not public.is_staff() then return jsonb_build_object('error', 'unauthorized'); end if;
  return jsonb_build_object(
    'days', p_days,
    'revenue_cents', coalesce((select sum(total_cents) from orders where status <> 'void' and created_at >= since), 0),
    'order_count', (select count(*) from orders where status <> 'void' and created_at >= since),
    'cogs_pct', coalesce((select round(avg(cogs_pct), 3) from event_economics), 0.30),
    -- product mix: count + apportioned revenue per menu line
    'by_product', coalesce((select jsonb_agg(jsonb_build_object('key', item, 'n', n, 'cents', cents) order by n desc) from (
        select unnest(items) item, count(*) n,
               sum(total_cents / greatest(coalesce(array_length(items, 1), 1), 1)) cents
        from orders where status <> 'void' and created_at >= since group by 1
      ) p), '[]'::jsonb),
    -- per-event actuals from the Square mirror
    'by_event', coalesce((select jsonb_agg(jsonb_build_object('event', coalesce(e.title, '(unlinked)'), 'cents', s.cents, 'orders', s.n) order by s.cents desc) from (
        select event_id, sum(amount_cents) cents, sum(item_count) n from event_sales where created_at >= since group by 1
      ) s left join events e on e.id = s.event_id), '[]'::jsonb),
    -- gap-filled daily revenue trend
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', to_char(d, 'MM-DD'), 'cents', coalesce(c, 0)) order by d) from (
        select g::date d, (select sum(total_cents) from orders o where o.status <> 'void' and o.created_at::date = g::date) c
        from generate_series(since::date, now()::date, interval '1 day') g
      ) dd), '[]'::jsonb)
  );
end; $$;

grant execute on function public.report_sales(int) to authenticated;
