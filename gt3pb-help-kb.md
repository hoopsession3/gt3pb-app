# GT3PB — Help & KB Index (living)

The single map of what's in the app and where it's explained. **Rule: any time a feature is added or
changed, update this file AND the in-app help in the same PR** — so the Section Guide, the Academy,
and this index never drift from the product. If you touched a surface below and didn't update its help,
the change isn't done.

## Where "help" lives (keep all three current)
1. **Section Guide** (in-app, crew) — `SEC_LABEL / SEC_WHEN / SEC_SUB / SEC_MORE / SEC_INSIDE` in
   `app/admin/page.tsx`. Opened from the crew top bar ("ⓘ Guide") or a header WHEN pill. Add a new
   crew surface → add it to the owning section's `SEC_INSIDE`.
2. **Academy / KB** (in-app, training) — `lib/academy.ts` (modules + product cards) and
   `lib/operatorKb.ts`. Operational or product change → reflect it here; keep it claim-safe and
   priced to the truck board.
3. **This index** — the top-level map + the deploy runbook (`gt3pb-deploy-v1.md`).

## Customer surfaces
The customer-facing app is named **"No Noise"** (PWA manifest + home-screen install name + guest-header
wordmark; canonical host `app.gt3pb.com`). "GT3 Performance Bar" stays the brand lockup above it.

| Surface | Route | What |
|---|---|---|
| Home / Today | `/` | Greeting, your usual, **loyalty stamp card**, reserve pitch, day-builder |
| Menu | `/menu` | Full line — Activation, Hydration, Fuel (prices per truck board) |
| Reserve (order-ahead) | `/reserve` | 3/6/12 packs + flavor mix, next-stop pickup |
| Truck | `/truck` | Live location / route |
| Account (3mpire) | `/3mpire` | **Scannable GT3 membership card (unique per-member QR)**, ring, credit, **leave a review**, order history |
| Operator scan | `/scan?m=<code>` | Staff-only: scan a member's card QR → their stamps → **add a stamp** for a walk-up |
| Truck display | `/display` | Full-screen loop for a tablet/TV: menu · brand · guest reviews · connect (scan QR) |
| Connect hub | every screen (side tab) | Floating intent link tree (`components/ConnectHub` + `lib/connect`): "Wanna order / Learn the brew / Connect / Book us" + scan QR. Signed in as owner/admin it adds the gold **Investor brief** group (→ `/built` one-pager, `/architecture`) |

## Crew console sections (`/admin`) — mirror these in the Section Guide
- **My Day** (start of shift) · **Now** (during service) · **Prep** (before the event) ·
  **Plan** (booking ahead) · **Studio** (marketing + **Review Desk → truck display**) ·
  **Money** (the books) · **Team** (people & roles) · **Ask GT3** (playbook, floats).

## Crew console navigation (how to move around `/admin`)
- **Sections are URL-backed** — switching section is a real history entry (`/admin?s=prep`), so the
  phone/browser **Back button and swipe-back work**, and a `?s=` link deep-links to a section.
  Owned by `OperatorSectionProvider` (`components/OperatorNav.tsx`); the console `‹` walks section
  history first, only leaving crew mode (→ `/3mpire`) when there's none left.
- **Swipe-back** — a left-edge drag walks section history (installed PWAs have no OS edge-swipe).
  `components/SwipeBack.tsx`; only fires when there's history, never drops you out of crew by accident.
- **Scroll is remembered per section** (`components/ScrollRestore.tsx`) — back into a long Prep/Money
  list and you land where you were.
- **Breadcrumbs** show in the section header for deep views (e.g. `Prep › Atlanta BeltLine`). Generic
  mechanism (`components/Crumbs.tsx` → `useCrumb(id, label, go)`); wired into `PrepDetail`. Any new
  drilldown opts in with one `useCrumb()` call.
