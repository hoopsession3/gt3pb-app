-- 0302 — The Academy speaks for the owners, not for one of them.
--
-- No schema change. This records an app-side copy change in the changelog, because it is the kind
-- of change a person notices in training and would otherwise have to guess the reason for.
--
-- WHAT CHANGED. Thirty Academy modules each carry a note explaining why the standard is the
-- standard, and ten of them were written in one person's first person: "I don't need clones",
-- "you don't need me in the room", "that's the only version of GT3 that outlives me". Six product
-- explanations did the same. Read on their own each one is fine. Read together — which is what
-- somebody being trained actually does — they describe a company with a single operator, which is
-- the opposite of what the roster, the market leads and the promote path are all for.
--
-- The notes are now the owners' voice, and the label above them reads Founders' note. Not one word
-- of the standard itself changed; only who is standing behind it. GT3 is owner-operated by two
-- people, so that is who the training sounds like.
--
-- A check in scripts/smoke.cjs holds it there: any founders' note or product voice containing a
-- first-person singular pronoun fails the build, naming the module. Its first draft was
-- case-sensitive and missed "My job was never to be the best on the cart" — one of the very
-- sentences this change rewrote — so it is case-insensitive now. A guard that cannot catch the
-- thing it was written for is worse than no guard, because it reports green and nobody looks again.

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The Academy speaks for the owners','improvement','Academy',
   'Every module carries a note explaining why the standard is the standard, and a third of them were written in one owner''s first person — "I don''t need clones", "you don''t need me in the room". Individually fine; read end to end by somebody in training, they describe a business run by one person. The notes are the owners'' voice now, and the heading above them reads Founders'' note. The standard itself is unchanged — only who is standing behind it. The build now refuses any note that slips back into the singular.',
   '2026-09-07', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select title, area, shipped_on from public.changelog order by shipped_on desc limit 5;
