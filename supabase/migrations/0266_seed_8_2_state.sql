-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0266 · SEED THE 8/2 STATE (2026-08-03 — GT3 Command build P3/P5/P6)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- "A session that doesn't update the system didn't happen." The 8/2 strategy session produced 7
-- decisions, 6 open items, 13 pipeline accounts, an Aug–Oct event slate, three gates, and one
-- parked concept — extracted by hand into two PDFs. This migration lands ALL of it on the spines
-- it belongs to, so the OS's own rule is finally satisfied retroactively:
--
--   session      → a meeting note (the record; decisions carry note_id provenance to it)
--   decisions    → strategy_decisions (append-only ledger)
--   open items   → the note's follow-up tasks (critical where they block, dated where dated)
--   pipeline     → 13 accounts on the Playbook enum with priorities + next moves (needs 0265)
--   events       → the Aug–Oct slate (8/15 conflict left VISIBLE — both bookings on the board)
--   gates        → readiness checks on the launch initiative (Gate 1 compliance blocks placement)
--   the Playbook → a Strategy-of-Record note; attach the two PDFs to it (0262 kept-files)
--
-- Every block is guarded where-not-exists — re-apply is a no-op, and rows the crew has since
-- edited are never overwritten. Idempotent; apply after 0265.

-- ── the session note (the record the 8/2 session never had) ─────────────────────────────────────
insert into public.meeting_notes (title, met_on, source, visibility, summary)
select 'Strategy Session · Aug 2 — the cooler session', '2026-08-02', 'strategy', 'team',
'## Decided (7 — in the ledger)
- Mini-fridge cooler over vending machine for partner placement.
- Sampling and pop-ups precede every cooler pitch — adoption before placement.
- Loop return credit is $2 across the board; Salted Latte runs $14 new / $12 Loop.
- Latte ships in the Dusk bottle — returns need no origin tracking.
- Options sheet prints on sturdy cardstock, dual track: cooler + corporate delivery.
- Coupon test ships both variants ($5-off and free-pour-on-return) with distinct QR codes.
- Upstate Spine & Sport is the first sample drop, sequenced through the Sarah relationship.

## Open — decide before the dependent move (filed as follow-ups below)
Commission % · loyalty mechanic · sample timing · cooler-pitch timing · partner return credit · 8/15 coverage.

## Parked
Branded vending — real concept, sequenced after brick-and-mortar. On the parking lot, off the working plan.'
 where not exists (select 1 from public.meeting_notes where title = 'Strategy Session · Aug 2 — the cooler session');

-- ── the 7 decisions + the parked call, with provenance to the session note ──────────────────────
do $$
declare nid uuid;
begin
  select id into nid from public.meeting_notes where title = 'Strategy Session · Aug 2 — the cooler session' limit 1;
  insert into public.strategy_decisions (key, decision, why, author_name, note_id)
  select v.k, v.d, v.w, 'Ryan + Kayla', nid
    from (values
      ('cooler',          'Mini-fridge cooler over vending machine for partner placement.', 'Less friction to install, less for the partner to manage — live in one business day.'),
      ('gtm:sampling',    'Sampling and pop-ups precede every cooler pitch — adoption before placement.', 'The cooler performs only after the program has built its audience.'),
      ('pricing:loop',    'Loop return credit is $2 across the board; Salted Latte runs $14 new / $12 Loop.', 'One flat credit covers the lineup — no per-bottle bookkeeping.'),
      ('product:latte',   'The Salted Latte ships in the Dusk bottle.', 'Returns need no tracking of what the bottle originally held.'),
      ('print:options',   'Options sheet prints on sturdy cardstock, dual track: cooler + corporate delivery.', 'One sheet, both offers, event menu as the teaser.'),
      ('gtm:coupons',     'Coupon test ships both variants — $5-off and free-pour-on-return — with distinct QR codes.', 'A acquires, B retains; the test decides whether both ship.'),
      ('pipeline:upstate','Upstate Spine & Sport is the first sample drop.', 'Warmest relationship (Sarah) plus two cluster accounts riding the same Lawrence Rd stop.'),
      ('parked:vending',  'Branded vending is PARKED — sequenced after brick-and-mortar consideration.', 'Real concept, wrong order. Parked by decision is legal; stalled without one is not.')
    ) as v(k, d, w)
   where not exists (select 1 from public.strategy_decisions s where s.decision = v.d);
end $$;

