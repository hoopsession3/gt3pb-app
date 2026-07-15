-- 0235 — Changelog rows for the July 14–15 pass: the app-wide Design System v1 migration, the Find Us
-- road (truck + events on one spine), the single public-visibility switch behind it, and the crew Route
-- board fix (one name per place + past-visit fold). Same idempotent shape as the 0200 seed: additive
-- content only, skips any title already present, so re-running is a no-op. Staff read; this is the
-- leader-legible record of what shipped, categorized the same way the rest of the log is.

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('One design system, every screen','design',null,
   'Every page — storefront and crew console alike — is now built from one small kit of shared parts: one header, one row, one set of buttons, one closing mark. The whole app reads as a single product instead of a dozen hand-built screens, and every new surface starts from the kit.',
   '2026-07-15', true),
  ('Find Us — one road to where we''ll be','feature','Ops',
   'The truck''s stops and the calendar''s events used to live on two separate tabs. They''re now one chronological road: the next place we''ll be, then everything after, on a single live screen guests can follow — and it updates itself the moment a stop goes live.',
   '2026-07-15', true),
  ('One switch for what''s public','improvement','Ops',
   'Stops and events now share a single data spine with one visibility switch, so what a guest can see is decided in one place instead of two lists kept in sync by hand. Fewer moving parts, no way for an internal stop to leak onto the public map.',
   '2026-07-15', false),
  ('Cleaner live Route board','fix','Crew',
   'A place linked to a vendor now shows that one canonical name on every visit, so two trips to the same spot can''t read as two different names. Stops whose date has passed fold into a tidy Past visits list instead of lingering as a false next stop.',
   '2026-07-15', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select shipped_on, category, title from public.changelog where shipped_on = '2026-07-15' order by highlight desc, title;
