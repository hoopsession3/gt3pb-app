-- 0220 — Field-ops unification (Phase 3 read model) + stop P&L + office payment linkage.
-- Three jobs:
--   (1) field_ops VIEW — events + stops presented as ONE schedule of "field operations" (the merge
--       target shape, reversible: a read model, no data moves). security_invoker → callers see what
--       their RLS allows.
--   (2) report_events() gains STOP rows — now that orders.stop_id exists (0219), sales made live at
--       a truck stop finally get a P&L line (blended COGS, no fixed costs). The payload keeps its
--       existing keys ('event' = the name) + a new 'kind' so nothing downstream breaks.
--   (3) business_orders.payment_id — schema-ready office↔Square linkage, and the walk-up dedupe in
--       report_sales / founder_digest_alert becomes SYMMETRIC across all four app tables. Today the
--       column is null (office links are texted from Square by hand — an app-generated payment-link
--       feature fills it later); the dedupe simply has no effect until it's populated.
-- Idempotent; create-or-replace supersedes 0216's versions of the two functions.

-- ── (3a) the column first, so the functions below can reference it ───────────────────────────────
alter table public.business_orders add column if not exists payment_id text;

-- ── (1) one schedule: every field operation, whichever table it lives in ─────────────────────────
create or replace view public.field_ops with (security_invoker = on) as
  select 'event'::text as kind, e.id, e.title as name, e.day as day_key,
         null::timestamptz as starts_at, e.location_text, e.is_live, e.archived_at, e.tenant_id
  from public.events e
  union all
  select 'stop', s.id, s.name, (s.starts_at at time zone 'America/New_York')::date,
         s.starts_at, s.location_text,
         (s.id = (select current_stop_id from public.live_status where id = 1 and is_live)), s.archived_at, s.tenant_id
  from public.stops s;
grant select on public.field_ops to authenticated;

-- ── (2) per-op P&L: events (Square mirror) + stops (attributed app orders) ───────────────────────
create or replace function public.report_events()
returns jsonb language plpgsql security definer set search_path = public as $$
declare blended numeric := public.catalog_cogs_pct(); tid uuid := public.effective_tenant();
begin
  if not public.is_staff() then return jsonb_build_object('error', 'unauthorized'); end if;
  return coalesce((select jsonb_agg(payload order by cents desc, sort_key) from (
    select jsonb_build_object(
        'id', e.id, 'kind', 'event',
        'event', e.title,
        'actual_cents', coalesce(s.cents, 0),
        'orders', coalesce(s.n, 0),
        'cogs_pct', coalesce(ec.cogs_pct, blended),
        'fixed_cents', coalesce(ec.booth_cents,0) + coalesce(ec.transport_cents,0) + coalesce(ec.permit_cents,0) + coalesce(ec.consumables_cents,0),
        'margin_cents', round(coalesce(s.cents,0) * (1 - coalesce(ec.cogs_pct, blended)))
                        - (coalesce(ec.booth_cents,0) + coalesce(ec.transport_cents,0) + coalesce(ec.permit_cents,0) + coalesce(ec.consumables_cents,0))
      ) as payload, coalesce(s.cents,0) as cents, coalesce(e.sort, 0)::numeric as sort_key
    from events e
    left join (select event_id, sum(amount_cents) cents, sum(item_count) n from event_sales where tenant_id = tid group by event_id) s on s.event_id = e.id
    left join event_economics ec on ec.event_id = e.id
    where e.archived_at is null and e.tenant_id = tid
    union all
    select jsonb_build_object(
        'id', st.id, 'kind', 'stop',
        'event', '🚚 ' || st.name,
        'actual_cents', so.cents,
        'orders', so.n,
        'cogs_pct', blended,
        'fixed_cents', 0,
        'margin_cents', round(so.cents * (1 - blended))
      ), so.cents, 100000::numeric
    from stops st
    join (select stop_id, sum(total_cents) cents, count(*) n from orders
            where paid and status <> 'void' and stop_id is not null and tenant_id = tid group by stop_id) so on so.stop_id = st.id
    where st.archived_at is null and st.tenant_id = tid
  ) all_rows), '[]'::jsonb);
end; $$;
grant execute on function public.report_events() to authenticated;

-- ── (3b) symmetric walk-up dedupe: all FOUR app tables ───────────────────────────────────────────
create or replace function public.report_sales(p_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  since timestamptz := (current_date - (greatest(p_days, 1) - 1))::timestamptz;
  tid uuid := public.effective_tenant();
  sq bigint; cup bigint; packs bigint; deliv bigint; office bigint;
begin
  if not public.is_staff() then return jsonb_build_object('error', 'unauthorized'); end if;
  sq     := coalesce((select sum(es.amount_cents) from event_sales es
              where es.created_at >= since and es.tenant_id = tid
                and not exists (select 1 from orders o where o.payment_id = es.square_payment_id)
                and not exists (select 1 from drop_orders d where d.payment_id = es.square_payment_id)
                and not exists (select 1 from delivery_orders dv where dv.payment_id = es.square_payment_id)
                and not exists (select 1 from business_orders b where b.payment_id = es.square_payment_id)), 0);
  cup    := coalesce((select sum(total_cents) from orders where paid and status <> 'void' and created_at >= since and tenant_id = tid), 0);
  packs  := coalesce((select sum(total_cents) from drop_orders where paid and canceled_at is null and created_at >= since and tenant_id = tid), 0);
  deliv  := coalesce((select sum(total_cents) from delivery_orders where payment_status = 'paid' and canceled_at is null and created_at >= since and tenant_id = tid), 0);
  office := coalesce((select sum(total_cents) from business_orders where payment_status = 'paid' and canceled_at is null and created_at >= since and tenant_id = tid), 0);
  return jsonb_build_object(
    'days', p_days,
    'revenue_basis', 'reconciled',
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
             and not exists (select 1 from delivery_orders dv where dv.payment_id = es.square_payment_id)
             and not exists (select 1 from business_orders b where b.payment_id = es.square_payment_id))
          + (select coalesce(sum(total_cents), 0) from orders o where o.paid and o.status <> 'void' and o.created_at::date = g::date and o.tenant_id = tid)
          + (select coalesce(sum(total_cents), 0) from drop_orders where paid and canceled_at is null and created_at::date = g::date and tenant_id = tid)
          + (select coalesce(sum(total_cents), 0) from delivery_orders where payment_status = 'paid' and canceled_at is null and created_at::date = g::date and tenant_id = tid)
          + (select coalesce(sum(total_cents), 0) from business_orders where payment_status = 'paid' and canceled_at is null and created_at::date = g::date and tenant_id = tid) c
        from generate_series(since::date, current_date, interval '1 day') g
      ) dd), '[]'::jsonb)
  );
end; $$;
grant execute on function public.report_sales(int) to authenticated;

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
    select coalesce((select sum(es.amount_cents) from event_sales es
             where es.created_at >= (current_date - 6)::timestamptz and es.tenant_id = t.id
               and not exists (select 1 from orders o where o.payment_id = es.square_payment_id)
               and not exists (select 1 from drop_orders d where d.payment_id = es.square_payment_id)
               and not exists (select 1 from delivery_orders dv where dv.payment_id = es.square_payment_id)
               and not exists (select 1 from business_orders b where b.payment_id = es.square_payment_id)), 0)
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

-- verify:
--   select to_regclass('public.field_ops');                                                          -- not null
--   select count(*) from information_schema.columns where table_name='business_orders' and column_name='payment_id'; -- 1
--   select prosrc like '%business_orders b where b.payment_id%' from pg_proc where proname='report_sales';           -- true
