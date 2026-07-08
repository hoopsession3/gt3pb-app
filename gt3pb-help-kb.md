# GT3PB "No Noise" — Help & KB Index (living)

The single map of what's in the app, why it works the way it does, and where each thing is
explained. **Rule: any time a feature is added or changed, update this file AND the in-app help in
the same PR** — the Section Guide, the Academy, and this index never drift from the product. If you
touched a surface below and didn't update its help, the change isn't done.

## Where "help" lives (keep all three current)
1. **Section Guide** (in-app, crew) — `SEC_LABEL / SEC_WHEN / SEC_SUB / SEC_MORE / SEC_INSIDE` in
   `app/admin/page.tsx`. Opened from the crew top bar ("ⓘ Guide") or a header WHEN pill. Add a new
   crew surface → add it to the owning section's `SEC_INSIDE`.
2. **Academy / KB** (in-app, training) — `lib/academy.ts` (modules + product cards) and
   `lib/operatorKb.ts`. Operational or product change → reflect it here; keep it claim-safe and
   priced to the truck board.
3. **This index** — the top-level map + the deploy runbook (`gt3pb-deploy-v1.md`) + the risk
   Delivery build: read `GT3-Delivery-Audit.md` FIRST — what already exists vs the Cowork debrief.
   register (`RISK_REGISTER.md`).

---

# 1 · The customer app

The customer-facing PWA is named **"No Noise"** (manifest + home-screen install name + guest-header
wordmark; canonical host `app.gt3pb.com`). "GT3 Performance Bar" stays the brand lockup above it.

| Surface | Route | What |
|---|---|---|
| Home / Today | `/` | Greeting, your usual, **loyalty stamp card**, reserve pitch, day-builder |
| Menu | `/menu` | Full line — Activation, Hydration, Fuel (prices per truck board) |
| Reserve (order-ahead) | `/reserve` | **Your pack** (track · change · cancel) + 3/6/12 packs, flavor mix, next-stop pickup |
| Truck | `/truck` | Live location / route |
| Account (3mpire) | `/3mpire` | **Scannable membership card (unique per-member QR)**, ring, credit, leave a review, order history |
| Operator scan | `/scan?m=<code>` | Staff-only: scan a member's card QR → their stamps → add a stamp for a walk-up |
| Truck display | `/display` | Full-screen loop for a tablet/TV: menu · brand · guest reviews · connect (scan QR) |
| Sunday delivery | `/delivery` | Zone check → pack (12/24/36) → build → refill swap (empties ack) → address → pay on order. Cutoff Fri 6 PM ET, porch drop Sun 5–8 AM. Loop tier = direct channel only (`lib/delivery`) |

**The floating rail** (`components/FloatRail.tsx`) is the one home for every floating tab —
**Display** (text size · contrast), **Connect** (the intent link tree from `lib/connect`; owner/admin
sign-in adds the gold **Investor brief** group → `/built`, `/architecture`), and **Ask us** (the
concierge). The rail is **movable** (drag the ≡ grip; position persists), **collapsible** (› folds
to a slim ‹ handle; persists), and **insightful expanded** (icon + label + purpose on every tab).
The left edge stays clear on purpose — that's the crew's swipe-back zone. New floating affordances
go INSIDE the rail, never loose on the screen.

## Ordering rules — why you can't always buy a cup
One rule, one source of truth, enforced at every layer so it can't be dodged or drift:
- **Cups sell only when there's a truck to make them** — while the truck is **live**, or inside the
  operator's window before the next stop. "Ready in ~8 min" must always be true.
- **The window is the operator's dial**, not a hardcoded rule: Now → Live truck → **"Cup orders
  open: Live only / 2h / 4h / 8h before"** (`live_status.preorder_lead_h`, 0137). *Live only* is
  strict — the go-live toggle is the gate.
- Enforced three times with the same function (`lib/orderAhead.preorderWindow`): the **menu drink
  sheet** (Add becomes "Truck's closed — reserve a pack ›"), the **checkout sheet** (explains when
  ordering opens, names the next stop), and **`/api/checkout`** (authoritative, before any charge).
