# GT3PB — Go to Production (v1)

The order-ahead pivot + event lifecycle + editable copy + backend hardening **already shipped**
(merged to `main`, live on Vercel). This file now tracks the **crew-console follow-up** on
`claude/event-prep-ai` and keeps the migration ledger current.

**This cut is frontend-only — it adds NO new migrations.** Merging it just rides the Vercel build.
- Crew back button retraces the previous section instead of dropping you out of crew mode.
- Completed events / finished truck stops drop off the active Prep list (still in history/archive).
- Every crew section header shows a "when to use it" cue; tap it (or the `GT3PB · Crew ⓘ` eyebrow)
  to open the interactive **Section Guide** — learn what each section is for and jump straight there.

## 0. Pre-flight (fast)
- `git fetch origin && git checkout claude/event-prep-ai && git pull`
- Rebased on `origin/main`; no conflicts.
- `npm run build` → succeeds.
- `npm run smoke` → **"87 passed, 0 failed"**.

## 1. Merge
- PR `claude/event-prep-ai` → `main` (#67). Merging triggers the Vercel **production** deploy automatically.
- No asset or migration steps for this cut — it's code only.

## 2. Migration ledger — confirm PROD is current
The set has grown to **0138**; make sure the production Supabase project has the whole set applied,
in order (Vercel does NOT run migrations — `supabase db push` or your runner):

| # | File | What |
|---|---|---|
| 0117 | `audit_retention` | weekly prune of `audit_log` |
| 0118 | `cancel_own_order` | customer self-service order cancel RPC |
| 0119 | `order_ahead` | `drop_orders` table (reservations) |
| 0120 | `stale_order_alert` | "orders waiting on the pass" cron alert |
| 0121 | `event_completion` | `events.completed_at` + `recap` + completion trigger |
| 0122 | `site_copy` | owner-editable front-end copy table |
| 0123 | `stale_alert_no_flood` | stop the pass watchdog re-alerting forever |
| 0124 | `set_live_where` | fix "go live" unqualified-UPDATE rejection |
| 0125 | `stop_completion` | truck-stop wrap step (mirrors event completion) |
| 0126 | `drop_fulfillment` | reservation manage/cancel + planning wiring |
| 0127 | `menu_reprice_board` | à-la-carte reprice to the truck board ($10/$14) |
| 0128 | `restore_tide_broth` | Tide $12 + broths $10 back in the catalog |
| 0129 | `sold_out` | 86 a product from the crew console |
| 0130 | `86_lifecycle` | 86 stamp + 4am auto-reset |
| 0131 | `reviews` | guest reviews table (feeds the truck display) |
| 0132 | `membership_scan` | staff RPCs: look up a member by card code + add a stamp |
| 0133 | `client_errors` | client error telemetry (deduped) + first-occurrence crew alert |
| 0134 | `tenant_enforcement` | tenant isolation: stamping triggers + restrictive RLS (R-002 DB half) |
| 0135 | `software_billing` | tenants.plan + Stripe columns (operator billing scaffold, dormant) |
| 0136 | `reservation_self_service` | cancel_own_reservation RPC (member cancels own pack) |
| 0137 | `preorder_window_setting` | live_status.preorder_lead_h — the cup-ordering dial |
| 0138 | `order_eta_comms` | orders.eta_status + set_order_eta ("on my way / outside / late") |

Confirm on prod (all should return rows / non-null):
```sql
select proname from pg_proc where proname in
  ('tidy_audit_log','cancel_own_order','alert_stale_orders','sync_event_completion');  -- 4 rows
select to_regclass('public.drop_orders'), to_regclass('public.site_copy');             -- both NOT null
select column_name from information_schema.columns where table_name='events'
  and column_name in ('completed_at','recap');                                          -- 2 rows
select column_name from information_schema.columns where table_name='stops'
  and column_name in ('completed_at','recap');                                          -- 2 rows (0125)
select jobname from cron.job where jobname in ('tidy-audit-log','alert-stale-orders'); -- 2 rows
-- 0133–0135:
select to_regclass('public.client_errors');                                             -- NOT null
select count(*) from pg_trigger where tgname = 'stamp_tenant_tg';                       -- > 20
select count(*) from pg_policy  where polname = 'tenant isolation';                     -- > 15
select column_name from information_schema.columns where table_name='tenants'
  and column_name in ('plan','billing_status','stripe_customer_id');                    -- 3 rows
-- 0136–0138:
select proname from pg_proc where proname in ('cancel_own_reservation','set_order_eta'); -- 2 rows
select preorder_lead_h from public.live_status;                                          -- 4 (default)
```
If any come back empty, apply the missing migrations in order, then re-check.

## 3. Env (confirm on the prod Vercel project)
- `SQUARE_ACCESS_TOKEN` and `NEXT_PUBLIC_SQUARE_LOCATION_ID` present.
  (Absent → checkout + `/api/reserve` fall back to pay-at-pickup — fine, not an error.)

## 4. Post-deploy smoke (on the live prod URL) — new this cut
- Crew console: tap the `GT3PB · Crew ⓘ` eyebrow (or a header WHEN pill) → Section Guide opens;
  hit "Go to <Section> ›" and it jumps there. Navigate a couple of sections, then the top-left `‹`
  steps **back through them** (only leaves to /3mpire when there's no history left).
- Complete an event (or truck stop) → it leaves the active **Prep** list (still in history/archive).
- Every section header carries its when-to-use pill, legible in both light and dark crew themes.

## 5. Reply with
The live URL, migration-ledger confirmation, and any step that failed.

## NOT in this release (Ryan's Square-side follow-ups — do NOT attempt here)
- In-app refund (Square Refunds API).
- À-la-carte $7/$8/$9 → $10/$8 repricing (menu + Square Catalog). Until done, walk-up and
  order-ahead price differently — expected.
