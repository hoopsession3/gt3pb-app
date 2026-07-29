-- 0252 — let staff grant "Founding VIP" by hand from the Customer book, not only through an actual
-- bottle-photo verification. Ryan: "I don't see a way to set someone status as VIP just member and
-- founding... You can be upgraded to a VIP or Founding member." Asked him directly whether VIP
-- should stay what 0249/0250 built (a bonus layer only Founding members carry, worth extra perks on
-- top of plain Founding's) or become its own separate tier below Founding — he picked the former
-- ("VIP stays a Founding bonus"). So this migration only adds the missing manual control; it does
-- NOT touch the tier ladder, the perks gate, or the verify queue — all of that stays exactly as
-- 0249/0250/0251 built it two days ago.
--
-- Mirrors admin_set_customer_tier (0176) exactly, same reason: public.customers has no staff UPDATE
-- policy at all (only two SELECT policies, 0151:28-31) — every write to it goes through a guarded
-- SECURITY DEFINER RPC by design, never direct client UPDATEs.
--
-- Deliberately does NOT require tier = 'founding' before allowing vip_verified = true. That's not a
-- gap — it matches 0249's own explicit design: "if a customer is later manually demoted off
-- Founding tier, the fact that they DID verify bottle ownership at some point shouldn't quietly
-- vanish." The flag is intentionally allowed to outlive a later tier demotion; this RPC just adds a
-- second way to SET it (by hand) alongside the existing photo-verification path, with the same
-- forward-compatible shape.

create or replace function public.admin_set_customer_vip(p_user uuid, p_vip boolean)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  update public.customers set vip_verified = p_vip, updated_at = now() where user_id = p_user;
end; $$;
revoke all on function public.admin_set_customer_vip(uuid, boolean) from public, anon;
grant execute on function public.admin_set_customer_vip(uuid, boolean) to authenticated;

-- verify:
--   select count(*) from pg_proc where proname = 'admin_set_customer_vip';                                              -- 1
--   select has_function_privilege('authenticated','public.admin_set_customer_vip(uuid,boolean)','execute') as can_exec; -- true
