# SSR cookie-based auth migration

## Status — what shipped on `claude/ssr-cookie-auth`

**Implemented (the perf goal, zero auth-flow risk):** edge guest routing. `proxy.ts` (Next 16 middleware)
redirects `/` → `/truck` for signed-out visitors **on the server**, reading a lightweight non-sensitive
**signal cookie** (`gt3_auth`) that `AuthProvider` sets on sign-in / clears on sign-out. This kills the
~5s client-redirect double-load without moving the session or changing the sign-in flow. Verified: guest
→ 307 `/truck`; signed-in signal → 200. The client redirect in `app/page.tsx` stays as the SPA-nav fallback.

**Deferred (the full session-in-cookie / PKCE rewrite):** on implementation I confirmed the current
**primary sign-in is a free-tier magic LINK** (`AuthProvider.sendCode` → `signInWithOtp` with
`emailRedirectTo`; the 6-digit code path exists but waits on Resend SMTP) **plus an iOS-PWA cross-browser
paste flow** (`signInWithUrl` extracts implicit-flow fragment tokens). Moving that to PKCE/cookies needs a
callback route (`exchangeCodeForSession`), a rewrite of the paste flow, Supabase-dashboard redirect-URL
config, and a **full real-email QA pass that can't be done headlessly** — so it's left as the plan below,
best done once the same-browser OTP code becomes the primary flow. The signal-cookie above already delivers
the routing win it was wanted for.

---

## Full migration plan (deferred) — SSR cookie sessions

**Why:** today the browser Supabase client uses `flowType: "implicit"` with `persistSession: true`, so the
session lives in **localStorage** — invisible to the server. Every auth-dependent routing decision is
therefore a **client** decision made *after* hydration. The clearest cost is `app/page.tsx:175`, which
client-redirects guests `/` → `/truck` once the auth layer is ready — a full second page-load that
Lighthouse reports as a ~5s "redirect" on a fresh visit. Nothing auth-gated can be server-rendered or
protected at the edge.

**Goal:** move the session into **cookies** via `@supabase/ssr` so **middleware** and **server components**
can read auth. Then guest routing (`/`→`/truck`), `/crew` protection, and auth-gated SSR all happen on the
server — no client round-trip, no double-load.

---

## Current state (measured)

- `lib/supabase.ts` — `createClient(@supabase/supabase-js)`, `flowType: "implicit"`, localStorage session.
- **No `middleware.ts`.** `@supabase/ssr` **not installed**. supabase-js `2.108.2`.
- Client auth surface (`components/AuthProvider.tsx`): **email OTP** (`signInWithOtp` → `verifyOtp`, code
  typed in the *same* browser — the primary path), **password** (`signInWithPassword`), **password reset**
  (`resetPasswordForEmail`). `getSession()` + `onAuthStateChange` on mount.
- **85 client components** import the `supabase` singleton from `@/lib/supabase`.
- Server: `lib/supabaseAdmin.ts` (service role, admin routes) + `lib/apiAuth.ts` (request auth).

## Target architecture

| Piece | Now | After |
|---|---|---|
| Browser client | `createClient` (localStorage) | `createBrowserClient` (cookies) — **API-compatible**, the 85 importers are unchanged |
| Server client | — | `lib/supabaseServer.ts` → `createServerClient` reading `next/headers` cookies (server components + route handlers) |
| Middleware | — | `middleware.ts` → refresh the session cookie every request + do guest routing |
| Flow | `implicit` | `pkce` (cookie-stored verifier) |

## Steps

1. `npm i @supabase/ssr`.
2. **`lib/supabase.ts`** → `createBrowserClient(url, anon)`. Keep the same `export const supabase` shape so
   nothing downstream changes. Drop `flowType/detectSessionInUrl` (the SSR client handles this).
3. **`lib/supabaseServer.ts`** (new) → `createServerClient` with a `cookies()` adapter; use in server
   components / route handlers that need the user or want to SSR gated content.
4. **`middleware.ts`** (new) → the canonical `@supabase/ssr` middleware: call `supabase.auth.getUser()` to
   refresh + write the session cookie, then:
   - guest (`!user`) hitting `/` → `NextResponse.redirect('/truck')` (replaces `app/page.tsx:175`);
   - guest hitting `/crew` or `/driver` → redirect to the sign-in surface (server-side gate).
   Scope `matcher` to real routes (exclude `_next`, static, api).
5. **`lib/apiAuth.ts`** → derive the user from the cookie session (server client) instead of the current
   path. Keep `supabaseAdmin` (service role) as-is.
6. **Auth callback** → ensure a route handler runs `exchangeCodeForSession` for the PKCE redirect
   (OTP/reset links). Point `emailRedirectTo`/reset `redirectTo` at it.
7. **Remove** the `app/page.tsx:175` client redirect (middleware owns it now).

## Risks & the one real tradeoff

- **PKCE + magic links across browsers.** PKCE stores the verifier in the *originating* browser's cookie,
  so a **magic link clicked in a different browser/app** than it was requested from will fail. **This app's
  primary flow is the OTP *code* (typed in the same browser) — unaffected.** Decision needed: are any users
  relying on clicking the email *link* on another device? If yes, keep that path on a same-device assumption
  or a code fallback. This is the gate for the whole migration.
- **Every server component that reads auth** needs the server client (can't reuse the browser singleton).
- **Full auth regression required:** OTP sign-in, password sign-in, password reset, token refresh, sign-out,
  `/crew` gating, realtime after cookie swap, and the deep-link/recovery flow.
- Low churn for the 85 importers (browser client is drop-in), but this touches *every* auth path — stage it
  on a branch, QA end-to-end, deploy off-peak.

## Payoff

- **Kills the guest `/`→`/truck` double-load** — routing decided at the edge, zero client round-trip (the
  ~5s Lighthouse "redirect").
- **Server-side `/crew` protection** (defense-in-depth beyond the client gate).
- **SSR auth-gated content** — signed-in first paint no longer waits on client hydration + `getSession`.

## Effort

~1–2 focused days of implementation + a **full auth QA pass**. Medium-high risk (every sign-in path). Best
sequenced as its own branch with a staging deploy before production, given it rewires authentication.
