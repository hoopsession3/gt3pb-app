-- 0248 — wire public.customers into the realtime publication.
--
-- Found while checking a screenshot of the crew Customer book right after shipping 0246/0247:
-- Ryan's screen showed stale rows (an old "No name yet / no contact info" ghost, and none of the
-- freshly-backfilled or newly-named rows), even though he was already on that screen when those
-- migrations ran. CrmPanel.tsx already calls `useRealtimeTable("customers", reload)` — the client
-- code fully expects the Customer book to live-update whenever the customers table changes. But
-- Supabase realtime is two separate switches: the client subscription (already wired) AND the
-- table being added to the `supabase_realtime` publication server-side. customers was never added
-- to the publication, so that subscription has been silently inert — confirmed via
-- pg_publication_tables (34 other tables are in the publication; customers was not one of them).
-- Net effect: any crew member already sitting on the Customer book screen never sees a new
-- signup, a new order's first-time customer, or a tier change from another device, until they
-- manually leave and reopen the screen.
--
-- Fix: add customers to the publication. Purely additive — no data or schema change, just turns
-- on the live-update path the component was already built to use.

alter publication supabase_realtime add table public.customers;

-- verify:
--   select exists(select 1 from pg_publication_tables
--     where pubname = 'supabase_realtime' and tablename = 'customers');   -- true
