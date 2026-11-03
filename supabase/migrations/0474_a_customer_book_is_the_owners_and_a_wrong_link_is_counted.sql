-- ── 0474 — A CUSTOMER BOOK IS THE OWNERS', AND A WRONG LINK IS COUNTED (IMS8 security review, for review — NOT applied) ─
-- 2026-11-03. Ryan: "Prepare narrowly scoped customer access for the actual order workflow. Use aggregate-only access
-- for customer totals… prepare effective flood protection for invalid tokens without logging token secrets."
-- PASTE AFTER the app that reads it is live (it needs that app; 0473 does not). A second run changes nothing.
--
-- WHY AFTER THE APP. Both changes alter what the old app reads:
--   · the old order sheet links the customer's name to their record for any crew member, and the old Goals card counts
--     the customers table directly — with the crew's row read gone, the old app would show "not found" and 0;
--   · the old app reads a dead link as an error; from here a dead link is an answer ({ "live": false }) so its miss can
--     be counted (a refusal undoes the transaction, count included). The old app would draw that as an empty vision.
--   The app on the review branch handles both shapes and both reads (lib/visionRead, ShopOrderRecord, lib/goalMetrics).
--
-- WHAT CHANGES.
--   · customers: "customers staff read" (any crew member, every customer, every column) goes; owners and admins read the
--     business's customers ("customers admin read"); a customer reads their own row (unchanged). What the crew keep, by
--     workflow — the order they were alerted to (v_shop_orders, through shop_orders: the order's own ship name, email,
--     address, items, status — "who" falls back to the ship name); the size of the book (customers_total, 0473); the
--     course line on a record (course_status, 0473, no payment or note). What they lose: every customer's phone, tier,
--     VIP proof, order history and the customer record. No crew screen reads those (Customers, VIP, Money and Team are
--     owner/admin; the order sheet's customer link is owner/admin from the review-branch app).
--   · vision_shared(token): a wrong, dead or malformed token answers { "live": false } and is counted per address —
--     twenty misses per ten minutes from one address (caller_address, 0436; IPv6 by /64); past that, PT429. A request
--     with no address header (nothing in production: every request through the API gateway carried cf-connecting-ip,
--     edge logs 2026-11-03) shares one bucket, 'no-address', with the same twenty — bounded, not unlimited. Live opens:
--     sixty per ten minutes per address, as 0473. The bucket names the address only — never a token or any part of
--     one; no notice, log line or error carries a token.
--   · What this does NOT stop: a flood spread across many addresses. Each miss costs one index probe and one counter
--     upsert; shedding that load is the API gateway's job (Supabase sets no Data API rate limit by default), or ours
--     only if the link's door moves behind our own domain (IMS8-STATUS › link throttling, option B).
--
-- set lock_timeout (database F16): one policy dropped and one created; one function's body replaced (same signature
-- and grants). existing rows: none changed.
-- rollback: supabase/cleanup/0474_rollback.sql (0473's vision_shared and the crew's read back). Roll this back BEFORE
--   rolling the app back to one older than the review branch.
-- changelog: none — who reads the customer book; what a wrong link answers.

set lock_timeout = '5s';

-- ── customers: the book is the owners' and admins' ──────────────────────────────────────────────────────────────────
drop policy if exists "customers staff read" on public.customers;
drop policy if exists "customers admin read" on public.customers;
create policy "customers admin read" on public.customers for select using ((select public.is_admin()));

-- ── a link's door: misses counted, per address ──────────────────────────────────────────────────────────────────────
create or replace function public.vision_shared(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.vision_shares; v_from text := coalesce(public.caller_address(), 'no-address');
begin
  if p_token is not null and length(p_token) >= 32 then
    select * into s from public.vision_shares
     where token = p_token and revoked_at is null and (expires_at is null or expires_at > now()) and published is not null;
  end if;
  if s.id is null then
    -- A miss: counted (this answer commits), never naming the token.
    if not public.rate_limit_hit('vision_shared:miss:' || v_from, 600000, 20) then
      raise exception 'Too many tries from this network — try again in a few minutes.' using errcode = 'PT429';
    end if;
    return jsonb_build_object('live', false);
  end if;
  if not public.rate_limit_hit('vision_shared:' || v_from, 600000, 60) then
    raise exception 'Too many opens from this network — try again in a few minutes.' using errcode = 'PT429';
  end if;
  perform set_config('gt3.share_open', 'on', true);
  update public.vision_shares set opens = opens + 1, last_opened_at = now() where id = s.id;
  perform set_config('gt3.share_open', 'off', true);
  return public.vision_share_live(s);
end $$;
revoke all on function public.vision_shared(text) from public, anon, authenticated;
grant execute on function public.vision_shared(text) to anon, authenticated;

-- verify (names and booleans only):
--   select count(*) from pg_policies where tablename = 'customers' and policyname = 'customers staff read';   -- 0
--   select public.vision_shared(repeat('x', 40)) ->> 'live';                                                  -- false
select public.record_migration('0474_a_customer_book_is_the_owners_and_a_wrong_link_is_counted');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