- **Jump / ⌘K** — command palette (`components/CommandPalette.tsx`): quick-jump to any role-allowed
  section, recent event/stop, or action (scan, customer view). The **Jump** chip in the crew top bar
  opens it on touch; ⌘K / Ctrl-K on desktop. Recents come from `lib/recents.ts` (record a visit with
  `recordRecent(kind, id, label)` from `components/recents.ts`).
- **A11y**: skip-to-content link, the section body is a focused labelled region on change, roving
  arrow-keys in the nav tablist, and the palette returns focus to its trigger on close.

## Data the customer sees publicly is always cleaned
- Guest reviews pass through `lib/reviews.ts` (anonymize to first name + initial, strip PII, mask
  profanity, drop <4★/spam) and must be **staff-approved** (Studio → Review Desk) before the display
  shows them. Reviews from Google / Instagram / the feedback album are added there too. Each pending
  review can be **approved as-is** or **✨ Simplified** — an AI editor (Haiku, `/api/reviews/simplify`)
  trims it to a display-ready line and **removes any health/medical claim** without inventing praise;
  the operator accepts the suggestion or keeps the original.

## UI standards
- **Collapsible sections** = the `Panel` primitive (`app/admin/page.tsx`) — tappable header + chevron,
  remembers open/closed per id. Use it for any new stacked crew section (Money and the Now management
  panels already do). Keep specialized accordions that carry extra affordances (the Prep `row()` with
  icons/subtitles, the KDS stage groups with live counts) — they're intentionally not plain Panels.
- **Quiet by default**: in a stacked section, open only the primary panel; collapse the rest.

## Reliability & trust (audit hardening, 2026-07-08)
- **CI**: `.github/workflows/ci.yml` runs build + smoke on every push/PR — the hand gate, automated.
- **Error visibility**: client errors (window errors, unhandled rejections, error-boundary hits)
  ship to `/api/errors/report` → deduped into `client_errors` (0133); the FIRST occurrence of a new
  error raises a crew-inbox alert (critical if a screen crashed). Telemetry is fail-silent — it can
  never make the app worse. Reporter: `components/ErrorReporter.tsx`.
- **Offline ops**: the pass keeps working with no signal. Status taps queue
  (`lib/offline.ts` pure math + `components/offline.ts` engine, coalesced per order — final state
  wins) and replay in order on reconnect; a fresh open renders the last-known board, labeled. The
  `OfflineChip` (crew console) shows offline/queued/syncing truth and owns the replay triggers.
  Customer pass shows "offline — last known". `sw.js` still never caches `/api` — snapshots are
  app-level on purpose.
- **Tenancy (R-002)**: 0134 enforces isolation at the DB — `stamp_tenant()` triggers on write +
  restrictive `"tenant isolation"` RLS policies wherever RLS is on; anon resolves to the founding
  GT3 tenant so public surfaces are unchanged. Service-role routes still need the
  `tenantFromRequest()` sweep before tenant #2 (tracked in RISK_REGISTER R-002).
- **Software billing (scaffold, dormant)**: 0135 adds `tenants.plan` + Stripe columns;
  `/api/billing/checkout|portal|webhook` are live once `STRIPE_SECRET_KEY` / `STRIPE_PRICE_PRO` /
  `STRIPE_WEBHOOK_SECRET` exist (Google-Wallet precedent). Feature gating = `lib/plan.ts`
  (`planAllows` / `planActive`, smoke-tested). GT3 is the `founder` tenant: everything, never billed.

## Loyalty
- `profiles.points`, +1 per drink on pickup (migration `0012`). Stamp card = a view of that; "10th on
  us." No separate data.

## Migration ledger (apply in order on prod; all idempotent)
Through **0132** — see `gt3pb-deploy-v1.md` for the full table + verify SQL. Newest:
`0128` restore Tide + broths · `0129` sold-out (86) · `0130` 86 lifecycle (stamp + 4am reset) · `0131` reviews table · `0132` membership scan (`member_by_code` + `award_manual_point`).
