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
-- pending-from: 0431
-- generated-at: 2026-10-18
-- pending-count: 4
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- held: 0376_nobody_on_the_pass_during_service_is_an_alert.sql — NOT in this file; applied by hand once the condition in its header is met
-- held: 0424_a_password_set_before_the_proof_waits_for_it_everywhere.sql — NOT in this file; applied by hand once the condition in its header is met
-- ============================================================
-- 0428_the_studio_room_is_its_editors_and_a_phone_nobody_keeps_is_let_go.sql
-- ============================================================
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

-- ============================================================
-- 0429_a_text_is_sent_once_for_what_happened.sql
-- ============================================================
-- ── 0429 — A TEXT IS SENT ONCE FOR WHAT HAPPENED ───────────────────────────────────────────────────────────────────
-- 2026-10-18. R22 of the 10/10 audit (API F11; Ryan, 2026-10-17: "Keep working to improve to a 10"). Paste into
-- Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY. A message to a customer named nothing of what it was about: the Pass pressed twice told the member twice that
-- their order was ready; a stop called off whose first call died part way never told its packs, because a second call
-- couldn't know who had heard; a provider's webhook told again sent its shipping notice again.
--
-- WHAT. The app names what happened — "order-ready:<order>", "stop-canceled:<stop>:pack:<pack>" (lib/notify onceKey) —
-- and the same name twice is one message. An email is held to it by Resend (its Idempotency-Key, kept a day). A text is
-- held to it here: public.message_sent keeps each text's key — claimed just before the text goes, marked sent when it
-- went, let go again if it didn't, and taken over by the next call when a claim was never marked in two minutes (the
-- call that claimed it died on the way: a text missed is worse than one doubled). The service role's alone, ninety days
-- — push_sent's shape (0419), for the push function's own.
--
-- set lock_timeout (database F16): one new table — nothing else is touched.
-- existing rows: none — a new table.
-- changelog: below.

set lock_timeout = '5s';

create table if not exists public.message_sent (
  event_key  text primary key check (char_length(event_key) between 3 and 220),
  claimed_at timestamptz not null default now(),   -- the text about to go (lib/notify claimText)
  sent_at    timestamptz                            -- when the provider took it; null while it is going, or if the call died
);
alter table public.message_sent enable row level security;   -- no policy: the app's server (service role) alone
revoke all on public.message_sent from public, anon, authenticated;
grant select, insert, update, delete on public.message_sent to service_role;
create index if not exists message_sent_claimed_idx on public.message_sent (claimed_at);
comment on table public.message_sent is
  'One row per text the app sent for something that happened (0429): its key names it (text:order-ready:<id>, text:stop-canceled:<stop>:pack:<id>, …) — claimed just before the text goes, marked sent when it went, let go if it did not, and taken over by the next call when never marked within two minutes; so the same thing told twice is texted once. Emails are held to the same keys by Resend. Kept ninety days.';

do $$ begin perform cron.unschedule('message-sent-sweep'); exception when others then null; end $$;
do $$ begin
  perform cron.schedule('message-sent-sweep', '19 7 * * *', $q$delete from public.message_sent where claimed_at < now() - interval '90 days'$q$);
exception when others then
  raise notice '0429: pg_cron is not here — the sweep is: delete from public.message_sent where claimed_at < now() - interval ''90 days''';
end $$;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A message is sent once', 'fix', 'Ordering',
   'Telling a customer something names what it is about — this order ready, this stop called off for this pack — and the same thing told twice is one email and one text: a button pressed twice, or a call retried after it stopped part way, no longer tells them twice, and a retry now reaches whoever the first try missed.',
   '2026-10-18', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from pg_class where relname = 'message_sent' and relrowsecurity;                                     -- 1
--   select has_table_privilege('anon', 'public.message_sent', 'select');                                                -- false
--   select count(*) from cron.job where jobname = 'message-sent-sweep';                                                 -- 1
select public.record_migration('0429_a_text_is_sent_once_for_what_happened');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor

