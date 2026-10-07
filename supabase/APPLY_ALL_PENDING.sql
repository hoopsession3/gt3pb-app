-- ⚠️ NEVER include files from supabase/pending/ in this bundle — those are soak-gated (see
-- supabase/pending/0224_field_ops_contract.sql) and applying them early is irreversible.
--
-- ── GENERATED FILE — DO NOT EDIT BY HAND ─────────────────────────────────────────────────────
-- Regenerate with:  npm run migrations:pending -- --write
--
-- This file is the OUTPUT of comparing supabase/migrations/ against what production's ledger
-- (public.schema_migrations, via /api/migrations) says has actually been applied. Its previous
-- hand-maintained version said "apply all pending migrations" and stopped at 0035 while this
-- directory held 326 files — wrong by 291 migrations, referenced by nothing, checked by nothing.
--
-- The line below is what stops that happening again: scripts/drift.check.mjs fails the release
-- if supabase/migrations/ ever holds a migration numbered above it.
-- pending-from: 0357
-- generated-at: 2026-10-07
-- pending-count: 1
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- ============================================================
-- 0357_an_office_delivery_is_a_stop_on_the_run.sql
-- ============================================================
-- 0357 — AN OFFICE DELIVERY IS A STOP ON THE RUN. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- Phase 1, part 3 of the B2B challenge report (2026-10-07; defect 11). The driver's screen read home
-- deliveries only — the office route lived in a crew panel, so whoever drove Monday morning worked
-- from a list on someone else's phone — and logging an office delivery was three separate writes from
-- the browser: the order, then a read of the jug balance, then the ledger row, then the balance. Two
-- phones logging at once (the driver and the crew) could each read the same balance and write their
-- own, and a failed second write left the order delivered with its jugs uncounted.
--
--   office_log_delivery(order, outcome, empties) — one write, staff only, the order locked: delivered
--   with the jug swap (full out, empties back — the ledger row and the account's balance in the same
--   transaction, the balance never under zero), delivered with no swap, or not delivered (the crew is
--   told, once). A delivery already logged is refused rather than counted twice; undo it first. A
--   delivery is logged on its day, not before (in its market's time), and only by crew who can see
--   it: the caller's own company (tenant isolation) and city (0291's market scope), as their screen
--   reads it — the function runs as its owner, so it asks the same question the policies ask.
--
--   office_reopen_delivery(order, reason) — the driver's mis-tap: the open jug entry is voided (the
--   same reversal void_jug_entry makes, kept as the record, with the reason), a "not delivered"
--   alert it raised is answered, and the stop is open again. Only a logged delivery reopens.
--
-- Orders with no account (a one-off) log the same way; they have no balance to move today, as before.
-- business_orders joins the realtime publication, so the driver's run and the crew's route see each
-- other's taps without a refresh.
--
-- changelog: below.

create or replace function public.office_log_delivery(p_order uuid, p_outcome text, p_jugs_in int default null)
returns public.business_orders
language plpgsql security definer set search_path = public as $$
declare
  o public.business_orders; v_out int; v_in int; v_bal int;
begin
  if not public.is_staff() then raise exception 'Only crew can log a delivery.' using errcode = '42501'; end if;
  if coalesce(p_outcome, '') not in ('delivered_swapped', 'delivered_no_swap', 'not_available') then
    raise exception 'Unknown outcome: %', coalesce(p_outcome, 'none') using errcode = '22023';
  end if;
  -- the caller's own company and city — what their screen shows them (0239's tenant isolation, 0291's
  -- market scope); anything else reads as not there, exactly as it does on the screen
  select * into o from public.business_orders
   where id = p_order and tenant_id = public.effective_tenant() and public.market_visible(market)
   for update;
  if not found then raise exception 'That delivery no longer exists.' using errcode = 'P0002'; end if;
  if o.canceled_at is not null then raise exception 'That delivery was canceled.' using errcode = '22023'; end if;
  if o.status in ('delivered', 'issue') or o.driver_outcome is not null then
    raise exception 'That delivery is already logged — undo it first.' using errcode = '22023';
  end if;
  if o.delivery_date > public.office_local_today(o.market) then
    raise exception 'That delivery is for % — log it on the day.', to_char(o.delivery_date, 'FMDay, Mon FMDD')
      using errcode = '22023';
  end if;

  if p_outcome = 'not_available' then
    update public.business_orders
       set status = 'issue', driver_outcome = 'not_available',
           driver_note = left('Not delivered — ' || to_char(now() at time zone public.office_tz(o.market), 'HH12:MI AM'), 200)
     where id = p_order returning * into o;
    perform public.alert_open_once(
      'office_not_delivered', o.id, 'important', 'order',
      left('Office delivery not made — ' || o.company, 180),
      o.company || ' (' || o.address_street || ', ' || o.address_city || ') wasn''t delivered this morning. '
        || round(o.gallons)::text || ' gal. ' || coalesce(o.contact_phone, ''),
      '/crew?s=now');
    return o;
  end if;

  v_out := round(o.gallons)::int;
  v_in  := case when p_outcome = 'delivered_swapped' then greatest(0, coalesce(p_jugs_in, v_out)) else 0 end;
  update public.business_orders
     set status = 'delivered', driver_outcome = p_outcome, jugs_out = v_out, jugs_in = v_in
   where id = p_order returning * into o;

  if o.business_id is not null then
    select greatest(0, coalesce(jug_balance, 0) + v_out - v_in) into v_bal
      from public.business_accounts where id = o.business_id for update;
    insert into public.jug_ledger (tenant_id, business_id, business_order_id, jugs_out, jugs_in, balance_after)
    values (o.tenant_id, o.business_id, o.id, v_out, v_in, v_bal);
    update public.business_accounts set jug_balance = v_bal, updated_at = now() where id = o.business_id;
  end if;
  return o;
