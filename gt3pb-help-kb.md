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

## Payment paths — how customers pay (Money → Checkout & payments)
Two independent switches, both surfaced in the crew Money section (`components/PaymentSettings.tsx`):
- **Card checkout** is on when the **Square env keys** are set on the host (read-only status). The
  exact keys to connect Square are in `gt3pb-deploy-v1.md`.
- **Pay at pickup / on delivery** is the owner's toggle (`live_status.pay_at_pickup`, 0145,
  default ON). Read everywhere by `usePayAtPickup()`; the cup **checkout**, the pack **reserve**,
  and **Sunday delivery** all offer a pay-later path when it's on — on its own when Square is off,
  or as the secondary action beside the card when Square is on. Delivery's card-less path is
  enforced server-side in `/api/delivery/checkout` (records `payment_method='pay_on_delivery'`,
  `payment_status='unpaid'`). **Default-ON means a real order can be placed and tasted end-to-end
  before Square is even connected.** If BOTH are off, no order can be placed (by design).

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

## The membership economy (loyalty · referral · streak · credit)
- **Stamps** — `profiles.points`, +1 per drink on pickup (0012). The stamp card and the
  membership-card ring are views of that one number — "10th on us." Walk-up stamps: staff scan the
  member QR (`/scan`, RPCs in 0132). *Strategy pilot (not yet built): 5 bottle RETURNS = one free
  Performance drink — the delivery `empties_collected` log is its future data source.*
- **Referral** — give $5, get $5 (`referral_events`): a friend joins with your code and makes their
  first order → both sides get credit automatically. The 3MPIRE card shows friends joined + earned.
- **Streak** — `profiles.streak_days`, consecutive-day visits; shown on the member stat line.
- **Credit** — `profiles.credit_cents` (referral + goodwill); only renders when non-zero.

---

# 2 · The crew console (`/admin`)

## Sections — when to use what
**My Day** (start of shift) · **Now** (during service) · **Prep** (before the event) · **Plan**
(booking ahead) · **Studio** (marketing + Review Desk → truck display) · **Money** (the books) ·
**Team** (people & roles) · **Ask GT3** (the playbook, floats everywhere).

- **Now is the service console**, ordered by what you touch most mid-rush: alerts → **the pass** →
  **the drop** (reserves & packs pickup checklist — brew sheet, check-offs, move/cancel) → **86
  board** → Live truck (go live + GPS; locations & the ordering dial: Plan › Truck stops) → Event heads-up → personal tasks.
  **Now is the glance, Service is the work.** Now shows alerts, the service pulse (live counts:
  orders on the pass, items 86'd — the counts ARE the button), the drop's prep face (brew sheet +
  window money) and Sunday delivery. **Service mode** (one tap; Esc exits) is the only place the
  boards render: the pass (tickets flow two-up on wide screens) with a sticky rail — pickup
  checklist and the 86 board — so nothing lives on two screens and 86ing a flavor mid-rush is a
  tap, not an exit.
  **Moving a pack to the next drop** now targets the truck's next scheduled stop (route truth,
  +7 days only if the calendar is empty), and the moved pack stays visible under **Upcoming
  drops** with a one-tap "← This drop" way back — nothing ever leaves every surface.
- Two kinds of "reserves," on purpose: the Saturday **pack** reserves live in Now → the drop;
  **Plan → back office → Reserves** is the *limited small-batch reserve* product (claims).
- **Studio holds the brand machine**: the campaign generator (drafts in GT3 voice, checked by the
  caption linter — which now enforces the strategy's locked banned-copy rules), Brand Kit (locked
  logo art + uploads), Brand & Company calendars, the repurpose engine, and the **Review Desk**
  (approve or ✨ Simplify guest reviews → the truck display).
- **Money holds the whole ledger**: Sales (revenue/orders/AOV/margin by range) · Business snapshot
  (incl. MRR + subscribers) · Per-event P&L (plan vs actual, ROI, break-even) · Product economics ·
  COGS calculator · Membership plans · Subscribers · Order history. Every GTM play's actuals land
  here — the Playbook page (below) links each play to where Money scores it.
- **Tab order is operating rhythm, not alphabet** — bottom nav: Today → Plan → Studio → Money (the
  arc of a working day); Plan sub-tabs: Calendar (when) → Events (what) → Truck stops (where) →
  Bookings (requests in) → Brew (production) → Notes, divider, back office (Vendors · Reserves).
  New tabs slot into the rhythm, not onto the end.

## Approve posts from the notification (no calendar detour)

A "content ready for review" alert now opens an **approval sheet right in the inbox** — like the
reservation drop card — instead of jumping to the (noisy) calendar. Edit the caption to revise,
**Approve** (saves the edit) or **Request changes** with a note; the creator is notified and the
alert **clears** once you act. Studio's flow is de-noised: the content workspace leads, and the
**App splash** (the guest pop-up editor) + **Customer reviews** collapse into labelled panels. The
App splash panel now states what's showing now — a custom promo, or the built-in "Own your week."

