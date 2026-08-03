-- 0269 — Changelog Wave 3 + the no-drift rule (2026-08-03, Ryan: "I don't want no drift anywhere
-- again"). The app's institutional memory had frozen at 2026-07-16 while ~20 rounds shipped. This
-- wave backfills every round since, same idempotent shape as 0200/0235/0241 (skips any title
-- already present), and from this round forward the release gate itself enforces the record:
-- scripts/drift.check.mjs fails the build when a migration ships schema without shipping its own
-- changelog entry (or an explicit, greppable opt-out). The record can no longer drift, because
-- drifting no longer passes the gate.

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values

  -- ── July 18–23 · stops, delivery, alerts ─────────────────────────────────────────────────────
  ('Truck stops wind themselves down','improvement','Ops',
   'A stop now takes a close time and handles its own end-of-day: live status and ordering wind down on schedule, ordering closes BEFORE the truck goes offline (never after), and staff can take the truck offline right from the Stops screen.',
   '2026-07-18', false),
  ('Find Us tells the truth to the minute','fix','Brand',
   'A run of public-page fixes: the truck hero''s cut-off time, a blank Starts field, a misleading "Next Fri" label, and crew-typed am/pm times now normalized so the public page always reads clean.',
   '2026-07-19', false),
  ('Delivery packs resized to 6 / 12 / 24','improvement','Delivery',
   'Delivery pack sizes changed from 12/24/36 to 6/12/24 — a smaller front door — and the price tiles became bring-back-aware, matching pickup, so returning bottles shows its discount up front.',
   '2026-07-20', false),
  ('Booking requests email the crew','improvement','Alerts',
   'A booking request now lands in email as well as the app, stamped with its true submission date — no more discovering a lead days later.',
   '2026-07-23', false),
  ('The craft story meets customers everywhere','brand','Brand',
   'The chemistry-of-the-cup education (cold extraction, whole ingredients, the why) now appears across the customer journey instead of living only on the Menu page.',
   '2026-07-27', false),

  -- ── July 28–29 · membership, crew console ────────────────────────────────────────────────────
  ('Founding and Founding VIP become two real tracks','feature','Membership',
   'Founding (the tier) and VIP (bottle-verified) are now separate: VIP carries its own perks, staff choose the right one at verification or grant VIP by hand, and every signup seeds its customer-book row from day one.',
   '2026-07-28', false),
  ('The keyboard stopped eating Save buttons','fix','Crew',
   'Every popout''s Save/submit used to hide behind the iOS keyboard; now the footer pins above it, the nav and float rail duck out of the way, and the member card gained a multi-platform "Share your status" button.',
   '2026-07-29', false),
  ('Crew console: fewer sections, clearer doors','design','Crew',
   'Goals merged into Command and Route into Plan (sections earn their tab or fold in), KPIs became clickable doors to their detail, and Events pinned where the day starts.',
   '2026-07-29', false),

  -- ── July 30 · performance, notify engine, economics ──────────────────────────────────────────
  ('The app got dramatically lighter and tougher','ops',null,
   'The crew console''s main bundle dropped from 780 kB to 348 kB, the offline shell now covers crew and driver screens, and the server watches itself: 500s self-report, /api/health answers, and a database watchdog runs on a schedule.',
   '2026-07-30', true),
  ('The notify engine: email joins push','feature','Alerts',
   'Sign-ups, delivery orders, and reserves now email the business; critical alerts and tasks email their owners; every event sends exactly one push — and the admin list rides BCC on customer mail.',
   '2026-07-30', false),
  ('The menu price IS the projection price','money','Money',
   'Product economics stopped carrying hand-typed prices: projections now read the live menu, so a reprice in Money flows straight through every forecast.',
   '2026-07-30', false),
  ('"Ping me when the truck goes live"','growth','Ordering',
   'Customers can ask to be pinged when the truck goes live — the first standing customer notification, wired into the same notify engine.',
   '2026-07-30', false),

  -- ── August 1 · checkout hardening, calendar, public polish, enterprise ───────────────────────
  ('Checkout can no longer double-charge on a retry','fix','Money',
   'Two payment-integrity holes closed: the app ID now decides the Square environment (no cross-environment surprises), and a retried payment mints a fresh idempotency key so a network blip can''t create a second charge.',
   '2026-08-01', true),
  ('One company calendar','feature','Crew',
   'Events, stops, prep, and the sales rhythm roll up into a single calendar every role can open; every item edits in a pop-out and a swipe walks the whole schedule.',
   '2026-08-01', true),
  ('The public face got its 10/10 pass','design','Brand',
   'Find Us leads with the Where (a deliberate address lockup, stop/event parity throughout); the customer flow took a full pass — contrast, one type voice, order affordances, a cart that survives navigation.',
   '2026-08-01', false),
  ('The funnel got its shape','ops','Pipeline',
   'The sales pipeline reads as a funnel (stage rail, counts, colored stage grammar), alerts went 7→10 with every card carrying its age, and every audited defect in the two top priority bands landed.',
   '2026-08-01', false),
  ('Enterprise round: the paper trail','security',null,
   'Admin actions now write an audit trail; exports, receipts, an integrations pane, and the legal pages landed; a blind-spot sweep closed consent, traceability, offline, and runbook gaps — with zero known CVEs in the dependency tree.',
   '2026-08-01', true),

  -- ── August 2–3 · the executive weekend ───────────────────────────────────────────────────────
  ('Notes never freeze','feature','Crew',
   'Meeting notes became living documents: append-only addenda (nothing is ever overwritten), kept files on a private shelf, per-note discussion threads, refreshable AI recaps, and editable titles.',
   '2026-08-02', false),
  ('The executive rhythm lands','feature','Crew',
   'A weekly operating review and strategy-session assembler that write themselves from real data, the decision ledger surfaced with follow-through (every decision can carry its task), one-tap goal check-ins that roll risk onto the Command Board, and a discussions rail.',
   '2026-08-02', true),
  ('GT3 Command: the Executive OS','feature','Crew',
   'The company now runs in the app: a ten-workstream registry with the Monday five-criteria audit, the Playbook''s twelve KPIs on one board, pipeline stages moved onto the Playbook''s own language (lead → warm → sampled → pilot → live → expand), and the entire 8/2 strategy session seeded as working state.',
   '2026-08-03', true),
  ('Utilization, extraction, and live meters','feature','Crew',
   'Owner-only team utilization (who''s in the system, sign-ins, last action — and guest counts with zero PII), a paste-the-transcript session extractor that files decisions, follow-ups, events, and pipeline moves on their spines, KPIs beginning to compute themselves, and batch traceability on delivery.',
   '2026-08-03', false),
  ('Activation economics: every account knows its cost to uplift','feature','Pipeline',
   'Every activation touch (pop-up, sampler, restock) logs with a cost, so each account shows spend against its Playbook budget band and live payback. QR coupon cards ride the existing code engine with self-counting scans, the Loop return ledger opens with the decided $2 credit, and eleven of the twelve KPIs now compute live.',
   '2026-08-03', true),

  -- ── the rule that keeps this page honest ─────────────────────────────────────────────────────
  ('The record can''t drift anymore','ops',null,
   'This page had silently fallen three weeks behind the actual shipping pace. Now the release gate enforces it: a build that ships database changes without shipping its own changelog entry fails before it can leave the shop, and the customer concierge''s knowledge gets refreshed in the same pass.',
   '2026-08-03', false)

) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- Verify (prod, after apply):
--   select count(*), max(shipped_on) from public.changelog;   -- 85 + 23 = 108 · 2026-08-03
