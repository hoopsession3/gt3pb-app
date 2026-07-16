-- 0241 — Changelog rows for Wave 2: the semantic token/spacing/icon foundation, the shared
-- load-state hook that kills false-empty screens app-wide, and modal focus management. Same
-- idempotent shape as 0200/0235: additive content only, skips any title already present, so
-- re-running is a no-op.

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('One design system, wired all the way through','design',null,
   'Every color, spacing value, and icon in the app now comes from one shared set instead of being hand-picked screen by screen — including real icons in place of emoji, and a batch of illegible light-mode pills and buttons fixed as part of the sweep.',
   '2026-07-16', true),
  ('A broken load no longer looks like nothing to see','fix',null,
   '59 places across the app used to show "nothing here" identically whether a screen was genuinely empty or its data just failed to load — orders, reservations, revenue, and more. Every one of those now tells the difference, with a real retry when something goes wrong, and a save no longer flashes the whole list back to a bare loading screen.',
   '2026-07-16', true),
  ('Keyboard and screen-reader support for every popup','improvement',null,
   'Every sheet, dialog, and popover in the app now traps Tab correctly, moves focus in when it opens, and returns it to where you were when it closes — covering the app''s ~35 modal surfaces in one pass instead of screen by screen.',
   '2026-07-16', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select shipped_on, category, title from public.changelog where shipped_on = '2026-07-16' order by highlight desc, title;
