-- 0215 — Tenant-scope the inventory reorder trigger. The 0205 function was tenant-blind: it looked up
-- the catalog item by NAME across all tenants (arbitrary limit 1), summed the ledger across all tenants,
-- and — worst — deduped/cleared the reorder ALERT by title with no tenant filter, so one tenant's
-- restock could silently acknowledge another tenant's low-stock alert. Single-tenant today, but it's a
-- write path, so harden it now. Also fixes a single-tenant edge: two items sharing a name no longer
-- cross-contaminate. Function replacement only; the trigger is unchanged. Idempotent.

create or replace function public.inventory_reorder_alert() returns trigger
  language plpgsql security definer set search_path = public as $$
declare it public.inventory_items; oh numeric;
begin
  select * into it from public.inventory_items where name = new.item and tenant_id = new.tenant_id limit 1;
  if not found or it.reorder_point is null then return new; end if;
  select coalesce(sum(qty), 0) into oh from public.inventory_ledger where item = new.item and tenant_id = new.tenant_id;

  if oh <= it.reorder_point then
    if not exists (select 1 from public.alerts
                     where ack_at is null and category = 'prep' and tenant_id = it.tenant_id and title = '📦 Reorder — ' || it.name) then
      insert into public.alerts (severity, category, title, body, link, target_user_id, tenant_id)
      values (case when oh <= 0 then 'critical' else 'important' end,
              'prep', '📦 Reorder — ' || it.name,
              it.name || ' is down to ' || oh::text || coalesce(' ' || it.unit, '') ||
                ' (reorder at ' || it.reorder_point::text || ').' ||
                case when it.reorder_link is not null then ' Reorder link is on the item.' else '' end,
              '/admin', null, it.tenant_id);
    end if;
  else
    update public.alerts set ack_at = now(), ack_by = new.created_by
      where ack_at is null and category = 'prep' and tenant_id = it.tenant_id and title = '📦 Reorder — ' || it.name;
  end if;
  return new;
end $$;

-- verify:
--   select prosrc like '%tenant_id = new.tenant_id%' as scoped from pg_proc where proname = 'inventory_reorder_alert'; -- true
