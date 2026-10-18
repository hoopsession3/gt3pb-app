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
-- pending-from: 0433
-- generated-at: 2026-10-18
-- pending-count: 6
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

-- ============================================================
-- 0432_a_covered_settle_is_a_free_cup_a_credit_or_an_owners_reason.sql
-- ============================================================
-- ── 0432 — A COVERED SETTLE IS A FREE CUP, A CREDIT, OR AN OWNER'S REASON ──────────────────────────────────────────────
-- 2026-10-18. R27 of the 10/10 audit (database F17; Ryan, 2026-10-18: "Owner/admin, with a reason"). Paste into
-- Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY. An order settled at the window as covered — paid with a free cup or the member's credit (0416) — takes no money,
-- and nothing recorded why: any crew member's tap made any order free, and the books said only "covered". A free cup
-- given (redeem_free_cup, 0387) and credit used (spend_credit, 0389) each write a row of their own, signed by whoever
-- gave it; the settle never asked for one.
--
-- WHAT.
--   · covered_settles: one row for each order settled as covered — the free cup or the credit that covered it, or an
--     owner's or admin's reason for putting it on the house — with who settled it and when. Written by
--     staff_collect_payment only, taken back with the settle by staff_undo_collection; the crew read it, nobody writes it.
--   · staff_collect_payment(kind, id, via, reason): covered, by anyone on the crew, takes a free cup redeemed for the
--     order's member today (the business day, Eastern) or credit they used today, that covers no other order — the
--     earliest, a free cup first, kept on the row. With nothing taken off, an owner or admin may put it on the house with
--     a reason (three characters or more, kept to 200), which is the record; anyone else is told to take it off on the
--     scan screen first. Your own order is still another crew member's to settle as covered (0420). Cash and the card
--     reader are as they were; a reason sent with them is not kept.
--   · staff_undo_collection (0341's): a covered settle taken back lets its free cup or credit cover an order again.
--
-- ORDER. Paste it right after the deploy that carries "On the house" (components/CollectSheet). Before this paste that
-- button is refused — its reason is an argument the database doesn't know yet (PGRST202); between this paste and that
-- deploy, an owner's covered settle with nothing taken off is asked for a reason the old screen can't give, and "Hand it
-- over unpaid" is the way through for those minutes. Every other settle works on either side.
--
-- set lock_timeout (database F16): a new table and its indexes; each function is made again under a moment's lock.
-- existing rows: none — an order settled as covered before this has no row here, and is left as it was.
-- changelog: below.

set lock_timeout = '5s';

create table if not exists public.covered_settles (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  order_kind  text not null check (order_kind in ('cup', 'pickup')),
  order_id    uuid not null,
  how         text not null check (how in ('free_cup', 'credit', 'on_the_house')),
  free_cup    uuid,   -- the loyalty_ledger row of the free cup that covered it (0387) — no key: an erased member's goes
  credit      uuid,   -- the credit_spends row of the credit that covered it (0389)
  reason      text,   -- an owner's or admin's, when nothing was taken off: why, not who
  by_user     uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint covered_settles_says_what check (
       (how = 'free_cup'     and free_cup is not null and credit is null and reason is null)
    or (how = 'credit'       and credit is not null and free_cup is null and reason is null)
    or (how = 'on_the_house' and free_cup is null and credit is null and length(btrim(coalesce(reason, ''))) between 3 and 200))
);
-- One cover for an order, and a free cup or a credit covers one order.
create unique index if not exists covered_settles_one_per_order on public.covered_settles (order_kind, order_id);
create unique index if not exists covered_settles_free_cup_once on public.covered_settles (free_cup) where free_cup is not null;
create unique index if not exists covered_settles_credit_once on public.covered_settles (credit) where credit is not null;
create index if not exists covered_settles_by_user on public.covered_settles (by_user);
comment on table public.covered_settles is
  'Why an order settled at the window as covered took no money (0432): the free cup (loyalty_ledger, 0387) or the credit (credit_spends, 0389) that covered it, or an owner''s or admin''s reason for putting it on the house — who settled it, and when. Written only by staff_collect_payment; removed with the settle by staff_undo_collection.';

alter table public.covered_settles enable row level security;
drop trigger if exists stamp_tenant_tg on public.covered_settles;
create trigger stamp_tenant_tg before insert on public.covered_settles for each row execute function public.stamp_tenant();
drop policy if exists "tenant isolation" on public.covered_settles;
create policy "tenant isolation" on public.covered_settles as restrictive for all
  using (tenant_id = (select public.effective_tenant())) with check (tenant_id = (select public.effective_tenant()));
drop policy if exists "covered settles crew read" on public.covered_settles;
create policy "covered settles crew read" on public.covered_settles for select using ((select public.is_staff()));
revoke all on public.covered_settles from public, anon;
revoke insert, update, delete, truncate on public.covered_settles from authenticated;
grant select on public.covered_settles to authenticated;

-- ── the settle: covered takes what covered it ───────────────────────────────────────────────────────────────────────
-- 0420's, with a reason and the cover. The three-argument door goes: a call that names three still lands here (the
-- reason defaults to none), and two doors of one name would be one too many for PostgREST to choose between.
drop function if exists public.staff_collect_payment(text, uuid, text);
create or replace function public.staff_collect_payment(p_kind text, p_id uuid, p_via text, p_reason text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_paid boolean; v_at timestamptz; v_gone boolean; v_owner uuid; v_tenant uuid;
        v_cup uuid; v_credit uuid; v_reason text; v_since timestamptz;
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  if p_via is null or p_via not in ('cash', 'card_reader', 'covered') then
    raise exception 'say how it was paid: cash, card_reader or covered';
  end if;

  -- Cash sets paid (the till is counted nowhere else); the reader does not (Square counts it, 0341); covered — a free
  -- cup or the member's credit (0416), or an owner's reason (0432) — does not either: it is owed nothing, and it is no
  -- money anywhere.
  if p_kind = 'cup' then
    select paid, collected_at, status = 'void', user_id, tenant_id into v_paid, v_at, v_gone, v_owner, v_tenant
      from public.orders where id = p_id and tenant_id = public.effective_tenant() for update;
    if not found then raise exception 'that order does not exist'; end if;
    if v_gone then raise exception 'that order was voided — nothing to collect'; end if;
  elsif p_kind = 'pickup' then
    select paid, collected_at, canceled_at is not null, user_id, tenant_id into v_paid, v_at, v_gone, v_owner, v_tenant
      from public.drop_orders where id = p_id and tenant_id = public.effective_tenant() for update;
    if not found then raise exception 'that pack does not exist'; end if;
    if v_gone then raise exception 'that pack was canceled — nothing to collect'; end if;
  else
    raise exception 'unknown kind: %', coalesce(p_kind, 'null');
  end if;
  if v_paid or v_at is not null then return 'already settled'; end if;

  if p_via = 'covered' then
    -- 0420: a free cup or credit for your own order is another crew member's to give (0392's rule for a card).
    if v_owner is not null and v_owner = auth.uid() then
      raise exception 'your own %: another crew member settles it as covered', case when p_kind = 'cup' then 'order' else 'pack' end
        using errcode = '42501';
    end if;
    -- A cover left from a settle taken back some other way is not this one's (the order is held: nobody else is here).
    delete from public.covered_settles where order_kind = p_kind and order_id = p_id;
    -- 0432: what covered it — a free cup redeemed for their member today, or credit they used today, covering no other
    -- order. Held while this settles, so two phones settling two of their orders take two, not one twice.
    if v_owner is not null then
      v_since := (public.business_day()::timestamp at time zone 'America/New_York');
      select l.id into v_cup from public.loyalty_ledger l
       where l.user_id = v_owner and l.kind = 'redeem' and l.created_at >= v_since
         and not exists (select 1 from public.covered_settles s where s.free_cup = l.id)
       order by l.created_at, l.id
       limit 1
       for update of l skip locked;
      if v_cup is null then
        select c.id into v_credit from public.credit_spends c
         where c.user_id = v_owner and c.created_at >= v_since
           and not exists (select 1 from public.covered_settles s where s.credit = c.id)
         order by c.created_at, c.id
         limit 1
         for update of c skip locked;
      end if;
    end if;
    -- Nothing taken off: on the house — an owner's or admin's to say, with why.
    if v_cup is null and v_credit is null then
      if not public.is_admin() then
        raise exception 'Nothing was taken off for them today — redeem their free cup or use their credit on the scan screen first. An owner or admin can put it on the house, with a reason.'
          using errcode = '42501';
      end if;
      v_reason := left(btrim(coalesce(p_reason, '')), 200);
      if length(v_reason) < 3 then
        raise exception 'Say why it''s on the house — the reason is the record.' using errcode = '22023';
      end if;
    end if;
  end if;

  if p_kind = 'cup' then
    update public.orders
       set paid = (p_via = 'cash'), collected_via = p_via, collected_at = now(), collected_by = auth.uid()
     where id = p_id;
  else
    update public.drop_orders
       set paid = (p_via = 'cash'), collected_via = p_via, collected_at = now(), collected_by = auth.uid()
     where id = p_id;
  end if;
  if p_via = 'covered' then
    insert into public.covered_settles (tenant_id, order_kind, order_id, how, free_cup, credit, reason, by_user)
    values (v_tenant, p_kind, p_id,
            case when v_cup is not null then 'free_cup' when v_credit is not null then 'credit' else 'on_the_house' end,
            v_cup, v_credit, case when v_cup is null and v_credit is null then v_reason end, auth.uid());
  end if;
  return 'collected';
