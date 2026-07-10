# GT3PB Design Standard

The bar, raised after each audit. Every wave ships against this; anything below it is a bug.
"No piecemeal" is the whole document in two words: build projections of one config, not parallel
copies of an idea.

## System architecture

1. **Two axes, never mixed.** Time (Today: My Day · Now — what needs me, cross-lane) and domain
   (work streams: Service · Events · Production · Brand · Business). A surface belongs to exactly
   one axis.
2. **Atoms and roll-ups.** Categories (stop, brew, drop, …) and sections (one page = one job) are
   atoms. `work_streams` is the ONLY roll-up: it drives the nav bar, the calendar's lane filter,
   the org chart's ownership cards, and (next) alert escalation. Never hand-roll a second grouping.
3. **Config over code.** Anything a tenant should reshape (lanes, labels, colors, icons, sections)
   lives in a table, with a typed client fallback (`DEFAULT_*`) so surfaces render before the
   table answers. Personal preference (nav pins) layers on top, per profile — tenant defines the
   menu, the human picks their plate.
4. **Pages own one job.** When a section accretes a second lane's work, split a dedicated page
   into the owning lane (Brew and Garage left Plan/Prep for Production; Goals joined Business).
   Growth = add a page to a lane, never a tab to a pile.
5. **One spine per concept.** Dates: `lib/dates.ts` (localToday for crew-facing, etDayKey for
   commerce keys) — never `toISOString().slice(0,10)`. Alerts: INSERT into `alerts` is the whole
   delivery contract (0157 trigger fans out; never invoke push directly). Plumbing:
   `useRealtimeTable`, `authedFetch`, `uploadToBucket`, `roleOf`/`isLeadership` — no forks.

## Database

6. **Tenant-first at creation** (0158's lesson): every new table gets the founding-tenant default
   on `tenant_id`, the `stamp_tenant` trigger, and the restrictive `tenant isolation` policy IN
   its creation migration — never left for a later loop to discover.
7. **Numbered migrations only**, idempotent (guards on drops, `on conflict do nothing` seeds,
   condition-gated updates so tenant customization is never clobbered). Every migration ends with
   a `-- verify:` footer of scalar-subquery checks, and gets run after applying.
8. **RLS is the API.** Client reads go through policies (`is_staff`/`is_admin` helpers); writes
   that matter are server-only or RPC. A new client surface that reads zero rows is a policy bug
   until proven otherwise — check restrictive policies AND together.

## UI

9. **One grammar per pattern.** Popouts: the canonical `<Sheet>`. Expanders: rotating `.ev-chev`
   + a hint or count in the collapsed state — nothing expandable may look static. Calendars: the
   shared tokens, the same day sheet, the same drag-to-reschedule everywhere.
10. **Honest data or no data.** A number that can't vary (Signal Score ~9/10 by construction) is
    decoration — replace it with a question the operator actually asks (coverage, serve-by,
    stock). Empty states say what will fill them.
11. **Both themes, checked.** Dark shell + crew-day both pass contrast (the crawler's thresholds:
    4.5 body / 3.0 large). New panel text sets its own color — never inherit across a background
    change (the `.liveinst` lesson).
12. **Grep before naming.** New CSS class families get a collision grep first (the `.rail` lesson
    — FloatRail owned it; calendar lanes became `.wsrail-*`).
13. **Copy is plain and gentle.** Say what happens ("Pin up to 4 to your bar — unpin anything, it
    stays here"), never poetic, never jargon-as-drama.

## Process

14. **Design first, then build.** Name the axis, the owner lane, the one job, and where the data
    lives — before code. If a feature has no lane, the lane model is wrong or the feature is.
15. **Gate everything:** `if npm run build; then npm run smoke; fi`, apply + verify migrations on
    prod, verify the built app in the signed-in preview (DOM checks over screenshots for facts),
    then push. Report failures plainly.
16. **Audits raise this bar.** Every audit finding that generalizes becomes a line here, and the
    fix sweeps ALL instances — never just the reported one.

## Locked 2026-07-10 — the day of the great consolidation (rules 17–24; do not go back)

17. **One writer per outcome, one editor per identity, one glance screen.** Delivery outcomes are
    written ONLY in /driver. A stop/event's identity + lifecycle is edited ONLY in its prep hub
    (Route and the calendar deep-link to it — `gt3-prep-open` + `setSection("prep")`). My Day is
    THE start-of-shift glance: needs-you, flags with threads, tasks, note capture. Any surface
    that duplicates one of these jobs is a bug, not a convenience.
18. **Relations over boolean columns** (0173's lesson): if a fact is "which X" and an X table
    exists, model the join (`event_menu_items`), never per-X flag columns. A new product/deal/play
    must appear everywhere by INSERT, not by migration.
19. **The comments table is THE thread engine** (strategy_key or one XOR id); event_tasks is THE
    task engine (one-owner XOR + origin attribution); alerts are THE ping spine (INSERT is the
    whole contract — 0157 fans out). New collaboration features compose these, never fork them.
20. **Visibility is RLS, never UI.** Note tiers (private/team/collab) are policies; comments
    inherit their subject's visibility via RESTRICTIVE policies. Hiding a button is not security.
21. **The motion voice.** Two easing tokens (`--ease`, `--ease-enter`) + `--spring` for sheets —
    no new cubic-beziers. Three shadow tokens per theme. Arrivals stagger (seatIn), sheets exit
    the way they entered (the canonical Sheet owns gesture exits), state that matters settles
    (paid flag) or breathes (LIVE dot) — nothing else moves uninvited. Reduced-motion always wins.
22. **Brand moments are locked assets.** The pour-fill "3" (mask over /public/brand/3-outline.svg,
    never redrawn), the green checkered flag under paid confirmations, HAPTIC.arm on go-live,
    HAPTIC.paid on a live paid-flip. New moments come from the brand kit, not from invention.
23. **Money state is a flag, not a whisper**: stripe + solid chip (green paid / gold due / dim
    done) with `data-`driven copy — never hardcoded "paid". Customer-facing prices show the number
    the CUSTOMER will actually pay first (bring-back vs new-glass defaults by session).
24. **Co-work protocol.** Concurrent sessions each own disjoint files; migration numbers are
    claimed against MAIN AND open branches before writing; branches merge main INTO themselves and
    re-gate before landing; every session's tree must be committed-or-clean before handoff.
