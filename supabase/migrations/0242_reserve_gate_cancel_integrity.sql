-- 0242 — three gaps found in a revenue-critical-paths sweep, all DB-side (no client can fix these
-- alone). Idempotent; safe to re-run.
--
--   (1) MEMBER-ONLY RESERVES WEREN'T ACTUALLY GATED: claim_reserve (0014, re-hardened in 0016 for the
--       FOR UPDATE lock) has always SELECTed reserves.member_only into a variable and then never once
--       checked it — any signed-in account, including a brand-new 'guest'-tier signup, could claim a
--       reserve meant to be restricted to member/founding tier (0176). Fixed by gating on
--       customers.tier, the real membership signal; a caller with no customers row yet (never
--       checked out) reads as 'guest' — correctly not a member, fails closed.
--   (2) cancel_own_order (0118) is the one cancel RPC of the three (cancel_own_order /
--       cancel_own_reservation / cancel_own_delivery) that never got the FOR UPDATE lock its two
--       siblings already have — a double-tap or client retry can both pass the 'still new' check
--       before either write lands, risking a duplicate refund-needed alert. Closed by locking the row
--       up front, same as its siblings.
--   (3) REFUND ALERTS COULD NEVER ESCALATE: all three cancel RPCs raise their paid-cancel refund alert
--       at severity 'important'. escalate_unacked_criticals() (0162/0174, cron every 15 min) only ever
--       escalates severity = 'critical' — so a refund alert buried in a busy inbox had no backstop,
--       unlike every other money-integrity alert added this round (checkout/reserve/delivery-checkout
--       critical alerts). These three predate the escalation system (0162) and were never revisited.
--       Bumped to 'critical' to bring them in line; a no-op if no work_streams owner covers 'money'.
--   (4) Two payment/account tables were missing the unique-index backstop their siblings already have:
--       drop_orders.payment_id (orders + delivery_orders got this in 0238; drop_orders was missed) and
--       business_accounts (user_id, lower(company)) (backstops the ilike-normalized lookup added in
--       OfficeOrder.tsx this round against a genuine concurrent double-submit, which no amount of
--       client-side normalization alone can close). Both guarded the same way as 0238: skip + notice
--       if pre-existing duplicates would violate the constraint, never fail the migration on live data.

