# Audit — What Already Exists vs the Delivery Debrief
*Answers to `GT3-Cowork-Delivery-Debrief.md` §"Questions for Cowork" · from the live codebase on `main` · 2026-07-08*

**Headline: the debrief's "what exists today" line is badly understated.** The app is not just
"venue ordering + accounts + payments" — roughly **60–70% of the delivery spec already exists** as
the order-ahead Reserve flow + the DropOps crew dashboard, and 3 of the 4 Owner/Manager sections
exist in partial-to-substantial form. Build the deltas; do not rebuild the overlaps.

---

## 1 · Direct answers (debrief Q1–7)

**Q1 — Framework.** Next.js 16 (App Router) + React 19 **web PWA** on Vercel, Supabase Postgres/RLS/Realtime.
No React Native / Flutter / native shell. A new flow is just new routes + components — no rebuild.
CI (build + deterministic smoke) runs on every push; migrations are numbered SQL files applied to prod
(currently through `0138`).

**Q2 — Payments.** **Square** is the integrated charge path (`/api/checkout` → Square, server-side price
authority; keys pending in Vercel env). **Stripe exists but is NOT for customer payments** — the `0135`
Stripe columns/routes are the dormant *SaaS software-billing* scaffold (tenants paying for No Noise).
Delivery checkout must use Square. Do not touch `STRIPE_*`.

**Q3 — Notifications.** **Web push exists** (`lib/push.ts`, per-user subscriptions, crew alert ladder) and an
in-app **alerts inbox** (`alerts` table → crew Now screen, severity, ack, comment threads). **No transactional
email/SMS** — Supabase auth emails only. SendGrid/Twilio (or Resend/Twilio) is a genuine new integration;
recommend routing every trigger through the existing `alerts`/notification ladder so crew-side visibility is free.

**Q4 — Admin panel.** A full crew console exists at `/admin`: URL-backed sections (My Day / Now / Prep /
Plan / Studio / Money / Team / Ask GT3), realtime KDS pass, Service mode, offline-resilient status taps,
command palette, breadcrumbs, Section Guide help. **The delivery admin should be new panels inside this
console** (Now + Prep), not a separate surface.

**Q5 — Roles.** `profiles.role` = member | server | admin | owner (+ `is_admin`); DB-side `is_staff()` =
`role <> 'member'`; owner/admin gates already drive UI (e.g. Investor brief) and RLS policies. Role gating
for the Owner/Manager layer maps directly onto this — nothing new needed except the manager read/comment split.

**Q6/Q7 — Owner/Manager audit.** See §3 below.

---

## 2 · Delivery build — exists → reuse map

| Debrief piece | Exists today | Verdict |
|---|---|---|
| Pack size cards (12/24/36) | Reserve flow has 3/6/12 pack cards (`PACK_SIZES`, `OrderAhead`) | **Reuse pattern**, new sizes/config |
| Pack builder w/ counters, "X/N picked", exact-match gate | Identical mechanic in Reserve (flavor mix ±, `0/6 bottles picked`) | **Reuse component logic** |
| Refill vs new bottles (Card A/B) | Reserve's "Bringing mine back (best price)" vs "Need new glass" — same loop mechanic incl. per-path pricing | **Reuse**, add refill-count input + ack checkbox |
| Cutoff → date auto-calc (Fri 6 PM → Sunday) | `lib/orderAhead` `nextDrop`/`dropForStop`/`dropDateKey` — cutoff→drop-date logic, client+server agreeing | **Reuse pattern** (parameterize day/cutoff) |
| Payment | `/api/checkout` (Square, server price authority, availability + window gates) | **Reuse**, add delivery branch |
| Admin route dashboard + status toggles | **DropOps**: per-Sunday… per-drop order list, per-order card (name/phone/pack/mix/paid-due), picked-up + bottles-in toggles, cancel/push-next-week, history | **Extend DropOps** (address, driver outcomes, route order) |
| Batch brewing summary | **Already built**: DropOps brew sheet ("2× RISE · 2× FLOW · 2× DUSK"), gallons calc w/ yield factor, **Queue brew batches** → `brew_batches` | **Reuse as-is**, add Performance combos |
| Empties log | picked-up / bottles-in per order exists; missing: actual-count discrepancy, 3-outcome driver log, `held_for_pickup` | **Extend** |
| Customer "your order" mgmt | `cancel_own_reservation` (0136), Your-pack card, ETA comms (`set_order_eta`, 0138) | **Reuse** |
| Zone gate (ZIP), address + gate code, waitlist | Nothing | **New** |
| Email/SMS lifecycle | Nothing (push + alerts only) | **New integration** |
| Route clustering | Nothing (stops map exists — `RouteMap` — reusable for driver view) | **New (manual Phase 1)** |

