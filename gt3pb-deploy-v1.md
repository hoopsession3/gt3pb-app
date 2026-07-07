# GT3PB — Go to Production (v1)

Merge `claude/event-prep-ai` → `main`. This is the ship-it runbook for the order-ahead pivot +
event lifecycle + editable copy + backend hardening. Two hands-on steps: **merge** and **apply
migrations**; everything else rides the Vercel build. Keep this file current as the branch grows.

## 0. Pre-flight (fast)
- `git fetch origin && git checkout claude/event-prep-ai && git pull`
- Confirm it's ahead of `main` with no conflicts (rebase on `origin/main` if needed).
- `npm run build` → must succeed.
- `npm run smoke` → must print **"87 passed, 0 failed"**.
- If either fails, STOP and report. Otherwise continue.

## 1. Merge
- Open PR `claude/event-prep-ai` → `main`, title:
  **"Order-ahead pivot + event lifecycle + editable copy + backend hardening"**
- Body: link the repo-root changelogs `gt3pb-diff-review-v1.md` and `gt3pb-orderahead-changelog-v1.md`.
- Merge it. Merging to `main` triggers the Vercel **production** deploy automatically
  (all code + the `public/brand/gt3-3.png` asset ship in the build).

## 2. Apply migrations to the PRODUCTION Supabase project
Vercel does NOT run migrations. `supabase db push` (or your runner), in order:

| # | File | What |
|---|---|---|
| 0117 | `audit_retention` | weekly prune of `audit_log` (closes R-003) |
| 0118 | `cancel_own_order` | customer self-service order cancel RPC |
| 0119 | `order_ahead` | `drop_orders` table (reservations) |
| 0120 | `stale_order_alert` | "orders waiting on the pass" cron alert |
| 0121 | `event_completion` | `events.completed_at` + `recap` + completion trigger |
| 0122 | `site_copy` | owner-editable front-end copy table |

Verify:
```sql
select proname from pg_proc where proname in
  ('tidy_audit_log','cancel_own_order','alert_stale_orders','sync_event_completion');  -- 4 rows
select to_regclass('public.drop_orders'), to_regclass('public.site_copy');             -- both NOT null
select column_name from information_schema.columns
  where table_name='events' and column_name in ('completed_at','recap');               -- 2 rows
select jobname from cron.job where jobname in ('tidy-audit-log','alert-stale-orders'); -- 2 rows
```

## 3. Env (confirm on the prod Vercel project)
- `SQUARE_ACCESS_TOKEN` and `NEXT_PUBLIC_SQUARE_LOCATION_ID` present.
  (Needed for the CHARGE path; without them checkout + `/api/reserve` fall back to pay-at-pickup —
  that's fine, not an error.)

## 4. Post-deploy smoke (on the live prod URL)
- Signed-out home is lean and the GT3 masthead shows the real red "3".
- Reserve tab: build a 6-pack, submit (pay-at-pickup if Square is off), and it lands in
  admin → Now → DropOps.
- Pickup date shows the truck's **next stop** (not a fixed Saturday).
- Card checkout shows **no surprise tip** (subtotal == charged unless a tip is chosen).
- Admin → Studio → Brand → Front-end copy: edit one line, Save, confirm it changes live.
- Open an event → "Complete event" with a recap → it marks done, not "live".

## 5. Reply with
The live URL, migration confirmation (the 4 checks above), and any step that failed.

## NOT in this release (Ryan's Square-side follow-ups — do NOT attempt here)
- In-app refund (Square Refunds API).
- À-la-carte $7/$8/$9 → $10/$8 repricing (menu + Square Catalog). Until done, walk-up and
  order-ahead price differently — expected.