- **Pack reserves are always open** — brewed to order for the next drop; the closed states route
  people there instead of dead-ending them.

## Customer self-service — the loop closes both ways
- **Your pack** (`components/MyPacks.tsx`, top of `/reserve`): members see upcoming reservations
  live — staff checking them off at the truck flips the card to "picked up" in front of them.
  **Change** prefills the form and the new reservation cancels the old (never a double-brew);
  **Cancel** runs `cancel_own_reservation` (0136 — owner-only, refuses picked-up; a PAID cancel
  raises the same refund alert staff cancels do, so the crew inbox is the single refund queue).
- **Talk to the truck** (quick replies under the order banner → `set_order_eta`, 0138): active
  orders carry one signal — 🏃 on my way · 📍 I'm outside · ⏰ running late. The pass shows it on
  the order card and **OUTSIDE rings the KDS once** — call the name. Tapping the active chip clears
  it. The vocabulary is fixed on purpose: glanceable on a busy pass, can't carry PII or abuse, and
  each value can drive behavior.
- **Order notifications** are managed in the profile sheet — real permission state, one tap to
  enable order-ready pings, honest copy when the OS has them blocked.
- **Cup orders**: live status banner (received → preparing → ready), self-cancel while still 'new'
  (`cancel_own_order`, 0118), offline shows "last known" instead of vanishing.

## Loyalty
`profiles.points`, +1 per drink on pickup (0012). The stamp card and the membership-card ring are
views of that number — "10th on us." No separate data to reconcile. Walk-up stamps: staff scan the
member QR (`/scan`, RPCs in 0132).

---

# 2 · The crew console (`/admin`)

## Sections — when to use what
**My Day** (start of shift) · **Now** (during service) · **Prep** (before the event) · **Plan**
(booking ahead) · **Studio** (marketing + Review Desk → truck display) · **Money** (the books) ·
**Team** (people & roles) · **Ask GT3** (the playbook, floats everywhere).

- **Now is the service console**, ordered by what you touch most mid-rush: alerts → **the pass** →
  **the drop** (reserves & packs pickup checklist — brew sheet, check-offs, move/cancel) → **86
  board** → Live truck (go live + GPS; locations & the ordering dial: Plan › Truck stops) → Event heads-up → personal tasks.
  **Service mode** (button at top; Esc exits) is the pass + pickups full-screen, nothing else.
- Two kinds of "reserves," on purpose: the Saturday **pack** reserves live in Now → the drop;
  **Plan → back office → Reserves** is the *limited small-batch reserve* product (claims).
- **Tab order is operating rhythm, not alphabet** — bottom nav: Today → Plan → Studio → Money (the
  arc of a working day); Plan sub-tabs: Calendar (when) → Events (what) → Truck stops (where) →
  Bookings (requests in) → Brew (production) → Notes, divider, back office (Vendors · Reserves).
  New tabs slot into the rhythm, not onto the end.

## Navigation (the "pay for this" layer)
- **Sections are URL-backed** (`OperatorSectionProvider`, `components/OperatorNav.tsx`) — every
  switch is a real history entry (`/admin?s=prep`), so the phone's Back button works, links
  deep-link, and the console `‹` walks section history before it ever exits crew mode.
- **Swipe-back** (`components/SwipeBack.tsx`) — left-edge drag walks history; installed PWAs have
  no OS edge-swipe, so the app provides one. Only fires when there's history to walk.
- **Scroll restoration** (`components/ScrollRestore.tsx`) — each section remembers where you were.
- **Breadcrumbs** (`components/Crumbs.tsx`) — deep views register one `useCrumb(id, label, go)`
  call and the header shows `Prep › Atlanta BeltLine` with a clickable root. Wired into PrepDetail;
  any new drilldown opts in the same way.
- **Jump / ⌘K** (`components/CommandPalette.tsx`) — quick-jump to any role-allowed section, recent
  event/stop (`lib/recents.ts` MRU; record visits with `recordRecent`), or action. The **Jump**
  chip is the touch entry; ⌘K on desktop.
