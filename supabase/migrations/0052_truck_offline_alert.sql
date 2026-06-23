-- 0052 — producer: raise an alert when the live truck goes offline.
-- Fires on the is_live true→false transition (covers the admin_set_offline RPC path). Lands in the
-- in-app inbox immediately (realtime). To ALSO push/Teams it, add a Database Webhook on
-- `alerts` INSERT → the `push` function (optional; documented in the rollout notes) — that makes
-- every system-raised alert (this, plus a future stale-GPS cron) fan out uniformly.
-- Idempotent; apply after 0050.

create or replace function public.alert_truck_offline() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if old.is_live = true and new.is_live = false then
    insert into public.alerts (severity, category, title, body, link, tenant_id)
    values ('important', 'truck', 'Truck went offline',
            'The live truck just went offline — confirm this was intended.', '/admin',
            coalesce(new.tenant_id, '00000000-0000-0000-0000-000000000001'));
  end if;
  return new;
end; $$;

drop trigger if exists live_status_offline_alert on public.live_status;
create trigger live_status_offline_alert
  after update of is_live on public.live_status
  for each row execute function public.alert_truck_offline();
