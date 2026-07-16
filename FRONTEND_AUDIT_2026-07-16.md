# Front-end (customer-facing) audit — 2026-07-16

Companion to `CREW_CONSOLE_IA_AUDIT.md` — same method, aimed at everything outside `/crew`: the
ordering funnel, the public schedule, booking, the member home, the account portal, the kiosk
display, and the brand/content pages. Four parallel passes, one per product cluster, each reading
every file in its cluster in full and cross-checking against migrations, RLS policies, and git
history rather than guessing. ~50 findings total; this doc keeps the ones worth a human decision.
Pure code-hygiene notes (dead ternaries, a redundant CSS token) were fixed inline without a write-up
— see the commit for the full list.

No prod DB credentials live in this container, so anything needing a schema/RLS change is called
out explicitly as **[MIGRATION]** — a new migration file gets committed, but a human applies it.

## P0 — needs a product decision, not just a fix

**Booking requests have no customer-facing view, and RLS structurally blocks building one today.**
`app/book/page.tsx` shows a one-time "Request received" toast with no reference ID and no way to
ever see the request again. This isn't just a missing screen — `booking_requests`' RLS
(`supabase/migrations/0004_admins_and_bookings.sql`) grants `insert` to anyone but `select`/`update`
only to admins. A customer literally cannot read their own submitted request back, signed in or not.
**[MIGRATION]** would need a new RLS policy scoping read (and probably cancel) to the submitter —
by `auth.uid()` if signed in, or an email/token match for a guest. Left for you to scope (guest
requests especially — token-based access has real design tradeoffs) rather than guessed at.

**Open office invoices have no in-app way to pay them.** `app/office/page.tsx` shows each invoice's
amount and `open`/`paid` status with no action. The payment-link generator
(`app/api/office/paylink/route.ts`) already exists and works — but it's staff-gated, so today a
customer can only get a pay link if a crew member texts it to them. Opening that endpoint (or an
equivalent) to the account-owning customer is a real auth-surface change I didn't want to make
without your sign-off, since it's payment-adjacent. Flagging, not fixing.

## P1 — real bugs, fixed this round

- **Duplicate-order risk on "reserve now, pay at pickup."** `OrderFunnel.tsx`'s pay-at-pickup path
  was missing the same-tap re-entrancy guard its two sibling payment paths already have (with a
  comment explaining exactly why: the `disabled` attribute isn't fast enough for a fast double-tap).
  Added the guard. The deeper fix — a server-side idempotency key on `drop_orders`, mirroring the
  `payment_id` unique-index pattern migrations 0238/0242 already use for the *paid* paths — is a
  **[MIGRATION]**, included this round.
- **"FREE DELIVERY" badge only showed on the 24-pack, never the 36-pack**, even though the fee
  waiver itself (`lib/delivery.ts`) already applies at 24+. A customer comparing sizes saw the badge
  disagree with the very next line of copy, which correctly said "free at 24+." Fixed to read the
  same constant the price logic already uses.
- **Reserves.tsx (limited-drop claims) silently went blank on a failed fetch** — identical to "no
  limited drops today." Same root cause as the false-empty-state bugs fixed crew-side: the query
  never checked `.error`. Fixed.
- **`/events` rendered two `<h1>` elements** (one real, one screen-reader-only) — the shell's
  dedup list was never updated when Truck and Events were unified onto one shared component.
  One-line fix.
- **Academy's "Team readiness" roster included real loyalty customers**, not just crew — the one
  query in the whole app pulling a staff list that forgot the `.neq("role", "member")` filter every
  other one uses. Customers were showing up as 0%-complete "staff," and could be assigned training.
  Fixed.
- **Office showed a permanent loading skeleton for a signed-out visitor** — no redirect, no sign-in
  prompt, forever. (`app/page.tsx` already handles this correctly for signed-out visitors; Office
  never got the same guard.) Fixed to prompt sign-in inline.
- **Office's business account/orders/invoices had the same silent-blank-on-error problem** — an
  existing business customer hitting a transient fetch error would see "set up office delivery," as
  if they'd never signed up. Fixed.
- **MemberInbox (the "your drink is ready" surface) swallowed fetch errors**, and the same swallow
  fed a guard meant to suppress an upsell for members with an active order — so a fetch hiccup could
  both hide a ready notification *and* show an upsell it was specifically built to avoid. Fixed.
- **The kiosk display's "Scan to order" QR pointed at the marketing site, not the ordering app** —
  contradicting its own on-screen copy two lines above, which correctly named `app.gt3pb.com`. Fixed
  to point at the actual PWA.
- **Playbook's "locked" pricing and loyalty copy was stale against the shipped product** — still
  described a since-replaced MCT/butter drink matrix and a "5 returns in 90 days" loyalty mechanic
  that isn't what ships today (it's 10 points = 1 free drink, no window). Corrected to match
  `lib/delivery.ts` and the live `MembershipCard`/`StampCard` mechanic.

