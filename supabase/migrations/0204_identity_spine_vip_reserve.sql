-- 0204 — Customer identity spine: fold VIP + reserve-claims onto the canonical customer, and let
-- staff actually promote a verified VIP. Two channels were writing orphan rows:
--   • vip_verifications (0203): the client tried to call resolve_customer directly, but that RPC is
--     service-role only (0151:85), so the call always failed and customer_id landed null — the staff
--     queue then showed every proof as "guest". And admin_set_customer_tier (0176) had its default
--     PUBLIC execute revoked with no grant back to authenticated, so "Verify → Founding" from the
--     staff console silently no-op'd. Both fixed here.
--   • reserve_claims: got a customer_id column in 0151 but the claim_reserve RPC never set it, so new
--     claims are orphaned.
-- Same fix shape as 0193 (B2B): a SECURITY DEFINER before-insert trigger calls resolve_customer (a
-- client insert can't, by design), plus a one-time backfill. Idempotent + purely additive.

-- ── 1. VIP proofs join the spine ──────────────────────────────────────────────────────────────────
create or replace function public.link_vip_customer() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.customer_id is null then
    new.customer_id := public.resolve_customer(new.user_id, null, null, null);
  end if;
  return new;
end $$;
drop trigger if exists link_vip_customer_tg on public.vip_verifications;
create trigger link_vip_customer_tg before insert on public.vip_verifications
  for each row execute function public.link_vip_customer();

update public.vip_verifications v
  set customer_id = public.resolve_customer(v.user_id, null, null, null)
  where customer_id is null;

-- ── 2. Staff can promote a verified VIP to Founding ──────────────────────────────────────────────
-- admin_set_customer_tier already self-guards with is_staff() (0176:85), so granting execute to
-- authenticated is safe: a non-staff caller just gets 'not authorized'.
grant execute on function public.admin_set_customer_tier(uuid, text) to authenticated;

-- ── 3. Reserve claims join the spine ─────────────────────────────────────────────────────────────
create or replace function public.link_reserve_claim_customer() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.customer_id is null and new.user_id is not null then
    new.customer_id := public.resolve_customer(new.user_id, null, null, null);
  end if;
  return new;
end $$;
drop trigger if exists link_reserve_claim_customer_tg on public.reserve_claims;
create trigger link_reserve_claim_customer_tg before insert on public.reserve_claims
  for each row execute function public.link_reserve_claim_customer();

update public.reserve_claims r
  set customer_id = public.resolve_customer(r.user_id, null, null, null)
  where customer_id is null and r.user_id is not null;

-- verify:
--   select tgname from pg_trigger where tgname in ('link_vip_customer_tg','link_reserve_claim_customer_tg');           -- 2 rows
--   select count(*) filter (where customer_id is null) as orphan_vip from public.vip_verifications;                    -- 0
--   select has_function_privilege('authenticated','public.admin_set_customer_tier(uuid, text)','execute') as can_exec; -- true