## The app splash + dynamic bulk-order menu (0144)

**Splash**: the app opens to a marketing card for guests — leads with the pack pitch, shown **once
per app open** (per session; reopening shows it again, navigating within a session doesn't re-nag),
closeable three ways (X, tap-outside, "Maybe later"). It's **owner-editable** with no deploy —
**Studio → App splash** sets the headline, benefit line, button label + link, and the live toggle.
Renders nothing when no promo is active. **Dynamic bulk-order**: any menu item can be flagged
**Available for bulk / delivery pack** in Money → Menu & products, with a tier — *brew* (the
refillable daypart core, Loop \$8 / new \$10) or *premium* (a flat \$14 add like the Salted Latte).
The delivery pack builder's premium adds are driven by this flag (cohesive products → UI → DB), so
the owner adds a new \$14 bottle without code. Falls back to the static Salted Latte pre-migration.

## Train the AI (Team → Train the AI, owner)

The freeform agents (Operator "Ask GT3", the guest Concierge) used to answer from a fixed
knowledge file with no way to correct a wrong answer. Now the owner writes a **correction**
(title + the right fact, optionally with a photo of the recipe card / receipt as proof); it's
injected as an **authoritative override** at the top of that agent's prompt, so it beats the
built-in knowledge and the agent can't contradict it. Every agent answer is **logged**, and any
wrong one becomes a one-tap correction. Recipe questions now ground in the real `brew_recipes`
data and the agent refuses ("not on file — check with Ryan") instead of inventing a number — the
fix for the phantom "200 g cacao". This is grounding, not model fine-tuning. Corrections scope to
one agent or **All agents**; toggle on/off; delete anytime (the audit log keeps the history).

## Customer notifications — off-app (SMS + email)

The app never assumes the customer is watching it. Lifecycle facts go out by **SMS (Twilio) and
email (Resend)**, server-side and best-effort (an order never fails because a provider hiccuped):
reservation confirmed (phone + account email), Sunday delivery confirmed (with the empties
reminder), **order ready** when the pass advances (account email — walk-ups carry no phone), and
**delivered** when the driver logs the porch outcome. Until the provider keys land in Vercel
(`RESEND_API_KEY` + `NOTIFY_FROM_EMAIL`, `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` +
`TWILIO_FROM_NUMBER`), every send is a clean no-op — the machinery is live, silent, and waiting.

## Sunday delivery — operations (the porch run)
- **Where**: Now → **Sunday delivery · run sheet** (appears only when a delivery day has orders).
  One summary line (bottles · refills/fresh · paid), the **Saturday brew line** (flavor totals +
  Performance combos like "2× RISE + MCT"), and the stop list — folded until the run day, sorted
  by ZIP for a sane route. Stop **times are managed in the location editor** (Opens / Ends next to the date) — the truck page's OPEN reads straight from it.
- **Statuses**: received → brewed → out for delivery → (delivered | held). Tap them as you go —
  it's how the owner watches the run without calling the driver.
- **The swap (locked rule)**: refill customers agreed at checkout — checkbox, timestamped — that
  empties are out by 5 AM. Empties there → **✓ Swap done**, log the ACTUAL count (shorts flag on
  the card). No empties → **Fresh anyway** (reason logged, margin absorbed once) or **No empties —
  hold** → order flips to `held_for_pickup`, the crew inbox gets the pickup-queue alert, customer
  collects at GT3PB 10 AM–2 PM. Payment already happened at order — never cash at the door.
- **Cancels**: customers self-cancel until Friday 6 PM ET (`cancel_own_delivery`, 0139); a paid
  cancel raises the standard refund alert. **Delivery's $14 premium bottle is the **Salted Latte** (one add, replaced the old MCT/butter matrix). The day is the customer's choice**: reserve
  offers the next few real stops as pickup days (server re-validates against the route + each
  drop's cutoff), and delivery offers this Sunday or next — dates never pick themselves. **Waitlist**: out-of-zone ZIPs capture email into
  `delivery_waitlist` (staff-read).
- **Trained where crew learns**: Academy → "Sunday Delivery — the porch run" (quizzed), and Ask GT3
  answers from the same module. The customer flow is §1.

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
- **Banned copy is enforced, not remembered** — the locked rules from
  `GT3-Brew-Business-Strategy.md` (detox, "cleanest", meal replacement, wellness filler, Zenith,
  the isn't-X-it's-Y flip…) live in `lib/captionLint` as a hard "banned" class: the Studio linter
  flags them and the smoke suite asserts them on every push.
- **Public data is always cleaned** — guest reviews pass through `lib/reviews.ts` (anonymize to
  first name + initial, strip PII, mask profanity, drop <4★/spam) and must be staff-approved
  (Studio → Review Desk) before the display shows them. ✨ Simplify (`/api/reviews/simplify`) trims
  a quote to display-ready and removes any health/medical claim without inventing praise.
- **The deterministic core** — money/ops math lives in pure `lib/*.ts` (orderAhead, cogs, loadout,
  reviews, recents, offline, plan, delivery) exercised by `npm run smoke` (162 assertions). If it computes a
  price, a window, or a queue, it's pure and tested — components only render it.

## Customer records — complete and never lost (0141)

Two guarantees, enforced by the database itself. **Complete**: every insert, update and delete on
a customer table (profiles, orders, drop/delivery orders, waitlist, RSVPs, referrals, check-ins,
reviews, leads) writes the full before/after row to `audit_log` — an overwritten phone number is
always recoverable. **Never lost**: hard DELETE is blocked on those tables for every role —
client, service-role and the SQL console included — so cancel/archive is the only path. The proof
lives in prod: a raw `delete` raises `Hard deletes are blocked… customer records are never lost`.
Deliberate maintenance (a legal erasure request) uses a session hatch, documented in the
migration. The home-screen app is **GT3 — Only the best for you** (icon: the GT3 mark with the
pixel-exact brand 3).

# 4 · The strategy layer (owners)

- **The Playbook** (`/playbook`, owner/admin only — also in the rail's Investor-brief group): the
  whole strategy on one screen. The flywheel (how one guest compounds), the locked foundations
  (two voices, pricing architecture, why the bottle comes back, daypart system, Phase 1→2 delivery
  sequencing with the trigger checklist, the money path), and **all ten growth plays** with
  projected ROI + the exact surface in the app that runs each one (ACTIVE / PLANNING / PHASE 2).
- **Source of truth**: `GT3-Brew-Business-Strategy.md` (Rev 1.0, locked, in-repo). The Playbook
  renders it; it never forks it. Strategy revs → `lib/strategy.ts` revs in the same PR.
- **Deeper cuts**: `/architecture` (owner — the live system map) · `/built/…` (the partner
  one-pager, safe to show) · Money (where every play's actuals recompute daily).
- **Goals — the strategy's scoreboard (0142, Plan › Goals)**: the six Phase 1→2 trigger
  conditions from the locked doc live as tracked goals (events/mo, Loop %, Sunday orders,
  bottles in circulation, bottles/mo, solo-ceiling net). Owners AND managers log progress as
  numbers, every goal carries a live 💬 thread (posting pings the owners), and "review the
  checklist" now means arguing with a board, not re-reading a paragraph. Business records:
  audited + delete-guarded like everything else.
- **Collaboration & governance (0140)**: every block and play on the Playbook carries a **live 💬
  thread** (the comments engine — posting pings the other owners through the alert ladder); the
  **guided builder** walks an owner through building or overhauling a play in seven coached steps
  (saved as visible DRAFTs in the debrief's GTM shape); and the **decision log** is append-only by
  construction — no update/delete policies exist, so the institution's memory can't be rewritten.
  Rule: no strategic call without a log line.
- **Coming (Sprint B)**: goals tracker, KPI deltas (channel split, Loop %, return rate), the
  rich-text strategies KB with permissions, GTM order-attribution. `GT3-Delivery-Audit.md` maps
  exists-vs-build.

## Pack lifecycle & one alerts home
- **Pack fulfillment stages** (`0146`) — a reserved pack walks **Reserved → Preparing → Ready →
  En route → Picked up**, advanced from the drop board (Now → the drop / Service, `DropOps`): tap a
  stage to jump or the primary button to advance one. A DB trigger keeps the legacy `picked_up`
  bool in sync so counts/history are unchanged. The customer sees the stage **live** on their pack
  card (`MyPacks` — a dot tracker + present-tense status), no refresh.
- **Alerts have ONE home.** The full flags-&-pings inbox lives in **My Day** (its defined job). The
  **Now** section shows only a compact strip ("N alerts need you · Open in My Day →",
  `AlertsInbox compact`) so the same cards never render in two places. The nav badge still carries
  the global critical count.

## Migration ledger
Through **0146** — full table + verify SQL in `gt3pb-deploy-v1.md`. `0145` pay_at_pickup toggle · `0146` pack lifecycle. Earlier newest:
`0133` client errors · `0134` tenant enforcement (on prod) · `0135` software billing (dormant) ·
`0136` reservation self-service · `0137` pre-order window dial · `0138` order eta comms · `0139` Sunday delivery · `0140` strategy collab (threads + decision log + drafts) · `0141` customer-record durability (audit catch-up + delete guards) · `0142` goals (scoreboard) · `0143` AI training · `0144` marketing splash + bulk-order flag · `0145` brew reminder skips a planned batch when a sibling for the same need is already brewing · `0146` content campaign/theme tag.