end $$;
revoke all on function public.staff_collect_payment(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.staff_collect_payment(text, uuid, text, text) to authenticated;
comment on function public.staff_collect_payment(text, uuid, text, text) is
  'The window''s settle (0341; 0416, 0420, 0432): cash, the card reader, or covered — staff only, tenant-scoped, the order locked. Covered is never your own order, and takes what covered it: a free cup redeemed or credit used for the order''s member today that covers no other order, or — nothing taken off — an owner''s or admin''s reason. Each is written to covered_settles.';

-- ── the undo: the cover goes with the settle ────────────────────────────────────────────────────────────────────────
-- 0341's, with one more line: a covered settle taken back lets its free cup or credit cover an order again.
create or replace function public.staff_undo_collection(p_kind text, p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_via text; v_at timestamptz; v_by uuid;
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  if p_kind = 'cup' then
    select collected_via, collected_at, collected_by into v_via, v_at, v_by
      from public.orders where id = p_id and tenant_id = public.effective_tenant() for update;
  elsif p_kind = 'pickup' then
    select collected_via, collected_at, collected_by into v_via, v_at, v_by
      from public.drop_orders where id = p_id and tenant_id = public.effective_tenant() for update;
  else
    raise exception 'unknown kind: %', coalesce(p_kind, 'null');
  end if;
  if not found then raise exception 'that order does not exist'; end if;
  if v_at is null then return 'nothing to undo'; end if;
  if not (public.is_admin() or (v_by = auth.uid() and v_at > now() - interval '1 hour')) then
    raise exception 'only the person who took it can undo it, within the hour — or an admin';
  end if;

  if p_kind = 'cup' then
    update public.orders
       set paid = case when v_via = 'cash' then false else paid end,
           collected_via = null, collected_at = null, collected_by = null
     where id = p_id;
  else
    update public.drop_orders
       set paid = case when v_via = 'cash' then false else paid end,
           collected_via = null, collected_at = null, collected_by = null
     where id = p_id;
  end if;
  delete from public.covered_settles where order_kind = p_kind and order_id = p_id;   -- 0432
  return 'undone';
end $$;
revoke all on function public.staff_undo_collection(text, uuid) from public, anon, authenticated;
grant execute on function public.staff_undo_collection(text, uuid) to authenticated;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A covered order says what covered it', 'fix', 'Money',
   'Settling an order at the window as a free cup or credit now takes the free cup redeemed or the credit used for that member today, and keeps which one it was. With nothing taken off, only an owner or admin can put an order on the house, and they say why — the reason is kept with it.',
   '2026-10-18', false),
  -- The same release's two changes outside the database (R27): said here, where the changelog is written.
  ('Deleting your account asks for a code', 'fix', 'Account',
   'Delete my account emails you an 8-digit code first, and deletes the account when you enter it — or, if you sign in with Apple, Face ID on your iPhone does. A phone left unlocked, or lent for a minute, can''t delete its owner''s account.',
   '2026-10-18', false),
  ('Alerts outside the app say only what kind and which order', 'fix', 'System',
   'Teams cards and alert emails say what kind of thing happened, the order''s number and the link — never a customer''s name, email, phone or address, or what anyone typed. A booking lead''s email says the day and the headcount; who it is stays in the app.',
   '2026-10-18', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from pg_proc where proname = 'staff_collect_payment';                                        -- 1
--   select pg_get_function_identity_arguments('public.staff_collect_payment(text,uuid,text,text)'::regprocedure)
--     = 'p_kind text, p_id uuid, p_via text, p_reason text';                                                     -- t
--   select relrowsecurity from pg_class where oid = 'public.covered_settles'::regclass;                          -- t
--   select has_table_privilege('authenticated', 'public.covered_settles', 'insert');                             -- f
--   select prosrc like '%covered_settles%' from pg_proc where proname = 'staff_undo_collection';                 -- t
select public.record_migration('0432_a_covered_settle_is_a_free_cup_a_credit_or_an_owners_reason');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor

-- ============================================================
-- 0433_two_step_for_the_owners_and_admins.sql
-- ============================================================
-- ── 0433 — TWO-STEP FOR THE OWNERS AND ADMINS ──────────────────────────────────────────────────────────────────────────
-- 2026-10-18. R28 of the 10/10 audit (security F6; Ryan, 2026-10-18: "Yes, owner/admin"). Paste into Supabase → SQL
-- Editor → Run. A second run changes nothing.
--
-- WHY. An owner's or an admin's password, or a code read off their email, is everything: refunds, the books, every
-- customer, the crew's roles and offer letters. Supabase has a second step built in — an authenticator app's six-digit
-- code (TOTP; Authentication → Multi-Factor says it is on for this project) — and nothing in the app asked for it, or
-- held an owner's or admin's powers to it.
--
-- WHAT.
--   · two_step_ok(): the caller has given the second step on this sign-in (the token's aal is aal2) — or has no
--     authenticator set up and nobody requires one. One question, asked by the two gates below.
--   · is_admin() and is_owner() — 0035's and 0023's, the gates every owner and admin power asks (171 places: policies,
--     functions, and the app's server through lib/apiAuth) — answer yes only with two_step_ok() as well. An owner or
--     admin who set up an authenticator is an owner or admin on a sign-in that gave its code, and crew (is_staff) on one
--     that didn't, until they give it. Nothing changes for anyone who hasn't set one up.
--   · two_step_settings: whether this business requires the second step of every owner and admin. Off until an owner
--     turns it on — require_two_step(true) — which only an owner who has set up an authenticator and given its code on
--     this sign-in may do, so turning it on can't lock its owner out. On, an owner or admin without an authenticator is
--     crew until they set one up (setting one up asks for no owner's power). Off again: an owner, on a sign-in with its
--     code.
--   · two_step_state(): what the app needs to ask — whether the caller is an owner or admin, has an authenticator,
--     gave its code on this sign-in, whether the business requires it — for the caller alone; no secret, no factor's id.
--
-- NO LOCKOUT. Before anyone sets up an authenticator nothing changes. An owner who loses theirs: Supabase → Authentication
-- → Users → the owner → remove the factor (the dashboard needs no app); they are an owner again on their next sign-in, and
-- set a new one up.
--
-- ORDER. Paste it right after the deploy that carries Settings & privacy → Two-step sign-in and the code prompt
-- (components/TwoStep*): before that deploy nobody can set an authenticator up from the app, and before this paste one set
-- up from it asks for its code and holds no power to it yet.
-- set lock_timeout (database F16): two functions made again, a small table, two more functions — a moment's lock each.
-- existing rows: none.
-- changelog: below.

set lock_timeout = '5s';

create table if not exists public.two_step_settings (
  tenant_id   uuid primary key references public.tenants(id),
  required    boolean not null default false,
  set_by      uuid references auth.users(id) on delete set null,
  set_at      timestamptz not null default now()
);
create index if not exists two_step_settings_set_by on public.two_step_settings (set_by);
comment on table public.two_step_settings is
  'Whether a business requires the second step (an authenticator''s code) of every owner and admin (0433). Read by two_step_ok(); written only by require_two_step().';
alter table public.two_step_settings enable row level security;
drop policy if exists "tenant isolation" on public.two_step_settings;
create policy "tenant isolation" on public.two_step_settings as restrictive for all
  using (tenant_id = (select public.effective_tenant())) with check (tenant_id = (select public.effective_tenant()));
revoke all on public.two_step_settings from public, anon, authenticated;

-- ── the one question ────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.two_step_ok() returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
      or (not exists (select 1 from auth.mfa_factors f where f.user_id = (select auth.uid()) and f.status = 'verified')
          and not coalesce((select s.required from public.two_step_settings s
                             where s.tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()))), false))
$$;
revoke all on function public.two_step_ok() from public, anon, authenticated;
grant execute on function public.two_step_ok() to authenticated, service_role;
comment on function public.two_step_ok() is
  'Whether the caller has given the second step on this sign-in (aal2) — or has no authenticator set up and their business does not require one (0433). is_admin() and is_owner() ask it.';

-- ── the two gates, each 0035's and 0023's but the question ─────────────────────────────────────────────────────────
create or replace function public.is_admin() returns boolean
  language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and (role in ('admin','owner') or is_admin = true)
  ) and public.two_step_ok();
$$;

create or replace function public.is_owner()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select role = 'owner' from public.profiles where id = auth.uid()), false) and public.two_step_ok();
$$;

