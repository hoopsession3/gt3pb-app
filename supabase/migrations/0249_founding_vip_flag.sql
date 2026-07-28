-- 0249 — separate "Founding" (the tier) from "VIP" (bottle-owner verified), so staff can actually
-- tell them apart.
--
-- Ryan (2026-07-28): "Founding and VIP are different, please ensure the infrastructure is there
-- to identify a member as a Founding VIP." He's right, and the gap is real: today
-- public.customers.tier just has 'guest' | 'member' | 'founding' — one flat ladder. Two completely
-- different things both land a customer on 'founding':
--   1. Staff free-promotes anyone to Founding from the Customer book's tier toggle, for any reason
--      (a manual comp, an early supporter, upgrading a member who emailed in — no proof required).
--   2. A customer proves bottle ownership through the VIP flow (VipVerify.tsx uploads a photo →
--      staff reviews in VipQueue.tsx → Verify promotes them). The app's OWN copy already calls
--      this a "Founding VIP" in two places (VipVerify's confirmation text, VipQueue's success
--      toast) — the product language already assumes this distinction exists.
-- Once promoted, both paths write the exact same tier = 'founding'. The only place that still
-- knows the difference is public.vip_verifications (a status='verified' row), which the Customer
-- book never reads. So today, a staff member looking at the Customer book cannot tell a genuine
-- bottle-verified Founding VIP apart from someone who was just tier-bumped by hand — checked
-- production directly: right now there are 0 verified vip_verifications rows, meaning every
-- 'founding' customer that exists today got there by the manual path, none by actual verification.
--
-- Fix: a denormalized, forward-only flag — same pattern as profiles.founding_member (0176) — set
-- by a trigger on vip_verifications the moment a proof is verified, completely independent of
-- whatever the tier toggle does. "Founding VIP" becomes tier = 'founding' AND vip_verified = true,
-- which the app can now actually query, badge, and search for — "Founding" alone (staff-granted,
-- no proof) stays visually and semantically distinct. Forward-only on purpose, matching
-- founding_member: there's no "unverify" workflow in the UI (VipQueue only offers verify/reject on
-- a still-pending proof), and if a customer is later manually demoted off Founding tier, the fact
-- that they DID verify bottle ownership at some point shouldn't quietly vanish — the app surfaces
-- that separately from the current tier.

alter table public.customers add column if not exists vip_verified boolean not null default false;

create or replace function public.mark_customer_vip_verified() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'verified' and new.customer_id is not null then
    update public.customers set vip_verified = true where id = new.customer_id and vip_verified is distinct from true;
  end if;
  return new;
end $$;

drop trigger if exists mark_customer_vip_verified_tg on public.vip_verifications;
create trigger mark_customer_vip_verified_tg after insert or update of status on public.vip_verifications
  for each row execute function public.mark_customer_vip_verified();

-- Backfill: any verification already sitting at 'verified' today should retroactively flag its
-- customer (none currently in prod, but this makes the migration correct wherever it runs next —
-- staging, a future restore, etc.).
update public.customers c
set vip_verified = true
from public.vip_verifications v
where v.customer_id = c.id and v.status = 'verified' and c.vip_verified is distinct from true;

-- verify:
--   select column_name from information_schema.columns
--     where table_schema = 'public' and table_name = 'customers' and column_name = 'vip_verified'; -- 1 row
--   select tgname from pg_trigger where tgname = 'mark_customer_vip_verified_tg';                   -- 1 row
--   select count(*) from public.customers where vip_verified;                                       -- 0 today, matches 0 verified vip_verifications rows
