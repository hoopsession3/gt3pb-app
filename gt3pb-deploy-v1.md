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
The set has grown to **0129**; make sure the production Supabase project has the whole set applied,
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
| 0129 | `reviews` | guest reviews table (feeds the truck display) |

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