-- ============================================================
-- 0430_the_watcher_is_watched_and_the_push_hooks_counted.sql
-- ============================================================
-- ── 0430 — THE WATCHER IS WATCHED, AND THE PUSH WEBHOOKS ARE COUNTED ─────────────────────────────────────────────────
-- 2026-10-18. R24 of the 10/10 audit (database F8 and F6, operations F11 and F19; Ryan, 2026-10-17: "Keep working to
-- improve to a 10").
-- Paste into Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY. pg_cron runs every scheduled job the migrations made — the watchdogs, the reminders, the sweeps — and cron_watch
-- (0419, 0423, 0427) says a job that fails or stops. But cron_watch is one of those jobs: if pg_cron stopped, or
-- cron_watch itself failed every run, nothing in the database was left to say so, and the alerts it would have raised
-- were simply never raised. And a job that was never made in this database (a restore, a project moved, a migration
-- pasted half) or that someone unscheduled fails nothing and stops nothing — it isn't there to be read. The push
-- webhooks are the same kind of thing: ten of the triggers that carry an order, a booking, a sign-up or an alert to the
-- phones, Teams and email were made in the dashboard (database F6), in no migration — one deleted or switched off there
-- is a push that silently never goes, and nothing looked.
--
-- WHAT. One question the app's own server may ask, from outside the database: public.ops_alive(p_jobs, p_from, p_hooks)
-- answers when cron_watch last finished without failing, how many active jobs there are, how many of the jobs the app
-- knows the migrations made (lib/opsWatch CRON_JOBS — held to the migrations by scripts/r24.test.mjs) are missing or
-- switched off — each counted only once the migration that made it is in this database's ledger, so a migration not yet
-- pasted is not "missing" — and how many of the push webhooks the app names (lib/opsWatch PUSH_HOOKS — held to the
-- security snapshot) are not on their table or are switched off. /api/health asks it and says whether the scheduled
-- jobs run and the webhooks are on; the half-hourly production check (scripts/verify.prod.mjs) fails when they are not —
-- outside the database, so a stopped pg_cron is heard. Counts and a time only: no job's or trigger's name, command or
-- address leaves the database (a webhook's definition carries its address and key — never read here).
--
-- set lock_timeout (database F16): a function only — nothing is locked — but the rule is the rule.
-- existing rows: none — a new function; cron_watch and the webhooks are not touched.
-- changelog: below.

set lock_timeout = '5s';

create or replace function public.ops_alive(p_jobs text[], p_from text[], p_hooks text[]) returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    -- when the watcher last finished without failing: a stopped pg_cron, and a watcher failing every run, both age it
    'watched_at', (select max(d.end_time) from cron.job_run_details d join cron.job j on j.jobid = d.jobid
                    where j.jobname = 'cron-watch' and d.status = 'succeeded'),
    'active', (select count(*) from cron.job j where j.active),
    -- each job the app names, once the migration that made it is applied here (the ledger, 0304): not there, or off
    'missing', (select count(*) from unnest(coalesce(p_jobs, '{}'::text[]), coalesce(p_from, '{}'::text[])) as x(job, made_by)
                 where exists (select 1 from public.schema_migrations m where m.version = x.made_by)
                   and not exists (select 1 from cron.job j where j.jobname = x.job and j.active)),
    -- each push webhook the app names ("table.trigger", public's): not on that table, or switched off (tgenabled D) —
    -- its name and switch only, never its definition (it carries the function's address and key)
    'hooks_off', (select count(*) from unnest(coalesce(p_hooks, '{}'::text[])) as h(hook)
                   where not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
                                      where n.nspname = 'public' and c.relname = split_part(h.hook, '.', 1) and t.tgname = split_part(h.hook, '.', 2)
                                        and not t.tgisinternal and t.tgenabled <> 'D')));
$$;
revoke all on function public.ops_alive(text[], text[], text[]) from public, anon, authenticated;
grant execute on function public.ops_alive(text[], text[], text[]) to service_role;
comment on function public.ops_alive(text[], text[], text[]) is
  'Whether the scheduled jobs run and the push webhooks are on (0430): when cron_watch last finished without failing, how many jobs are active, how many of the jobs the app names (lib/opsWatch CRON_JOBS, with the migration that made each) are missing or switched off — counted only once that migration is in the ledger — and how many of the push webhooks it names (PUSH_HOOKS) are not there or are off. The app''s server alone (/api/health); counts and a time, never a name, a command or a definition.';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The watcher is watched', 'fix', 'System',
   'The jobs the database runs on a schedule — the watchdogs, reminders and sweeps — and the hooks that carry orders and alerts to phones are checked from outside it every half hour: if the scheduler stopped, its watcher failed, a job went missing or a push hook was switched off, the production check fails and says so.',
   '2026-10-18', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select has_function_privilege('anon', 'public.ops_alive(text[], text[], text[])', 'execute');                  -- false
--   select has_function_privilege('service_role', 'public.ops_alive(text[], text[], text[])', 'execute');          -- true
--   select (public.ops_alive('{}', '{}', '{}') ->> 'active')::int > 0;                                              -- true
select public.record_migration('0430_the_watcher_is_watched_and_the_push_hooks_counted');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor

-- ============================================================
-- 0431_the_day_is_the_businesss_and_money_is_never_below_zero.sql
-- ============================================================
-- ── 0431 — THE DAY IS THE BUSINESS'S, AND MONEY IS NEVER BELOW ZERO ──────────────────────────────────────────────────
-- 2026-10-18. R26 of the 10/10 audit (database F4's last and F2's last; Ryan, 2026-10-17: "Keep working to improve to a
-- 10"). Paste into Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY. (1) 0348 named the business day — Eastern time, public.business_day() — and 0420 and 0423 moved the money's reports
-- onto it. Eight columns' defaults, five functions and three views still read current_date, the database's day (UTC),
-- which is already tomorrow from 8pm Eastern in summer, 7pm in winter. A delivery shelved at nine at night was received
-- tomorrow; an agreement ended at nine ended tomorrow; a city could be switched live the evening before its opening day;
-- an evening's check-in, meeting notes, expense or maintenance run was dated tomorrow; tonight's events stopped counting
-- as upcoming; an expense's age and a check's freshness were a day off every evening.
-- (2) A total, a fee, a tax or an amount the money stands on could be written below zero, and nothing in the database
-- said no — tips, refunds, credit spends and a pack's price had their checks; the cup orders', the packs', the
-- deliveries', the shop's, the office's, the invoices' and the event takings' totals did not.
--
-- WHAT. (1) Each of the five functions and three views is made again from its own definition as this database holds it
-- (pg_get_functiondef, pg_get_viewdef — a view's options, its grants and its comment kept), with current_date read as
-- public.business_day() and nothing else changed; one that no longer reads current_date is left as it is. The eight
-- defaults are the business day. (2) Each of seventeen money columns gets a check that it is never below zero — added,
-- then proven against every row it has. A column that already holds a row below zero gets no check (one its own rows
-- break would refuse every later write to them): it is named in the crew's inbox instead, to put right, and the next
-- paste adds it.
--
-- set lock_timeout (database F16): a check is added NOT VALID (a moment's lock) and then validated (reads and writes go
-- on while it reads the rows); a function or a view made again holds its own lock for a moment only.
-- existing rows: none — the defaults date new rows only (which evening a row was written cannot be told now), and every
--   check is proven against the rows already there before it stands.
-- changelog: below.

set lock_timeout = '5s';

-- ── 1) the business day ─────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare r record; n integer := 0;
begin
  for r in
    select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.prokind = 'f'
       and p.proname in ('map_ingredient', 'progress_kpis', 'receive_lot', 'set_market_live', 'supersede_agreement')
       and pg_get_functiondef(p.oid) ~* '\mcurrent_date\M'
  loop
    execute regexp_replace(pg_get_functiondef(r.oid), '\mcurrent_date\M', 'public.business_day()', 'gi');
    n := n + 1;
  end loop;
  raise notice '0431: % function(s) read the business day', n;
end $$;

do $$
declare r record; n integer := 0;
begin
  for r in
    select c.oid, c.relname, c.reloptions from pg_class c join pg_namespace s on s.oid = c.relnamespace
     where s.nspname = 'public' and c.relkind = 'v'
       and c.relname in ('v_compliance_freshness', 'v_crew_person', 'v_receipt_gaps')
       and pg_get_viewdef(c.oid) ~* '\mcurrent_date\M'
  loop
    -- A view made again without its options loses them (security_invoker among them): they are given back by name.
    execute format('create or replace view public.%I%s as %s', r.relname,
      case when r.reloptions is null then '' else ' with (' || array_to_string(r.reloptions, ', ') || ')' end,
      regexp_replace(rtrim(btrim(pg_get_viewdef(r.oid)), ';'), '\mcurrent_date\M', 'public.business_day()', 'gi'));
    n := n + 1;
  end loop;
  raise notice '0431: % view(s) read the business day', n;
end $$;

alter table public.agreement_hours   alter column on_date      set default public.business_day();
alter table public.asset_maintenance alter column performed_on set default public.business_day();
alter table public.changelog         alter column shipped_on   set default public.business_day();
alter table public.check_ins         alter column day          set default public.business_day();
alter table public.expenses          alter column spent_on     set default public.business_day();
alter table public.inventory_lots    alter column received_on  set default public.business_day();
alter table public.maintenance_log   alter column ran_on       set default public.business_day();
alter table public.meeting_notes     alter column met_on       set default public.business_day();

-- ── 2) money is never below zero ────────────────────────────────────────────────────────────────────────────────────
do $$
declare c record; bad bigint; n integer := 0; held text := '';
begin
  for c in
    select * from (values
      ('orders', 'total_cents'), ('drop_orders', 'total_cents'),
      ('delivery_orders', 'bottle_subtotal_cents'), ('delivery_orders', 'delivery_fee_cents'), ('delivery_orders', 'tax_cents'), ('delivery_orders', 'total_cents'),
      ('shop_orders', 'subtotal_cents'), ('shop_orders', 'total_cents'), ('shop_order_items', 'unit_cents'), ('shop_order_items', 'cost_cents'),
      ('invoices', 'amount_cents'),
      ('business_orders', 'price_per_gallon_cents'), ('business_orders', 'subtotal_cents'), ('business_orders', 'delivery_fee_cents'),
      ('business_orders', 'tax_cents'), ('business_orders', 'total_cents'),
      ('event_sales', 'amount_cents')) as v(tbl, col)
  loop
    continue when exists (select 1 from pg_constraint k where k.conrelid = format('public.%I', c.tbl)::regclass
                                                       and k.conname = c.tbl || '_' || c.col || '_not_negative');
    execute format('select count(*) from public.%I where %I < 0', c.tbl, c.col) into bad;
    if bad = 0 then
      begin
        execute format('alter table public.%I add constraint %I check (%I >= 0) not valid', c.tbl, c.tbl || '_' || c.col || '_not_negative', c.col);
        execute format('alter table public.%I validate constraint %I', c.tbl, c.tbl || '_' || c.col || '_not_negative');
        n := n + 1;
      exception when check_violation then
        -- A row below zero written between the count and the proof: the check goes with this block, the column is named.
        execute format('select count(*) from public.%I where %I < 0', c.tbl, c.col) into bad;
      end;
    end if;
    if bad > 0 then held := held || c.tbl || '.' || c.col || ' (' || bad || case when bad = 1 then ' row' else ' rows' end || '); '; end if;
  end loop;
  if held <> '' then
    perform public.alert_open_once('money_below_zero', md5('0431:money-below-zero')::uuid, 'important', 'money',
      'Money below zero in the records — its check waits',
      'These hold an amount below zero, so the check that refuses one does not stand on them yet: ' || held
        || 'Put each right, then paste 0431 again — it adds the checks that are missing.',
      '/crew?s=money&a=pay');
  end if;
  raise notice '0431: % money check(s) stand; waiting: %', n, coalesce(nullif(held, ''), 'none');
end $$;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The day is the business''s', 'fix', 'System',
   'Everything dated as it happens — a delivery shelved, a check-in, an expense, an agreement ended, a city switched live — is dated on Eastern time, not the database''s clock, which turns to tomorrow at 8pm. And no total, fee, tax or amount can be recorded below zero.',
   '2026-10-18', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public'
--     and p.proname in ('map_ingredient','progress_kpis','receive_lot','set_market_live','supersede_agreement')
--     and pg_get_functiondef(p.oid) ~* '\mcurrent_date\M';                                                     -- 0
--   select count(*) from pg_class where relname in ('v_compliance_freshness','v_crew_person','v_receipt_gaps')
--     and pg_get_viewdef(oid) ~* '\mcurrent_date\M';                                                            -- 0
--   select count(*) from information_schema.columns where table_schema = 'public' and column_default ~* 'current_date'; -- 0
--   select count(*) from pg_constraint where conname like '%\_not\_negative' and convalidated;                  -- 17
select public.record_migration('0431_the_day_is_the_businesss_and_money_is_never_below_zero');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