-- ── what the app asks ──────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.two_step_state() returns jsonb
  language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'leader',   coalesce((select p.role in ('owner', 'admin') or coalesce(p.is_admin, false) from public.profiles p where p.id = (select auth.uid())), false),
    'owner',    coalesce((select p.role = 'owner' from public.profiles p where p.id = (select auth.uid())), false),
    'enrolled', exists (select 1 from auth.mfa_factors f where f.user_id = (select auth.uid()) and f.status = 'verified'),
    'given',    coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2',
    'required', coalesce((select s.required from public.two_step_settings s
                           where s.tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()))), false),
    'ok',       public.two_step_ok())
$$;
revoke all on function public.two_step_state() from public, anon, authenticated;
grant execute on function public.two_step_state() to authenticated;
comment on function public.two_step_state() is
  'The second step, for the caller alone (0433): owner or admin, an authenticator set up, its code given on this sign-in, required by their business, and whether their owner and admin powers stand. No secret and no factor''s id.';

create or replace function public.require_two_step(p_on boolean) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  if p_on is null then raise exception 'Say on or off.' using errcode = '22023'; end if;
  -- An owner, on a sign-in that gave its code, with an authenticator of their own: so the owner turning it on has one,
  -- and has just used it (GoTrue gives aal2 only for a code; the factor is asked too, as a second word for it).
  if not public.is_owner() or coalesce((select auth.jwt() ->> 'aal'), 'aal1') <> 'aal2'
     or not exists (select 1 from auth.mfa_factors f where f.user_id = (select auth.uid()) and f.status = 'verified') then
    raise exception 'Only an owner, signed in with their authenticator''s code, sets this.' using errcode = '42501';
  end if;
  select p.tenant_id into v_tenant from public.profiles p where p.id = (select auth.uid());
  insert into public.two_step_settings (tenant_id, required, set_by, set_at)
  values (v_tenant, p_on, (select auth.uid()), now())
  on conflict (tenant_id) do update set required = excluded.required, set_by = excluded.set_by, set_at = excluded.set_at;
  return jsonb_build_object('ok', true, 'required', p_on);
end $$;
revoke all on function public.require_two_step(boolean) from public, anon, authenticated;
grant execute on function public.require_two_step(boolean) to authenticated;
comment on function public.require_two_step(boolean) is
  'Require the second step of every owner and admin of the caller''s business, or stop requiring it (0433): an owner, on a sign-in that gave their authenticator''s code, only.';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Two-step sign-in for owners and admins', 'security', 'Account',
   'Owners and admins can add an authenticator app in Settings & privacy. Once it''s on, the money, the books, customers and the crew''s roles ask for its six-digit code once each sign-in — a password or an emailed code alone isn''t enough. An owner can require it of every owner and admin.',
   '2026-10-18', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select prosrc like '%two_step_ok%' from pg_proc where proname in ('is_admin', 'is_owner');                  -- t, t
--   select has_function_privilege('anon', 'public.two_step_state()', 'execute');                                 -- f
--   select relrowsecurity from pg_class where oid = 'public.two_step_settings'::regclass;                        -- t
--   select count(*) from public.two_step_settings where required;                                                -- 0
select public.record_migration('0433_two_step_for_the_owners_and_admins');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
