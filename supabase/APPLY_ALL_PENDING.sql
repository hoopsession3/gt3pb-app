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
-- pending-from: 0398
-- generated-at: 2026-10-14
-- pending-count: 1
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- held: 0376_nobody_on_the_pass_during_service_is_an_alert.sql — NOT in this file; applied by hand once the condition in its header is met
-- ============================================================
-- 0398_a_text_needs_a_yes.sql
-- ============================================================
-- ── 0398 — A TEXT NEEDS A YES ──────────────────────────────────────────────────────────────────────────────────────
-- 2026-10-14 (R5 of the customer audit — "A pickup-day text, plus notices when a pack is moved or cancelled"; decided
-- 2026-10-13: texts with a recorded opt-in, STOP honoured, no texts at night, and none at all until the Twilio number is
-- registered).
--
-- WHY. lib/notify texted any phone an order carried the moment Twilio's keys were set — a pack reserved, a delivery, a
-- stop called off. Nothing asked the customer, nothing recorded a yes, and a STOP sent back reached nothing that listened.
--
-- WHAT.
--   · text_consents — one row per phone number, as lib/notify sends to it (E.164, "+18645550100"): when it said yes and
--     where (the pack or delivery checkout, the account screen, START by text), and when it said stop and where (STOP by
--     text, the account screen). A number is texted only while its yes is later than its stop. The member whose order or
--     account gave the yes is kept, so they can read their own row; nobody writes it but the server.
--   · say_text_consent(phone, yes, source, user) — the one writer, for the server alone (the checkout routes, the
--     account route, the inbound-text webhook). A yes and a stop each keep their own time and place; the later wins.
--   · text_consent_standing(phone) — is this number's yes standing now? (the server, before every text)
--   · an erased account takes its numbers' rows with it (0353): the rows the account gave go with the account (on delete
--     cascade — erase_account_data deletes what the schema says goes with it), and a yes or a STOP that came by text,
--     with no account on it, goes when a pack, a delivery or a customer record lets go of the person and the number
--     together — matched by the number as lib/notify reads it (text_number = lib/texts e164). A number with no row is
--     never texted, so nothing is texted for it.
--
-- A second run changes nothing.

create table if not exists public.text_consents (
  phone        text primary key check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  user_id      uuid references auth.users (id) on delete cascade,
  yes_at       timestamptz,
  yes_source   text check (yes_source in ('pack_checkout', 'delivery_checkout', 'account', 'start_text')),
  stop_at      timestamptz,
  stop_source  text check (stop_source in ('stop_text', 'account')),
  updated_at   timestamptz not null default now()
);
create index if not exists text_consents_user on public.text_consents (user_id) where user_id is not null;
comment on table public.text_consents is
  'A text needs a yes (0398): per phone number (E.164), the latest yes and the latest stop, each with when and where. Texted only while the yes is later than the stop.';

alter table public.text_consents enable row level security;
drop policy if exists text_consents_own_read on public.text_consents;
create policy text_consents_own_read on public.text_consents for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.text_consents from public, anon, authenticated;
grant select on public.text_consents to authenticated;

-- ── the one writer ─────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.say_text_consent(p_phone text, p_yes boolean, p_source text, p_user uuid default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'That isn''t a phone number we can text.' using errcode = '22023';
  end if;
  if p_yes then
    insert into public.text_consents (phone, user_id, yes_at, yes_source, updated_at)
    values (p_phone, p_user, now(), p_source, now())
    on conflict (phone) do update
      set yes_at = now(), yes_source = excluded.yes_source,
          user_id = coalesce(excluded.user_id, public.text_consents.user_id), updated_at = now();
  else
    insert into public.text_consents (phone, user_id, stop_at, stop_source, updated_at)
    values (p_phone, p_user, now(), p_source, now())
    on conflict (phone) do update
      set stop_at = now(), stop_source = excluded.stop_source,
          user_id = coalesce(excluded.user_id, public.text_consents.user_id), updated_at = now();
  end if;
  return public.text_consent_standing(p_phone);
end $$;

create or replace function public.text_consent_standing(p_phone text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select c.yes_at is not null and (c.stop_at is null or c.yes_at > c.stop_at)
                     from public.text_consents c where c.phone = p_phone), false)
