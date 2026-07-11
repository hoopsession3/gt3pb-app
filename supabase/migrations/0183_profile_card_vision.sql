-- ===================================================================================================
-- 0183 . CARD VISION -- the member's own one-line 5-year goal, shown as the hero line on their card
-- ===================================================================================================
-- The card's hero line ("I PERFORM") becomes theirs to write: a short, declarative 5-year vision --
-- e.g. "Make great coffee in 3 regions." Optional, canonical (follows them), own-row RLS on profiles
-- already lets a member set it. Length is bounded in the app; null = the default "I PERFORM". Idempotent.

alter table public.profiles add column if not exists card_vision text;

-- verify:
--   select count(*) from information_schema.columns where table_name='profiles' and column_name='card_vision';  -- 1
