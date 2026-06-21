# GT3PB — turning on the revenue features

Three revenue features are built. **Referral** and **Reserves** work the moment the
code is live (no extra config). **Subscriptions** need Square + a couple of keys
because recurring billing must run server-side.

Ownership (no redundancy): **Square** = all money, cards, and recurring billing.
**Supabase** = the membership wallet (points/credit), referral, reserve stock.

---

## 1. Referral — live now, nothing to configure
- Every member's code is on their 3MPIRE card. "Share invite" sends a link like
  `https://your-app/?ref=THEIRCODE`.
- A friend who opens that link, signs in, and gets their **first order picked up**
  (operator marks it "Picked up") → **both get $5 credit**, automatically.
- Operator-gated, so it can't be farmed with fake/forged orders. One reward per
  friend, ever. Self-referral is blocked.
- Tune the amount: change `grant_cents` (default 500 = $5) and `floor_cents`
  (minimum order to count) in `award_points()` — see `supabase/migrations/0013_referral.sql`.

## 2. Reserves — live now
- Add a drop in **Back office → Reserves**: name, price, stock, per-member limit,
  then set **Status = Live**.
- Members see it on **Events**, tap **Reserve yours** (stock can't oversell), and
  **pay at the truck** on pickup. Unclaimed holds auto-return to stock after 48h.

## 3. Subscriptions — needs Square setup (recurring billing)

### a) Create the plan in Square (you do this in the Square Dashboard)
1. Square Dashboard → **Subscriptions → Plans → Create plan** (e.g. "RISE + FLOW").
2. Add a **plan variation** with the cadence + price (e.g. **$48 every 2 weeks**).
3. Copy the **plan variation ID** (starts with a long ID).

### b) Create the webhook (Square Dashboard → Developer → Webhooks)
1. Add an endpoint: `https://YOUR-DOMAIN/api/square/webhook`
2. Subscribe to events: `subscription.created`, `subscription.updated`,
   `invoice.payment_made`, `invoice.payment_failed`.
3. Copy the endpoint's **Signature Key**.

### c) Add environment variables (Vercel → Project → Settings → Environment Variables, Production)
| Variable | Value | Notes |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` secret | **Server-only. Never prefix with NEXT_PUBLIC.** Also required for **card checkout** — paid orders are recorded server-side so `paid` can't be forged. |
| `SQUARE_SUBSCRIPTION_PLAN_VARIATION_ID` | the variation ID from step (a) | |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | the key from step (b) | |
| `SQUARE_WEBHOOK_URL` | `https://YOUR-DOMAIN/api/square/webhook` | must exactly match the endpoint |
| `NEXT_PUBLIC_SUBSCRIPTIONS_ON` | `1` | flips the member Subscribe button on |
| `NEXT_PUBLIC_SUB_NAME` | e.g. `RISE + FLOW` | display only (optional) |
| `NEXT_PUBLIC_SUB_PRICE_LABEL` | e.g. `$48 · every 2 weeks` | display only (optional) |

These are **in addition to** the live payment keys you're already adding:
`NEXT_PUBLIC_SQUARE_APP_ID`, `NEXT_PUBLIC_SQUARE_LOCATION_ID`,
`NEXT_PUBLIC_SQUARE_ENV=production`, `SQUARE_ACCESS_TOKEN`.

### d) Redeploy
Vercel redeploys on the next push, or hit **Redeploy**. Until `NEXT_PUBLIC_SUBSCRIPTIONS_ON=1`
the member sees an honest "opening soon" line — no broken button.

> Prove it in **sandbox** first (`NEXT_PUBLIC_SQUARE_ENV=sandbox` + sandbox plan +
> sandbox webhook) before flipping to production, so the HMAC check and renewals are
> verified end-to-end.

---

## Security notes (already enforced)
- Members can never grant themselves credit, points, stock, paid status, or an
  active subscription — those columns are writable only by DB triggers/RPCs or the
  service role.
- The webhook verifies Square's HMAC over the raw body before any write, so forged
  events can't grant access.
- `SUPABASE_SERVICE_ROLE_KEY` is used only in server routes; never ship it to the client.