-- ── the open items + this-week moves → the session note's follow-ups (the ONE task spine) ───────
do $$
declare nid uuid;
begin
  select id into nid from public.meeting_notes where title = 'Strategy Session · Aug 2 — the cooler session' limit 1;
  if nid is null then return; end if;
  insert into public.event_tasks (meeting_note_id, label, kind, section, critical, due_at, sort)
  select nid, v.l, 'task', 'Follow-up', v.c, v.d, v.s
    from (values
      ('Decide partner commission % (band 10–15) — blocks the options sheet and both pitches', true,  '2026-08-04T17:00:00-04'::timestamptz, 1),
      ('Decide the loyalty mechanic — locked pilot (5 returns) vs session float (10) — one ships on partner print', true, '2026-08-06T17:00:00-04', 2),
      ('Decide 8/15 coverage — Wine Xpress truck stop vs Soul Yoga workshop — assign or move', true, '2026-08-08T12:00:00-04', 3),
      ('Quality-test the current batch — go / no-go on this week''s sampling', true, '2026-08-04T10:00:00-04', 4),
      ('Upstate Spine sample drop + dual-track options sheet (via Sarah)', true, '2026-08-05T17:00:00-04', 5),
      ('Print: options sheet, A/B coupon cards (distinct QRs), rinse card — after commission % + loyalty lock', false, '2026-08-07T17:00:00-04', 6),
      ('Confirm Soul Yoga pop-up window Sat 8/8, 9–11 AM — samples + sell bottles', false, '2026-08-06T12:00:00-04', 7),
      ('Decide sample timing at studios (lean after class) + cooler-pitch timing (pop-ups before the ask)', false, '2026-08-08T17:00:00-04', 8),
      ('Decide whether partners earn a credit for facilitated Loop returns', false, null, 9)
    ) as v(l, c, d, s)
   where not exists (select 1 from public.event_tasks t where t.meeting_note_id = nid and t.label = v.l);
end $$;

-- ── the Aug–Oct slate (booked only; the 8/15 conflict stays VISIBLE as two bookings) ────────────
insert into public.events (title, day, location_text)
select v.t, v.d::date, v.l from (values
  ('Soul Yoga Workshop — serve window', '2026-08-15', 'Soul Yoga'),
  ('Sassafras Flower Farm',             '2026-08-23', 'Sassafras Flower Farm'),
  ('Greenville Fit Fest',               '2026-10-03', 'Greenville')
) as v(t, d, l)
 where not exists (select 1 from public.events e where e.title = v.t and e.day = v.d::date);

