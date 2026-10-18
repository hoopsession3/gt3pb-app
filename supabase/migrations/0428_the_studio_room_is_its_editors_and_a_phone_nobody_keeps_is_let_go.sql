-- ── 0428 — THE STUDIO'S ROOM IS ITS EDITORS', AND A PHONE NOBODY KEEPS IS LET GO ─────────────────────────────────────
-- 2026-10-18. R22 of the 10/10 audit (security F12, database F14; Ryan, 2026-10-17: "Keep working to improve to a 10").
-- Paste into Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY. (1) The Studio's co-editing (components/Studio) talks on a Realtime channel named for the piece — who is in it,
-- and each field as it is typed — and the channel was public: anyone holding the app's public key and a piece's id could
-- join, see the crew's names, and type into an open editor's fields. (2) Every phone and browser the app keeps for
-- alerts is a row in push_subscriptions, and one nobody is signed in on, and that asked to hear nothing, was kept for
-- ever: a device that stopped opening the app left its row, and a script registering devices left all of its.
--
-- WHAT. (1) Who may join the Studio's room for a piece, hear it and speak in it: whoever can read the piece — its
-- business's leadership (content_items' own rules, asked as the caller). The room is private now (Realtime
-- Authorization: policies on realtime.messages, and the page asks for a private channel); a public channel of the same
-- name is another room, and hears nothing of this one. (2) A device is "seen" whenever the app keeps it again — every
-- launch of the iPhone app, every browser that asks — and one nobody is signed in on, that asked for no news, and that
-- has not been seen for thirty days is let go each morning. A member's device, and one that asked to hear when the truck
-- goes live, are never let go for quiet; a gone one is still deleted the moment Apple or a push service says so.
--
-- set lock_timeout (database F16): one column added to push_subscriptions (no rewrite — its default is set once), two
-- functions, two policies, a schedule.
-- existing rows: every device kept today is seen as of this paste — thirty days' grace for each.
-- changelog: below.

set lock_timeout = '5s';