## P2 — cohesion & stale copy, fixed this round

- "Book the truck" (screen-reader-only page title) vs. "Book the bar" everywhere else the feature
  is named, six-to-one. Standardized on "bar."
- Book's "City / venue" field could read as "pick one of GT3's existing spots" rather than
  "describe your own event's location" — reworded.
- Two stale code comments pointing at logic that moved or a security follow-up already closed by a
  later migration (`lib/db.ts`'s `nextStop()` reference; `FindUs.tsx`'s PII-column TODO, already
  fully resolved by migration 0240). Comments corrected so the next person doesn't chase a
  already-closed item.
- Display's header comment said "three scenes"; a fourth (the QR/social "connect" scene) was fully
  shipped and undocumented. Comment updated.
- Display's two data fetches (prices, reviews) handled failure inconsistently — one had a `.catch`,
  the other didn't. Aligned.
- Office's "3-gallon minimum" pitch line was hardcoded text sitting two lines above the *live*,
  owner-editable minimum the rest of the page correctly reads — so changing the setting would
  silently leave the marketing copy wrong. Now reads the same live value.
- Playbook's copy told owners to "tap 💬" when the actual control is the shared Icon component's
  chat glyph, not a literal emoji. Reworded (both here and in the matching governance line in
  lib/strategy.ts).

## P3 — real, but deliberately left as a report item (feature-scoped or judgment calls)

These are genuine findings, not fixed this round — each is either a meaningful chunk of new feature
work, or a naming/tone call that's yours to make rather than mine to guess at:

- **Delivery orders can only be canceled, not rescheduled or resized** — pickup packs get "move day"
  and "change the pack"; delivery doesn't. May be an intentional phase-1 scope limit (the code's own
  comments call delivery "Phase 1").
- **Limited-reserve claims are hardcoded to qty 1** with no way to request a second unit, even though
  the display logic already anticipates multi-quantity claims existing.
- **The pay screen never previews a signed-in member's automatic tier discount** (e.g. a founding
  member's free-refill benefit) — the total shown before "Pay" can read higher than what's actually
  charged. Square only ever charges the correct, server-computed amount, so this isn't an overcharge
  risk, just a confusing preview.
- **"Reserve" names two different products stacked on one screen** — a limited-drop claim system and
  the weekly bottle-pack pre-order both use "reserve/reserved" as their verb, back-to-back on
  `/reserve`. Distinct systems, same word; a naming call, not a bug.
- **ReservePitch's three pack-size tiles + its CTA all navigate identically**, without carrying the
  chosen size into `/reserve` — visually promises a size pick that doesn't do anything yet. Would
  need `/reserve` to accept and honor a size parameter.
- **Academy training assignments can be created but never edited or removed** — an admin who
  assigns the wrong person or module has no in-app way to undo it. RLS already permits it; only the
  UI is missing (a real, if modest, feature to build).
- **3mpire has six hand-rolled icons instead of the shared Icon component** — partly because the
  icon set doesn't yet have graduation-cap / grid / storefront / logout glyphs to swap in. Icon
  additions + swap, not a one-liner.
- **MpireDemo (the Supabase-disabled fallback view) is a stale, uncleaned pre-redesign duplicate** —
  real in the code, but only renders when Supabase is disabled, which shouldn't happen in production.
  Low real-world exposure; left alone this round.
- Several lower-confidence items each agent flagged as "possibly intentional" — the AI concierge's
  next-stop grace window not matching FindUs's 8-hour grace, RsvpRow's directions link using a plain
  text search instead of FindUs's precise lat/lng, and Book's marketing copy not being wired into
  the owner-editable copy system the way Truck's is. Worth a look, not urgent.

## What's already solid, for contrast

The initial kit migration held up well under scrutiny: no raw emoji-as-icons turned up outside the
two spots called out above, no hardcoded colors bypassing tokens outside the handful fixed here, and
the core order-pricing math (`lib/orderAhead.ts`, `lib/delivery.ts`) is pure and re-verified
server-side — no path where the client displays one charge and Square honors another. FindUs's
"upcoming vs. past" logic is computed once and shared correctly between its hero and its list, and
now matches the crew-side stop-status fix shipped earlier this round, constant-for-constant.