-- ── (1) + (2): claim_reserve member-tier gate, cancel_own_order FOR UPDATE ─────────────────────────
create or replace function public.claim_reserve(p_reserve uuid, p_qty int default 1) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_limit int; v_member_only boolean; v_have int; v_claim uuid; v_tier text;
begin
  if v_uid is null then raise exception 'sign in to reserve'; end if;
  if p_qty < 1 then p_qty := 1; end if;
  perform public.release_expired_holds();

  select per_member_limit, member_only into v_limit, v_member_only
    from public.reserves where id = p_reserve and status = 'live' for update;
  if v_limit is null then raise exception 'reserve not available'; end if;

  -- member_only was fetched above but never checked (the actual bug). customers.tier is the real
  -- membership signal (0176: guest / member / founding) — 'guest' includes both an explicit guest
  -- row and no row at all (a caller who's never checked out), and neither counts as a member.
  if v_member_only then
    select tier into v_tier from public.customers where user_id = v_uid;
    if coalesce(v_tier, 'guest') = 'guest' then raise exception 'members only'; end if;
  end if;

  select coalesce(sum(qty),0) into v_have from public.reserve_claims
    where reserve_id = p_reserve and user_id = v_uid and state in ('held','paid');
  if v_have + p_qty > v_limit then raise exception 'limit reached'; end if;

  update public.reserves set stock_remaining = stock_remaining - p_qty
    where id = p_reserve and status = 'live' and stock_remaining >= p_qty;
  if not found then raise exception 'sold out'; end if;

  select id into v_claim from public.reserve_claims
    where reserve_id = p_reserve and user_id = v_uid and state in ('held','paid') limit 1;
  if v_claim is not null then
    update public.reserve_claims set qty = qty + p_qty, hold_expires_at = now() + interval '48 hours'
      where id = v_claim;
  else
    insert into public.reserve_claims (reserve_id, user_id, qty, state, hold_expires_at)
      values (p_reserve, v_uid, p_qty, 'held', now() + interval '48 hours')
      returning id into v_claim;
  end if;

  update public.reserves set status = 'sold_out' where id = p_reserve and stock_remaining = 0;
  return v_claim;
end; $$;
grant execute on function public.claim_reserve(uuid, int) to authenticated;

create or replace function public.cancel_own_order(p_order uuid) returns boolean
  language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  -- FOR UPDATE added: cancel_own_reservation (0136) and cancel_own_delivery (0139) already lock
  -- their row here; this one didn't, so two concurrent cancels (double-tap / client retry) could
  -- both read status='new' before either write landed and both insert a refund alert.
  select * into o from public.orders where id = p_order and user_id = auth.uid() for update;
  if not found then return false; end if;      -- not yours (or doesn't exist)
  if o.status <> 'new' then return false; end if;  -- too late: already preparing / ready / done / void

  update public.orders set status = 'void' where id = p_order;

  -- A card-paid order that's canceled needs a refund in Square — flag the crew (best-effort inbox
  -- row; the app's push dispatcher fans it out). The refund itself is done in Square.
  if o.paid then
    insert into public.alerts (severity, category, title, body, link)
    values ('critical', 'money',
            'Customer canceled a paid order — refund needed',
            'A member canceled order #' || upper(substr(o.id::text, 1, 4)) ||
            ' ($' || to_char((o.total_cents / 100.0)::numeric, 'FM999990.00') || '). Refund it in Square.',
            '/admin');
  end if;
  return true;
end $$;

revoke all on function public.cancel_own_order(uuid) from public, anon;
grant execute on function public.cancel_own_order(uuid) to authenticated;

-- ── (3) refund alerts: 'important' → 'critical' so escalate_unacked_criticals() actually covers them ──
create or replace function public.cancel_own_reservation(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare r public.drop_orders%rowtype;
begin
  select * into r from public.drop_orders
    where id = p_id and user_id = (select auth.uid())
    for update;
  if r.id is null or r.canceled_at is not null or r.picked_up then return false; end if;
  update public.drop_orders set canceled_at = now() where id = p_id;
  if r.paid then
    insert into public.alerts (severity, category, title, body, link) values (
      'critical', 'money', 'Member canceled a PAID reservation — refund needed',
      r.name || ' · ' || r.size || '-pack · $' || to_char(r.total_cents / 100.0, 'FM999990.00')
        || ' for ' || to_char(r.drop_date, 'Dy Mon DD') || '''s drop. Refund it in Square.',
      '/admin?s=now');
  end if;
  return true;
end $$;

grant execute on function public.cancel_own_reservation(uuid) to authenticated;
revoke execute on function public.cancel_own_reservation(uuid) from anon;

create or replace function public.cancel_own_delivery(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare r public.delivery_orders%rowtype;
declare cutoff timestamptz;
begin
  select * into r from public.delivery_orders
    where id = p_id and user_id = (select auth.uid())
    for update;
  if r.id is null or r.canceled_at is not null or r.status <> 'received' then return false; end if;
  cutoff := ((r.delivery_date - interval '2 days') + time '18:00') at time zone 'America/New_York';
  if now() >= cutoff then return false; end if;
  update public.delivery_orders set canceled_at = now() where id = p_id;
  if r.payment_status = 'paid' then
    insert into public.alerts (severity, category, title, body, link) values (
      'critical', 'money', 'Delivery canceled — refund needed',
      r.name || ' · ' || r.pack_size || ' bottles · $' || to_char(r.total_cents / 100.0, 'FM999990.00')
        || ' for ' || to_char(r.delivery_date, 'Dy Mon DD') || '. Refund it in Square.',
      '/admin?s=now');
  end if;
  return true;
end $$;
grant execute on function public.cancel_own_delivery(uuid) to authenticated;
revoke execute on function public.cancel_own_delivery(uuid) from anon;

-- ── (4) missing unique-index backstops, guarded against pre-existing dirty data (0238's pattern) ──
do $$
begin
  if not exists (
    select 1 from public.drop_orders where payment_id is not null
    group by payment_id having count(*) > 1
  ) then
    create unique index if not exists drop_orders_payment_id_uniq
      on public.drop_orders (payment_id) where payment_id is not null;
  else
    raise notice 'drop_orders.payment_id has duplicates — unique index skipped; dedupe then re-run';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from public.business_accounts where company is not null
    group by user_id, lower(company) having count(*) > 1
  ) then
    create unique index if not exists business_accounts_user_company_uniq
      on public.business_accounts (user_id, lower(company));
  else
    raise notice 'business_accounts has duplicate (user_id, lower(company)) rows — unique index skipped; dedupe then re-run';
  end if;
end $$;

-- verify:
--   select prosrc like '%members only%' from pg_proc where proname = 'claim_reserve';                 -- t
--   select prosrc like '%for update%' from pg_proc where proname = 'cancel_own_order';                 -- t
--   select count(*) from pg_proc where proname in ('cancel_own_order','cancel_own_reservation','cancel_own_delivery')
--     and prosrc like '%''critical''%';                                                                 -- 3
--   select indexname from pg_indexes where tablename = 'drop_orders' and indexname = 'drop_orders_payment_id_uniq';        -- 1 row (if data was clean)
--   select indexname from pg_indexes where tablename = 'business_accounts' and indexname = 'business_accounts_user_company_uniq'; -- 1 row (if data was clean)
