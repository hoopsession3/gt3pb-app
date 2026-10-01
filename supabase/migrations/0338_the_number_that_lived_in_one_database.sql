-- ── THE NUMBER THAT LIVED IN ONE DATABASE ─────────────────────────────────────────────────────
-- 2026-10-01. 0337 added brew_vessels.min_gal and shipped it EMPTY, because "not measured" is a
-- real fact and a default would have hidden it. Ryan then gave the two numbers:
--
--     "The minimum for the 5-gallon Cold Brew Avenue is 1 gallon. I don't see a minimum for the
--      Toddy, so let's just go half a gallon."
--
-- and they were typed straight into the SQL editor as an UPDATE, the same hour. That worked, and it
-- left them in exactly one place: this database. A hand-typed UPDATE is not in the ledger, is not in
-- supabase/migrations/, and does not survive a restore — so the Brew board would come back from a
-- restore quietly guessing capacity/3 again, with nothing anywhere to say a real measurement had
-- ever been taken. This migration is those two numbers written down where the rest of the schema
-- lives. Against production it is a NO-OP, by construction; see the guard below.
--
-- ── EVERY WRITE IS GUARDED BY `min_gal is null`, AND THAT IS THE WHOLE DESIGN ──────────────────
-- Ryan has not measured the Toddy yet — 0.5 gal is his working floor, chosen, not measured, and he
-- said so. He is going to replace it with a real figure. If this file ever runs again (a restore, a
-- staging rebuild, somebody pasting the pending file twice) it must not put the guess back over the
-- measurement. So it fills a blank and never overwrites a value: a migration that replaces a
-- measurement with a guess is worse than no migration at all, because the guess then carries the
-- authority of having been written down.
--
-- The same reason the notes are APPENDED rather than set. `notes` is an operator's free-text field
-- about their own gear; a migration has no business replacing what they wrote in it.
--
-- ── WHAT THIS DOES NOT DO: DELETE THE capacity/3 PROMPT ────────────────────────────────────────
-- 0337 promised it would: "the guess becomes dead code the day Toddy and Cold Brew Avenue both
-- carry a number." That was over-stated, and this is the correction. Both rows carry a number now
-- and the heuristic is still live — because the next vessel Ryan buys arrives with min_gal null,
-- and for that row the prompt is doing exactly the job 2026-09-07 described: "a prompt to go and
-- look at the vessel, not a specification of it." It is dormant for these two rows, not dead. It
-- goes when the app can tell "nobody has measured this yet" some better way, not today.
--
-- ── WHY THE MATCH NAMES CAPACITY AS WELL AS NAME ───────────────────────────────────────────────
-- One tenant owns both of these rows (checked: 1 tenant, 2 vessels, 2026-10-01). A second operator's
-- "Toddy (commercial)" would be a different physical vessel and Ryan's floor would be none of its
-- business — so the match names the capacity too, and the null guard means even a wrong match could
-- only fill a blank, never contradict somebody's measurement.
--
-- changelog: covered by 0337_how_small_can_this_vessel_go.sql — "Each vessel can also record the
-- smallest batch it can physically brew, once that has been measured." This is that measurement
-- arriving, not a second feature, and a second entry for one change is how a changelog stops being
-- read.

-- Cold Brew Avenue — 5 gal stainless, perforated basket, bottom tap. MEASURED.
update public.brew_vessels
   set min_gal = 1.0,
       notes = case
         when notes is null then 'Minimum 1.0 gal — MEASURED by Ryan 2026-10-01.'
         when notes like '%Minimum 1.0 gal%' then notes
         else notes || ' Minimum 1.0 gal — MEASURED by Ryan 2026-10-01.'
       end
 where name = 'Cold Brew Avenue'
   and capacity_gal = 5.0
   and min_gal is null;

-- Toddy (commercial) — 2.5 gal, paper/cloth filter bag. NOT measured: an owner's working floor.
-- The note says which it is, because a number with no provenance becomes a measurement by age.
update public.brew_vessels
   set min_gal = 0.5,
       notes = case
         when notes is null then 'Minimum 0.5 gal — owner''s working floor set 2026-10-01, NOT measured: no stated minimum was found for this vessel. Replace with a measured figure (the volume that covers the filter bag) when one is taken.'
         when notes like '%Minimum 0.5 gal%' then notes
         else notes || ' Minimum 0.5 gal — owner''s working floor set 2026-10-01, NOT measured: no stated minimum was found for this vessel. Replace with a measured figure (the volume that covers the filter bag) when one is taken.'
       end
 where name = 'Toddy (commercial)'
   and capacity_gal = 2.5
   and min_gal is null;

select public.record_migration('0338_the_number_that_lived_in_one_database',
  'The two vessel minimums, written down where the schema lives instead of only in the one database they were typed into. 0337 shipped min_gal empty on purpose; Ryan then gave 1.0 gal for the 5 gal Cold Brew Avenue (measured) and 0.5 gal for the 2.5 gal Toddy (his working floor, NOT measured — he said so, and the note says so), and they went in as a hand-typed UPDATE in the SQL editor. That left them in production and nowhere else: not in the ledger, not in supabase/migrations/, gone on a restore, and the Brew board would have come back guessing capacity/3 with nothing to say a measurement had ever been taken. Against production this file changes nothing, because every write is guarded by `min_gal is null` — it fills a blank and never overwrites a value. That guard is the point, not caution: Ryan is going to measure the Toddy, and a re-run that put 0.5 back over his measurement would hand a guess the authority of having been written down. Notes are appended for the same reason — `notes` is the operator''s field. Does NOT delete the capacity/3 prompt, which 0337 said would be dead code once both rows carried a number: that was over-stated. The next vessel arrives with min_gal null and the prompt is right for it. Dormant, not dead.');

-- verify:
--   select name, capacity_gal, min_gal, left(notes, 60) from public.brew_vessels order by sort;
--   -- Cold Brew Avenue 5.0 / 1.0, Toddy (commercial) 2.5 / 0.5, notes unchanged by this run
--   -- re-running the two UPDATEs above must report UPDATE 0 both times
