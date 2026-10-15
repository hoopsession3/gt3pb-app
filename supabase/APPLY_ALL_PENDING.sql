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
-- pending-from: 0406
-- generated-at: 2026-10-15
-- pending-count: 4
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- held: 0376_nobody_on_the_pass_during_service_is_an_alert.sql — NOT in this file; applied by hand once the condition in its header is met
-- ============================================================
-- 0403_an_apple_sign_in_joins_the_account_it_belongs_to.sql
-- ============================================================
-- ── 0403 — AN APPLE SIGN-IN JOINS THE ACCOUNT IT BELONGS TO ─────────────────────────────────────────────────────────────
-- 2026-10-15 (A3 of the account audit; decided by Ryan on 2026-10-13: "right after a first Apple sign-in, offer 'Already a
-- member with another email? Link it', verified by a code sent to that email").
--
-- WHY. Sign in with Apple can hide a person's email behind a private relay address. Supabase links an Apple sign-in to the
-- account with the same email — and a relay address matches nobody's, so a member who joined with their email and then
-- tapped Continue with Apple got a second, empty account: none of their stamps, orders, rewards or referral code, and
-- nothing that linked the two (components/SignIn, lib/appleAuth; the audit's finding).
--
-- WHAT. Two questions only the server asks (app/api/account/link-apple, lib/appleLink):
--   · account_for_apple(sub) — the account an Apple ID signs in to, if one does (auth.identities: Apple's `sub` is the
--     identity's provider_id);
--   · account_unused(id) — whether an account holds nothing a person would lose: no order, payment, stamp, point, credit,
--     review, RSVP, referral, membership, reserve, photo or text sign-up. Found the way 0353 finds what to erase — every
--     foreign key in the schema that points at an account, a profile or a customer record, from the catalog, so a table
--     added later counts without anyone remembering it — less the rows signing in makes by itself (the profile and the
--     customer record handle_new_user writes, a phone's push registration, notification settings, page visits, a
--     reminder that cup orders opened, alert reads) and the Apple token the join carries across.
-- The joining itself is Supabase's own: the empty Apple account is deleted (0353's erasure, which finds nothing to keep),
-- and the Apple ID is linked to the member's account with Supabase's manual linking, so Continue with Apple opens it from
-- then on. Nothing here writes a row; both functions answer the server alone.
--
-- A second run changes nothing.
-- changelog: one line, below — the join is something a member sees.

-- 1 · The account an Apple ID signs in to.
create or replace function public.account_for_apple(p_sub text)
returns uuid language sql stable security definer set search_path = public, auth as $$
  select i.user_id from auth.identities i
   where i.provider = 'apple' and i.provider_id = p_sub
   order by i.user_id
   limit 1
$$;
comment on function public.account_for_apple(text) is
  'The account an Apple ID (Apple''s sub) signs in to, or null (0403). The server''s alone: app/api/account/link-apple.';

-- 2 · Whether an account holds nothing a person would lose.
create or replace function public.account_unused(p_user uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  -- What signing in makes by itself, and what nobody would miss: 'table.column' pairs, so a table named here still counts
  -- through any other column that points at the account (profiles.referred_by: someone they referred).
  v_made constant text[] := array[
    'profiles.id', 'customers.user_id', 'apple_tokens.user_id', 'push_subscriptions.user_id', 'notif_prefs.user_id',
    'user_activity.user_id', 'device_heartbeats.user_id', 'alert_reads.user_id', 'alert_snoozes.user_id', 'cup_reminders.user_id'];
  v_customers uuid[];
  v_hit       boolean;
  ref         record;
begin
  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then return false; end if;

  -- what the profile counts itself: points, credit, a founding place, a referral, a role, a photo
  if exists (select 1 from public.profiles p
              where p.id = p_user
                and (coalesce(p.points, 0) <> 0 or coalesce(p.credit_cents, 0) <> 0 or p.founding_member
                     or p.referred_by is not null or p.referral_converted or p.role is distinct from 'member'
                     or nullif(p.avatar_url, '') is not null)) then
    return false;
  end if;

  select coalesce(array_agg(id), '{}') into v_customers from public.customers where user_id = p_user;

  -- every row anywhere that points at the account, its profile or its customer record (0353's way: the catalog)
  for ref in
    select c.conrelid::regclass as rel, cl.relname::text as tbl, a.attname::text as col, c.confrelid as target
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace and ns.nspname = 'public'
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and cardinality(c.conkey) = 1
       and c.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass, 'public.customers'::regclass)
  loop
    if ref.target = 'public.customers'::regclass then
      continue when cardinality(v_customers) = 0;
      execute format('select exists (select 1 from %s where %I = any($1))', ref.rel, ref.col) into v_hit using v_customers;
    else
      continue when (ref.tbl || '.' || ref.col) = any(v_made);
      execute format('select exists (select 1 from %s where %I = $1)', ref.rel, ref.col) into v_hit using p_user;
    end if;
    if v_hit then return false; end if;
  end loop;

  -- a photo of theirs in storage — the avatar and the VIP proof are written to `<user id>/…`
  if exists (select 1 from storage.objects o
              where o.bucket_id in ('avatars', 'vip') and o.name like p_user::text || '/%') then
    return false;
  end if;

  return true;
end $$;
comment on function public.account_unused(uuid) is
  'Whether an account holds nothing a person would lose (0403): the profile''s own counters, every foreign key that points at the account, its profile or its customer record, and its photos — less what signing in makes by itself. The server''s alone: app/api/account/link-apple.';

-- Only the server asks either one: Supabase grants a new function to anon and authenticated by name, so both are taken
-- back here, by name.
revoke all on function public.account_for_apple(text) from public, anon, authenticated;
grant execute on function public.account_for_apple(text) to service_role;
revoke all on function public.account_unused(uuid) from public, anon, authenticated;
grant execute on function public.account_unused(uuid) to service_role;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Sign in with Apple finds the account you already have', 'feature', 'Account',
   'Joined GT3 with your email and then signed in with Apple, which can hide your email? Right after that first Apple sign-in, the app asks whether you are already a member: enter your email and the code we send it, and Continue with Apple opens your own account — stamps, orders and rewards included — from then on. Signed in with your email already? Settings & privacy has Link Sign in with Apple.',
   '2026-10-15', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select has_function_privilege('anon', 'public.account_unused(uuid)', 'execute');            -- false
--   select has_function_privilege('authenticated', 'public.account_for_apple(text)', 'execute'); -- false
--   select has_function_privilege('service_role', 'public.account_unused(uuid)', 'execute');    -- true
select public.record_migration('0403_an_apple_sign_in_joins_the_account_it_belongs_to');

-- ============================================================
-- 0404_an_account_is_erased_before_anything_outside_it.sql
-- ============================================================
-- ── 0404 — AN ACCOUNT IS ERASED BEFORE ANYTHING OUTSIDE IT ───────────────────────────────────────────────────────────────
-- 2026-10-15 (A3 of the account audit: "deletion finishes the database erase before cancelling anything outside it").
--
-- WHY. Deleting an account did what only the route can do first — cancel the membership at Square, remove the photos,
-- revoke Sign in with Apple — and the database's erasure last (0353). The erasure can still say no at that point (an
-- order placed a moment ago), and then the account was left standing without its membership, its photos or its Apple
-- sign-in: deletion stopped halfway (the audit's finding; app/api/account/erase). 0353 refused a membership Square could
-- still bill, so the route had no other order to take.
--
-- WHAT. The database goes first, and what lies outside it follows from a queue the erasure cannot commit without:
--   · erasure_followups — what is left to do outside the database for an account that is gone: a membership to cancel
--     at Square, the Square customer profile that holds a saved card, the token Sign in with Apple gave GT3, a photo in
--     storage. Only the server reads or writes it; a row is deleted when its step is done.
--   · erasure_queues_what_is_outside() — a trigger on auth.users, before the erasure's own (triggers fire in name
--     order: erasure_… before on_auth_user_deleted), that writes those rows from the account's own: in the deleting
--     transaction, so they exist exactly when the erasure commits, and not at all when it refuses.
--   · account_erasure_blockers() — a membership no longer stands in the way: deleting queues its cancel. The only owner
--     and an order on its way still do, in the same words.
--   · claim / finish — the route works its own rows (the ticket it writes on the account before deleting it), any
--     server worker the rest; a row two workers might both take is taken once (skip locked).
--   · erasure_followup_alert(id) — a step that could not be done is handed to the crew by an alert, once, with what to
--     do by hand: the membership's cancel rings (critical — a deleted account must not be billed), the rest do not.
--   · erasure_followups_watch(), every ten minutes — a row nobody finished in fifteen minutes (the route stopped
--     between the erasure and its steps) is handed to the crew the same way; an Apple token nobody revoked in an hour
--     is let go — the person was told how to end Sign in with Apple in Settings.
--
-- A second run changes nothing.
-- changelog: none — deleting reads the same to the person; only its order changed.

create table if not exists public.erasure_followups (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('square_subscription', 'square_customer', 'apple_token', 'photo')),
  ref           text not null,           -- the Square subscription or customer id, the refresh token, 'bucket/path'
  ticket        text,                    -- the route's mark for its own erasure (raw_app_meta_data.erasure_ticket)
  created_at    timestamptz not null default now(),
  attempts      int not null default 0,
  claimed_at    timestamptz,
  last_error    text,
  handed_off_at timestamptz             -- an alert asked the crew to finish it by hand
);
comment on table public.erasure_followups is
  'What is left to do outside the database for an account that was deleted (0404): written by the deletion itself, worked by the server, deleted when done. Nothing in it says who.';
create index if not exists erasure_followups_open_idx on public.erasure_followups (created_at) where handed_off_at is null;
create index if not exists erasure_followups_ticket_idx on public.erasure_followups (ticket) where ticket is not null;

alter table public.erasure_followups enable row level security;
revoke all on table public.erasure_followups from public, anon, authenticated;
grant select, insert, update, delete on table public.erasure_followups to service_role;

-- 1 · Written by the deletion, before the erasure takes the rows it reads from.
create or replace function public.erasure_queues_what_is_outside()
returns trigger language plpgsql security definer set search_path = public, storage as $$
declare
  v_ticket text := nullif(old.raw_app_meta_data ->> 'erasure_ticket', '');
begin
  -- a membership Square can still bill (0353's own test for one)
  insert into public.erasure_followups (kind, ref, ticket)
  select 'square_subscription', s.square_subscription_id, v_ticket
    from public.subscriptions s
   where s.user_id = old.id and nullif(s.square_subscription_id, '') is not null
     and s.status in ('active', 'paused', 'pending', 'past_due');
  -- the Square customer profile, which holds a saved card
  insert into public.erasure_followups (kind, ref, ticket)
  select 'square_customer', p.square_customer_id, v_ticket
    from public.profiles p
   where p.id = old.id and nullif(p.square_customer_id, '') is not null;
  -- what Sign in with Apple gave GT3, to revoke at Apple (0363)
  insert into public.erasure_followups (kind, ref, ticket)
  select 'apple_token', t.refresh_token, v_ticket
    from public.apple_tokens t
   where t.user_id = old.id;
  -- their photos: the avatar and the VIP proof, written to `<user id>/…`
  insert into public.erasure_followups (kind, ref, ticket)
  select 'photo', o.bucket_id || '/' || o.name, v_ticket
    from storage.objects o
   where o.bucket_id in ('avatars', 'vip') and o.name like old.id::text || '/%';
  return old;
end $$;
revoke all on function public.erasure_queues_what_is_outside() from public, anon, authenticated, service_role;

drop trigger if exists erasure_queues_what_is_outside on auth.users;
create trigger erasure_queues_what_is_outside before delete on auth.users
  for each row execute function public.erasure_queues_what_is_outside();

-- 2 · 0353's, without the membership: deleting queues its cancel (above).
create or replace function public.account_erasure_blockers(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_role      text;
  v_tenant    uuid;
  v_customers uuid[];
  out         jsonb := '[]'::jsonb;
begin
  select role, tenant_id into v_role, v_tenant from public.profiles where id = p_user;
  select coalesce(array_agg(id), '{}') into v_customers from public.customers where user_id = p_user;

  if v_role = 'owner' and not exists (
    select 1 from public.profiles o where o.role = 'owner' and o.id <> p_user and o.tenant_id is not distinct from v_tenant
  ) then
    out := out || jsonb_build_object('code', 'only_owner',
      'message', 'You are this business''s only owner. Make someone else an owner in Team first, then delete your account.');
  end if;

  if exists (select 1 from public.drop_orders o
              where (o.user_id = p_user or o.customer_id = any(v_customers)) and o.canceled_at is null
                and o.fulfillment_status in ('placed', 'in_prep', 'ready') and o.drop_date >= current_date)
     or exists (select 1 from public.delivery_orders o
              where (o.user_id = p_user or o.customer_id = any(v_customers))
                and o.fulfillment_status in ('placed', 'in_prep', 'ready') and o.delivery_date >= current_date)
     or exists (select 1 from public.orders o
              where (o.user_id = p_user or o.customer_id = any(v_customers))
                and o.fulfillment_status in ('placed', 'in_prep', 'ready') and o.created_at > now() - interval '12 hours')
     or exists (select 1 from public.shop_orders o
              where (o.user_id = p_user or o.customer_id = any(v_customers))
                and o.status in ('paid', 'needs_fulfillment') and o.created_at > now() - interval '30 days')
     -- a reserve they paid for, from a drop still running, not yet in their hands
     or exists (select 1 from public.reserve_claims c join public.reserves r on r.id = c.reserve_id
              where c.user_id = p_user and c.state = 'paid' and r.status in ('live', 'sold_out')
                and (c.order_id is null or exists (select 1 from public.orders o where o.id = c.order_id
                                                     and o.fulfillment_status in ('placed', 'in_prep', 'ready')))) then
    out := out || jsonb_build_object('code', 'order_on_its_way',
      'message', 'You have an order on its way. Once it is picked up or delivered, you can delete your account here.');
  end if;

  return out;
end $$;
revoke all on function public.account_erasure_blockers(uuid) from public, anon, authenticated;
grant execute on function public.account_erasure_blockers(uuid) to service_role;

-- 3 · Taken to be done: the route's own rows by its ticket, or (no ticket) the oldest open ones. A row taken in the last
--     two minutes is someone else's to finish.
create or replace function public.claim_erasure_followups(p_ticket text default null, p_limit int default 20)
returns setof public.erasure_followups language sql volatile security definer set search_path = public as $$
  update public.erasure_followups f
     set claimed_at = now(), attempts = f.attempts + 1
   where f.id in (
     select e.id from public.erasure_followups e
      where e.handed_off_at is null
        and (p_ticket is null or e.ticket = p_ticket)
        and (e.claimed_at is null or e.claimed_at < now() - interval '2 minutes')
      order by e.created_at
      limit greatest(1, least(coalesce(p_limit, 20), 100))
      for update skip locked)
  returning f.*
$$;

-- 4 · Done (the row goes: nothing is kept), or not (said why, and free to be taken again).
create or replace function public.finish_erasure_followup(p_id uuid, p_ok boolean, p_error text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if p_ok then
    delete from public.erasure_followups where id = p_id;
  else
    update public.erasure_followups set claimed_at = null, last_error = left(coalesce(p_error, 'failed'), 300) where id = p_id;
  end if;
end $$;

-- 5 · Handed to the crew: an alert, once, saying what to do by hand. An Apple token has no hand step — the person was
--     told how to end Sign in with Apple in Settings — so it is let go instead.
create or replace function public.erasure_followup_alert(p_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  f record;
begin
  select * into f from public.erasure_followups where id = p_id and handed_off_at is null for update;
  if not found then return; end if;
  if f.kind = 'apple_token' then
    delete from public.erasure_followups where id = p_id;
    return;
  end if;
  if f.kind = 'square_subscription' then
    perform public.alert_open_once('erasure_followup', f.id, 'critical', 'money',
      'A deleted account''s membership is still on at Square',
      'Someone deleted their GT3 account, and their membership could not be cancelled automatically. Cancel subscription '
        || f.ref || ' in Square › Subscriptions today, so it does not bill again.',
      '/crew?s=money&a=pay');
  elsif f.kind = 'square_customer' then
    perform public.alert_open_once('erasure_followup', f.id, 'important', 'money',
      'Remove a deleted account''s Square profile',
      'Someone deleted their GT3 account. Their Square customer profile ' || f.ref
        || ' could not be removed automatically and still holds their saved card — delete it in Square › Customers.',
      '/crew?s=money&a=pay');
  else
    perform public.alert_open_once('erasure_followup', f.id, 'important', 'system',
      'Remove a deleted account''s photo',
      'Someone deleted their GT3 account, and a photo of theirs could not be removed automatically: '
        || f.ref || ' in Supabase › Storage. Delete it there.',
      '/crew?s=settings&a=set-integrations');
  end if;
  update public.erasure_followups set handed_off_at = now() where id = p_id;
end $$;

-- existing rows: erasure_followup_alert — a new producer; it has never written an alert.
-- (Its links: Money › Refunds & payment settings, the door to Square, as refund alerts link; Settings › Integrations,
-- which says what the app is connected to, Supabase's storage among it.)

-- 6 · The watch: a row nobody finished in fifteen minutes goes to the crew; an Apple token after an hour is let go.
create or replace function public.erasure_followups_watch()
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  n int := 0;
  f record;
begin
  delete from public.erasure_followups
   where kind = 'apple_token' and created_at < now() - interval '1 hour';
  for f in
    select id from public.erasure_followups
     where handed_off_at is null and kind <> 'apple_token'
       and created_at < now() - interval '15 minutes'
       and (claimed_at is null or claimed_at < now() - interval '2 minutes')
     order by created_at
     limit 50
  loop
    perform public.erasure_followup_alert(f.id);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.claim_erasure_followups(text, int) from public, anon, authenticated;
revoke all on function public.finish_erasure_followup(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.erasure_followup_alert(uuid) from public, anon, authenticated;
revoke all on function public.erasure_followups_watch() from public, anon, authenticated;
grant execute on function public.claim_erasure_followups(text, int) to service_role;
grant execute on function public.finish_erasure_followup(uuid, boolean, text) to service_role;
grant execute on function public.erasure_followup_alert(uuid) to service_role;
grant execute on function public.erasure_followups_watch() to service_role;

do $$ begin
  perform cron.unschedule('erasure-followups-watch');
exception when others then null; end $$;
do $$ begin
  perform cron.schedule('erasure-followups-watch', '*/10 * * * *', 'select public.erasure_followups_watch()');
exception when others then raise notice '0404: pg_cron is not here, so nothing hands a stuck step to the crew on its own — run select public.erasure_followups_watch() by hand.';
end $$;

-- verify (numbers and booleans only):
--   select relrowsecurity from pg_class where oid = 'public.erasure_followups'::regclass;                  -- true
--   select has_table_privilege('authenticated', 'public.erasure_followups', 'select');                     -- false
--   select count(*) from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'erasure_queues_what_is_outside'; -- 1
--   select count(*) from cron.job where jobname = 'erasure-followups-watch';                                -- 1
select public.record_migration('0404_an_account_is_erased_before_anything_outside_it');

-- ============================================================
-- 0405_a_weeks_audit_is_a_record.sql
-- ============================================================
-- ── 0405 — A WEEK'S AUDIT IS A RECORD ─────────────────────────────────────────────────────────────────────────────────
-- 2026-10-15. Release 3 of the Today, Command, Audit & Catalog audit, "the audit as a record" — the first of the crew's
-- database rules, one yes and one migration each (Ryan, 2026-10-15: "Crew database rules"). Paste into Supabase → SQL
-- Editor → Run. A second run changes nothing.
--
-- WHY. The Monday Audit (components/MondayAudit, the walk since 2026-10-12) is the portfolio's history, and the database
-- kept it like a notepad:
--   · it filed each audit under the phone's day (week_of = localToday()), not the week's Monday: a Monday audit and a
--     Tuesday fix were two rows, and the two-week rule, which counts weeks, counted two;
--   · it saved in two writes — the history row, then the stream's health and date — so a second write that failed left
--     the history moved and the screen not;
--   · a second save the same day overwrote a colleague's audit without a word, and any owner or admin could rewrite or
--     delete any week's audit, last month's included (0264's "ws audits admin write", for all);
--   · removing a stream deleted its whole history with it (on delete cascade).
--
-- WHAT.
--   · audit_week(day) — the Monday of the business's week: Eastern, business_day() (0348), as the walk's weekStartKey.
--   · The history re-filed: each audit under its week's Monday. Where one week holds two, the later is that week's audit
--     and the earlier is kept, not lost, in workstream_audit_superseded.
--   · save_workstream_audit(...) — the one writer of an audit, an owner's or an admin's. The week's row (when all five are
--     scored) and the stream (its details, and with a score its health and the day it was audited) in one transaction:
--     both, or neither. It refuses, in words, a save over a change the caller has not seen (os_workstreams.updated_at,
--     new here): a colleague's newer save is never overwritten without being read.
--   · A week that has ended cannot change: the API roles write no audit row directly any more (the function does), and a
--     trigger refuses any change to a week before this one, whoever asks — the function included.
--   · A stream with history cannot be deleted (on delete restrict). Park it: parking keeps it and its record.
--   · v_workstream_weeks — each stream's last eight weekly totals, for the list's history and the walk's "was".
--   · The reminder: on a Monday at 9 am Eastern, each owner and admin gets one "Monday audit" alert while any active stream
--     is unscored this week; it clears itself when the last one is saved (save_workstream_audit), and reaches nobody else.
--
-- UNCHANGED: the five criteria and their 0–2 scale, the total and its bands, the two-week rule and its words, who may
-- audit (owners and admins), who may read (all staff), and the details a stream carries.
-- changelog: below.

-- ── the week ──────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.audit_week(p_day date default public.business_day()) returns date
  language sql immutable set search_path = public as $$
  select p_day - (extract(isodow from p_day)::int - 1)
$$;
comment on function public.audit_week(date) is
  'The Monday of the week a day falls in — the week an audit is filed under (0405). With no day, this business week''s Monday (Eastern, business_day()).';

-- ── the history, re-filed by week ─────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.workstream_audit_superseded (
  id            uuid primary key,
  workstream_id uuid not null,
  week_of       date not null,           -- the day it was filed under before 0405
  c_owner       smallint,
  c_next        smallint,
  c_blockers    smallint,
  c_artifacts   smallint,
  c_signal      smallint,
  total         int,
  note          text,
  audited_by    uuid,
  created_at    timestamptz,
  superseded_at timestamptz not null default now()
);
alter table public.workstream_audit_superseded enable row level security;
drop policy if exists "ws audits superseded staff read" on public.workstream_audit_superseded;
create policy "ws audits superseded staff read" on public.workstream_audit_superseded for select using ((select public.is_staff()));
revoke all on public.workstream_audit_superseded from anon;
grant select on public.workstream_audit_superseded to authenticated;
comment on table public.workstream_audit_superseded is
  'An audit that 0405 found sharing a week with a later one: kept as it was, under the day it was filed, when the history was re-filed by Monday. Read only; nothing writes here after 0405.';

-- The lock below would refuse moving a past week's row; it does not exist yet on a first run, and on a second there is
-- nothing left to move.
drop trigger if exists workstream_audit_week_is_closed on public.workstream_audits;

with ranked as (
  select a.*, row_number() over (partition by a.workstream_id, public.audit_week(a.week_of)
                                 order by a.week_of desc, a.created_at desc, a.id desc) as rn
    from public.workstream_audits a
)
insert into public.workstream_audit_superseded (id, workstream_id, week_of, c_owner, c_next, c_blockers, c_artifacts, c_signal, total, note, audited_by, created_at)
select id, workstream_id, week_of, c_owner, c_next, c_blockers, c_artifacts, c_signal, total, note, audited_by, created_at
  from ranked where rn > 1
on conflict (id) do nothing;

delete from public.workstream_audits a
 using public.workstream_audit_superseded s
 where s.id = a.id;

update public.workstream_audits
   set week_of = public.audit_week(week_of)
 where week_of <> public.audit_week(week_of);

-- ── the stream says when it last changed ──────────────────────────────────────────────────────────────────────────────
alter table public.os_workstreams add column if not exists updated_at timestamptz not null default now();
drop trigger if exists os_workstreams_touch on public.os_workstreams;
create trigger os_workstreams_touch before update on public.os_workstreams
  for each row execute function public.touch_updated_at();

-- ── a stream with a record is parked, not deleted ─────────────────────────────────────────────────────────────────────
alter table public.workstream_audits drop constraint if exists workstream_audits_workstream_id_fkey;
alter table public.workstream_audits add constraint workstream_audits_workstream_id_fkey
  foreign key (workstream_id) references public.os_workstreams(id) on delete restrict;

-- ── a week that has ended cannot change ───────────────────────────────────────────────────────────────────────────────
create or replace function public.workstream_audit_week_is_closed() returns trigger
  language plpgsql set search_path = public as $$
declare
  this_week date := public.audit_week(public.business_day());
begin
  if tg_op in ('UPDATE', 'DELETE') and old.week_of < this_week then
    raise exception 'week_closed' using errcode = '42501',
      detail = 'An audit cannot change once its week has ended. This week''s audit is the place for what changed.';
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if new.week_of <> public.audit_week(new.week_of) then
      raise exception 'not_a_week' using errcode = '22023', detail = 'An audit is filed under its week''s Monday.';
    end if;
    if new.week_of < this_week then
      raise exception 'week_closed' using errcode = '42501',
        detail = 'An audit cannot be filed under a week that has ended.';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger workstream_audit_week_is_closed before insert or update or delete on public.workstream_audits
  for each row execute function public.workstream_audit_week_is_closed();

-- The API roles read the history and write none of it: save_workstream_audit is the writer.
drop policy if exists "ws audits admin write" on public.workstream_audits;
revoke insert, update, delete on public.workstream_audits from anon, authenticated;

-- ── the one writer ────────────────────────────────────────────────────────────────────────────────────────────────────
-- p_seen: the stream's updated_at as the caller read it (null skips the check — the walk always sends it).
-- p_details: { name, owner, owner_user_id, status, next_action, due, blocker } — what the walk's form holds.
-- p_scores: { c_owner, c_next, c_blockers, c_artifacts, c_signal }, all five 0–2, or null for a details-only save.
-- Answers { ok: true, week_of, total, updated_at } or { ok: false, code, words } — 'changed' (someone saved this stream
-- after the caller read it), 'no_stream', 'bad_scores', 'bad_details'. A caller who is not an owner or an admin is
-- refused with an error, as every admin-only function here is.
create or replace function public.save_workstream_audit(
  p_workstream uuid,
  p_seen timestamptz,
  p_details jsonb,
  p_scores jsonb default null,
  p_note text default null
) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  w        public.os_workstreams%rowtype;
  wk       date := public.audit_week(public.business_day());
  v_name   text := btrim(coalesce(p_details->>'name', ''));
  v_status text := coalesce(nullif(p_details->>'status', ''), 'active');
  v_due    date;
  v_owner_id uuid;
  k        text;
  v        int;
  total    int := 0;
  stamp    timestamptz;
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501', detail = 'The Monday audit is an owner''s or an admin''s.';
  end if;

  select * into w from public.os_workstreams where id = p_workstream for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'no_stream', 'words', 'This stream is no longer in the portfolio.');
  end if;
  if p_seen is not null and w.updated_at is distinct from p_seen then
    return jsonb_build_object('ok', false, 'code', 'changed', 'updated_at', w.updated_at,
      'words', 'Someone saved this stream after you opened it. Check what they changed, then save again to keep yours.');
  end if;

  if v_name = '' or v_status not in ('active', 'blocked', 'parked') then
    return jsonb_build_object('ok', false, 'code', 'bad_details', 'words', 'A stream needs a name, and a status of active, blocked or parked.');
  end if;
  begin
    v_due := nullif(p_details->>'due', '')::date;
    v_owner_id := nullif(p_details->>'owner_user_id', '')::uuid;
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'bad_details', 'words', 'The due date or the owner could not be read.');
  end;

  if p_scores is not null then
    foreach k in array array['c_owner', 'c_next', 'c_blockers', 'c_artifacts', 'c_signal'] loop
      v := case when jsonb_typeof(p_scores->k) = 'number' then (p_scores->>k)::int end;
      if v is null or v not in (0, 1, 2) then
        return jsonb_build_object('ok', false, 'code', 'bad_scores', 'words', 'All five scores, each 0, 1 or 2 — or none, to save the details alone.');
      end if;
      total := total + v;
    end loop;

    insert into public.workstream_audits (workstream_id, week_of, c_owner, c_next, c_blockers, c_artifacts, c_signal, total, note, audited_by)
    values (p_workstream, wk, (p_scores->>'c_owner')::int, (p_scores->>'c_next')::int, (p_scores->>'c_blockers')::int,
            (p_scores->>'c_artifacts')::int, (p_scores->>'c_signal')::int, total, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
    on conflict (workstream_id, week_of) do update
       set c_owner = excluded.c_owner, c_next = excluded.c_next, c_blockers = excluded.c_blockers,
           c_artifacts = excluded.c_artifacts, c_signal = excluded.c_signal, total = excluded.total,
           note = excluded.note, audited_by = excluded.audited_by;
  end if;

  update public.os_workstreams
     set name = left(v_name, 80),
         owner = left(btrim(coalesce(p_details->>'owner', '')), 40),
         owner_user_id = v_owner_id,
         status = v_status,
         next_action = nullif(btrim(coalesce(p_details->>'next_action', '')), ''),
         due = v_due,
         blocker = nullif(btrim(coalesce(p_details->>'blocker', '')), ''),
         health = case when p_scores is null then health else total end,
         last_audited = case when p_scores is null then last_audited else public.business_day() end
   where id = p_workstream
  returning updated_at into stamp;

  -- The last stream scored this week clears the week's reminder for everyone it reached.
  if p_scores is not null and not exists (
       select 1 from public.os_workstreams s
        where s.status <> 'parked'
          and not exists (select 1 from public.workstream_audits a where a.workstream_id = s.id and a.week_of = wk)) then
    update public.alerts set ack_at = now(), ack_by = auth.uid()
     where kind = 'monday_audit_due' and ack_at is null;
  end if;

  return jsonb_build_object('ok', true, 'week_of', wk, 'total', case when p_scores is null then null else total end, 'updated_at', stamp);
end $$;
comment on function public.save_workstream_audit(uuid, timestamptz, jsonb, jsonb, text) is
  'The Monday audit''s one writer (0405): the week''s audit row and the stream together, or neither; filed under this week''s Monday (Eastern); refused with code ''changed'' over a save the caller has not seen. An owner''s or an admin''s.';
revoke all on function public.save_workstream_audit(uuid, timestamptz, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.save_workstream_audit(uuid, timestamptz, jsonb, jsonb, text) to authenticated;

-- ── eight weeks a stream ──────────────────────────────────────────────────────────────────────────────────────────────
create or replace view public.v_workstream_weeks with (security_invoker = on) as
select workstream_id, week_of, total
  from (select a.workstream_id, a.week_of, a.total,
               row_number() over (partition by a.workstream_id order by a.week_of desc) as rn
          from public.workstream_audits a) x
 where rn <= 8;
revoke all on public.v_workstream_weeks from anon;
grant select on public.v_workstream_weeks to authenticated;
comment on view public.v_workstream_weeks is
  'Each stream''s last eight weekly audit totals, newest first (0405): the list''s history and the walk''s "was".';

-- ── the Monday reminder ───────────────────────────────────────────────────────────────────────────────────────────────
-- Hourly on Mondays (UTC), acting only in the 9 am Eastern hour, so daylight saving moves nothing. One alert per owner
-- and admin, while any active or blocked stream is unscored this week — the database's own dedupe (0372) counts a second
-- raise instead of sending it — and none at all once the week is scored.
create or replace function public.monday_audit_reminder(p_force boolean default false) returns int
  language plpgsql security definer set search_path = public as $$
declare
  wk     date := public.audit_week(public.business_day());
  due    int;
  person record;
  n      int := 0;
begin
  if not p_force and (extract(isodow from (now() at time zone 'America/New_York')) <> 1
                      or extract(hour from (now() at time zone 'America/New_York')) <> 9) then
    return 0;
  end if;
  select count(*) into due from public.os_workstreams s
   where s.status <> 'parked'
     and not exists (select 1 from public.workstream_audits a where a.workstream_id = s.id and a.week_of = wk);
  -- Last week's, if nobody cleared it, is last week's: it goes, and this week's says this week's count.
  update public.alerts set ack_at = now()
   where kind = 'monday_audit_due' and ack_at is null and created_at < (wk::timestamp at time zone 'America/New_York');
  if due = 0 then return 0; end if;
  for person in select p.id, p.tenant_id from public.profiles p where p.role in ('owner', 'admin') loop
    insert into public.alerts (severity, category, kind, subject_id, title, body, link, target_user_id, tenant_id)
    values ('important', 'task', 'monday_audit_due', person.id,
            'Monday audit: ' || due || ' stream' || case when due = 1 then '' else 's' end || ' to score',
            'This week''s audit is open. Each stream gets its five scores, its next action and its blocker; the reminder clears when the last one is saved.',
            '/crew?s=command&a=os-registry', person.id, person.tenant_id);
    n := n + 1;
  end loop;
  return n;
end $$;
-- existing rows: monday_audit_reminder — a new producer; it has never written an alert.
revoke all on function public.monday_audit_reminder(boolean) from public, anon, authenticated;
grant execute on function public.monday_audit_reminder(boolean) to service_role;

do $$ begin
  perform cron.unschedule('monday-audit-reminder');
exception when others then null; end $$;
do $$ begin
  perform cron.schedule('monday-audit-reminder', '5 * * * 1', 'select public.monday_audit_reminder()');
exception when others then raise notice '0405: pg_cron is not here, so no Monday reminder is raised on its own — run select public.monday_audit_reminder(true) by hand.';
end $$;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A week''s audit is a record', 'improvement', 'Command',
   'The Monday audit files under the week''s Monday, saves the audit and the stream together, never overwrites a colleague''s newer save, and a past week can''t be changed. A stream with history is parked, not deleted. Owners and admins get one Monday reminder that clears when the week is scored.',
   '2026-10-15', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from public.workstream_audits where week_of <> public.audit_week(week_of);                    -- 0
--   select has_table_privilege('authenticated', 'public.workstream_audits', 'insert');                            -- false
--   select count(*) from pg_trigger where tgname = 'workstream_audit_week_is_closed';                              -- 1
--   select confdeltype from pg_constraint where conname = 'workstream_audits_workstream_id_fkey';                  -- r
--   select count(*) from cron.job where jobname = 'monday-audit-reminder';                                         -- 1
select public.record_migration('0405_a_weeks_audit_is_a_record');

-- ============================================================
-- 0406_one_clock_a_todo_due_today_is_due_today.sql
-- ============================================================
-- ── 0406 — ONE CLOCK: A TO-DO DUE TODAY IS DUE TODAY UNTIL MIDNIGHT EASTERN ──────────────────────────────────────────────
-- 2026-10-15. Release 3 of the Today, Command, Audit & Catalog audit, "one clock in the database" — the second of the
-- crew's database rules, one yes and one migration each (Ryan, 2026-10-15: "Crew database rules"). Paste into Supabase →
-- SQL Editor → Run. A second run changes nothing.
--
-- WHY. The screens count the business's day — Eastern (Release 1's "one Eastern day", lib/dates etToday; the database's
-- business_day(), 0348). Two views still counted the database's: current_date and a timestamp's ::date are UTC there,
-- and UTC's day turns over at 8 pm Eastern in summer, 7 pm in winter. So after 8 pm:
--   · v_obligations — My Day's Needs you, Money's deadlines — said a to-do due today was "1 day late" (days_out
--     -1, severity overdue), a certificate expiring tonight expired yesterday, and a permit with no check date was due
--     tomorrow (0330:327, :189);
--   · all_tasks — My tasks, Command's week — filed a task due at 9 pm under tomorrow (0237: due_at::date).
--
-- WHAT. The same two views, restated with the business's day: v_obligations counts days_out and its severity from
-- business_day(), a permit never checked is due on the business's today, and a certificate's expiry and a training's
-- due date are their Eastern day; all_tasks files an event task under the Eastern day of its due_at. And two routes
-- name the panel they mean, as every link must (scripts/smoke.cjs, deep links): an invoice's is Money › Get paid, which
-- lists invoices since 2026-10-15, and an agreement's is Team › Operator agreements, where it is since the same day.
-- Every branch otherwise byte for byte 0330's and 0237's — spliced from those files, not retyped. Columns, their order
-- and their types are unchanged, so nothing that reads them changes.
-- changelog: below.

create or replace view public.v_obligations as
with raw as (

  -- EQUIPMENT SERVICE. asset_maintenance is a LOG, so the next due date is the one on the most
  -- recent entry per asset, not one row per historical entry. distinct on does that; counting rows
  -- instead would report the same overdue tool once per time it has ever been serviced.
  select 'asset_maintenance'                                as source,
         m.id::text                                          as subject_id,
         'Equipment'                                         as area,
         'Service due'                                       as kind,
         coalesce(a.name, 'Equipment')                       as title,
         m.kind || ' last done ' || to_char(m.performed_on, 'Mon FMDD') || '.' as detail,
         m.next_due_on                                       as due_on,
         '/crew?s=garage'                                    as route,
         a.market                                            as market,
         null::uuid                                          as owner_user_id
    from (
      select distinct on (asset_id) * from public.asset_maintenance
       where next_due_on is not null
       order by asset_id, performed_on desc, created_at desc
    ) m
    join public.assets a on a.id = m.asset_id
   where coalesce(a.status, 'active') <> 'retired'

  union all

  -- PERMITS AND LICENCES. compliance_rules has no due column; what it has is verified_on, and
  -- v_compliance_freshness already owns the judgement about when that has gone stale. Re-deriving
  -- the threshold here would be a second opinion, so the due date is expressed in the view's own
  -- terms: a year after it was last confirmed, or today if nobody ever recorded a date.
  select 'compliance_rules', f.id::text, 'Compliance', 'Needs re-checking',
         f.label,
         f.freshness || coalesce(' · ' || f.authority, '') || '.',
         coalesce(f.verified_on + 365, public.business_day()),
         '/crew?s=prep',
         null,
         null::uuid
    from public.v_compliance_freshness f
   where f.freshness <> 'fresh'

  union all

  -- CERTIFICATIONS. A lapsed food-safety cert is a person who cannot legally work the event.
  select 'academy_certifications', c.user_id::text || ':' || c.cert_key, 'People', 'Certification expires',
         coalesce(p.display_name, 'A crew member') || ' — ' || c.cert_key,
         'Awarded ' || to_char(c.awarded_at, 'Mon FMDD, YYYY') || '.',
         (c.expires_at at time zone 'America/New_York')::date,
         '/crew?s=team',
         p.market,
         c.user_id
    from public.academy_certifications c
    left join public.profiles p on p.id = c.user_id
   where c.expires_at is not null

  union all

  -- ASSIGNED TRAINING with a date on it.
  select 'academy_assignments', t.id::text, 'People', 'Training due',
         coalesce(p.display_name, 'A crew member') || ' — ' || t.target_key,
         'Assigned ' || t.target_type || '.',
         (t.due_at at time zone 'America/New_York')::date,
         '/crew?s=team',
         p.market,
         t.user_id
    from public.academy_assignments t
    left join public.profiles p on p.id = t.user_id
   where t.due_at is not null

  union all

  -- OFFERS OUT. Only ones actually awaiting an answer: a draft that expires is not a deadline.
  select 'offer_letters', o.id::text, 'Hiring', 'Offer expires',
         o.candidate_name || ' — ' || o.title,
         'Sent ' || coalesce(to_char(o.sent_at, 'Mon FMDD'), 'recently') || ', no answer yet.',
         o.expires_on,
         '/crew?s=team&a=offers',
         o.market,
         o.candidate_user_id
    from public.offer_letters o
   where o.expires_on is not null and o.status in ('sent', 'countered')

  union all

  -- MONEY OWED TO US.
  select 'invoices', i.id::text, 'Money', 'Invoice due',
         coalesce(b.company, 'An account') || ' — ' || to_char(i.amount_cents / 100.0, 'FM$999,999.00'),
         i.terms || ', issued ' || to_char(i.issued_at, 'Mon FMDD') || '.',
         i.due_at,
         '/crew?s=money&a=pay',
         b.market,
         null::uuid
    from public.invoices i
    left join public.business_accounts b on b.id = i.business_id
   where i.due_at is not null and i.status in ('open', 'sent')

  union all

  -- AGREEMENTS RUNNING OUT.
  select 'operator_agreements', g.id::text, 'Franchise', 'Agreement ends',
         g.operator_name || ' — ' || g.market,
         'Version ' || g.version || ', ' || g.status || '.',
         g.ends_on,
         '/crew?s=team&a=operators',
         g.market,
         g.operator_user_id
    from public.operator_agreements g
   where g.ends_on is not null and g.status in ('accepted', 'signed', 'active')

  union all

  -- THE COMPANY'S OWN COMMITMENTS.
  select 'goals', gl.id::text, 'Command', 'Goal due',
         gl.title,
         'At ' || round(gl.current_value)::text || ' of ' || round(gl.target_value)::text ||
           coalesce(' ' || nullif(gl.unit, ''), '') || '.',
         gl.due_date,
         '/crew?s=command',
         null,
         null::uuid
    from public.goals gl
   where gl.due_date is not null and gl.status = 'active'

  union all

  select 'initiatives', n.id::text, 'Command', 'Initiative target',
         n.title, coalesce(n.summary, 'No summary recorded.'), n.target_date,
         '/crew?s=command', null, null::uuid
    from public.initiatives n
   where n.target_date is not null and n.status in ('planning', 'active')

  union all

  select 'os_workstreams', w.id::text, 'Command', 'Next action due',
         w.name, coalesce(w.next_action, 'No next action recorded.'), w.due,
         '/crew?s=command', null, w.owner_user_id
    from public.os_workstreams w
   where w.due is not null and w.status <> 'parked'

  union all

  -- TODOS. event_tasks are deliberately absent — task_due_alerts already sweeps those every ten
  -- minutes, and telling somebody twice by two mechanisms that cannot see each other is worse than
  -- the silence this view exists to fix. todos have never had a sweeper of any kind.
  select 'todos', d.id::text, 'Work', 'To-do due',
         d.title, coalesce('Category: ' || nullif(d.category, ''), 'Uncategorised.'), d.due_on,
         '/crew?s=day', null, d.assignee
    from public.todos d
   where d.due_on is not null and not d.done

  -- CHARGEBACK EVIDENCE (0330). The one deadline in this app where silence costs the full amount
  -- plus a fee: a dispute has a date by which evidence must be with Square, and missing it loses by
  -- default. It can only arrive from Square's webhook, and before 0330 nothing here knew a dispute
  -- existed at all. Excludes the states that are already decided.
  union all
  select 'square_disputes'                                    as source,
         d.id                                                as subject_id,
         'Money'                                              as area,
         'Chargeback evidence due'                            as kind,
         coalesce(nullif(btrim(so.ship_name), ''), so.email, 'A card dispute') as title,
         'A customer disputed ' || to_char(coalesce(d.amount_cents, 0) / 100.0, 'FM999999990.00')
           || '. Evidence has to be with Square by this date or it is lost by default.' as detail,
         (d.due_at at time zone 'America/New_York')::date    as due_on,
         '/crew?s=money&a=shoporders'                        as route,
         null::text                                          as market,
         null::uuid                                          as owner_user_id
    from public.square_disputes d
    left join public.shop_orders so on so.payment_id = d.payment_id
   where d.due_at is not null
     and coalesce(d.state, '') not in ('WON', 'LOST', 'ACCEPTED')
)
select r.source, r.subject_id, r.area, r.kind, r.title, r.detail, r.due_on,
       (r.due_on - public.business_day()) as days_out,
       case when r.due_on <  public.business_day() then 'overdue'
            when r.due_on <= public.business_day() + 14 then 'soon'
            else 'upcoming' end as severity,
       r.route, r.market, r.owner_user_id
  from raw r
 where r.due_on is not null;
-- security_invoker so every base table's RLS still decides who sees each row (0312's rule). Restated
-- because `create or replace view` does NOT preserve the setting when the definition is replaced.
alter view public.v_obligations set (security_invoker = on);

revoke all on public.v_obligations from public, anon;
grant select on public.v_obligations to authenticated;
comment on view public.v_obligations is
  'Every business deadline the app stores and nothing was watching, in one shape. Deliberately EXCLUDES event_tasks, brew_batches and reserve_claims — those already have cron sweepers, and being told twice by two mechanisms that cannot see each other is worse than the silence this fixes. 0330 added chargeback evidence deadlines, which are the only ones here that cost money by default if missed. 0406: days are the business''s (Eastern, business_day()), not the database''s UTC.';

create or replace view public.all_tasks with (security_invoker = on) as
  with u as (
    select 'event'::text as source, id, label as title, assignee, (due_at at time zone 'America/New_York')::date as due,
           done, done_at, created_at, critical, section as category, event_id, goal_id, meeting_note_id,
           due_at, warn, sort, stop_id, field_op_id, initiative_id
    from public.event_tasks
    union all
    select 'todo', id, title, assignee, due_on as due,
           done, done_at, created_at, false as critical, category, event_id, null::uuid, meeting_note_id,
           null::timestamptz, false, null::int, null::uuid, field_op_id, initiative_id
    from public.todos
  )
  select u.source, u.id, u.title, u.assignee, u.due,
         u.done, u.done_at, u.created_at, u.critical, u.category, u.event_id, u.goal_id, u.meeting_note_id,
         u.due_at, u.warn, u.sort, u.stop_id, u.field_op_id,
         fo.kind                     as op_kind,
         fo.name                     as op_name,
         fo.day                      as op_day,
         fo.starts_at                as op_starts_at,
         coalesce(fo.is_live, false) as op_is_live,
         mn.title                    as meeting_note_title,
         g.title                     as goal_title,
         -- appended (0237): the program a task rolls up to
         u.initiative_id,
         i.title                     as initiative_title,
         i.emoji                     as initiative_emoji,
         i.status                    as initiative_status,
         i.target_date               as initiative_target
  from u
  left join public.field_ops     fo on fo.id = coalesce(u.field_op_id, u.event_id, u.stop_id)
  left join public.meeting_notes mn on mn.id = u.meeting_note_id
  left join public.goals         g  on g.id  = u.goal_id
  left join public.initiatives   i  on i.id  = u.initiative_id;

grant select on public.all_tasks to authenticated;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A to-do due today is due today until midnight', 'fix', 'Today',
   'After 8 pm, Needs you said a to-do due today was a day late, and a task due that evening showed under tomorrow: two lists counted the day in UTC. Every list counts the business''s day now — Eastern, midnight to midnight.',
   '2026-10-15', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select pg_get_viewdef('public.v_obligations'::regclass) like '%business_day()%';          -- true
--   select pg_get_viewdef('public.v_obligations'::regclass) like '%CURRENT_DATE%';            -- false
--   select pg_get_viewdef('public.all_tasks'::regclass) like '%America/New_York%';            -- true
select public.record_migration('0406_one_clock_a_todo_due_today_is_due_today');
