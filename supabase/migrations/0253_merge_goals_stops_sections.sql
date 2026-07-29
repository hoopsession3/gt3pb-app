-- 0253: collapse Goals into Command and Route into Plan (2026-07-29 design-merge round).
-- Ryan: "Look for ways to simplify and merge, not based off data, but based off system design."
-- Two sections whose whole job was a slice of another section's job:
--   · goals — "steering the quarter" — is the same leadership conversation as Command's
--     "are we on track?"; Goals + PlanningBoard now render ON Command (anchor #goals kept,
--     so strategy alerts still land on the block).
--   · stops (Route) — planning where the truck goes — is planning; it's now Plan's Route tab,
--     beside the calendar that already rolled events + stops up together and the Events tab.
--     Going LIVE at a location was never really here anyway — Live Ops has its own LiveControl.
-- The client's OpSection/VALID set no longer recognizes either key (stale ?s= deep-links and
-- localStorage fall back gracefully), so lane rows carrying them would just hold dead strings.
-- This cleans work_streams to match what renders. Idempotent; safe to re-run.
update public.work_streams
set sections = array_remove(array_remove(sections, 'stops'), 'goals')
where sections && array['stops','goals']::text[];
