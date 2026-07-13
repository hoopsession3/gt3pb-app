-- 0205 — Inventory reorder truth. Two quantity systems had drifted apart: inventory_items.qty (a
-- static, hand-edited field) and the inventory_ledger running balance (the real movement record).
-- Low-stock math read the STATIC field, so actual consumption logged to the ledger never tripped a
-- reorder. This reconciles them (effective on-hand = ledger balance when we have one, else the static
-- qty) and makes reorder AUTOMATIC: every ledger movement re-checks the item and, when it crosses the
-- reorder point, drops a dedup'd alert into the spine (category 'prep' = "readiness, stock, load-out")
-- so it rolls up in the Inbox. A restock that lifts it back above the point auto-clears the alert.
-- Idempotent + additive. No new alert category (reuses 'prep'), no schema change to existing tables.

-- ── 1. Reconciled status view — one reorder truth ────────────────────────────────────────────────
-- Ledger is keyed by item NAME (0090); join the catalog on name. Items whose ledger name matches get
-- live balances; the rest fall back to the static qty (no regression). security_invoker → honors RLS.
create or replace view public.inventory_status with (security_invoker = on) as
  select i.*,
    coalesce(oh.on_hand, i.qty)        as effective_on_hand,
    oh.last_movement,
    (i.reorder_point is not null
       and coalesce(oh.on_hand, i.qty) is not null
       and coalesce(oh.on_hand, i.qty) <= i.reorder_point) as needs_reorder
  from public.inventory_items i
  left join public.inventory_on_hand oh on oh.item = i.name;
grant select on public.inventory_status to authenticated;

-- ── 2. Auto reorder alert on every ledger movement ───────────────────────────────────────────────
create or replace function public.inventory_reorder_alert() returns trigger
  language plpgsql security definer set search_path = public as $$
declare it public.inventory_items; oh numeric;
begin
  select * into it from public.inventory_items where name = new.item limit 1;
  if not found or it.reorder_point is null then return new; end if;
  select coalesce(sum(qty), 0) into oh from public.inventory_ledger where item = new.item;

  if oh <= it.reorder_point then
    -- fire once — suppress while an unacked reorder alert for this item is already open
    if not exists (select 1 from public.alerts
                     where ack_at is null and category = 'prep' and title = '📦 Reorder — ' || it.name) then
      insert into public.alerts (severity, category, title, body, link, target_user_id, tenant_id)
      values (case when oh <= 0 then 'critical' else 'important' end,
              'prep', '📦 Reorder — ' || it.name,
              it.name || ' is down to ' || oh::text || coalesce(' ' || it.unit, '') ||
                ' (reorder at ' || it.reorder_point::text || ').' ||
                case when it.reorder_link is not null then ' Reorder link is on the item.' else '' end,
              '/admin', null, it.tenant_id);
    end if;
  else
    -- back above the reorder point (e.g. a restock) → clear any open reorder alert for this item
    update public.alerts set ack_at = now(), ack_by = new.created_by
      where ack_at is null and category = 'prep' and title = '📦 Reorder — ' || it.name;
  end if;
  return new;
end $$;
drop trigger if exists inventory_reorder_alert_tg on public.inventory_ledger;
create trigger inventory_reorder_alert_tg after insert on public.inventory_ledger
  for each row execute function public.inventory_reorder_alert();

-- verify:
--   select tgname from pg_trigger where tgname = 'inventory_reorder_alert_tg';        -- 1 row
--   select count(*) from public.inventory_status where needs_reorder;                 -- items at/below reorder point