end $$;
-- existing rows: office_log_delivery — a new producer; it has never written an alert.
revoke all on function public.office_log_delivery(uuid, text, int) from public, anon;
grant execute on function public.office_log_delivery(uuid, text, int) to authenticated;

create or replace function public.office_reopen_delivery(p_order uuid, p_reason text)
returns public.business_orders
language plpgsql security definer set search_path = public as $$
declare o public.business_orders; j record;
begin
  if not public.is_staff() then raise exception 'Only crew can reopen a delivery.' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Say why it is being reopened.' using errcode = '22023'; end if;
  select * into o from public.business_orders
   where id = p_order and tenant_id = public.effective_tenant() and public.market_visible(market)
   for update;
  if not found then raise exception 'That delivery no longer exists.' using errcode = 'P0002'; end if;
  if o.canceled_at is not null then raise exception 'That delivery was canceled.' using errcode = '22023'; end if;
  if o.status not in ('delivered', 'issue') and o.driver_outcome is null then
    raise exception 'That delivery isn''t logged — there is nothing to undo.' using errcode = '22023';
  end if;
  -- the open jug entry for this delivery, reversed the way void_jug_entry reverses one (0310)
  for j in select id from public.v_jug_open where business_order_id = p_order loop
    perform public.void_jug_entry(j.id, btrim(p_reason));
  end loop;
  -- a "not delivered" that was a mis-tap: the crew's alert about it is answered, not left to chase
  update public.alerts set ack_at = now(), ack_by = auth.uid()
   where kind = 'office_not_delivered' and subject_id = p_order and ack_at is null;
  update public.business_orders
     set status = 'out_for_delivery', driver_outcome = null, jugs_in = null,
         driver_note = left('Reopened — ' || btrim(p_reason), 200)
   where id = p_order returning * into o;
  return o;
end $$;
revoke all on function public.office_reopen_delivery(uuid, text) from public, anon;
grant execute on function public.office_reopen_delivery(uuid, text) to authenticated;

-- The driver's run and the crew's route hear each other.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'business_orders') then
    alter publication supabase_realtime add table public.business_orders;
  end if;
end $$;

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Office deliveries are on the driver''s run','improvement','Delivery',
   'Whoever drives Monday morning now sees the office route on their own phone: each office, its door notes, its window and how many gallons to bring, with Navigate and Call. One tap logs it — delivered with the jug swap (empties counted on the spot), delivered with no swap, or not delivered (the crew is told) — and the jug count moves in the same write, so two phones can no longer count the same swap twice. A mis-tap undoes cleanly, and the crew''s route and the driver''s run update each other live.',
   '2026-10-07', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select has_function_privilege('anon', 'public.office_log_delivery(uuid, text, int)', 'execute');      -- false
--   select exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'business_orders');   -- t
select public.record_migration('0357_an_office_delivery_is_a_stop_on_the_run',
  'office_log_delivery(uuid, text, int) — one locked write on the delivery''s day, in the caller''s tenant and market: outcome, jugs, ledger row, balance; not delivered raises office_not_delivered; office_reopen_delivery(uuid, text) voids the open jug entry, answers that alert and reopens; business_orders joins supabase_realtime.');