- **A11y**: skip-to-content link, section body is a focused labelled region on change, roving
  arrow-keys in the nav tablist, palette returns focus on close.

## UI standards
- **Collapsible sections** = the `Panel` primitive (`app/admin/page.tsx`) — tappable header +
  chevron, remembers open/closed per id. Specialized accordions that carry extra affordances (Prep
  rows, KDS stage groups) are intentionally not Panels.
- **Quiet by default**: open only the primary panel in a stacked section; collapse the rest.
  The drop's name-by-name pickup checklist folds behind its progress line and opens itself only
  on the drop's date (window work) — prep days show just the counts; tap the line to peek any time.
- **Floating affordances** live in the rail (see §1); crew-only floats (theme toggle, QuickDock ✦)
  keep their corners but must never overlap rail, order banner, or cart bar.

---

# 3 · The systems that keep it honest

- **CI** (`.github/workflows/ci.yml`) — build + smoke on every push/PR. The same gate we always ran
  by hand, automated so a red commit can't reach main unnoticed.
- **Client error telemetry** (`components/ErrorReporter.tsx` → `/api/errors/report` → `client_errors`,
  0133) — window errors, unhandled rejections, and error-boundary (white-screen) hits are
  fingerprinted and deduped; the FIRST occurrence of a new error raises a crew-inbox alert
  (critical if a screen crashed). Fail-silent by contract: telemetry can never make the app worse.
  A field breakage reaches the inbox in minutes instead of arriving as a churn complaint.
- **Offline ops** (`lib/offline.ts` pure math + `components/offline.ts` engine + `OfflineChip`) —
  food trucks work dead zones, so the pass keeps working without signal: status taps queue
  (coalesced per order — final state wins) and replay in order on reconnect; a fresh open renders
  the last-known board, clearly labeled. The chip shows offline/queued/syncing truth and owns the
  replay triggers. `sw.js` still never caches `/api` — snapshots are app-level on purpose.
- **Tenant isolation** (0134 — **applied to prod 2026-07-07: 52 stamp triggers + 52 restrictive
  policies, zero RLS-off exceptions**) — `stamp_tenant()` stamps the caller's tenant on every
  write; restrictive `"tenant isolation"` policies AND onto existing RLS. Anon resolves to the
  founding GT3 tenant, so public surfaces are unchanged. Remaining before tenant #2: the
  service-role route sweep with `tenantFromRequest()` (`lib/apiAuth.ts`) — tracked as R-002.
- **Software billing scaffold** (0135, dormant until Stripe env) — `tenants.plan` + Stripe columns;
  `/api/billing/checkout|portal|webhook` wake when `STRIPE_SECRET_KEY` / `STRIPE_PRICE_PRO` /
  `STRIPE_WEBHOOK_SECRET` exist (the Google-Wallet precedent). Feature gating = `lib/plan.ts`
  (`planAllows` / `planActive`, smoke-tested). GT3 is the `founder` tenant: everything, never billed.
- **Public data is always cleaned** — guest reviews pass through `lib/reviews.ts` (anonymize to
  first name + initial, strip PII, mask profanity, drop <4★/spam) and must be staff-approved
  (Studio → Review Desk) before the display shows them. ✨ Simplify (`/api/reviews/simplify`) trims
  a quote to display-ready and removes any health/medical claim without inventing praise.
- **The deterministic core** — money/ops math lives in pure `lib/*.ts` (orderAhead, cogs, loadout,
  reviews, recents, offline, plan) exercised by `npm run smoke` (142 assertions). If it computes a
  price, a window, or a queue, it's pure and tested — components only render it.

## Migration ledger
Through **0139** — full table + verify SQL in `gt3pb-deploy-v1.md`. Newest:
`0133` client errors · `0134` tenant enforcement (on prod) · `0135` software billing (dormant) ·
`0136` reservation self-service · `0137` pre-order window dial · `0138` order eta comms · `0139` Sunday delivery (orders + waitlist + cancel RPC).
