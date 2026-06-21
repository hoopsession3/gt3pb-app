-- 0016 — security hardening (adversarial review findings)

-- (#1 HIGH) Orders: clients may insert ONLY unpaid orders again. paid/payment_id
-- are written server-side by /api/checkout via the service role. Reverts the 0011
-- client-paid tradeoff so a paid order can no longer be forged with the anon key.
drop policy if exists "place own order" on public.orders;
create policy "place own order" on public.orders for insert to anon, authenticated
  with check (paid = false and status = 'new' and total_cents >= 0 and (user_id is null or user_id = auth.uid()));

-- (#1 HIGH) Referral conversion now requires a server-verified PAID order (paid is
-- server-only after the revert above). Loyalty points stay on operator pickup.
create or replace function public.award_points() returns trigger
language plpgsql security definer set search_path = public as $$
declare ref uuid; existing int := 0; grant_cents int := 500; floor_cents int := 500;
begin
  if new.status = 'done' and old.status is distinct from 'done' and new.user_id is not null then
    update public.profiles set points = points + greatest(coalesce(array_length(new.items, 1), 1), 1) where id = new.user_id;
    if new.paid = true and new.total_cents >= floor_cents then
      select referred_by into ref from public.profiles where id = new.user_id and referred_by is not null and referral_converted = false;
      if ref is not null then
        select count(*) into existing from public.referral_events where referee = new.user_id;
        if existing = 0 then
          update public.profiles set referral_converted = true, credit_cents = credit_cents + grant_cents where id = new.user_id;
          update public.profiles set credit_cents = credit_cents + grant_cents where id = ref;
          insert into public.referral_events (referrer, referee, converting_order, referrer_credit_cents, referee_credit_cents)
            values (ref, new.user_id, new.id, grant_cents, grant_cents);
        end if;
      end if;
    end if;
  end if;
  return new;
end; $$;

-- (#2 HIGH) Subscriptions: one active-ish subscription per member (atomic guard).
create unique index if not exists subscriptions_one_active on public.subscriptions(user_id)
  where status in ('active','paused','pending','past_due');

-- (#3 MED) claim_reserve: lock the reserve row up front so concurrent claims
-- serialize — closes the per-member-limit race (and reinforces no-oversell).
create or replace function public.claim_reserve(p_reserve uuid, p_qty int default 1) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_limit int; v_member_only boolean; v_have int; v_claim uuid;
begin
  if v_uid is null then raise exception 'sign in to reserve'; end if;
  if p_qty < 1 then p_qty := 1; end if;
  perform public.release_expired_holds();
  select per_member_limit, member_only into v_limit, v_member_only
    from public.reserves where id = p_reserve and status = 'live' for update;
  if v_limit is null then raise exception 'reserve not available'; end if;
  select coalesce(sum(qty),0) into v_have from public.reserve_claims
    where reserve_id = p_reserve and user_id = v_uid and state in ('held','paid');
  if v_have + p_qty > v_limit then raise exception 'limit reached'; end if;
  update public.reserves set stock_remaining = stock_remaining - p_qty
    where id = p_reserve and status = 'live' and stock_remaining >= p_qty;
  if not found then raise exception 'sold out'; end if;
  select id into v_claim from public.reserve_claims
    where reserve_id = p_reserve and user_id = v_uid and state in ('held','paid') limit 1;
  if v_claim is not null then
    update public.reserve_claims set qty = qty + p_qty, hold_expires_at = now() + interval '48 hours' where id = v_claim;
  else
    insert into public.reserve_claims (reserve_id, user_id, qty, state, hold_expires_at)
      values (p_reserve, v_uid, p_qty, 'held', now() + interval '48 hours') returning id into v_claim;
  end if;
  update public.reserves set status = 'sold_out' where id = p_reserve and stock_remaining = 0;
  return v_claim;
end; $$;

-- (#5 MED) rsvps: one row per (event_id, member). Dedupe existing, then enforce.
delete from public.rsvps a using public.rsvps b
  where a.user_id is not null and a.user_id = b.user_id and a.event_id = b.event_id and a.ctid > b.ctid;
create unique index if not exists rsvps_one_per_member on public.rsvps(event_id, user_id) where user_id is not null;

-- (#10 LOW) reserve_claims realtime so the member's "Reserved" badge stays in sync.
alter publication supabase_realtime add table public.reserve_claims;
