-- ── 0426 — AN EVENT'S TAKINGS ARE COUNTED WHERE THEY ARE ───────────────────────────────────────────────────────────
-- 2026-10-17. R20 of the 10/10 audit (performance F6; Ryan, 2026-10-17: "Keep working to improve to a 10"). Paste into
-- Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY. The crew console's live-event instrument (app/crew EventHUD) read every order and every Square sale of the live
-- event — on every change to an order or a sale (coalesced to one a second) and every fifteen seconds — to add up three
-- numbers. A festival's thousand cups was a thousand rows a read, for each phone the crew had it open on.
--
-- WHAT. public.event_totals(event) answers the three: what was taken — paid orders not voided, and Square's sales that are
-- no app payment's (the webhook mirrors every completed Square payment against the live event: an app order paid by
-- card, a pack, a delivery, an office order, the shop, a reserve, a pack change's charge — report_sales has left each of
-- those out since 0216–0415), less what was refunded of either — how many sales, and when the first was. Run as its
-- owner, for the crew only, on the caller's own tenant (the R20 review): the payments it leaves out are read whole
-- whoever asks, as report_sales reads them — under a caller's own row rules some were hidden, and counted as walk-ups.
-- lib/eventTotals holds the same rule (totalsFromRows) for the screen until this is pasted; scripts/db.r20.test.mjs
-- runs both on the same rows.
--
-- set lock_timeout (database F16): a function only — no table is locked — but the rule is the rule.
-- existing rows: none — a function; nothing is written but the changelog.
-- changelog: below.

set lock_timeout = '5s';

create or replace function public.event_totals(p_event uuid) returns json
  language plpgsql stable security definer set search_path = public as $$
declare tid uuid := public.effective_tenant();
begin
  if not public.is_staff() then
    raise exception 'The live event''s takings are the crew''s.' using errcode = '42501';
  end if;
  return (
    with o as (   -- the event's orders, a voided ticket left out
      select total_cents, paid, payment_id, created_at from public.orders
       where event_id = p_event and tenant_id = tid and status is distinct from 'void'
    ), s as (     -- the event's Square sales that are no app payment's own
      select e.amount_cents, e.square_payment_id, e.created_at from public.event_sales e
       where e.event_id = p_event and e.tenant_id = tid
         and (e.square_payment_id is null or (
              not exists (select 1 from public.orders x where x.payment_id = e.square_payment_id)
          and not exists (select 1 from public.drop_orders x where x.payment_id = e.square_payment_id)
          and not exists (select 1 from public.delivery_orders x where x.payment_id = e.square_payment_id)
          and not exists (select 1 from public.business_orders x where x.payment_id = e.square_payment_id)
          and not exists (select 1 from public.shop_orders x where x.payment_id = e.square_payment_id)
          and not exists (select 1 from public.reserve_claims x where x.payment_id = e.square_payment_id)
          and not exists (select 1 from public.drop_order_changes x where x.charge_payment_id = e.square_payment_id and x.state = 'done')))
    ), back as (  -- what went back of those, as the books count it — refunds_counted's rule, word for word (a cup's refunds
                  -- together capped at its drinks), on this event's payments alone: not every refund the tenant ever had,
                  -- on every read (the R20 review)
      select coalesce(sum(case when x.channel = 'cup'
                               then greatest(least(x.run, x.cap) - least(x.run - x.amt, x.cap), 0)
                               else x.amt end), 0) as cents
        from (select r.amt, c.channel, c.cap,
                     sum(r.amt) over (partition by r.payment_id order by r.created_at, r.id rows between unbounded preceding and current row) as run
                from (select r.id::text as id, r.payment_id, coalesce(r.amount_cents, 0)::bigint as amt, r.created_at
                        from public.square_refunds r
                       where r.status = 'COMPLETED' and r.tenant_id = tid
                         and r.payment_id in (select payment_id from o where paid and payment_id is not null
                                              union select square_payment_id from s where square_payment_id is not null)) r
                cross join lateral public.refund_counts_against(r.id, r.payment_id) c
               where c.channel is not null) x
       where x.channel in ('cup', 'walkup')
    )
    select json_build_object(
      'cents', coalesce((select sum(total_cents) from o where paid), 0) + coalesce((select sum(amount_cents) from s), 0) - (select cents from back),
      'orders', (select count(*) from o) + (select count(*) from s),
      'first_at', (select min(t) from (select created_at as t from o union all select created_at from s) x))
  );
end $$;
revoke all on function public.event_totals(uuid) from public, anon, authenticated;
grant execute on function public.event_totals(uuid) to authenticated;
comment on function public.event_totals(uuid) is
  'An event''s takings (0426), for the crew, on their tenant: paid orders not voided and Square sales that are no app payment''s (report_sales'' rule), less their refunds; how many, and the first. The live-event instrument''s three numbers; lib/eventTotals holds the same rule.';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The live event adds up its own takings', 'fix', 'Events',
   'The live-event card in the crew console asks for its three numbers — taken, sales, first sale — instead of reading every order and sale of the event each time one changes.',
   '2026-10-17', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from pg_proc where proname = 'event_totals';                                                      -- 1
--   select has_function_privilege('anon', 'public.event_totals(uuid)', 'execute');                                    -- f
select public.record_migration('0426_an_events_takings_are_counted_where_they_are');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor (the R19 review, third pass)
