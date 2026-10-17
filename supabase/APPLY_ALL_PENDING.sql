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
-- pending-from: 0424
-- generated-at: 2026-10-17
-- pending-count: 1
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- held: 0376_nobody_on_the_pass_during_service_is_an_alert.sql — NOT in this file; applied by hand once the condition in its header is met
-- held: 0424_a_password_set_before_the_proof_waits_for_it_everywhere.sql — NOT in this file; applied by hand once the condition in its header is met
-- ============================================================
-- 0423_an_invite_waits_for_a_proven_address_money_keeps_its_doors_a_stopped_job_is_said.sql
-- ============================================================
-- ── 0423 — A STAFF INVITE WAITS FOR A PROVEN ADDRESS, MONEY KEEPS ITS DOORS, AND A JOB THAT STOPPED IS SAID ─────────
-- 2026-10-17. R18 of the 10/10 audit (Ryan, 2026-10-16: "then audit for 10/10 best practices... front and back end";
-- 2026-10-17: "Keep working to improve to a 10"). Paste into Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY.
--   · A staff invite was claimed the moment an account row was made with the invited address — before anyone proved
--     the address was theirs (the security pass, SEC1). Anyone who knew an invitee's email could sign up with it and a
--     password; when the real invitee later signed in with the emailed code, the account they proved was the stranger's,
--     with the stranger's password still on it, now holding the invite's role. The same stranger's row could be brought
--     onto the crew from Add teammate ("they already have an account"), and any customer account a stranger made under
--     someone else's address kept the stranger's password once its owner proved it (the R18 review — that half is 0424,
--     held for the iPhone build that sets a joiner's password again).
--   · 0420 put packs, deliveries, office orders and invoices behind their own doors. Shop orders and their lines, the
--     office jug count and expenses were left writable by any crew role straight through the API (database F2): a
--     shop order's total or refund amount — which Money subtracts — an expense's amount, or a voided expense un-voided.
--   · Four places still asked the calendar in UTC (database F4): a city "opened" at 8 pm Eastern the evening before its
--     opening day (market_live), an office order showed at 8 pm the evening before its delivery (all_orders), an offer
--     letter expired at 8 pm on its last day (respond_to_offer), and an order due today stopped blocking an account's
--     erasure at 8 pm (account_erasure_blockers).
--   · cron_watch (0419) saw only runs that failed. A job that stopped running fails nothing, and the requests the
--     database sends — the push function's webhook, which carries every alert to the phones — answered errors no one
--     read (database F8, operations F11).
--   · The public buckets for Studio, training, brand and the shop took any file of any size from the crew writing them
--     (the security pass, SEC3). And four foreign keys on the paths alerts and the money doors walk had no index
--     (database F19).
--
-- WHAT.
--   · claim_team_invites(user, email): the one claim (0280's two updates). handle_new_user claims at sign-up only an
--     address a provider vouched for with no password on the row (Sign in with Apple); every other account claims when
--     its address is proven (claim_invites_on_proof, after email_confirmed_at is first set) — by a confirmation that was
--     sent and answered or a provider that vouches for it (address_proved_itself), or by an owner confirming it by hand
--     (vouched_by_hand). With Confirm email off, GoTrue confirms what nobody proved: that claims nothing, and the invite
--     waits for the owner.
--   · password_waits_for_proof: where a crew role is at stake — a staff invite waits for the address, or the account was
--     brought onto the crew before its address was proven — a password set on the row before the proof is taken off it in
--     the same write as the proof, however the proof came (by itself, or an owner's hand: the owner can say whose the
--     address is, never who set that password), and the account is marked (profiles.password_taken_at). Whoever proved
--     the address is the one in: they sign in by code; the join screen sets the password they typed again right after
--     their code (components/SignIn), and anyone whose password was taken is asked to choose one when next signed in
--     (components/AuthProvider, by the mark — a password set, or "Not now" (password_not_now), takes it off). An account
--     its person made with an emailed code (the app's joined_by_code) is not asked: GoTrue gave it a random password
--     nobody typed. An account brought onto the crew later with the password it was made with still on it (GoTrue clears
--     confirmation_sent_at whenever it sets a new password) has that password taken as it becomes crew, and every
--     session it had ended (take_signup_password) — Add teammate and the welcome letter say so. In the SQL editor,
--     select public.confirm_address('their@address') proves an address by hand, claims what waits for it, and says what
--     it did; for someone whose mail never arrives, select public.set_password_by_hand('their@address', '…') sets one
--     with them there. Before anything, the paste checks it may write auth.users. Every other account keeps the password
--     it was made with, as before: taking it wherever a confirmation was sent is 0424 (password_scope_everywhere), held
--     until this round's iPhone build is on the phones (supabase/held.json) — a build from before sets nothing again
--     after the code, so its joiners would lose the password they typed without a word (the R18 review, third to fifth
--     passes).
--   · money_columns_guard (0420's) takes four more tables: a page may not make a shop order, a shop order's line or a
--     jug count (the checkout, the delivery's door and void_jug_entry do), may log an expense but not a voided one, and
--     may not change a shop order's money, status or owner, a line's price or quantity, a jug count, or an expense's
--     amount, date, author or void — unless the caller is an owner or admin (Money's own spend editor is theirs).
--   · business_day() (0348) where current_date stood: market_live, all_orders, respond_to_offer,
--     account_erasure_blockers — each otherwise as it was, word for word.
--   · cron_watch: also one alert for an active job on an every-day schedule — every hour, any minute rule; every N hours
--     or one hour, a single minute — that ran at least three times this week and has gone three of its usual gaps (the
--     long end of its gaps, half an hour at least) without starting (cron_stalled, one open per job, closed by the run that
--     finds it started again), and one while requests the database sent failed in the last twenty minutes
--     (db_http_failed — pg_net's answers, kept six hours; closed by the run that finds none, left as it is by one that
--     can't read them).
--   · storage: content takes images and videos up to 100 MB, and the shop its picker's eight types (never an SVG in a
--     public bucket); brand and training images up to 12 MB; the private intake and note-files buckets the documents and
--     pictures their pickers take, up to 25 MB; receipts images and PDFs (its 20 MB stands) — what each screen's picker
--     already allows (lib/shopMedia, the Studio, the brand kit, the AI trainer, SmartIntake, NoteAttach, LogPurchase;
--     lib/bucketTakes checks the same before a file is sent, and lib/fileType sends it as what it is).
--   · indexes on orders.collected_by, drop_orders.collected_by, loyalty_ledger.by_user and alerts.ack_by.
-- existing rows: team_invites — an invite already claimed stays claimed; one waiting is claimed by the next proven
--   sign-in, as before for every code sign-in. Passwords on accounts already confirmed are untouched; an account made
--   with a password and not yet confirmed loses that password when it is confirmed only where a crew role is at stake
--   (its owner sets it again, is asked to, or uses a code) — an invitee joining on an iPhone build from before this
--   round signs in by code until they choose one (asked on the web, and by this round's build); nobody is locked out.
-- existing rows: profiles — password_taken_at and password_set_by_hand_at are new and empty: nobody is asked to choose a
--   password until one is taken.
--   Nobody on the crew today is touched: crew_role_takes_signup_password reads the next member brought onto the crew.
-- existing rows: shop_orders, shop_order_items, jug_ledger, expenses — the guard reads writes from now on; no row changes.
-- existing rows: storage objects already in the seven buckets stay; the limits apply to the next upload.
-- existing rows: cron_watch — its cron_failed alerts are written as they were; cron_stalled and db_http_failed are new
--   kinds, with no rows of theirs to restate.
-- changelog: below.

set lock_timeout = '5s';

-- WHAT THIS PASTE MUST BE ABLE TO DO (the R18 review, fifth pass). The rules below take a password off an account and end
-- its sessions from inside GoTrue's own confirmation and from a promotion — the first of this schema's functions to write
-- auth.users. Run as a role that may not, they would fail every invitee's confirmation and every promotion; so the paste
-- stops here, with nothing changed, unless the role running it (whose functions these become) may.
do $$ begin
  if not (has_table_privilege('auth.users', 'UPDATE') and has_table_privilege('auth.sessions', 'DELETE')
          and has_table_privilege('auth.refresh_tokens', 'UPDATE')) then
    raise exception '0423 needs UPDATE on auth.users, DELETE on auth.sessions and UPDATE on auth.refresh_tokens for the role running it (%) — nothing was changed. Run it in the SQL editor as postgres.', current_user;
  end if;
end $$;

-- ── a staff invite is claimed by a proven address ────────────────────────────────────────────────────────────────────
create or replace function public.claim_team_invites(p_user uuid, p_email text) returns integer
  language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if p_user is null or coalesce(btrim(p_email), '') = '' then return 0; end if;
  -- 0280's claim, word for word: it cannot mint an owner (team_invites.role excludes it) and leaves a crew role alone.
  update public.profiles p set role = i.role, is_admin = (i.role in ('admin','owner'))
    from public.team_invites i
    where p.id = p_user and i.claimed_at is null and lower(i.email) = lower(p_email) and p.role = 'member';
  update public.team_invites set claimed_at = now(), claimed_by = p_user
    where claimed_at is null and lower(email) = lower(p_email);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.claim_team_invites(uuid, text) from public, anon, authenticated;
comment on function public.claim_team_invites(uuid, text) is
  'The one staff-invite claim (0423): the invite''s role onto a member''s profile, the invite marked claimed. Called by handle_new_user for an address a provider vouched for, and by claim_invites_on_proof when an address is first proven.';

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare nm text; base text; ref text;
begin
  nm := coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), initcap(split_part(new.email, '@', 1)));
  base := upper(regexp_replace(split_part(nm, ' ', 1), '[^A-Za-z0-9]', '', 'g'));
  if base = '' then base := 'GT3'; end if;
  ref := left(base, 8) || '-' || upper(substr(md5(new.id::text), 1, 4));
  begin
    insert into public.profiles (id, display_name, referral_code, is_admin, role)
    values (new.id, nm, ref, false, 'member')
    on conflict (id) do nothing;
  exception when unique_violation then
    insert into public.profiles (id, display_name, referral_code, is_admin, role)
    values (new.id, nm, left(base, 8) || '-' || upper(substr(md5(new.id::text || clock_timestamp()::text), 1, 8)), false, 'member')
    on conflict (id) do nothing;
  end;

  begin
    insert into public.customers (user_id, name, email, tenant_id)
    values (new.id, nm, new.email, public.effective_tenant())
    on conflict (user_id) do nothing;
  exception when others then null; -- never let a CRM-seed hiccup block account creation
  end;

  -- A STAFF INVITE WAITS FOR A PROVEN ADDRESS (0423). It was claimed here, the moment a row was made with the invited
  -- address — before anyone proved it. Now: an address a provider vouched for, with no password on the row (Sign in
  -- with Apple), claims here; every other account claims when its address is first proven (claim_invites_on_proof).
  if new.email_confirmed_at is not null and coalesce(new.encrypted_password, '') = '' then
    perform public.claim_team_invites(new.id, new.email);
  end if;

  return new;
end $$;

-- WHO CONFIRMED IT. GoTrue confirms an address as its own database role (supabase_auth_admin) — the emailed code or
-- link, the dashboard's "Confirm email", the admin API. The SQL editor runs as postgres (or supabase_admin): an owner
-- confirming someone's address by hand there has proven it for them — an invite waiting for it is claimed. Never for the
-- password on the row: the owner can say whose the address is, not who set that password (the R18 review, fourth pass).
create or replace function public.vouched_by_hand() returns boolean
  language sql stable set search_path = public as $$ select session_user in ('postgres', 'supabase_admin') $$;
revoke all on function public.vouched_by_hand() from public, anon, authenticated;

-- THE ADDRESS PROVED ITSELF: a confirmation was sent for the row and answered (the row was made unproven — Confirm email
-- on), or a provider that vouches for the address made it (Sign in with Apple). With an owner's hand, the one test the
-- claim and the password both ask (the R18 review, third pass): with Confirm email off, or the dashboard's "Create user"
-- with Auto Confirm, nothing was sent and nobody proved anything — nothing is claimed, and nothing is taken.
create or replace function public.address_proved_itself(p_sent timestamptz, p_app jsonb) returns boolean
  language sql immutable set search_path = public as $$
  select p_sent is not null or coalesce(p_app ->> 'provider', 'email') <> 'email'
$$;
revoke all on function public.address_proved_itself(timestamptz, jsonb) from public, anon, authenticated;

-- HOW FAR THE RULE REACHES. 0423: where a crew role is at stake. 0424 (held for the iPhone build) turns this to true —
-- every account. Made here only if it is not there yet, so pasting 0423 again after 0424 never narrows it back (the R18
-- review, fourth pass).
do $$ begin
  if to_regprocedure('public.password_scope_everywhere()') is null then
    execute $f$create function public.password_scope_everywhere() returns boolean language sql stable set search_path = public as 'select false'$f$;
  end if;
end $$;
revoke all on function public.password_scope_everywhere() from public, anon, authenticated;
comment on function public.password_scope_everywhere() is
  'Whether a password set before an address is proven is taken at the proof on every account (true, from 0424) or only where a crew role is at stake (false, 0423).';

-- A PASSWORD TAKEN IS SAID (the R18 review, third pass): the app asks its person to choose one again when they are next
-- signed in (components/AuthProvider) — whichever screen, phone or browser they are on. Server-written only (no member
-- grant on the column): set where a password is taken, taken off by a password set (password_chosen) or "Not now"
-- (password_not_now). Never for an account its person made with an emailed code (joined_by_code, the app's mark at a code
-- sign-up — fourth pass): GoTrue gave that row a random password nobody typed, and taking it is all there is to it.
alter table public.profiles add column if not exists password_taken_at timestamptz;
-- A password an owner set by hand (set_password_by_hand) is one the owner knows: its mark is not for "Not now" to take off.
alter table public.profiles add column if not exists password_set_by_hand_at timestamptz;
comment on column public.profiles.password_set_by_hand_at is
  'When an owner set this account''s password by hand (0423, set_password_by_hand): its person is asked to choose their own at every sign-in until they do — "Not now" does not take it off. Null once they set one.';
comment on column public.profiles.password_taken_at is
  'When a password set before this account''s address was proven was taken (0423, password_waits_for_proof, take_signup_password): its person is asked to choose one. Null once a password is set (password_chosen) or they say not now (password_not_now).';

create or replace function public.password_waits_for_proof() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  -- The address is proven now — by itself (address_proved_itself), or by an owner's hand. A password already on the row
  -- was set by whoever made the account before that: not necessarily its owner, and no hand can say otherwise. Where a
  -- crew role is at stake — a staff invite waits for this address, or the account was brought onto the crew before its
  -- address was proven — or on every account once 0424 says so (password_scope_everywhere), the password goes, so only
  -- the person who proved the address is in, and the account is marked so they are asked to choose one.
  if old.email_confirmed_at is null and new.email_confirmed_at is not null
     and coalesce(new.encrypted_password, '') <> ''
     and (public.address_proved_itself(old.confirmation_sent_at, new.raw_app_meta_data) or public.vouched_by_hand())
     and (public.password_scope_everywhere()
          or exists (select 1 from public.team_invites i where i.claimed_at is null and lower(i.email) = lower(new.email))
          or exists (select 1 from public.profiles p where p.id = new.id and coalesce(p.role, 'member') <> 'member')) then
    new.encrypted_password := '';
    if coalesce(new.raw_user_meta_data ->> 'joined_by_code', '') <> 'true' then
      update public.profiles set password_taken_at = now() where id = new.id;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.password_waits_for_proof() from public, anon, authenticated;
comment on function public.password_waits_for_proof() is
  'When an account''s address is first proven (0423) — by itself or by an owner''s hand — a password set on the row before the proof is taken off where a crew role is at stake (every account once 0424 turns password_scope_everywhere on), and the account marked (profiles.password_taken_at), so the account is only ever whoever proved the address.';

-- ONTO THE CREW WITH THE PASSWORD IT WAS MADE WITH (the R18 review, fourth and fifth passes). An account proven as a
-- customer kept the password it was made with (0423, until 0424) — perhaps a stranger's, set before its owner proved the
-- address, and the stranger perhaps signed in with it since. Brought onto the crew later (promote_to_crew, the roster, an
-- invite claimed by hand), that password — and every session it opened — would have been a crew account's. GoTrue clears
-- confirmation_sent_at whenever it sets a new password (the same one set again changes nothing, and clears nothing), so a
-- confirmed row that still carries it still carries the password it was made with: that is taken as the account becomes
-- crew, every session the account has is ended — as GoTrue's own password change ends them (a token already handed out
-- lives out its hour) — and the account is marked. Its owner signs in with a code and chooses a password; Add teammate
-- and the welcome letter say so (promote_to_crew's password_taken, from the transaction's gt3.password_taken).
create or replace function public.take_signup_password(p_user uuid) returns boolean
  language plpgsql security definer set search_path = public as $$
declare by_code boolean;
begin
  update auth.users set encrypted_password = ''
   where id = p_user and email_confirmed_at is not null and confirmation_sent_at is not null
     and coalesce(encrypted_password, '') <> ''
  returning coalesce(raw_user_meta_data ->> 'joined_by_code', '') = 'true' into by_code;
  if not found then return false; end if;
  -- Signed out everywhere — taken in GoTrue's own order, a token and then its session, so a refresh at the same moment
  -- waits for this instead of deadlocking with it (the R18 review, sixth pass); the tokens from before sessions too.
  perform 1 from auth.refresh_tokens where user_id = p_user::text for update;
  perform 1 from auth.sessions where user_id = p_user for update;
  delete from auth.sessions where user_id = p_user;
  update auth.refresh_tokens set revoked = true where user_id = p_user::text and coalesce(revoked, false) = false;
  -- Marked and said — never for a code-made account, whose random password nobody knew (nothing to choose again).
  if not by_code then
    update public.profiles set password_taken_at = now() where id = p_user;
    perform set_config('gt3.password_taken', p_user::text, true);
  end if;
  return true;
end $$;
revoke all on function public.take_signup_password(uuid) from public, anon, authenticated;
comment on function public.take_signup_password(uuid) is
  'A confirmed account''s password from before any password was set on it (confirmation_sent_at still set) is taken off, and the account marked (0423) — as it becomes crew (crew_role_takes_signup_password).';

create or replace function public.crew_role_takes_signup_password() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.take_signup_password(new.id);
  return null;
end $$;
revoke all on function public.crew_role_takes_signup_password() from public, anon, authenticated;
drop trigger if exists crew_role_takes_signup_password on public.profiles;
create trigger crew_role_takes_signup_password after update of role on public.profiles
  for each row when (coalesce(old.role, 'member') = 'member' and coalesce(new.role, 'member') <> 'member')
  execute function public.crew_role_takes_signup_password();

-- 0299's, word for word, and it says whether the account's old password was taken as it came on (fifth pass): Add
-- teammate tells the owner, who tells them, and so does the welcome letter.
create or replace function public.promote_to_crew(
  p_member uuid, p_role text, p_market text default null, p_lead boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare cur text; nm text; mk text;
begin
  select role, display_name, market into cur, nm, mk from public.profiles where id = p_member;
  if cur is null then raise exception 'no such profile'; end if;

  if p_role in ('owner', 'member') then
    raise exception 'This brings someone into the crew. Making an owner, or moving someone back to a customer, is done from the team roster.';
  end if;
  if cur <> 'member' then
    raise exception '% is already on the crew as a %. Change the role from the team roster instead.',
      coalesce(nm, 'This person'), cur;
  end if;

  -- The role first: set_market_lead refuses anyone who is not already an operator or above, and
  -- admin_set_role carries the authorisation rules for who may grant what. Not re-implemented here.
  perform public.admin_set_role(p_member, p_role);

  if p_market is not null then
    perform public.set_member_market(p_member, p_market);
    mk := p_market;
  end if;

  -- Leading a market is owner-only and lives in set_market_lead; letting it raise is the point.
  if p_lead then
    if p_market is null then
      raise exception 'Say which market they lead.';
    end if;
    perform public.set_market_lead(p_member, p_market);
  end if;

  return jsonb_build_object(
    'member', p_member, 'name', nm, 'from', cur, 'role', p_role,
    'market', mk, 'leads', p_lead,
    'password_taken', coalesce(current_setting('gt3.password_taken', true), '') = p_member::text);
end $$;
revoke all on function public.promote_to_crew(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.promote_to_crew(uuid, text, text, boolean) to authenticated;

create or replace function public.password_chosen() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  -- A password set — the join screen's, the choose sheet's, a reset's — is one nobody needs to ask for again.
  if coalesce(new.encrypted_password, '') <> '' and new.encrypted_password is distinct from old.encrypted_password then
    update public.profiles set password_taken_at = null, password_set_by_hand_at = null
     where id = new.id and (password_taken_at is not null or password_set_by_hand_at is not null);
  end if;
  return null;
end $$;
revoke all on function public.password_chosen() from public, anon, authenticated;
comment on function public.password_chosen() is
  'A password set on an account (0423) takes off the mark that asks its person to choose one (profiles.password_taken_at).';

create or replace function public.claim_invites_on_proof() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  -- Only a real proof claims (R18 review): the address proving itself (an answered confirmation, a provider that vouches
  -- for it), or an owner confirming it by hand. With Confirm email off, GoTrue confirms an address nobody proved, at
  -- sign-up — that claims nothing; the invite waits for the owner.
  if old.email_confirmed_at is null and new.email_confirmed_at is not null
     and (public.address_proved_itself(old.confirmation_sent_at, new.raw_app_meta_data) or public.vouched_by_hand()) then
    perform public.claim_team_invites(new.id, new.email);
  end if;
  return null;
end $$;
revoke all on function public.claim_invites_on_proof() from public, anon, authenticated;
comment on function public.claim_invites_on_proof() is
  'After an account''s address is first proven (0423) — by an answered confirmation, a provider that vouches for it, or an owner by hand — a staff invite waiting for it is claimed.';

-- "THIS ADDRESS IS THEIRS" (the R18 review, third and fourth passes). An owner who knows an address is its person's says so
-- here, in the SQL editor: select public.confirm_address('their@address'); — the address proven by hand, and an invite
-- waiting for it claimed (for an address already confirmed: claimed now). A password set before then is taken where the
-- rule reaches (a crew role at stake; every account after 0424): the owner can vouch for the address, not for whoever set
-- that password — they sign in with a code and choose one. It says what it did. Not the dashboard's "Confirm email"
-- either way: that is GoTrue's own, the same as the person's code. No door for the app: through the API it refuses.
create or replace function public.confirm_address(p_email text) returns text
  language plpgsql security definer set search_path = public as $$
declare uid uuid; was timestamptz; had boolean; has boolean; n integer;
begin
  if not public.vouched_by_hand() then
    raise exception 'An address is confirmed by hand by an owner, in the SQL editor.' using errcode = '42501';
  end if;
  select u.id, u.email_confirmed_at, coalesce(u.encrypted_password, '') <> '' into uid, was, had from auth.users u
   where lower(u.email) = lower(btrim(coalesce(p_email, ''))) limit 1;
  if uid is null then return 'No account has that address.'; end if;
  if was is null then
    update auth.users set email_confirmed_at = now() where id = uid;   -- by hand: the triggers above take and claim
    select count(*) into n from public.team_invites where claimed_by = uid and claimed_at = now();
  else
    n := public.claim_team_invites(uid, p_email);                       -- a crew role now: take_signup_password, above
  end if;
  select coalesce(encrypted_password, '') <> '' into has from auth.users where id = uid;
  return case when was is null then 'Confirmed by hand.' else 'Already confirmed.' end
    || case when n > 0 then ' The invite waiting for it is claimed.' when was is not null then ' Nothing was waiting for it.' else '' end
    || case when had and not has then ' The password set before now is taken — whoever set it may not be them: they sign in with a code and choose one (their mail never arrives? set one with them there: select public.set_password_by_hand(''…'', ''…'');).'
            when has then ' Its password stays.' else '' end;
end $$;
revoke all on function public.confirm_address(text) from public, anon, authenticated;
comment on function public.confirm_address(text) is
  'An owner confirming an address by hand, in the SQL editor (0423): proven, a waiting invite claimed, a password set before then taken where a crew role is at stake. Says what it did; refuses anyone else.';

-- "THEIR MAIL NEVER COMES" (the R18 review, fifth pass). Whoever lost a password to the rules above gets in with a code —
-- and the code goes by mail. For someone whose mail never arrives, the owner sets a password with them there, in the SQL
-- editor: select public.set_password_by_hand('their@address', 'eight or more characters'); — then says it to them, in
-- person. They sign in with it and are asked to choose their own at every sign-in until they do (the mark, which "Not now"
-- does not take off: the owner knows this one). An address already confirmed only; every session the account had is
-- ended, as GoTrue's own password change ends them. pgcrypto's bcrypt at GoTrue's cost (extensions), which GoTrue reads;
-- said, not thrown, where it isn't on. The editor keeps the query in its history: the answer says to clear it.
create or replace function public.set_password_by_hand(p_email text, p_password text) returns text
  language plpgsql security definer set search_path = public as $$
declare uid uuid; was timestamptz; hash text;
begin
  if not public.vouched_by_hand() then
    raise exception 'A password is set by hand by an owner, in the SQL editor.' using errcode = '42501';
  end if;
  if length(coalesce(p_password, '')) < 8 then return 'A password is at least 8 characters — nothing was changed.'; end if;
  select u.id, u.email_confirmed_at into uid, was from auth.users u
   where lower(u.email) = lower(btrim(coalesce(p_email, ''))) limit 1;
  if uid is null then return 'No account has that address.'; end if;
  if was is null then return format('Its address isn''t confirmed yet — confirm it first: select public.confirm_address(%L);', btrim(p_email)); end if;
  begin
    hash := extensions.crypt(p_password, extensions.gen_salt('bf', 10));   -- GoTrue's own cost
  exception when undefined_function or invalid_schema_name then
    return 'pgcrypto isn''t on (Database → Extensions → pgcrypto) — nothing was changed.';
  end;
  update auth.users set encrypted_password = hash, confirmation_sent_at = null where id = uid;   -- as GoTrue's UpdatePassword
  perform 1 from auth.refresh_tokens where user_id = uid::text for update;                       -- GoTrue's order (above)
  perform 1 from auth.sessions where user_id = uid for update;
  delete from auth.sessions where user_id = uid;
  update auth.refresh_tokens set revoked = true where user_id = uid::text and coalesce(revoked, false) = false;
  update public.profiles set password_taken_at = now(), password_set_by_hand_at = now() where id = uid;   -- asked until they choose
  return 'Set by hand. Say it to them in person — they sign in with it, and are asked to choose their own at every sign-in until they do. Then clear this query from the editor''s history: the password is in it.';
end $$;
revoke all on function public.set_password_by_hand(text, text) from public, anon, authenticated;
comment on function public.set_password_by_hand(text, text) is
  'An owner setting a password by hand for someone whose mail never arrives, in the SQL editor (0423): a bcrypt hash GoTrue reads, every session ended, the account asked to choose its own. Refuses anyone else.';

-- "Not now" on the choose sheet: asked once, not at every sign-in. Only ever the caller's own mark, and only taken off.
create or replace function public.password_not_now() returns void
  language sql security definer set search_path = public as $$
  update public.profiles set password_taken_at = null
   where id = auth.uid() and password_taken_at is not null and password_set_by_hand_at is null   -- a hand-set one stays asked
$$;
revoke all on function public.password_not_now() from public, anon, authenticated;
grant execute on function public.password_not_now() to authenticated;
comment on function public.password_not_now() is
  'The signed-in person''s "Not now" to choosing a password (0423): their own mark (profiles.password_taken_at) taken off — a code signs them in.';

drop trigger if exists invite_email_proven on auth.users;          -- this file's first draft's name for it
drop function if exists public.invite_email_proven();
drop trigger if exists password_waits_for_proof on auth.users;
create trigger password_waits_for_proof before update of email_confirmed_at on auth.users
  for each row execute function public.password_waits_for_proof();
drop trigger if exists claim_invites_on_proof on auth.users;
create trigger claim_invites_on_proof after update of email_confirmed_at on auth.users
  for each row execute function public.claim_invites_on_proof();
drop trigger if exists password_chosen on auth.users;
create trigger password_chosen after update of encrypted_password on auth.users
  for each row execute function public.password_chosen();

-- ── the money on a shop order, a jug count and an expense keeps its doors ────────────────────────────────────────────
create or replace function public.money_columns_guard() returns trigger
  language plpgsql security invoker set search_path = public as $$
declare cols text[]; c text; o jsonb; n jsonb;
begin
  -- A function of ours runs as its owner and the server as service_role: only a page's own write is asked. Invoker on
  -- purpose — a definer would always see its owner here.
  if current_user not in ('authenticated', 'anon') or public.is_admin() then   -- a guest's write is a page's too
    return new;
  end if;
  n := to_jsonb(new);
  if tg_op = 'INSERT' then
    -- What a page never makes (0423): a shop order and its lines are the checkout's, a jug count the delivery's door.
    if tg_table_name in ('shop_orders', 'shop_order_items', 'jug_ledger') then
      raise exception '% is recorded through its own door, not written by a page.',
        case tg_table_name when 'shop_orders' then 'A shop order' when 'shop_order_items' then 'A shop order''s line'
                           else 'A jug count' end
        using errcode = '42501';
    end if;
    -- An expense a page logs is a live one (0423): it is voided through void_expense, never logged voided.
    if tg_table_name = 'expenses' then
      if n ->> 'voided_at' is not null then
        raise exception 'An expense is voided through its own door — it is not logged voided.' using errcode = '42501';
      end if;
      return new;
    end if;
    -- A page may not create one already settled (0420).
    if coalesce((n ->> 'paid')::boolean, false)
       or coalesce(n ->> 'payment_status', '') in ('paid', 'invoiced', 'refunded')
       or n ->> 'collected_at' is not null
       or (tg_table_name = 'invoices') then
      raise exception 'Money on an order is recorded through its own door — an owner or admin can settle it.'
        using errcode = '42501';
    end if;
    return new;
  end if;
  cols := case tg_table_name
    when 'drop_orders'      then array['paid', 'total_cents', 'payment_id', 'payment_status', 'collected_via', 'collected_at', 'collected_by', 'idempotency_key']
    when 'delivery_orders'  then array['total_cents', 'bottle_subtotal_cents', 'delivery_fee_cents', 'tax_cents', 'payment_status', 'payment_method', 'payment_id']
    when 'business_orders'  then array['total_cents', 'subtotal_cents', 'delivery_fee_cents', 'tax_cents', 'price_per_gallon_cents', 'payment_status', 'payment_id', 'square_order_id', 'paylink_url', 'paylink_id']
    when 'invoices'         then array['amount_cents', 'status', 'paid_at', 'business_order_id', 'business_id']
    when 'shop_orders'      then array['payment_id', 'subtotal_cents', 'total_cents', 'refund_amount_cents', 'status', 'status_changed_at', 'status_changed_by', 'benefit_code', 'user_id', 'customer_id', 'apliiq_order_id']
    when 'shop_order_items' then array['order_id', 'product_id', 'variant', 'qty', 'unit_cents', 'cost_cents']
    when 'jug_ledger'       then array['business_id', 'business_order_id', 'jugs_out', 'jugs_in', 'balance_after', 'voided_at', 'voided_by', 'void_reason']
    when 'expenses'         then array['amount_cents', 'spent_on', 'created_by', 'voided_at', 'voided_by', 'void_reason']
    else array[]::text[] end;
  o := to_jsonb(old);
  foreach c in array cols loop
    if (n -> c) is distinct from (o -> c) then
      raise exception 'Money on an order changes through its own door — % is not a page''s to write. An owner or admin can settle it.', c
        using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.money_columns_guard() from public, anon, authenticated;
comment on function public.money_columns_guard() is
  'Before a page writes a pack, delivery, office order, invoice (0420), shop order, shop order line, jug count or expense (0423): its money columns change only through a function of ours or the server, unless the caller is an owner or admin; a page may not create one already settled, nor a shop order, its line or a jug count at all. Named a_… so it reads the row as the page sent it, before the triggers that derive payment_status.';

drop trigger if exists a_money_columns_guard on public.shop_orders;
create trigger a_money_columns_guard before insert or update on public.shop_orders
  for each row execute function public.money_columns_guard();
drop trigger if exists a_money_columns_guard on public.shop_order_items;
create trigger a_money_columns_guard before insert or update on public.shop_order_items
  for each row execute function public.money_columns_guard();
drop trigger if exists a_money_columns_guard on public.jug_ledger;
create trigger a_money_columns_guard before insert or update on public.jug_ledger
  for each row execute function public.money_columns_guard();
drop trigger if exists a_money_columns_guard on public.expenses;
create trigger a_money_columns_guard before insert or update on public.expenses
  for each row execute function public.money_columns_guard();

-- ── the business day where the calendar was still UTC ────────────────────────────────────────────────────────────────
-- Each is its last migration's text with current_date → public.business_day() (0348: the Eastern calendar day), and
-- nothing else changed.
-- security_invoker: market_live — definer on purpose, as 0285 made it and 0412 kept it: the storefront asks it signed out,
-- and markets is the crew's to read; it says only whether each city is open.
create or replace view public.market_live as
select m.slug                                                    as market,
       ((m.is_live is distinct from false)
         and coalesce(ls.is_live, false)
         and (m.opens_on is null or m.opens_on <= public.business_day()))  as is_live,
       coalesce(m.preorder_lead_h, ls.preorder_lead_h, 4)         as preorder_lead_h,
       coalesce(m.pay_at_pickup,   ls.pay_at_pickup,   true)      as pay_at_pickup,
       m.opens_on,
       (m.opens_on is not null and m.opens_on > public.business_day())     as pre_launch,
       (m.is_live is not distinct from false)                     as held_closed
  from public.markets m
  left join (select is_live, preorder_lead_h, pay_at_pickup
               from public.live_status where id = 1) ls on true;
revoke all on public.market_live from public;
grant select on public.market_live to anon, authenticated;

create or replace view public.all_orders with (security_invoker = on) as
  select 'cup'::text as channel, id, customer_id, user_id, tenant_id,
    fulfillment_status, payment_status, total_cents, created_at
  from public.orders
  union all
  select 'pickup', id, customer_id, user_id, tenant_id,
    fulfillment_status, payment_status, total_cents, created_at
  from public.drop_orders
  union all
  select 'delivery', id, customer_id, user_id, tenant_id,
    fulfillment_status, payment_status, total_cents, created_at
  from public.delivery_orders
  union all
  select 'office', id, customer_id, user_id, tenant_id,
    case when canceled_at is not null then 'canceled' when status = 'delivered' then 'fulfilled' when status in ('received','brewed') then 'placed' else 'in_prep' end,
    case payment_status when 'paid' then 'paid' when 'refunded' then 'refunded' when 'failed' then 'failed' else 'pending' end,
    total_cents, (delivery_date + time '12:00') at time zone 'UTC'
  from public.business_orders
  where delivery_date <= public.business_day();

create or replace function public.respond_to_offer(p_id uuid, p_action text, p_note text default null)
returns public.offer_letters language plpgsql security definer set search_path = public as $$
declare o public.offer_letters; nxt text; me_email text;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to answer your offer.' using errcode = '28000';
  end if;
  select * into o from public.offer_letters where id = p_id;
  if not found then raise exception 'No such offer.'; end if;

  me_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  if o.candidate_user_id is distinct from auth.uid()
     and lower(o.candidate_email) is distinct from me_email then
    raise exception 'Only the person this offer is for can respond to it.';
  end if;
  if o.status not in ('sent','countered') then
    raise exception 'This offer is not open for a response right now (it is %).', o.status;
  end if;
  if o.expires_on is not null and o.expires_on < public.business_day() then
    update public.offer_letters set status = 'expired', updated_at = now() where id = p_id;
    raise exception 'This offer expired on %.', o.expires_on;
  end if;

  nxt := case p_action when 'accept' then 'accepted'
                       when 'decline' then 'declined'
                       when 'counter' then 'countered' else null end;
  if nxt is null then raise exception 'Unknown response: %. Use accept, decline or counter.', p_action; end if;

  update public.offer_letters
     set status = nxt,
         responded_at = now(),
         -- link the account on first response, so later reads stop depending on the email match
         candidate_user_id = coalesce(candidate_user_id, auth.uid()),
         updated_at = now()
   where id = p_id returning * into o;

  update public.offer_events set note = coalesce(p_note, note)
   where id = (select id from public.offer_events where offer_id = p_id order by at desc limit 1);

  return o;
end $$;

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
                and o.fulfillment_status in ('placed', 'in_prep', 'ready') and o.drop_date >= public.business_day())
     or exists (select 1 from public.delivery_orders o
              where (o.user_id = p_user or o.customer_id = any(v_customers))
                and o.fulfillment_status in ('placed', 'in_prep', 'ready') and o.delivery_date >= public.business_day())
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


-- ── a job that stopped, and a request the database sent that failed, are said ────────────────────────────────────────
create or replace function public.cron_watch() returns integer
  language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0; bad integer; last_err text; gap text;
begin
  for r in
    select j.jobname, count(*) as fails, max(d.end_time) as last_at,
           (array_agg(left(coalesce(d.return_message, ''), 160) order by d.end_time desc))[1] as said
      from cron.job_run_details d join cron.job j on j.jobid = d.jobid
     where d.status = 'failed' and d.end_time > now() - interval '20 minutes'
     group by j.jobname
  loop
    -- One open alert per job (alert_open_once: a job failing every run is one alert, its count going up), named by the
    -- job — the subject is the job's name made a uuid, so the same job is the same alert.
    perform public.alert_open_once('cron_failed', md5('cron:' || r.jobname)::uuid, 'important', 'system',
      'A scheduled job is failing — ' || r.jobname,
      r.fails || ' failed run' || case when r.fails = 1 then '' else 's' end || ' in the last 20 minutes. The last said: '
        || coalesce(nullif(btrim(r.said), ''), '(nothing)'),
      '/crew?s=settings&a=set-errors');
    n := n + 1;
  end loop;

  -- A JOB THAT STOPPED (0423). A schedule that no longer fires fails nothing, so the loop above never sees it. A job
  -- that started at least three times this week and has now gone three of its usual gaps (half an hour at least)
  -- without starting is one alert of its own.
  -- Only an active job on an every-day schedule is read for its gaps: one that runs only on some days or some hours (a
  -- Monday's reminder, a service window) has gaps no median says, and a paused one (active = false) is meant to stop.
  for r in
    with runs as (
      select j.jobname, d.start_time,
             extract(epoch from d.start_time - lag(d.start_time) over (partition by d.jobid order by d.start_time))::float8 as gap_s
        from cron.job j join cron.job_run_details d on d.jobid = j.jobid
       where d.start_time > now() - interval '7 days'
         and j.active
         and split_part(j.schedule, ' ', 3) = '*' and split_part(j.schedule, ' ', 4) = '*' and split_part(j.schedule, ' ', 5) = '*'
         -- Every hour: any minute rule. Some hours (every N, or one): once in each of them — '* 3 * * *' runs sixty times
         -- in one hour and then waits twenty-three (R18 review).
         and ((split_part(j.schedule, ' ', 2) = '*' and split_part(j.schedule, ' ', 1) ~ '^(\*|\*/[0-9]+|[0-9]+(,[0-9]+)*)$')
           or (split_part(j.schedule, ' ', 2) ~ '^(\*/[0-9]+|[0-9]+)$' and split_part(j.schedule, ' ', 1) ~ '^[0-9]+$'))
    )
    -- Its usual gap is the long end of its gaps (the ninetieth percentile, R18 review): a minute list like '0,10,20'
    -- waits forty minutes every hour, and a median of ten would call each of those a stop.
    select jobname, max(start_time) as last_start, percentile_cont(0.9) within group (order by gap_s) as usual_s
      from runs group by jobname
    having count(*) >= 3
  loop
    continue when r.usual_s is null or now() - r.last_start <= make_interval(secs => greatest(3 * r.usual_s, 1800));
    gap := case when r.usual_s < 5400 then round((r.usual_s / 60)::numeric) || case when round((r.usual_s / 60)::numeric) = 1 then ' minute' else ' minutes' end
                when r.usual_s < 172800 then round((r.usual_s / 3600)::numeric) || case when round((r.usual_s / 3600)::numeric) = 1 then ' hour' else ' hours' end
                else round((r.usual_s / 86400)::numeric) || case when round((r.usual_s / 86400)::numeric) = 1 then ' day' else ' days' end end;
    perform public.alert_open_once('cron_stalled', md5('cron-stalled:' || r.jobname)::uuid, 'important', 'system',
      'A scheduled job stopped running — ' || r.jobname,
      'It usually starts about every ' || gap || '; it last started '
        || to_char(r.last_start at time zone 'America/New_York', 'Dy, Mon FMDD, FMHH12:MI AM') || ' ET.',
      '/crew?s=settings&a=set-errors');
    n := n + 1;
  end loop;
  -- A job that started again since its line was raised closes it: the mechanism's ack (ack_by left null, 0340's way).
  update public.alerts a set ack_at = now()
   where a.kind = 'cron_stalled' and a.ack_at is null
     and exists (select 1 from cron.job j join cron.job_run_details d on d.jobid = j.jobid
                  where md5('cron-stalled:' || j.jobname)::uuid = a.subject_id and d.start_time > a.created_at);

  -- WHAT THE DATABASE SENT AND DIDN'T LAND (0423). pg_net keeps six hours of answers to the requests the database
  -- makes — the push function's webhook among them, which carries every alert to the phones, Teams and email — and
  -- nothing read them. One alert while any failed in the last twenty minutes.
  begin
    execute $q$
      select count(*)::int,
             (array_agg(left(coalesce(nullif(btrim(error_msg), ''), 'HTTP ' || status_code::text, 'timed out'), 160)
                order by created desc))[1]
        from net._http_response
       where created > now() - interval '20 minutes'
         and (timed_out or status_code >= 400 or nullif(btrim(error_msg), '') is not null)$q$
      into bad, last_err;
  exception when others then
    -- No pg_net here, or its answers can't be read: nothing to say about them either way — an open line stays open
    -- (unread is not answering again) — and never the reason the failed-job and stopped-job lines above go unwritten
    -- (one error here rolled the whole run back).
    bad := null;
  end;
  if bad > 0 then
    perform public.alert_open_once('db_http_failed', md5('db-http:sent')::uuid, 'important', 'system',
      'Requests the database sends are failing — ' || bad || ' in 20 minutes',
      'Most likely the push function''s webhook: alerts may not be reaching phones, Teams or email until it answers. The last said: '
        || coalesce(last_err, '(nothing)') || '.',
      '/crew?s=settings&a=set-errors');
    n := n + 1;
  elsif bad = 0 then
    -- Answering again: the line closes itself, as the stopped job's does.
    update public.alerts set ack_at = now()
     where kind = 'db_http_failed' and subject_id = md5('db-http:sent')::uuid and ack_at is null;
  end if;

  -- The run log keeps a week (it grew by thousands of rows a day and was never pruned).
  delete from cron.job_run_details where end_time < now() - interval '7 days';
  return n;
end $$;
revoke all on function public.cron_watch() from public, anon, authenticated;
comment on function public.cron_watch() is
  'Every ten minutes (0419, 0423): a job with failed runs in the last twenty minutes (cron_failed), an active every-day job that has gone three of its usual gaps without starting (cron_stalled, closed when it starts again) — one open alert per job — and one alert while requests the database sent failed in the last twenty minutes (db_http_failed, closed when none do). The run log keeps a week.';

-- ── what a public bucket takes ───────────────────────────────────────────────────────────────────────────────────────
update storage.buckets set file_size_limit = 104857600, allowed_mime_types = array['image/*', 'video/*']
 where id = 'content';
update storage.buckets set file_size_limit = 104857600,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm']
 where id = 'shop';                                                -- lib/shopMedia's picker, type for type: never an SVG in a public bucket
update storage.buckets set file_size_limit = 12582912, allowed_mime_types = array['image/*']
 where id in ('brand', 'training');
update storage.buckets set file_size_limit = 26214400,
       allowed_mime_types = array['image/*', 'application/pdf', 'text/plain', 'text/csv', 'text/markdown']
 where id = 'intake';                                              -- SmartIntake: a picture, a PDF or a text file
update storage.buckets set file_size_limit = 26214400, allowed_mime_types = array['image/*', 'application/pdf', 'text/plain']
 where id = 'note-files';                                          -- NoteAttach: pictures, a PDF, a text file
update storage.buckets set allowed_mime_types = array['image/*', 'application/pdf']
 where id = 'receipts';                                            -- LogPurchase: a photo or a PDF (0292's 20 MB stands)

-- ── the foreign keys alerts and the money doors walk ─────────────────────────────────────────────────────────────────
create index if not exists orders_collected_by_idx on public.orders (collected_by) where collected_by is not null;
create index if not exists drop_orders_collected_by_idx on public.drop_orders (collected_by) where collected_by is not null;
create index if not exists loyalty_ledger_by_user_idx on public.loyalty_ledger (by_user) where by_user is not null;
create index if not exists alerts_ack_by_idx on public.alerts (ack_by) where ack_by is not null;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A crew invite goes to whoever proves the address', 'fix', 'Team',
   'A staff invite is claimed only once the invited address is proven — by the emailed code or link, or by Sign in with Apple — and a password someone set on that address before it was proven no longer opens the account.',
   '2026-10-17', false),
  ('Shop orders, jug counts and expenses keep their money', 'fix', 'Money',
   'A shop order''s total, refund and status, a jug count, and an expense''s amount or void change only through the app''s own steps (or an owner or admin), as packs, deliveries and office orders already did.',
   '2026-10-17', false),
  ('A scheduled job that stops is said', 'fix', 'System',
   'Besides a job that fails, a job that stops running and requests to the push service that fail now raise an alert in Settings, instead of going quiet.',
   '2026-10-17', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from pg_trigger where tgname = 'a_money_columns_guard';                                       -- 8
--   select count(*) from pg_trigger where tgname in ('password_waits_for_proof', 'claim_invites_on_proof', 'password_chosen', 'crew_role_takes_signup_password'); -- 4
--   select public.password_scope_everywhere();                                                                  -- f (t once 0424 is pasted)
--   select count(*) from information_schema.columns where table_name = 'profiles' and column_name = 'password_taken_at'; -- 1
--   select has_function_privilege('authenticated', 'public.confirm_address(text)', 'execute');                 -- f
--   select has_function_privilege('authenticated', 'public.set_password_by_hand(text, text)', 'execute');      -- f
--   select has_table_privilege('postgres', 'auth.users', 'UPDATE');                                            -- t
--   select prosrc like '%claim_team_invites%' from pg_proc where proname = 'handle_new_user';                    -- t
--   select count(*) from pg_proc where proname = 'cron_watch' and prosrc like '%cron_stalled%';                  -- 1
--   select count(*) from storage.buckets where id in ('content','shop','brand','training','intake','note-files','receipts') and allowed_mime_types is not null; -- 7
--   select count(*) from pg_indexes where indexname in ('orders_collected_by_idx','drop_orders_collected_by_idx','loyalty_ledger_by_user_idx','alerts_ack_by_idx'); -- 4
select public.record_migration('0423_an_invite_waits_for_a_proven_address_money_keeps_its_doors_a_stopped_job_is_said');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor (the R18 review, third pass)