-- ── (1) the Studio's room ─────────────────────────────────────────────────────────────────────────────────────────
-- A topic is the room's name as the page gives it: 'studio-' and the piece's id. Anything else is no room of the
-- Studio's (the uuid is checked before it is cast, so a malformed name is a closed door, not an error).
drop policy if exists "studio: the piece's editors hear its room" on realtime.messages;
create policy "studio: the piece's editors hear its room" on realtime.messages for select to authenticated
  using (realtime.messages.extension in ('broadcast', 'presence')
         and exists (select 1 from public.content_items c
                      where c.id = (select case when realtime.topic() ~ '^studio-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                                then substr(realtime.topic(), 8)::uuid end)));
drop policy if exists "studio: the piece's editors speak in its room" on realtime.messages;
create policy "studio: the piece's editors speak in its room" on realtime.messages for insert to authenticated
  with check (realtime.messages.extension in ('broadcast', 'presence')
              and exists (select 1 from public.content_items c
                           where c.id = (select case when realtime.topic() ~ '^studio-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                                     then substr(realtime.topic(), 8)::uuid end)));

-- ── (2) a device is seen when it is kept, and one nobody keeps is let go ──────────────────────────────────────────
alter table public.push_subscriptions add column if not exists seen_at timestamptz not null default now();
comment on column public.push_subscriptions.seen_at is
  'When the app last kept this device (0428: keep_push_device, keep_app_push_token — every launch of the iPhone app). One nobody is signed in on, that asked for no news (wants_live) and unseen for 30 days is let go each morning (push-device-sweep).';

-- As 0418 and 0419 wrote them, with the stamp (the R22 test holds every other line to theirs).
create or replace function public.keep_push_device(p_endpoint text, p_p256dh text, p_auth text,
  p_crew boolean default null, p_wants_live boolean default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if coalesce(length(p_endpoint), 0) not between 12 and 2048 or p_endpoint !~ '^https://' then
    raise exception 'That isn''t a push subscription.' using errcode = '22023';
  end if;
  -- 0418: at a browser's push service — any other address was a post the push function made to wherever it said.
  if not public.push_host_ok(p_endpoint) then
    raise exception 'That isn''t a push subscription.' using errcode = '22023';
  end if;
  if coalesce(length(p_p256dh), 0) not between 16 and 256 or coalesce(length(p_auth), 0) not between 8 and 128 then
    raise exception 'That push subscription has no keys.' using errcode = '22023';
  end if;
  -- 0418: a new device nobody is signed in on is counted — three hundred an hour, for everyone together. A member's is
  -- not: theirs replaces their other browsers (below), so it cannot pile up.
  if v_user is null and not exists (select 1 from public.push_subscriptions where endpoint = p_endpoint)
     and not public.rate_limit_hit('push:new-guest', 3600000, 300) then
    raise exception 'Too many devices just now — try again in a while.' using errcode = 'P0001';
  end if;
  insert into public.push_subscriptions as s (endpoint, p256dh, auth, user_id, is_admin, wants_live, seen_at)
  values (p_endpoint, p_p256dh, p_auth, v_user, coalesce(p_crew, false), coalesce(p_wants_live, false), now())
  on conflict (endpoint) do update set
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    user_id = excluded.user_id,
    tenant_id = excluded.tenant_id,          -- stamped for whoever has it now (0134 stamp_tenant)
    is_admin = case when s.user_id is distinct from excluded.user_id then coalesce(p_crew, false)
                    else coalesce(p_crew, false) or s.is_admin end,
    wants_live = coalesce(p_wants_live, s.wants_live),
    seen_at = now();                         -- 0428: kept again is seen again (a device nobody keeps is let go)
  -- One browser each: the person's other browsers go (a reinstall or a new browser mints a new endpoint, and every
  -- alert fanned out to all the stale ones). Only browsers — an endpoint that is a web address.
  if v_user is not null then
    delete from public.push_subscriptions
     where user_id = v_user and endpoint <> p_endpoint and endpoint like 'https://%';
  end if;
end $$;
revoke all on function public.keep_push_device(text, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.keep_push_device(text, text, text, boolean, boolean) to anon, authenticated;

create or replace function public.keep_app_push_token(p_token text) returns void
  language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_endpoint text;
begin
  if coalesce(p_token, '') !~ '^[0-9A-Fa-f]{32,200}$' then
    raise exception 'That isn''t a device token.' using errcode = '22023';
  end if;
  v_endpoint := 'apns:' || lower(p_token);
  -- 0419: a new phone nobody is signed in on is counted with the web's (0418's push:new-guest — three hundred an hour,
  -- for everyone together). A member's is not: theirs replaces their other phones (below), so it cannot pile up.
  if v_user is null and not exists (select 1 from public.push_subscriptions where endpoint = v_endpoint)
     and not public.rate_limit_hit('push:new-guest', 3600000, 300) then
    raise exception 'Too many devices just now — try again in a while.' using errcode = 'P0001';
  end if;
  insert into public.push_subscriptions as s (endpoint, platform, p256dh, auth, user_id, is_admin, seen_at)
  values (v_endpoint, 'apns', null, null, v_user, true, now())          -- the mark is 0365's to give: the crew's alone
  on conflict (endpoint) do update set
    platform = 'apns', p256dh = null, auth = null,
    user_id = excluded.user_id,
    tenant_id = excluded.tenant_id,                             -- stamped for whoever has it now (0134 stamp_tenant)
    is_admin = true,
    seen_at = now();                                            -- 0428: kept again is seen again
  -- One app install each: the person's other phones go — a reinstall or a new phone is a new token. Browsers stay.
  if v_user is not null then
    delete from public.push_subscriptions
     where user_id = v_user and endpoint <> v_endpoint and endpoint like 'apns:%';
  end if;
end $$;
revoke all on function public.keep_app_push_token(text) from public, anon, authenticated;
grant execute on function public.keep_app_push_token(text) to anon, authenticated;

-- The sweep, each morning (0419's sweeps are at :17 and :23 past seven). A member's device is theirs until they sign
-- out or it is gone; one that asked to hear when the truck goes live stays while it lives.
do $$ begin perform cron.unschedule('push-device-sweep'); exception when others then null; end $$;
do $$ begin
  perform cron.schedule('push-device-sweep', '29 7 * * *',
    $q$delete from public.push_subscriptions where user_id is null and not wants_live and seen_at < now() - interval '30 days'$q$);
exception when others then
  raise notice '0428: pg_cron is not here — the sweep is: delete from public.push_subscriptions where user_id is null and not wants_live and seen_at < now() - interval ''30 days''';
end $$;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The Studio talks only to its editors', 'security', 'Studio',
   'Co-editing a piece in the Studio — who is in it, and the fields as they are typed — goes over a private room only the piece''s editors can join. It was a public channel anyone with the piece''s id could listen to and type into.',
   '2026-10-18', false),
  ('Devices nobody uses are let go', 'fix', 'Alerts',
   'A phone or browser kept for alerts that nobody is signed in on, that asked for no news, and that hasn''t opened the app in thirty days is let go each morning. Members'' devices, and ones waiting to hear the truck is live, are kept.',
   '2026-10-18', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname like 'studio:%';  -- 2
--   select count(*) from information_schema.columns where table_name = 'push_subscriptions' and column_name = 'seen_at';     -- 1
--   select prosrc like '%seen_at = now()%' from pg_proc where proname in ('keep_push_device', 'keep_app_push_token');        -- t, t
--   select count(*) from cron.job where jobname = 'push-device-sweep';                                                     -- 1
select public.record_migration('0428_the_studio_room_is_its_editors_and_a_phone_nobody_keeps_is_let_go');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
