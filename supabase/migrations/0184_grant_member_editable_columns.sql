-- 0184 — grant column-level UPDATE for the member-editable profile fields that shipped without a grant.
--
-- 0008 revoked UPDATE on public.profiles from anon/authenticated (so a member couldn't rewrite any
-- column of their own row) and re-granted ONLY display_name. 0102 added avatar_url, title, bio.
-- But two later columns are written client-side by signed-in members and were never granted:
--   • card_vision (0183) — the member card's hero/5-year-goal line (StatusCard.saveVision)
--   • nav_pins    (0160) — a member's pinned crew lanes (OperatorNav)
-- Result: those UPDATEs hit "permission denied for table profiles", failed silently, and reverted on
-- reload — i.e. "save your goal" never actually saved. The own-row RLS policy (auth.uid() = id) was
-- present, but column GRANTs are a separate check; both are required. Grant the two columns now.
--
-- Safe + idempotent: GRANT is additive and re-runnable. Sensitive columns (points, credit_cents,
-- founding_member, role, referral_code, square_customer_id) stay ungranted — they remain server-only.

grant update (card_vision, nav_pins) on public.profiles to authenticated;

-- verify: both columns should now show UPDATE for the authenticated role
-- select column_name from information_schema.column_privileges
--  where table_schema='public' and table_name='profiles' and grantee='authenticated'
--    and privilege_type='UPDATE' order by 1;
--  → expect: avatar_url, bio, card_vision, display_name, nav_pins, title
