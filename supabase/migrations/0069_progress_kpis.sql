-- 0069 — PROGRESS KPIs: one function the owner-only Progress view calls to get live business numbers
-- in a single round-trip. Returns counts + sums only (no PII, no secrets). Revenue counts completed
-- ('done') orders to match the Money tab, plus any event cash sales. Inventory value is on-hand cost.
-- security definer so it can read across tables; the API route gates access to owners. Apply after 0068.

create or replace function public.progress_kpis()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'revenue_cents',         (select coalesce(sum(total_cents),0) from public.orders where status = 'done')
                           + (select coalesce(sum(amount_cents),0) from public.event_sales),
    'orders',                (select count(*) from public.orders where status = 'done')
                           + (select count(*) from public.event_sales),
    'members',               (select count(*) from public.profiles),
    'subscribers',           (select count(*) from public.subscriptions where status = 'active'),
    'events',                (select count(*) from public.events where archived_at is null),
    'events_upcoming',       (select count(*) from public.events where archived_at is null and day >= current_date),
    'inventory_value_cents', (select coalesce(round(sum(coalesce(total_cost, qty * unit_cost, 0)) * 100), 0)::bigint from public.inventory_items),
    'inventory_items',       (select count(*) from public.inventory_items),
    'products_live',         (select count(*) from public.products where active),
    'open_tasks',            (select count(*) from public.event_tasks where not done)
                           + (select count(*) from public.todos where not done),
    'notes',                 (select count(*) from public.meeting_notes),
    'content_pieces',        (select count(*) from public.content_items),
    'tables',                (select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE')
  );
$$;

revoke all on function public.progress_kpis() from public, anon;
grant execute on function public.progress_kpis() to authenticated, service_role;
