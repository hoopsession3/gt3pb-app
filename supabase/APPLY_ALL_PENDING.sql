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
-- pending-from: 0404
-- generated-at: 2026-10-15
-- pending-count: 2
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
