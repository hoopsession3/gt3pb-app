-- ===================================================================================================
-- 0182 . OPTIONAL GENDER on the profile -- drives the founding-member crest (crown / tiara), nothing else
-- ===================================================================================================
-- A founding member's card can wear a crest: a crown or a tiara that hangs off the card and spins
-- with it. That needs to know which -- so we add an OPTIONAL gender field. It is never required, has
-- no default (null = not set = no crest), and only ever drives that one cosmetic. Own-row RLS on
-- profiles already lets a member set their own. Idempotent.

alter table public.profiles add column if not exists gender text
  check (gender is null or gender in ('male','female','other'));

-- verify:
--   select count(*) from information_schema.columns where table_name='profiles' and column_name='gender';  -- 1
