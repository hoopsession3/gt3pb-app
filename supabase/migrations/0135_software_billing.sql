-- 0135 — SOFTWARE BILLING SCAFFOLD (audit #2: "nobody can pay for the software"). Paste into
-- Supabase → SQL Editor → Run. Idempotent.
--
-- This is billing for the SOFTWARE (operators paying for No Noise), completely separate from the
-- existing `subscriptions` table (GT3's customers paying for coffee). Dormant until Stripe env
-- keys exist — exactly the Google Wallet precedent. GT3 itself is the founding 'founder' tenant:
-- everything unlocked, never billed.

alter table public.tenants add column if not exists plan text not null default 'founder';
alter table public.tenants add column if not exists billing_status text;            -- active | trialing | past_due | canceled
alter table public.tenants add column if not exists stripe_customer_id text;
alter table public.tenants add column if not exists stripe_subscription_id text;
alter table public.tenants add column if not exists current_period_end timestamptz;

-- One tenant per Stripe customer/subscription — webhook upserts key off these.
create unique index if not exists tenants_stripe_customer_uq
  on public.tenants(stripe_customer_id) where stripe_customer_id is not null;
create unique index if not exists tenants_stripe_subscription_uq
  on public.tenants(stripe_subscription_id) where stripe_subscription_id is not null;

-- verify:
--   select slug, plan, billing_status from public.tenants;  -- gt3pb · founder · null