**Spec corrections to lock before build:**
- **Pricing tables differ and must stay separate.** Existing reserve: return-packs $22.50/$42/$78 (≈$7.50/bottle),
  new $10. Delivery spec: refill **$8**, new $10, Performance $14, sizes 12/24/36, $10 fee waived at 24+.
  Model delivery pricing as its own config (per-channel), don't "unify" it into the venue grid.
- **`delivery_channel` fits the existing model**: `drop_orders` + the preorder-window/dial machinery are
  channel-adjacent already; the cleanest build is a `delivery` flavor of the drop system (its own table or a
  `channel` column), not a parallel universe.
- **Tenancy (0134) is live**: every new table needs `tenant_id` — the stamp trigger + restrictive policy attach
  automatically when `0134` re-runs. Include it in each new migration.
- **Performance Upgrade is a new SKU** (MCT/butter add-ins don't exist in the catalog/menu model) — needs
  product + pricing + brew-sheet handling.
- **Voice**: flow copy should ride the editable `site_copy` system (`lib/copy.ts`) like the rest of the app,
  so Ryan can tune Voice 2 lines without deploys.

---

## 3 · Owner/Manager Operations layer — audit (debrief Q6)

**Section 1 · KPI Dashboard — ~60% exists.** Money already has: **Sales** (revenue/orders/AOV/est-margin
with range picker, by-event + product-mix bars), **Business snapshot** (incl. MRR/subscribers), **Per-event
P&L** (plan vs actual, ROI, break-even), **Product economics + COGS calculator**, live **Event heads-up**
($/hr, % of plan) and a BI story (`bi_readonly` role; Looker temporary, Power BI pending — risk R-001).
**Missing:** channel split (venue vs delivery), Loop-tier %, empties return rate, repeat/new customer rates,
30-day trendlines, owner-set thresholds/color coding. Verdict: **extend Money**, don't build a new dashboard.
(Note: this app's design language deliberately avoids "big number tile farms" — the owner has rejected them
repeatedly. Hero + quiet line + trend, per the KB's UI standards.)

**Section 2 · Goals Tracker — does not exist.** Nothing tracks targets/pace today. **Net-new build** (the
auto-compute-from-KPI design in the debrief is right). Related prior art: a family/OKR cascade concept was
explicitly parked for a separate app — keep this tracker business-scoped.

**Section 3 · Strategies KB — ~50% exists.** In-app today: **Meeting notes** (Supabase system of record,
follow-ups become tasks), **Academy** (training modules + quizzes), **operator KB** (playbook), **brand voice
module** (`lib/brandVoice`), **architecture map** (live system doc), Brand Kit, and a `content_versions`
table (version history exists for Studio content). Section Guide covers every crew surface. **Missing:**
rich-text strategy docs w/ owner-edit/manager-comment permissions, search, goal-linking. Verdict: **build the
doc layer on the existing pieces** (reuse `content_versions` pattern for versioning) and seed from
`GT3-Brew-Business-Strategy.md`.

**Section 4 · GTM strategies w/ ROI — ~25% exists.** Attribution primitives exist: **referral program**
(`referral_events`, codes, auto-credit), Studio **campaign generator**, per-event P&L gives play-level actuals
for event-type strategies. **Missing:** the `gtm_strategies` record, projected-vs-actual ROI, and
`order_attributions` beyond referrals. Verdict: **new tables + views**, wired to existing orders/referrals.

---

## 4 · What is genuinely NEW (the honest build list)

**Sprint A (delivery):** ZIP zone gate + waitlist capture · address/gate-code capture · delivery pricing
config (channel-scoped) · Performance SKU + add-ins · empties acknowledgment (checkbox + timestamp) ·
driver 3-outcome log + `held_for_pickup` + discrepancy counts · Sunday pickup queue tie-in · route ordering
(manual) · **email/SMS service integration** (the only new external dependency) · delivery-channel gate on
the refill card (Phase-2-proofing).

**Sprint B (owner layer):** goals tracker (new) · KPI deltas listed above (extend Money) · strategy-doc
layer w/ permissions/search (extend Notes/Academy/`content_versions`) · `gtm_strategies` +
`order_attributions` (extend referrals).

**Standing constraints for whoever builds:** numbered idempotent migrations with `-- verify:` footers ·
`tenant_id` on every new table · gate = `npm run build` + `npm run smoke` · unique realtime channel names
per subscription (twice-shipped crash class) · no fixed KPI tile farms (owner's lens: units on numbers, one
hero per block, zeros silent, detail folds until actionable) · keep the Section Guide + `gt3pb-help-kb.md`
current in the same PR.
