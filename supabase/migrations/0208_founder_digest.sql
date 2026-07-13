-- 0208 — Founder digest. Once a day, roll the whole business up into one line the founders actually
-- see: all-channel revenue, launch-readiness verdict, open blockers, reorder needs, and what needs
-- them. Two delivery paths, each idiomatic to this codebase:
--   • Automated (this migration): a SQL function on pg_cron (same mechanism as brew_due_alerts, 0084)
--     inserts ONE summary alert → the 0157 fanout already pushes it to web-push + Teams. No fragile
--     external HTTP, no embedded keys — it reaches the founders through channels they already have.
--   • On-demand email/SMS: the /api/cron/digest route + a "Send digest now" button (Resend/Twilio).
-- Cadence is owner-set on the live_status singleton (off / daily / weekly). Idempotent + additive.

alter table public.live_status add column if not exists digest_cadence text not null default 'daily'
  check (digest_cadence in ('off', 'daily', 'weekly'));

create or replace function public.founder_digest_alert() returns void
  language plpgsql security definer set search_path = public as $$
declare
  cadence text; rev bigint; blockers int; reorders int; crit int;
  rdy_blocked int; rdy_total int; verdict text; msg text;
begin
  select digest_cadence into cadence from public.live_status where id = 1;
  if cadence is null or cadence = 'off' then return; end if;
  if cadence = 'weekly' and extract(dow from now()) <> 1 then return; end if;   -- weekly = Mondays only

  -- All-channel revenue, last 7 days (same four order tables MoneyKpis sums).
  select coalesce((select sum(total_cents) from orders          where paid and status <> 'void'      and created_at >= now() - interval '7 days'), 0)
       + coalesce((select sum(total_cents) from drop_orders     where paid and canceled_at is null    and created_at >= now() - interval '7 days'), 0)
       + coalesce((select sum(total_cents) from delivery_orders where payment_status = 'paid' and canceled_at is null and created_at >= now() - interval '7 days'), 0)
       + coalesce((select sum(total_cents) from business_orders where payment_status = 'paid' and canceled_at is null and created_at >= now() - interval '7 days'), 0)
    into rev;

  select count(*) into blockers from public.incident_log where resolved = false and severity = 'blocker';
  select count(*) into reorders from public.alerts where ack_at is null and category = 'prep' and title like '📦 Reorder%';
  select count(*) into crit     from public.alerts where ack_at is null and severity = 'critical';
  select count(*) filter (where critical and status = 'blocked'), count(*) filter (where critical)
    into rdy_blocked, rdy_total from public.readiness_checks;
  verdict := case when rdy_total = 0 then 'no criteria yet' when rdy_blocked > 0 then 'NO-GO' else 'on track' end;

  msg := 'Revenue 7d: $' || (rev / 100)::text
      || '  ·  Launch: ' || verdict || case when rdy_blocked > 0 then ' (' || rdy_blocked::text || ' blocked)' else '' end
      || '  ·  Blockers: ' || blockers::text
      || '  ·  Reorders: ' || reorders::text
      || '  ·  Needs you: ' || crit::text;

  insert into public.alerts (severity, category, title, body, link, target_user_id, tenant_id)
  values ('fyi', 'money', '📊 Daily founder digest', msg, '/admin', null, '00000000-0000-0000-0000-000000000001');
end $$;

-- Schedule daily at 13:00 UTC (~breakfast ET). The function itself honors the cadence toggle, so the
-- schedule stays static. Guarded so a re-run / missing cron extension can't fail the migration.
do $$ begin perform cron.unschedule('founder-digest'); exception when others then null; end $$;
do $$ begin perform cron.schedule('founder-digest', '0 13 * * *', 'select public.founder_digest_alert()'); exception when others then null; end $$;

-- verify:
--   select digest_cadence from public.live_status where id = 1;                      -- daily
--   select proname from pg_proc where proname = 'founder_digest_alert';             -- 1 row
--   select jobname from cron.job where jobname = 'founder-digest';                  -- founder-digest
--   select public.founder_digest_alert();                                          -- inserts one alert (if cadence<>off)
