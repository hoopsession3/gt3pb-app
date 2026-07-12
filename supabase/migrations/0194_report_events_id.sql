-- 0194 — report_events returns the event id (audit P2 · reports were read-only dead-ends)
-- The per-event P&L rows named the event but carried no id, so you couldn't jump from a P&L row back
-- to the event to edit it. Adding 'id' is purely additive — no math changes — and lets the UI link
-- each row to its source. (Same function body as 0048, plus the id field.)
create or replace function public.report_events()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then return jsonb_build_object('error', 'unauthorized'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id,
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
grant execute on function public.report_events() to authenticated;
