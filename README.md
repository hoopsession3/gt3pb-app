# GT3 Performance Bar — web/PWA validation release

The free, installable daily front door to GT3PB. Web-first (Next.js on Vercel) — a funnel
into subscription LTV and B2B "Book the bar" inbound. Built to match `gt3pb-app-v3.html`.

## Status (build runbook v1.1)

- ✅ **Phase 0** — Scaffold, design tokens, 5 self-hosted font families (9 woff2)
- ✅ **Phase 2** — v3 components ported to React, pixel-faithful (warm palette, red = accent only)
- ✅ **Phase 3** — 5 screens as routes: `/` Today · `/truck` · `/menu` · `/events` · `/3mpire`, plus `/book`
- ✅ **PWA** — manifest, offline-shell service worker, CSP baked in (Square SDK ready)
- ⏳ **Phase 1** — accounts/infra (Supabase, Square, OneSignal, Resend) — needs 🔑 taps
- ⏳ **Phase 4/5** — live data + commerce hand-off — wiring stubbed, gated behind repeat-opens
- ⏳ **Phase 7** — deploy to Vercel + bind gt3pb.com

Today/Truck/Menu/Events run on local/mock state until the Phase 1 keys land.

## Run locally

```bash
npm install
npm run dev      # http://localhost:3000
npm run build && npm run start   # production
```

## Architecture

- `app/` — App Router routes (one screen per route), `layout.tsx` shell, `manifest.ts`
- `components/` — `AppProvider` (toast/cart/sheet state), `AppShell`, `BottomNav`, `DrinkSheet`, `Toast`
- `lib/menu.ts` — NET+ catalog (single source of truth; descriptions are quality-attribute only)
- `app/globals.css` — design tokens + components, ported verbatim from the v3 prototype
- `public/fonts/` — self-hosted woff2 (Archivo Black, Playfair Display, Oswald, Montserrat, DM Mono)
- `next.config.ts` — security headers + Content-Security-Policy (Square/OneSignal/Supabase allowances)

## Brand lock

Warm palette only · red ≤ accent (today dot, live tag, primary buttons, loyalty ring) · no vendor
names · no medical claims · base claim "Nothing toxic." The app never quotes booking pricing —
Booking Tool v5 is the rate source of truth.
