-- 0257 · CUSTOMER "TRUCK IS LIVE" PUSH (2026-07-30). One column: any push subscription — an
-- anonymous customer on the public site, a member, even staff — can raise its hand for the
-- go-live ping. The Find Us page's "Ping me when the truck goes live" button writes it via the
-- existing subscribePush upsert (anon INSERT + anon-row UPDATE policies from 0006/0009 already
-- allow this; no policy changes needed). The push Edge Function's new live_status UPDATE case
-- targets wants_live = true when the truck flips live. Deliberately NOT a new table: the
-- subscription row IS the device; this is one more preference on it.

alter table public.push_subscriptions add column if not exists wants_live boolean not null default false;
