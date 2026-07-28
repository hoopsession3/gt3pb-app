-- 0247 — enrich customer-book rows that exist but are still nameless.
--
-- Follow-up to 0246, found while verifying that fix for the specific customer Ryan reported
-- (2026-07-28): 0246 made sure EVERY signed-up account has a public.customers row (backfilling
-- anyone who signed up but never ordered). That part worked — verified 0 profiles without a
-- matching row. But looking up the actual reported customer by name turned up nothing, because
-- her row already existed before 0246 ran, created by something short of a full order (most
-- likely an order/booking flow that calls resolve_customer() as soon as checkout starts, before
-- she'd typed her name in) — so her row had user_id set, but name and email both NULL. 0246's
-- backfill insert is "on conflict (user_id) do nothing," so that pre-existing, nearly-empty row
-- silently blocked the backfill from ever filling in her real name/email. Net effect: she
-- technically had a customers row (the 0246 aggregate check passed), but showed up in the
-- Customer book as a blank, unfindable-by-name entry — same practical problem Ryan reported,
-- different mechanism.
--
-- Fix: a one-time enrichment pass. For every customers row with a null name and/or null email,
-- fill in whatever public.profiles / auth.users already has for that user_id — using COALESCE, so
-- this can only ever fill a gap, never touch a row that already has real data. Same
-- non-destructive posture as resolve_customer() itself and as 0246. Phone is deliberately left
-- alone — it only ever comes from an actual order/booking, there's nowhere else to source it
-- from, and that's fine: it fills in the normal way the first time she orders.

update public.customers c
set name = coalesce(c.name, p.display_name),
    email = coalesce(c.email, u.email),
    updated_at = now()
from public.profiles p
join auth.users u on u.id = p.id
where c.user_id = p.id
  and (c.name is null or c.email is null)
  and (p.display_name is not null or u.email is not null);

-- verify:
--   -- the reported customer should now show her real name:
--   select c.name, c.email, c.tier from public.customers c
--     join public.profiles p on p.id = c.user_id where p.display_name ilike '%gianna%';
--   -- should now be 0 (or only genuinely nameless/emailless accounts with nothing to source from):
--   select count(*) from public.customers where name is null and email is null;
