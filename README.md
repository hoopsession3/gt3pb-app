# GT3 Performance Bar — live app

The daily front door to GT3PB and the crew's operating console in one PWA. Next.js (App Router)
on Vercel, Supabase-backed, Square for payments. Live at **app.gt3pb.com**.

## Status — LIVE

Shipped and running in production: customer storefront + membership, the crew/admin console,
Supabase data (RLS-enforced), Square checkout, push (the app's own web push through `public/sw.js`, and the iPhone
app's alerts once APNs is set up) and email (Resend), and the AI helpers under `app/api/agents`.
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
npm run release            # the whole gate — verify, then npm's advisories — what CI runs. Green before any ship.
npm run verify             # the gate without the advisories (CI's verify job)
npm run smoke:ui           # the browser smoke on its own
npm test                   # unit + PGlite DB-contract suites
```

`npm run release` is the pre-ship gate (R40): `verify` — `test && audit && build && smoke:ui && smoke:authed &&
build:app -- --smoke && smoke:native`, the lint ratchet and the secrets audit among the audits — then `advisories`,
npm's advisory database asked of what ships. package.json is the one definition; `.github/workflows/ci.yml` runs
`verify` by name and the advisories as a job beside it, so the owner's gate and CI's are the same two. It stops at the
first link that fails and the log names it. Never push red. The ship sequence after it is RELEASE.md. Every setting the
app reads is listed in `lib/envSchema.ts`.

## Architecture

- `app/` — one folder per screen; `layout.tsx` shell, `manifest.ts`, `api/` the route handlers (each wrapped by
  `lib/apiRoute`).
- `components/kit.tsx` — the design-system primitives; `AppShell` / `OperatorNav` (crew shell) / `BottomNav`.
- `components/FindUs.tsx` — the customer "where are you?" road: stops **and** events on the `field_ops`
  spine in one `is_public` query (`/truck` and `/events` both render it).
- `supabase/migrations/` — numbered, forward-only. Canonical spine: **field_ops** (stops+events, mirror-
  maintained, `is_public` generated column at the RLS door), **loyalty_ledger** (points = sum, void-safe),
  **order_items** (per-drink sales), **webhook_events** (idempotent Square inbox). See `lib/architecture.ts`.
- `scripts/` — PGlite DB-contract tests (`db.*.test.mjs`) + the Playwright UI smoke (`smoke.ui.mjs`).
- `app/globals.css` — tokens + the `/* KIT */` block (the primitives) + legacy component styles.
- `next.config.ts` — security headers + CSP (Square and Supabase allowances; nothing allowed that is not used).

## Brand lock

Warm palette only · red ≤ accent (live tag, the ONE primary button, loyalty ring) · the GT3 "3" is a
locked asset (`public/brand/gt3-3.png`), never a font/trace · no vendor names · no medical claims. The
app never quotes booking pricing — Booking Tool v5 is the rate source of truth.
