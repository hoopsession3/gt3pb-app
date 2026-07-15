# GT3 Performance Bar — live app

The daily front door to GT3PB and the crew's operating console in one PWA. Next.js (App Router)
on Vercel, Supabase-backed, Square for payments. Live at **app.gt3pb.com**.

## Status — LIVE

Shipped and running in production: customer storefront + membership, the crew/admin console,
Supabase data (RLS-enforced), Square checkout, push (OneSignal) and email (Resend), 12 AI agents.
The old "phase 0–7" runbook is retired — the platform is past validation and in daily use.

## Design System v1 — THE build standard

**Every page is built from one kit** (`components/kit.tsx`) — no bespoke chrome per screen:

- **Masthead** — one identity zone per page; the eyebrow is a *context label only* (never a slogan/date).
- **SectionHeader** — mono label + italic annotation + one hairline. The only section-title grammar.
- **InfoRow** — lead · body · trailing slot. A stop and an event render as the *same* row.
- **Buttons** — three tiers: `.btn-pri` (**max ONE red primary per screen**), `.btn-sec`, `.btn-ter`; chips `.k-chip`.
- **Type scale** — `.k-title` / `.k-sub` / `.k-eyb` / `.k-cap`; **ClosingBeat** ends every page (mark + "Carolinas, Georgia").

Rules: build a new surface ON the kit or don't build it. Sheets/popouts share the DNA but never
get a masthead or beat (a sheet is a room, not a house). Crew sections live inside the operator
shell (`OperatorNav` + `.op-head`), which owns identity — they use SectionHeader + rows + chips only.
Kiosk signage (`/display`) is the one intentional exemption (a rotating billboard, not a page).

## Run locally & verify

```bash
npm install
npm run dev                # http://localhost:3000
npm run verify             # unit/db suite → next build → UI smoke (all 18 routes). Green before any ship.
npm run smoke:ui           # the browser smoke on its own
npm test                   # unit + PGlite DB-contract suites
```

`npm run verify` is the pre-ship gate: it must print `183 / 11 / 60 / 23 / 65` for the suites and
`UI SMOKE: N passed, 0 failed`. Never push red.

## Architecture

- `app/` — one route per screen (18 routes); `layout.tsx` shell, `manifest.ts`, `api/` route handlers (59).
- `components/kit.tsx` — the design-system primitives; `AppShell` / `OperatorNav` (crew shell) / `BottomNav`.
- `components/FindUs.tsx` — the customer "where are you?" road: stops **and** events on the `field_ops`
  spine in one `is_public` query (`/truck` and `/events` both render it).
- `supabase/migrations/` — numbered, forward-only. Canonical spine: **field_ops** (stops+events, mirror-
  maintained, `is_public` generated column at the RLS door), **loyalty_ledger** (points = sum, void-safe),
  **order_items** (per-drink sales), **webhook_events** (idempotent Square inbox). See `lib/architecture.ts`.
- `scripts/` — PGlite DB-contract tests (`db.*.test.mjs`) + the Playwright UI smoke (`smoke.ui.mjs`).
- `app/globals.css` — tokens + the `/* KIT */` block (the primitives) + legacy component styles.
- `next.config.ts` — security headers + CSP (Square / OneSignal / Supabase allowances).

## Brand lock

Warm palette only · red ≤ accent (live tag, the ONE primary button, loyalty ring) · the GT3 "3" is a
locked asset (`public/brand/gt3-3.png`), never a font/trace · no vendor names · no medical claims. The
app never quotes booking pricing — Booking Tool v5 is the rate source of truth.
