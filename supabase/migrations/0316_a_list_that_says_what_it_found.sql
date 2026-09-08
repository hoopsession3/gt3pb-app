-- 0316 — A LIST THAT SAYS WHAT IT FOUND (2026-09-08)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Reading 0315 on the deployed page. The stop record sheet was right; the LIST above it was not,
-- and the list is what a person actually looks at.
--
-- Three name_drift rows, rendered live:
--
--     Wine Express — Five Forks   guests see this   The stop and the venue disagree about what
--     Restore Hyper Wellness      guests see this   this place is called. Guests see the stop's
--     Wine Express Saturday       guests see this   name. Decide which is right. A name like
--                                                   "— Five Forks" or "Saturday" usually means…
--
-- Two things wrong with that, and they are the same thing twice.
--
--   1. It never says what the venue calls it. The whole point of the 0315 correction was that this
--      app should show BOTH names and take no side — and the list shows one. Three rows that look
--      identical, and nothing on any of them tells you what the disagreement is. You have to open
--      each sheet to find out, which is what the list existed to save you.
--
--   2. The advice is generic, so it is wrong for one of the three. "A name like '— Five Forks' or
--      'Saturday' usually means the venue needs a second location" is exactly right for two rows
--      and nonsense for Restore Hyper Wellness, whose venue row reads "Restore Wellness" — a
--      different word, not a location suffix. lib/stopRecord.looksLocationQualified() was written
--      for precisely this distinction in 0315 and then used on ONE of the two surfaces.
--
-- ── THE SPLIT THIS TAKES ───────────────────────────────────────────────────────────────────────
-- The tempting fix is to build the sentence in SQL: `'The stop says "' || r.name || '"…'`. That
-- would put a second implementation of "is this name location-qualified" into the database beside
-- the one in lib/stopRecord, and a second copy of a rule is the defect this whole audit is about.
--
-- So the view supplies DATA and the module supplies WORDS. All this migration does is carry the
-- venue's name out to the row, so the list can say the same true thing the sheet already says,
-- using the same function.
--
-- changelog: covered below.

-- ── v_stop_gaps: carry the other name ──────────────────────────────────────────────────────────
-- security_invoker (0312's rule). v_stop_record beneath it is invoker too, so a member reading this
-- gets their own RLS on stops, not postgres's.
create or replace view public.v_stop_gaps with (security_invoker = on) as
select r.id as stop_id,
       coalesce(nullif(btrim(r.name), ''), '(unnamed)') as name,
       r.starts_at, r.status, r.phase, g.gap, g.detail, g.severity,
       -- NEW, and APPENDED rather than slotted in beside `name` where it belongs to read. Postgres
       -- refuses to insert a column into the middle of an existing view:
       --     ERROR 42P16: cannot change name of view column "starts_at" to "canonical_name"
       -- create-or-replace can only add at the end. The alternative is drop + create, which throws
       -- away the grants and every dependent object, for the sake of column order nobody sees.
       --
       -- What 0226's model says the place is called. Null-safe — canonical_name already coalesces
       -- to the stop's own name, so an unlinked stop reports the two as equal and the client
       -- renders no comparison rather than a comparison against nothing.
       r.canonical_name,
       r.vendor_id
  from public.v_stop_record r
  cross join lateral (values
    -- Deliberately still generic, and shorter than it was. The row now carries both names, so the
    -- SPECIFIC sentence ("The stop says X. The venue says Y.") is built once in lib/stopRecord and
    -- rendered by both the list and the sheet. A second copy of it here is how they drift apart.
    ('name_drift', 'The stop and the venue disagree about what this place is called.', 'high',
       r.name_is_stale),
    ('no_pin',     'No map pin, so directions do not work for anyone trying to find the truck.', 'high',
       r.lat is null or r.lng is null),
    ('no_day',     'No date or time, so it appears on no calendar and in no week.', 'high',
       r.starts_at is null),
    ('live_past',  'Flagged as the live stop, but its window closed. The public page still points here.', 'high',
       r.is_live_now and r.phase = 'past'),
    ('unlinked',   'Not linked to a venue. Typing the name again next time is how one place becomes three.', 'medium',
       r.vendor_id is null),
    ('addr_drift', 'The address on this stop differs from the venue''s. One of the two is out of date.', 'medium',
       r.vendor_id is not null
         and coalesce(btrim(r.vendor_address), '') <> ''
         and btrim(coalesce(r.address, '')) <> btrim(coalesce(r.vendor_address, ''))),
    ('stale_status','The window closed more than eight hours ago and this still reads upcoming.', 'medium',
       r.status = 'upcoming' and r.phase = 'past'),
    ('no_recap',   'Finished, with no after-action note.', 'low',
       (r.status = 'done' or r.completed_at is not null) and coalesce(btrim(r.recap), '') = '')
  ) as g(gap, detail, severity, hit)
 where g.hit
   and r.archived_at is null;

revoke all on public.v_stop_gaps from anon;
grant select on public.v_stop_gaps to authenticated;

comment on view public.v_stop_gaps is
  'Every way a stop currently contradicts itself, the calendar, or the venue it is linked to. Carries canonical_name so a LIST can state the disagreement, not just report that one exists — the sentence itself is built in lib/stopRecord so both surfaces say it the same way. Archived stops excluded: an archived mistake is filed, not outstanding.';

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The stops check now tells you what the disagreement is','fix','Plan',
   'The list of stops needing attention could tell you a stop and its venue disagreed about the name, but not what either of them said — three rows, identically worded, and the only way to find out was to open each one. It now names both, the way the stop''s own page does. The advice underneath adapts too: a name that is the venue plus a location or a day ("— Five Forks", "Saturday") gets told that is usually a missing second location rather than a typo, and a name that differs some other way does not get told something that does not apply to it.',
   '2026-09-08', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0316_a_list_that_says_what_it_found',
  'v_stop_gaps carries canonical_name and vendor_id so the list can state the name disagreement instead of only reporting one; the sentence is built in lib/stopRecord and shared by the list and the record sheet.');

-- verify:
--   select name, canonical_name, gap from public.v_stop_gaps where gap = 'name_drift';