-- ── the 13 accounts, on the Playbook enum (0265), priorities + next moves ───────────────────────
do $$
declare v record; vid uuid;
begin
  for v in
    select * from (values
      ('Upstate Spine & Sport',    'WHSL+PRTNR',    'P1', 'warm',    'QT Tue 8/4; sample drop + dual-track options sheet this week (via Sarah)', '2026-08-04'::date, null::int),
      ('Soul Yoga',                'W/R/EVENTS',    'P1', 'warm',    'Saturday pop-up 9–11 AM (4 classes); samples + sell bottles; cooler pitch framed inside the offer', '2026-08-08', null),
      ('Back to Nine',             'WHOLESALE',     'P1', 'warm',    'Sampler drop; close a Monday 3-gal pilot (owner asked about permits)', '2026-08-07', null),
      ('Corporate Coffee Program', 'WHOLESALE',     'P1', 'sampled', 'Run sampler → book first 6 Model A accounts', null, null),
      ('Baseline',                 'WHSL/RETAIL',   'P1', 'warm',    'Sampler; scope recurring drop vs. event booking', null, null),
      ('Sunny + Meena Handa',      'RETAIL',        'P1', 'warm',    'Pilot retail presence at the EV charger lot; test dwell traffic', null, null),
      ('Corporate Delivery',       'WHOLESALE',     'P1', 'live',    'Deliver to standard; use as the reference account', null, 177300),
      ('Hot Works',                'WHSL+PRTNR',    'P2', 'lead',    'Cluster play — sample after Upstate lands (same Lawrence Rd complex)', null, null),
      ('Alloy Training',           'WHSL+PRTNR',    'P2', 'lead',    'Same-complex cluster; rides the Upstate route stop', null, null),
      ('Euphoria Office',          'EVENTS/WHSL',   'P2', 'lead',    'Define the objective before sampling; their event cycle lands next month', null, null),
      ('ISI Simpsonville',         'RETAIL/EVENTS', 'P4', 'warm',    'Re-engage for the next monthly mega-workout (missed last)', null, null),
      ('Restore Wellness',         'RETAIL',        'P4', 'warm',    'Nurture; revisit after the compliance gate clears', null, null),
      ('Wine Xpress',              'RETAIL',        'P4', 'warm',    'Run the 8/15 truck stop; measure conversion to D2C', '2026-08-15', null)
    ) as t(nm, cat, pri, stg, mv, mvat, mrr)
  loop
    -- Honor the ONE resolver's philosophy (0226): never mint a near-duplicate. Match exact,
    -- space-insensitive ("WineXpress" = "Wine Xpress"), or containment either way ("Sunny +
    -- Meena Handa" reuses the existing "Meena Handa" account). Only if genuinely absent do we
    -- insert — and if the similarity guard still objects, these are the Playbook's canonical
    -- account names, so the guard's own escape hatch (confirmed_distinct) applies.
    select id into vid from public.vendors
     where archived_at is null and (
       name = v.nm
       or replace(lower(name), ' ', '') = replace(lower(v.nm), ' ', '')
       or lower(v.nm) like '%' || lower(name) || '%'
       or lower(name) like '%' || lower(v.nm) || '%'
     )
     order by (name = v.nm) desc, length(name) desc limit 1;
    if vid is null then
      begin
        insert into public.vendors (name) values (v.nm) returning id into vid;
      exception when others then
        insert into public.vendors (name, confirmed_distinct) values (v.nm, true) returning id into vid;
      end;
    end if;
    if not exists (select 1 from public.opportunities o where o.vendor_id = vid and o.stage <> 'lost') then
      insert into public.opportunities (vendor_id, stage, priority, category, next_step, next_step_at, mrr_cents, source, won_at)
      values (vid, v.stg, v.pri, v.cat, v.mv, v.mvat, v.mrr, 'manual', case when v.stg = 'live' then now() end);
    end if;
  end loop;
end $$;

-- ── the three gates → launch readiness (Gate 1 compliance BLOCKS third-party placement) ─────────
do $$
declare iid uuid;
begin
  select id into iid from public.initiatives where status <> 'done' order by created_at limit 1;
  if iid is null then return; end if;
  insert into public.readiness_checks (initiative_id, label, category, status, critical, note, sort)
  select iid, v.l, v.c, v.st, v.cr, v.n, v.s from (values
    ('Gate 1 · Seals + packaged-beverage labels with verified nutrition', 'legal',   'blocked', true,  'Nothing prints or placements with unverified values — write-in fields stay write-in', 210),
    ('Gate 1 · Shelf-life validated per SKU',                             'product', 'blocked', true,  'Clears before any bottle enters a third-party fridge or shelf', 220),
    ('Gate 1 · Salted Latte dairy flags — pasteurization + 7-day viability', 'product', 'blocked', true, 'The hard one; gates every cooler install. The funnel (pop-ups, sampling) is UNGATED — run it while this clears', 230),
    ('Gate 2 · Solo capacity: book the floor — 4–8 well-converted events/mo', 'ops',  'at_risk', false, '15/mo is a Phase-2-with-helper number; don''t model the ceiling', 240),
    ('Gate 3 · Cash float: bottle-count floor per consignment location; gallon accounts stay paid-on-delivery', 'money', 'at_risk', false, 'Float never touches next-brew working capital', 250)
  ) as v(l, c, st, cr, n, s)
   where not exists (select 1 from public.readiness_checks r where r.label = v.l);
end $$;

-- ── the Strategy-of-Record shelf ────────────────────────────────────────────────────────────────
insert into public.meeting_notes (title, met_on, source, visibility, summary)
select 'Playbook v1.0 — Strategy of Record', '2026-08-03', 'manual', 'team',
'**Layer 1 lives here.** Attach the current *Living Strategy & Playbook* and *Executive OS* PDFs to this note (＋ Add to this note → attach) — they are kept as real files, opened by secure link.

**The versioning law:** these documents change only when a logged decision changes strategy — version increment, never drift. Bump = new addendum + fresh attachment + a ⚖ decision line on this note.

The spine, in one line: **Events open the door. Wholesale compounds. D2C catches the funnel. Retail keeps us present.**'
 where not exists (select 1 from public.meeting_notes where title = 'Playbook v1.0 — Strategy of Record');

-- Verify (prod, after apply):
--   select count(*) from public.opportunities where stage <> 'lost';                                -- ≥ 13
--   select count(*) from public.strategy_decisions where key like any (array['cooler','parked:vending']);
--   select count(*) from public.event_tasks where label like 'Decide partner commission%';          -- 1
--   select count(*) from public.readiness_checks where label like 'Gate %';                         -- 5
