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
