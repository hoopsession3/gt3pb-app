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
| Surface | Route | What |
|---|---|---|
| Home / Today | `/` | Greeting, your usual, **loyalty stamp card**, reserve pitch, day-builder |
| Menu | `/menu` | Full line — Activation, Hydration, Fuel (prices per truck board) |
| Reserve (order-ahead) | `/reserve` | 3/6/12 packs + flavor mix, next-stop pickup |
| Truck | `/truck` | Live location / route |
| Account (3mpire) | `/3mpire` | **Scannable GT3 membership card (unique per-member QR)**, ring, credit, **leave a review**, order history |
| Operator scan | `/scan?m=<code>` | Staff-only: scan a member's card QR → their stamps → **add a stamp** for a walk-up |
| Truck display | `/display` | Full-screen loop for a tablet/TV: menu · brand · guest reviews |

## Crew console sections (`/admin`) — mirror these in the Section Guide
- **My Day** (start of shift) · **Now** (during service) · **Prep** (before the event) ·
  **Plan** (booking ahead) · **Studio** (marketing + **Review Desk → truck display**) ·
  **Money** (the books) · **Team** (people & roles) · **Ask GT3** (playbook, floats).

## Data the customer sees publicly is always cleaned
- Guest reviews pass through `lib/reviews.ts` (anonymize to first name + initial, strip PII, mask
  profanity, drop <4★/spam) and must be **staff-approved** (Studio → Review Desk) before the display
  shows them. Reviews from Google / Instagram / the feedback album are added there too.

## UI standards
- **Collapsible sections** = the `Panel` primitive (`app/admin/page.tsx`) — tappable header + chevron,
  remembers open/closed per id. Use it for any new stacked crew section (Money and the Now management
  panels already do). Keep specialized accordions that carry extra affordances (the Prep `row()` with
  icons/subtitles, the KDS stage groups with live counts) — they're intentionally not plain Panels.
- **Quiet by default**: in a stacked section, open only the primary panel; collapse the rest.

## Loyalty
- `profiles.points`, +1 per drink on pickup (migration `0012`). Stamp card = a view of that; "10th on
  us." No separate data.

## Migration ledger (apply in order on prod; all idempotent)
Through **0129** — see `gt3pb-deploy-v1.md` for the full table + verify SQL. Newest:
`0127` board reprice · `0128` restore Tide + broths · `0129` reviews table.
