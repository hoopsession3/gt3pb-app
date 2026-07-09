-- SUBSCRIPTIONS GO-LIVE SWITCH — the owner's dial for whether recurring coffee subscriptions are
-- offered to customers. Distinct from the infra prerequisite (Square plans configured, read by
-- subsConfigured()): this is the business decision to actually show + sell subscriptions.
--
-- Default FALSE — subscriptions are NOT part of the launch. The push is packs, reserves, and bulk
-- packs for pickup + delivery; subscriptions stay dark until the owner flips this on (Money →
-- Payments). Every subscription surface (the pitch, the card, the create API) reads this one flag,
-- so it can't drift on. Lives on live_status, the app's single-row settings table (same home as
-- pay_at_pickup, 0147).
alter table public.live_status add column if not exists subscriptions_enabled boolean not null default false;

-- verify:
--   select pay_at_pickup, subscriptions_enabled from public.live_status;  -- subscriptions_enabled = f
