# GT3PB — Order-Ahead Diff & Enhance · Phase 1 Review (v1)

**Status:** Phase 1 (review only — no code changed). STOP for approval before Phase 2.
**Caveat:** The reference build `gt3pb-orderahead-app-v1.0.html` was **not attached to this session**
(only images/PDFs present in uploads). This review is built from the **business-rule spec** in the
Cowork prompt + a full read of the live repo. Items needing the actual HTML for exact state-shape,
edge cases, or microcopy are marked **[NEEDS REF FILE]**.

---

## 0. Headline decision (blocks Phase 2)

The reference model is a **strategic pivot**: Rule 1 removes subscriptions entirely (no
subscribe/subscription/plan/membership words, no recurring billing). The live app has a **complete,
recently-hardened subscription system**. Phase 2 would **delete** it. This must be confirmed before
any destructive step. (Phase 1 here is non-destructive.)

---

## 1. Reference review (from spec; HTML not available)

Business rules encoded by the reference (per the prompt's locked list): one-off pre-orders only;
pack pricing 3/6/12 for bring-back + flat $10/bottle new-glass; glass toggle w/ discount removal +
nudge + SAVE pill; Wed 18:00 cutoff → Saturday drop w/ roll-to-next + live countdown; RISE/FLOW/DUSK
flavor-mix steppers must total pack size before CTA (`allowFlavorMix` flag); dual confirmation copy +
"fresh 7 days from pickup"; ops brew sheet by flavor + stats + per-order cards w/ Picked up / Bottles
in toggles; brand lock.

**[NEEDS REF FILE] to confirm exactly:**
- Pack-size **shrink resetting an overfull flavor mix** (prompt hints at this edge case) — exact reset rule.
- Exact state shape (order object keys), storage format, and validation order.
- Exact confirmation/nudge microcopy strings (must be ported verbatim).
- Countdown behavior at/after cutoff (does it show "closed — next drop" immediately?).
- Whether new-glass path also allows flavor mix, and single-flavor forcing via `allowFlavorMix`.

**Would harden regardless (flagged in prompt too):** client-clock cutoff is spoofable/wrong across
timezones → derive server-side.

## 2. Live-app inventory (repo, grounded)

**Ordering spine (already one-time pre-order — reusable):**
- Menu `lib/menu.ts` (`DRINKS`, à-la-carte `px` $7/$8/$9) → `DrinkSheet` → `CartBar` → `Checkout.tsx`
  → `app/api/checkout/route.ts` (Square Web Payments, **one-time** charge, server-authoritative price)
  → `orders` table (`0005_orders.sql`). Guest checkout supported.
- Live status: `OrderStatus.tsx` (member realtime banner + self-cancel while `new`), KDS in
  `app/admin/page.tsx` (`Kitchen`).

**Pricing locations (today):**
- À-la-carte drink prices: `lib/menu.ts` `px` fields **and** Square Catalog (`checkout` priceMap is authoritative).
- Subscription packs: `lib/square.ts` `SUB_PACKS` = 6/12/18 → $36/$66/$90 (env-overridable), cadence
  `SUB_CADENCE` "every 2 weeks"; real charge from Square plan variations (`lib/squareServer.ts`).

**Subscription / recurring scaffolding present (all CONFLICT with Rule 1):**
- UI: `app/3mpire/page.tsx`, `components/SubscriptionCard.tsx`, `components/SubscribePitch.tsx`
  (waitlist "Notify me / when it opens" → `subscription_interest`).
- API: `app/api/subscriptions/create`, `.../manage`, subscription+invoice branches in
  `app/api/square/webhook/route.ts`.
- Config: `lib/square.ts` (`SUB_PACKS`, `SUB_CADENCE`), `lib/squareServer.ts` (plan variations).
- DB: `0015_subscriptions.sql`, `0020_subscription_interest.sql`.

**Square status:** LIVE for one-time payments (checkout) and for subscriptions. Webhook HMAC-verified.

## 3. The diff

### MISSING (in reference, absent in live)
| Feature | In reference | Should live in production |
|---|---|---|
| Saturday **drop** model + Wed 18:00 cutoff + countdown + roll-to-next | drop/cutoff logic + timer | new `drops` config + **server-derived** cutoff resolver + countdown UI |
| **Bring-back vs new-glass** path + bottle-return tracking | glass toggle + return status | orders schema: `glass_path`, `bottles_returned`; toggle in order UI |
| Order-ahead **pack pricing** 3/6/12 + MOST POPULAR/BEST VALUE + SAVE pill + new-glass nudge | pricing config + pack cards | single pricing **config/table** (no hardcoded prices) |
| **Flavor-mix steppers** (RISE/FLOW/DUSK total = pack) gating CTA; `allowFlavorMix` | stepper state machine | order UI component + config flag |
| **Dual confirmation copy** + "bring all N empties" + "fresh 7 days" | copy variants | confirmation view (return vs new) |
| **Ops brew sheet per drop** (totals by flavor, bottles-to-brew, glass-back, revenue) + Picked up / Bottles in toggles | ops view | staff-gated brew-sheet view atop existing KDS |
| Pack-shrink resets overfull mix **[NEEDS REF FILE]** | state logic | order UI reducer |

### CONFLICTING (live contradicts reference — remove **in the same PR** that ships the replacement)
| Live behavior | Conflicts with | Removal plan |
|---|---|---|
| Entire subscription UX (`/3mpire`, `SubscriptionCard`, `SubscribePitch` waitlist) | Rule 1 (no sub/plan/membership words, no recurring) | delete UI + nav entry; remove pitch/waitlist |
| `api/subscriptions/create` + `manage` + webhook sub/invoice branches | Rule 1 (recurring billing) | delete routes; strip sub branches from webhook (keep `payment.*` sales mirror) |
| `SUB_PACKS` 6/12/18 = $36/$66/$90 | reference 3/6/12 = $22.50/$42/$78 | delete `SUB_PACKS`; replace w/ order-ahead pricing config |
| `SUB_CADENCE` "every 2 weeks" / biweekly language | weekly Saturday drops | remove cadence copy |
| `0015_subscriptions`, `0020_subscription_interest` tables | one-off model | keep tables **dormant** (non-destructive) or drop — **[INPUT NEEDED]** |
| Walk-up à-la-carte $7/$8/$9 (`lib/menu.ts`) | reference walk-up $10 new / $8 bring-back / single $10 | **[INPUT NEEDED — reconcile]** (see §Decisions) |
| Deposit remnants | Rule 1 (no deposit) | none found in code — **confirmed absent** |

### KEEP / BETTER (live is production-grade; reference defers to these)
| Live asset | Why it wins over the reference stub |
|---|---|
| Supabase auth (magic-link/OTP + password) | reference has no real auth |
| Square Web Payments one-time charge, server-authoritative pricing (`checkout/route.ts`) | reference uses a pay stub — **reuse this for order-ahead** |
| Supabase persistence + RLS + realtime (`orders`) | reference uses `window.storage` |
| KDS realtime pass, alerts→push spine, audit log, error boundary | reference ops is client-only, ephemeral |
| PWA + locked brand system + fonts | reference is a single file |

## 4. Enhancement proposals (propose, not silently do)
1. **Server-derived cutoff** — resolve current drop + cutoff from a `drops` table / server clock, never the client. (Reference flags this itself.)
2. **Supabase persistence** replacing `window.storage`. Schema proposal — extend/echo `orders`:
   `drop_date date`, `glass_path text check (in ('bring_back','new'))`, `flavor_mix jsonb` (`{rise,flow,dusk}`),
   `pack_size int`, `pickup_name text`, `phone text`, `picked_up bool default false`,
   `bottles_returned int default 0`. RLS: own-read + staff-manage (mirror `orders`).
3. **Square Web Payments SDK, one-time only** — already live; reuse, do not add recurring.
4. **SMS pickup-day text** via captured phone — provider **[INPUT NEEDED — Twilio vs Square Messages]**; transactional only, no marketing scaffolding.
5. **Drop-capacity ceiling** — max bottles/Saturday **[INPUT NEEDED — Ryan to set]**; "this drop is full → rolls to next Saturday" state.
6. **Ops view auth-gating** — brew sheet must be `is_staff()`-gated (customers can't open it); live already gates admin, so fold into the admin shell.

## 5. Migration order (smallest-safe-step first; each deployable alone)
1. **Pricing config** — single source for order-ahead packs + glass paths (no UI yet). Delete no prices yet.
2. **DB migration (additive)** — `drops` table + order-ahead columns/table. Non-destructive; back up first.
3. **Server cutoff/drop resolver** — read-only endpoint (server clock).
4. **Order-ahead UI behind a route/flag** — pack picker + glass toggle + flavor-mix steppers + countdown, paying through the **existing** Square checkout.
5. **Confirmation copy** — dual variants + "fresh 7 days".
6. **Ops brew-sheet view** — staff-gated; Picked up / Bottles in toggles.
7. **Remove subscriptions in the SAME PR that ships order-ahead** — so old/new pricing never co-exist:
   delete UI/routes/nav, retire `SUB_PACKS`/cadence; tables dormant per decision.
8. **Enhancements** — SMS + capacity ceiling after core is live.

## 6. Decisions (RESOLVED 2026-07-05)
1. **Pivot — CONFIRMED.** Subscriptions become a **dormant, separate work stream**: remove all
   subscription UI/routes/pricing from the active product; **keep `0015`/`0020` tables intact and
   dormant** (nothing destructive, fully reversible). Retire it **in the same PR that ships
   order-ahead** so there's never a gap or dual pricing on the live app.
2. **Walk-up pricing — RESOLVED: move everything to the $10 / $8 glass model.** Retire the à-la-carte
   $7/$8/$9 `px` values in `lib/menu.ts`; ALL sales (walk-up + order-ahead) price off the glass model
   ($10 new glass, $8 bring-back). Pack pricing (bring-back) stays 3=$22.50 / 6=$42.00 / 12=$78.00.
3. **Reference HTML — user will upload it to this session.** Phase 2 waits for it so exact edge cases
   (pack-shrink reset) + verbatim copy are ported, not inferred.

### Still open (won't block starting; will mark [INPUT NEEDED] inline)
- Drop capacity ceiling — max bottles per Saturday?
- SMS provider — Twilio / Square Messages / defer?
- `allowFlavorMix` default — mixed packs vs single-flavor?

---
**Phase 1 ends here. Holding for the reference HTML upload, then Phase 2 executes in the §5 order.**