$$;

-- the server's alone: a member reads their own row (the policy above); a text's yes is never written from a phone's page
revoke all on function public.say_text_consent(text, boolean, text, uuid) from public, anon, authenticated;
grant execute on function public.say_text_consent(text, boolean, text, uuid) to service_role;
revoke all on function public.text_consent_standing(text) from public, anon, authenticated;
grant execute on function public.text_consent_standing(text) to service_role;
-- existing rows: none — text_consents is new in this migration, and no text has been sent without Twilio's keys.

-- ── a number the person lets go of takes its yes and its stop with it ──────────────────────────────────────────────
-- The number as lib/notify reads it — lib/texts e164, line for line: a number written with its own + keeps it (8 to 15
-- digits, not starting 0); ten digits take +1 (not starting 0 or 1); eleven starting 1 take + (the next not 0 or 1).
-- Anything else is no number.
create or replace function public.text_number(p_raw text)
returns text language sql immutable set search_path = public as $$
  select case
           when length(x.d) = 0 then null
           when p_raw ~ '^\s*\+' then case when length(x.d) between 8 and 15 and x.d !~ '^0' then '+' || x.d end
           when length(x.d) = 10 and x.d !~ '^[01]' then '+1' || x.d
           when length(x.d) = 11 and x.d ~ '^1' and x.d !~ '^1[01]' then '+' || x.d
         end
    from (select regexp_replace(coalesce(p_raw, ''), '[^0-9]', '', 'g') as d) x
$$;
revoke all on function public.text_number(text) from public, anon, authenticated;
grant execute on function public.text_number(text) to service_role;

-- An erased account keeps its orders without the person (0353): each pack, delivery and customer record lets go of the
-- member and the number in one change. When a record does — its phone emptied, and no account on it — any yes or stop
-- kept for that number goes too.
create or replace function public.text_consent_lets_go()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.text_consents where phone = public.text_number(old.phone);
  return null;
end $$;
revoke all on function public.text_consent_lets_go() from public, anon, authenticated;

drop trigger if exists text_consent_lets_go on public.customers;
create trigger text_consent_lets_go after update of phone on public.customers
  for each row when (old.phone is not null and new.phone is null and new.user_id is null)
  execute function public.text_consent_lets_go();
drop trigger if exists text_consent_lets_go on public.drop_orders;
create trigger text_consent_lets_go after update of phone on public.drop_orders
  for each row when (old.phone is not null and new.phone is null and new.user_id is null)
  execute function public.text_consent_lets_go();
drop trigger if exists text_consent_lets_go on public.delivery_orders;
create trigger text_consent_lets_go after update of phone on public.delivery_orders
  for each row when (old.phone is not null and new.phone is null and new.user_id is null)
  execute function public.text_consent_lets_go();

-- ── what changed ───────────────────────────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A text needs a yes', 'improvement', 'Messages',
   'We text a phone number only after its owner says yes — at checkout or on their account — and stop the moment they reply STOP. Nothing is texted at night. Texts stay off until our number is registered.',
   '2026-10-14', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0398_a_text_needs_a_yes');

-- verify (numbers and booleans only):
--   select count(*) from information_schema.tables where table_name = 'text_consents';                                  -- 1
--   select has_function_privilege('anon', 'public.say_text_consent(text,boolean,text,uuid)', 'execute');               -- false
--   select has_function_privilege('authenticated', 'public.say_text_consent(text,boolean,text,uuid)', 'execute');      -- false
--   select count(*) from pg_trigger where tgname = 'text_consent_lets_go';                                               -- 3
