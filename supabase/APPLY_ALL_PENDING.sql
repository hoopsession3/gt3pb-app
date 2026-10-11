-- ⚠️ NEVER include files from supabase/pending/ in this bundle — those are soak-gated (see
-- supabase/pending/0224_field_ops_contract.sql) and applying them early is irreversible.
--
-- ── GENERATED FILE — DO NOT EDIT BY HAND ─────────────────────────────────────────────────────
-- Regenerate with:  npm run migrations:pending -- --write
--
-- This file is the OUTPUT of comparing supabase/migrations/ against what production's ledger
-- (public.schema_migrations, via /api/migrations) says has actually been applied. Its previous
-- hand-maintained version said "apply all pending migrations" and stopped at 0035 while this
-- directory held 326 files — wrong by 291 migrations, referenced by nothing, checked by nothing.
--
-- The line below is what stops that happening again: scripts/drift.check.mjs fails the release
-- if supabase/migrations/ ever holds a migration numbered above it.
-- pending-from: 0366
-- generated-at: 2026-10-11
-- pending-count: 2
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- ============================================================
-- 0365_only_the_crew_is_sent_new_orders.sql
-- ============================================================
-- ── 0365 — ONLY THE CREW IS SENT NEW ORDERS ─────────────────────────────────────────────────────────────
-- 2026-10-11 (the review of the iPhone app's alerts, which read the web's half too).
--
-- A new order's push carries the customer's name, what they ordered and the total, and it goes to every device
-- whose row is marked is_admin (supabase/functions/push, the orders INSERT case). The mark was whatever the page
-- that subscribed sent: the insert and update rules (0081, 0009) ask only whose row it is, and the column is open
-- to anon and authenticated alike (0006). So anyone — signed in or not — could mark a browser of their own and be
-- sent every order. The database decides now:
--
--   · a row is marked only while the person it belongs to is on the crew (public.is_staff's test, 0035, asked of
--     the row's own person), whatever the page sent — and a page can still leave it unmarked: a crew member who
--     turned on "order ready" from the customer's side has not asked for the pass's alerts;
--   · someone who leaves the crew stops being sent orders the moment their role changes, on every device;
--   · the rows marked today go through the same test.
--
-- Nothing a page does changes: the crew console's alerts send the mark (components/DeviceAlerts), a customer's
-- send none (lib/push subscribePush), and both are kept as they were asked for.

create or replace function public.push_sub_crew_only() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  new.is_admin := coalesce(new.is_admin, false) and new.user_id is not null and exists (
    select 1 from public.profiles p where p.id = new.user_id and (p.role <> 'member' or p.is_admin = true));
  return new;
end $$;
revoke all on function public.push_sub_crew_only() from public, anon, authenticated;

drop trigger if exists push_sub_crew_only on public.push_subscriptions;
create trigger push_sub_crew_only before insert or update on public.push_subscriptions
  for each row execute function public.push_sub_crew_only();

-- Off the crew: off the pass's alerts, on every device the person has.
create or replace function public.push_subs_leave_with_the_crew() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if not (new.role <> 'member' or new.is_admin = true) then
    update public.push_subscriptions set is_admin = false where user_id = new.id and is_admin;
  end if;
  return null;
end $$;
revoke all on function public.push_subs_leave_with_the_crew() from public, anon, authenticated;

drop trigger if exists push_subs_leave_with_the_crew on public.profiles;
create trigger push_subs_leave_with_the_crew after update of role, is_admin on public.profiles
  for each row when (old.role is distinct from new.role or old.is_admin is distinct from new.is_admin)
  execute function public.push_subs_leave_with_the_crew();

-- The rows marked today, through the same test: the trigger above decides each one this touches.
update public.push_subscriptions set is_admin = is_admin where is_admin;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Only the crew is sent new orders','security','Crew',
   'A new order''s alert — the customer''s name, what they ordered and the total — goes to the devices marked for the pass. That mark was whatever the page that turned alerts on said, so a device could be marked by someone who isn''t on the crew. Now the database marks a device only while the person it belongs to is on the crew, and takes the mark off every device of someone who leaves it, the moment their role changes. Crew alerts that are on stay on.',
   '2026-10-11', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select count(*) filter (where s.is_admin) as marked,
--          count(*) filter (where s.is_admin and not exists (select 1 from public.profiles p
--            where p.id = s.user_id and (p.role <> 'member' or p.is_admin))) as marked_off_the_crew
--     from public.push_subscriptions s;                                   -- marked_off_the_crew = 0
select public.record_migration('0365_only_the_crew_is_sent_new_orders');

-- ============================================================
-- 0366_a_device_is_whoever_is_signed_in_on_it.sql
-- ============================================================
-- ── 0366 — A DEVICE'S ALERTS ARE WHOEVER IS SIGNED IN ON IT ─────────────────────────────────────────────
-- 2026-10-11 (the review of the iPhone app's alerts, which read the web's half too).
--
-- A browser's subscription was written by the page itself (lib/push subscribePush: an upsert on the endpoint, then
-- a delete of the person's other devices), under rules that only let a row be written by the person it belongs to,
-- or — for a row that is nobody's — by anyone (0009, 0081). Three things followed, all on today's web:
--
--   · "Ping me when the truck goes live" (0257) never saved for a guest. An upsert must be able to read the row it
--     writes, and the read rule (0006, "own sub read") reads only your own: a row that is nobody's is no one's to
--     read, so the write failed — and the page, which never looked at the answer, said the ping was on.
--   · A browser someone signed out of stayed theirs: their "your order's ready" kept arriving on it for whoever
--     used it next, signed in or not.
--   · The next person to sign in on it could not take it over (the row is someone else's), and the delete that
--     followed the failed write took away that person's own devices: no alerts anywhere.
--
-- Now a page asks the database, which does all of it in one place:
--   keep_push_device    this device, for whoever is signed in on it now (nobody: a guest's row) — the device
--                       moves to them whoever had it, and their other browsers go (one device each, lib/push's
--                       rule since 2026-07). The pass's mark is asked for, never taken away, by a page: a crew
--                       member's order from the shop doesn't switch off the alerts the crew console turned on.
--                       A device that changes hands starts unmarked. (0365 still decides who may be marked.)
--   release_push_device this device stops being mine — called as someone signs out, while they still are. The
--                       device keeps a guest's "truck is live" ping, and nothing of theirs.
-- The table's own rules are unchanged, so a page that was loaded before this keeps working as it did.

create or replace function public.keep_push_device(p_endpoint text, p_p256dh text, p_auth text,
  p_crew boolean default null, p_wants_live boolean default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if coalesce(length(p_endpoint), 0) not between 12 and 2048 or p_endpoint !~ '^https://' then
    raise exception 'That isn''t a push subscription.' using errcode = '22023';
  end if;
  if coalesce(length(p_p256dh), 0) not between 16 and 256 or coalesce(length(p_auth), 0) not between 8 and 128 then
    raise exception 'That push subscription has no keys.' using errcode = '22023';
  end if;
  insert into public.push_subscriptions as s (endpoint, p256dh, auth, user_id, is_admin, wants_live)
  values (p_endpoint, p_p256dh, p_auth, v_user, coalesce(p_crew, false), coalesce(p_wants_live, false))
  on conflict (endpoint) do update set
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    user_id = excluded.user_id,
    tenant_id = excluded.tenant_id,          -- stamped for whoever has it now (0134 stamp_tenant)
    is_admin = case when s.user_id is distinct from excluded.user_id then coalesce(p_crew, false)
                    else coalesce(p_crew, false) or s.is_admin end,
    wants_live = coalesce(p_wants_live, s.wants_live);
  -- One browser each: the person's other browsers go (a reinstall or a new browser mints a new endpoint, and every
  -- alert fanned out to all the stale ones). Only browsers — an endpoint that is a web address.
  if v_user is not null then
    delete from public.push_subscriptions
     where user_id = v_user and endpoint <> p_endpoint and endpoint like 'https://%';
  end if;
end $$;
revoke all on function public.keep_push_device(text, text, text, boolean, boolean) from public;
grant execute on function public.keep_push_device(text, text, text, boolean, boolean) to anon, authenticated;

create or replace function public.release_push_device(p_endpoint text) returns void
  language sql security definer set search_path = public as $$
  update public.push_subscriptions set user_id = null, is_admin = false
   where endpoint = p_endpoint and user_id = auth.uid();
$$;
revoke all on function public.release_push_device(text) from public;
grant execute on function public.release_push_device(text) to authenticated;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A device''s alerts are whoever is signed in on it','fix','Alerts',
   '"Ping me when the truck goes live" now saves for guests — it said it was on, and was never kept. Signing out of a browser stops that person''s alerts there: "your order''s ready" no longer lands on a browser they left for whoever uses it next. And the next person to sign in on it gets their alerts there, without losing the ones on their own phone. A crew member''s order from the shop no longer switches off the order alerts they turned on in the console.',
   '2026-10-11', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select has_function_privilege('anon', 'public.keep_push_device(text,text,text,boolean,boolean)', 'execute');   -- t
--   select has_function_privilege('anon', 'public.release_push_device(text)', 'execute');                         -- f
select public.record_migration('0366_a_device_is_whoever_is_signed_in_on_it');
