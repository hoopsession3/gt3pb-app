# GT3PB — Order-Ahead Phase 2 Changelog (v1)

Ships the approved Saturday-drop reserve model into the live app. One-off pre-orders only — no
subscription, no deposit, no recurring billing. Every step gated by `npm run build` + `npm run smoke`
(now 87 tests). Migrations `0119` (and prior `0117`/`0118`) must be applied to the live DB.

## Shipped

| Area | File(s) | What |
|---|---|---|
| Pricing — single source | `lib/orderAhead.ts` (new) | Return packs 3=$22.50 / 6=$42 / 12=$78, new glass $10 flat, walk-up copy $10/$8/$10, `allowFlavorMix` flag, flavor-mix math, Wed-18:00 cutoff/drop resolver. **No prices hardcoded in components.** |
| Test guardrail | `scripts/smoke.cjs`, `package.json` | +23 smoke tests lock the money math + cutoff (the 70% margin floor lives in the grid). |
| Persistence | `supabase/migrations/0119_order_ahead.sql` (new) | `drop_orders` table; server-recorded so `paid` can't be forged; owner-read + staff-manage RLS; realtime. |
| Reserve API | `app/api/reserve/route.ts` (new) | Server-authoritative price **and server-derived cutoff** (enhancement over the reference's client clock); Square one-time charge; reconcile alert if a paid reservation fails to save; new-reservation alert to leadership. |
| Customer flow | `components/OrderAhead.tsx`, `app/reserve/page.tsx` (new) | Faithful port of reserve → details → confirmed: pack tiles (MOST POPULAR/BEST VALUE), flavor steppers gating the CTA, glass toggle w/ SAVE pill + new-glass nudge, live countdown, dual confirmation copy, "fresh 7 days". Pack-shrink resets an overfull mix (verified in lib). |
| Ops | `components/DropOps.tsx` (new), `app/admin/page.tsx` | Brew sheet + pickup checklist in the admin **Now** section under the kitchen pass — per-drop stats (brew / glass-back / revenue), flavor totals, per-order cards, realtime Picked up / Bottles in toggles. Staff-gated by RLS. |
| Ops stress usability | `components/DropOps.tsx` | Unfulfilled-first sort, "X/N picked up · Y/M bottles in" progress, tap-to-call phone, completed dim out. |
| Styles | `app/globals.css` | `oa-*` (reserve, brand-locked colors from the reference) + `dops-*` (admin ops). |

## Old-model references removed / dormanted (subscriptions parked as a separate work stream)

- **Nav:** `/3mpire` subscription tab → **Reserve** (`components/BottomNav.tsx`).
- **Checkout post-pay upsell:** "Make it a regular / every two weeks / → /3mpire" → "Reserve a Saturday drop / → /reserve" (`components/Checkout.tsx`). Removes recurring-billing language from the customer flow.
- **Kept dormant (intact + reversible, NOT deleted):** `/3mpire` page, `SubscriptionCard`, `SubscribePitch`, `app/api/subscriptions/*`, subscription branches in the Square webhook, `SUB_PACKS`/`SUB_CADENCE`, tables `0015`/`0020`. No user-facing entry points remain in nav or checkout.

## Deferred / needs input (marked, not silently assumed)

1. **Retire à-la-carte $7/$8/$9 → $10/$8 glass model everywhere.** Order-ahead already uses the glass
   model; the **walk-up menu** (`lib/menu.ts`) still shows per-drink $7/$8/$9. Moving all sales to
   $10 new / $8 bring-back requires re-pricing the walk-up menu **and the Square Catalog** — that's a
   Square-side change (your task). Until done, walk-up and order-ahead price differently. `[YOUR SQUARE STEP]`
2. **SMS pickup-day text** — phone is captured on every reservation; texting is not wired. `[INPUT NEEDED — Twilio vs Square Messages]`
3. **Drop-capacity ceiling** — max bottles/Saturday + a "this drop is full → rolls to next" state. `[INPUT NEEDED — Ryan to set the number]`
4. **`allowFlavorMix=false`** — flag exists and the server rejects multi-flavor when off; the UI stepper collapse to a single-flavor picker is deferred. `[INPUT NEEDED — default?]`
5. **Reservation revenue into reports/PnL** — visible per-drop in DropOps today; not yet folded into the day's money reports. (Backend-money cohesion follow-up.)
6. **Subscriptions**: fully delete code + tables (vs the current dormant state) — only if/when you decide the pivot is permanent.

## Apply on deploy
- Run migrations against the live DB (`supabase db push`): **`0117`, `0118`, `0119`.** Vercel does not run migrations.
- `/api/reserve` needs `SQUARE_ACCESS_TOKEN` + `NEXT_PUBLIC_SQUARE_LOCATION_ID` (same as checkout) to charge; without them the reserve screen shows a "switches on soon" state.
