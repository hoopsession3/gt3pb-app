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
-- pending-from: 0390
-- generated-at: 2026-10-12
-- pending-count: 3
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- held: 0376_nobody_on_the_pass_during_service_is_an_alert.sql — NOT in this file; applied by hand once the condition in its header is met
-- ============================================================
-- 0388_a_pack_is_changed_in_place.sql
-- ============================================================
-- ── 0388 — A PACK IS CHANGED IN PLACE ──────────────────────────────────────────────────────────────────────────────
-- 2026-10-12. C5 of the customer frontend audit. The owner approved it on 2026-10-12 (decision 4: a paid pack is changed
-- in place, charging or refunding only the difference).
--
-- WHY. "Change the pack" placed a second reservation and then canceled the first. A paid pack was charged again in
-- full; the first payment waited on a crew alert ("Member canceled a PAID reservation — refund needed") to be refunded
-- by hand; and the customer was told only "Pack updated" (OrderFunnel, cancel_own_reservation 0341).
--
-- WHAT. A change is one row here, keyed by the page's idempotency key (components/useIdemKey), written only by the
-- functions below, and only the server calls them (app/api/reserve/change, through lib/packChange):
--
--   started   the pack is held for this change — one change at a time per pack — and nothing has moved yet
--   moved     what the change needed is done in Square: the difference charged, or refunded, or nothing to move
--   done      the pack was changed in place: size, glass, mix, day, name, phone, code, the total
--   refused   Square declined the card: nothing moved, and the pack is free again
--   unknown   Square's answer never came or did not say; the crew is told, and the pack is unchanged
--   void      it stopped before any money moved (the pack changed underneath, or its request died)
--   stale     money moved but the pack changed underneath before it was applied: the server gives a charge back,
--             and tells the crew about a refund
--
-- The money rule lives in pack_change_begin, read under the pack's lock — the page is quoted the same rule
-- (lib/packChange.diffFor) and sends what it was shown; a different answer here refuses before anything moves:
--   paid pack      the difference: the new total less what the pack holds now. More is charged to a card; less is
--                  refunded to the payments that funded the pack, newest first (pack_change_funding).
--   pay at pickup  nothing moves, unless the customer pays now: then the new total is charged.
--
-- Untouched: /api/reserve, cancel_own_reservation (a cancel still flags a paid pack's refund for the crew), the
-- loyalty trigger (a pack earns its stamps at pickup, so a change before pickup moves none), the drop board.
--
-- ORDER. Paste it before the deploy that carries the change route. Pasted after, nothing breaks: until it is here the
-- route answers "Changing a pack isn't switched on yet" and the page keeps the old way.
-- existing rows: none written.
-- changelog: below.

create table if not exists public.drop_order_changes (
  key               text primary key check (char_length(key) between 8 and 45),
  drop_order_id     uuid not null references public.drop_orders(id) on delete cascade,
  user_id           uuid references auth.users(id) on delete set null,
  tenant_id         uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  state             text not null default 'started'
                    check (state in ('started', 'moved', 'done', 'refused', 'unknown', 'void', 'stale')),
  card              boolean not null default false,       -- a card is charged under this key
  before            jsonb not null,                       -- the pack as it was, read under its lock
  after             jsonb not null,                       -- what it becomes
  diff_cents        integer not null,                     -- + charged under this key, − refunded, 0 nothing moves
  charge_payment_id text unique,
  refunds           jsonb not null default '[]'::jsonb,   -- [{payment_id, refund_id, cents, status}]
  by_hand_cents     integer not null default 0 check (by_hand_cents >= 0),  -- refund the crew sends by hand
  status            integer,                              -- what the server answered, said again to a retry
  answer            jsonb,
  outcome           text,                                 -- how the money step went, in Square's words or ours
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists drop_order_changes_one_at_a_time
  on public.drop_order_changes (drop_order_id) where state in ('started', 'moved');
create index if not exists drop_order_changes_pack on public.drop_order_changes (drop_order_id, created_at desc);
comment on table public.drop_order_changes is
  'Every change to a reserved pack (0388): the pack before and after, the money it moved and how. No name or phone is kept here — they go straight onto the pack — so an erased account leaves nothing of the person in it. Written only by pack_change_begin / _moved / _end / _apply / _refunded / _answer, which only the server calls.';

alter table public.drop_order_changes enable row level security;
drop policy if exists "pack changes own read" on public.drop_order_changes;
create policy "pack changes own read" on public.drop_order_changes for select
  using (user_id = (select auth.uid()) or (select public.is_staff()));
drop trigger if exists stamp_tenant_tg on public.drop_order_changes;
create trigger stamp_tenant_tg before insert on public.drop_order_changes for each row execute function public.stamp_tenant();
drop policy if exists "tenant isolation" on public.drop_order_changes;
create policy "tenant isolation" on public.drop_order_changes as restrictive for all
  using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
-- read for the signed-in (the policies decide which rows); no writes from the app
revoke all on public.drop_order_changes from public, anon;
revoke insert, update, delete, truncate on public.drop_order_changes from authenticated;
grant select on public.drop_order_changes to authenticated;
grant select, insert, update, delete on public.drop_order_changes to service_role;

-- The pack as a change compares it: what it is, and what it holds.
create or replace function public.pack_snapshot(r public.drop_orders) returns jsonb
  language sql stable set search_path = public as $$
  select jsonb_build_object('size', r.size, 'glass', r.glass, 'mix', r.mix, 'drop_date', r.drop_date,
    'total_cents', r.total_cents, 'paid', r.paid, 'payment_id', r.payment_id)
$$;

-- The payments that fund a pack, newest first, with what is left to refund on each. The reservation's own payment
-- (drop_orders.payment_id) holds what the pack cost before its first change — or, when a change paid a pay-at-pickup
-- pack, what that change charged; every later charged difference is its own payment. A refund recorded by a change
-- comes off the payment it was taken from. A refund made by hand in Square is not here: Square refuses a refund past
-- what is left, and the crew is told.
create or replace function public.pack_change_funding(p_order uuid) returns jsonb
  language sql stable set search_path = public as $$
  with r as (select * from public.drop_orders where id = p_order),
  done as (select c.* from public.drop_order_changes c where c.drop_order_id = p_order and c.state in ('moved', 'done', 'stale')),
  pays as (
    select r.payment_id as payment_id,
           coalesce((select d.diff_cents from done d where d.charge_payment_id = r.payment_id),
                    (select (d.before->>'total_cents')::int from done d order by d.created_at limit 1),
                    r.total_cents) as cents,
           '-infinity'::timestamptz as at
      from r where r.payment_id is not null
    union all
    select d.charge_payment_id, d.diff_cents, d.created_at
      from done d, r where d.charge_payment_id is not null and d.charge_payment_id is distinct from r.payment_id
  ),
  taken as (
    select x->>'payment_id' as payment_id, sum((x->>'cents')::int) as cents
      from done d, jsonb_array_elements(d.refunds) x group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('payment_id', p.payment_id,
           'left', greatest(0, p.cents - coalesce(t.cents, 0))) order by p.at desc), '[]'::jsonb)
    from pays p left join taken t on t.payment_id = p.payment_id
$$;

-- Hold the pack for this change, or say why not. A key seen before answers with its change, whatever has happened
-- since. The money it will move is decided here, under the pack's lock.
create or replace function public.pack_change_begin(
  p_key text, p_order uuid, p_user uuid, p_after jsonb, p_new_total integer, p_pay_now boolean, p_expected_diff integer
) returns jsonb language plpgsql set search_path = public as $$
declare r public.drop_orders%rowtype; c public.drop_order_changes%rowtype; h public.drop_order_changes%rowtype;
  v_diff integer; v_card boolean;
begin
  select * into c from public.drop_order_changes where key = p_key;
  if c.key is not null then
    if c.drop_order_id is distinct from p_order or c.user_id is distinct from p_user then
      return jsonb_build_object('refused', 'key');
    end if;
    return jsonb_build_object('change', to_jsonb(c), 'again', true,
      'age_ms', floor(extract(epoch from (now() - c.updated_at)) * 1000));
  end if;
  select * into r from public.drop_orders where id = p_order for update;
  if r.id is null or r.user_id is distinct from p_user then return jsonb_build_object('refused', 'not_found'); end if;
  if r.canceled_at is not null then return jsonb_build_object('refused', 'canceled'); end if;
  if r.picked_up or r.stage is distinct from 'reserved' then return jsonb_build_object('refused', 'in_motion'); end if;
  if r.collected_at is not null then return jsonb_build_object('refused', 'collected'); end if;
  select * into h from public.drop_order_changes where drop_order_id = p_order and state in ('started', 'moved');
  if h.key is not null then
    return jsonb_build_object('held', to_jsonb(h), 'age_ms', floor(extract(epoch from (now() - h.updated_at)) * 1000));
  end if;
  if r.paid then
    v_diff := p_new_total - r.total_cents;
  elsif p_pay_now then
    v_diff := p_new_total;
  else
    v_diff := 0;
  end if;
  v_card := v_diff > 0;
  if p_expected_diff is distinct from v_diff then
    return jsonb_build_object('refused', 'repriced', 'diff', v_diff, 'was', r.total_cents, 'paid', r.paid);
  end if;
  insert into public.drop_order_changes (key, drop_order_id, user_id, tenant_id, card, before, after, diff_cents)
    values (p_key, p_order, p_user, r.tenant_id, v_card, public.pack_snapshot(r), p_after, v_diff)
    returning * into c;
  return jsonb_build_object('change', to_jsonb(c), 'funding', public.pack_change_funding(p_order));
end $$;

-- Square did what the change needed (or there was nothing to do): started → moved.
create or replace function public.pack_change_moved(
  p_key text, p_charge_payment_id text, p_refunds jsonb, p_by_hand integer, p_outcome text
) returns boolean language plpgsql set search_path = public as $$
begin
  update public.drop_order_changes
     set state = 'moved', charge_payment_id = p_charge_payment_id, refunds = coalesce(p_refunds, '[]'::jsonb),
         by_hand_cents = greatest(0, coalesce(p_by_hand, 0)), outcome = p_outcome, updated_at = now()
   where key = p_key and state = 'started';
  return found;
end $$;

-- A change that ends before it moved anything: started → refused | unknown | void.
create or replace function public.pack_change_end(p_key text, p_state text, p_outcome text) returns boolean
  language plpgsql set search_path = public as $$
begin
  if p_state not in ('refused', 'unknown', 'void') then raise exception 'pack_change_end: % is not an end', p_state; end if;
  update public.drop_order_changes set state = p_state, outcome = p_outcome, updated_at = now()
   where key = p_key and state = 'started';
  return found;
end $$;

-- Change the pack in place: moved → done, when the pack is still as the change found it. Otherwise → stale (money
-- moved) or void (none did), and the pack is left alone. The name and phone come with the request that made the
-- change; a change finished by a later request keeps the pack's. The pack's name and phone come back for the words.
create or replace function public.pack_change_apply(p_key text, p_name text default null, p_phone text default null) returns jsonb
  language plpgsql set search_path = public as $$
declare c public.drop_order_changes%rowtype; r public.drop_orders%rowtype; v_state text;
begin
  select * into c from public.drop_order_changes where key = p_key for update;
  if c.key is null then return jsonb_build_object('state', 'missing'); end if;
  select * into r from public.drop_orders where id = c.drop_order_id for update;
  if c.state <> 'moved' then return jsonb_build_object('state', c.state, 'change', to_jsonb(c), 'name', r.name, 'phone', r.phone); end if;
  if r.id is null or r.canceled_at is not null or r.picked_up or r.stage is distinct from 'reserved'
     or r.collected_at is not null or public.pack_snapshot(r) is distinct from c.before then
    v_state := case when c.charge_payment_id is not null or jsonb_array_length(c.refunds) > 0 or c.by_hand_cents > 0
                    then 'stale' else 'void' end;
    update public.drop_order_changes set state = v_state, outcome = coalesce(c.outcome || ' · ', '') || 'the pack changed before this was applied', updated_at = now()
     where key = p_key returning * into c;
    return jsonb_build_object('state', v_state, 'change', to_jsonb(c), 'name', r.name, 'phone', r.phone);
  end if;
  update public.drop_orders set
      size = (c.after->>'size')::int,
      glass = c.after->>'glass',
      mix = c.after->'mix',
      drop_date = (c.after->>'drop_date')::date,
      total_cents = (c.after->>'total_cents')::int,
      name = coalesce(nullif(trim(p_name), ''), r.name),
      phone = coalesce(nullif(trim(p_phone), ''), r.phone),
      benefit_code = nullif(c.after->>'benefit_code', ''),
      -- a pay-at-pickup pack paid by this change is paid, by this change's payment
      paid = r.paid or c.charge_payment_id is not null,
      payment_id = case when not r.paid and c.charge_payment_id is not null then c.charge_payment_id else r.payment_id end
   where id = r.id
  returning * into r;
  update public.drop_order_changes set state = 'done', updated_at = now() where key = p_key returning * into c;
  return jsonb_build_object('state', 'done', 'change', to_jsonb(c), 'name', r.name, 'phone', r.phone);
end $$;

-- A refund made after the change moved — a stale change's charge given back — goes on its record, so the payment it
-- came from holds that much less (pack_change_funding).
create or replace function public.pack_change_refunded(p_key text, p_refund jsonb) returns boolean
  language plpgsql set search_path = public as $$
begin
  update public.drop_order_changes set refunds = refunds || jsonb_build_array(p_refund), updated_at = now()
   where key = p_key and state in ('moved', 'done', 'stale');
  return found;
end $$;

-- What the server answered, kept for a retry of the same key.
create or replace function public.pack_change_answer(p_key text, p_status integer, p_answer jsonb) returns void
  language sql set search_path = public as $$
  update public.drop_order_changes set status = p_status, answer = p_answer, updated_at = now() where key = p_key
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.pack_snapshot(public.drop_orders)', 'public.pack_change_funding(uuid)',
    'public.pack_change_begin(text, uuid, uuid, jsonb, integer, boolean, integer)',
    'public.pack_change_moved(text, text, jsonb, integer, text)', 'public.pack_change_end(text, text, text)',
    'public.pack_change_apply(text, text, text)', 'public.pack_change_refunded(text, jsonb)',
    'public.pack_change_answer(text, integer, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A pack is changed in place','fix','Ordering',
   'Changing a paid pack used to charge a second full pack and leave the first to be refunded by hand. Now the pack itself changes — size, flavors, glass, day — and only the difference moves: a bigger pack charges the difference to a card, a smaller one refunds it to the card that paid, and the same price moves nothing. The page shows the difference before you confirm, and the text says what moved.',
   '2026-10-12', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select relrowsecurity from pg_class where oid = 'public.drop_order_changes'::regclass;                       -- t
--   select has_function_privilege('authenticated', 'public.pack_change_apply(text, text, text)', 'execute');    -- f
--   select count(*) from pg_proc where proname like 'pack_change_%';                                             -- 7
select public.record_migration('0388_a_pack_is_changed_in_place');

-- ============================================================
-- 0389_one_purchase_one_stamp_and_credit_at_the_window.sql
-- ============================================================
-- ── 0389 — ONE PURCHASE, ONE STAMP · CREDIT IS SPENT AT THE WINDOW ─────────────────────────────────────────────────
-- 2026-10-12. H8 of the customer frontend audit, release C1. The owner approved the release ("yes to all improvements")
-- and chose, on 2026-10-12, that referral credit is spent at the window: the crew takes it off in one tap, like a free
-- cup, and rings the order up that much less.
--
-- WHY. One purchase could earn two stamps: an app order earns its own at pickup (0152/0229, one award per order),
-- while the member card said "Scan at the truck to earn your stamp" and a scan awards one more with no order behind it
-- — so the once-per-order rule never applied to it. And the $5 "give $5, get $5" credit was shown on accounts but
-- nothing could spend it: no checkout read it, and the crew could not see it at the window.
--
-- WHAT.
--   · member_card(code): the scan screen's read of a member — name, points, founding, the credit, and what they
--     ordered in the app today (cups, and packs for today's pickup), which stamp themselves. Staff only, as
--     member_by_code (0132), which stays for any older page.
--   · award_manual_point: the same stamp, now signed by who gave it (loyalty_ledger.by_user, 0387) and noted as a
--     walk-up purchase.
--   · credit_spends: credit used at the window, one row each, with who took it off. spend_credit(code, cents) is the
--     scan screen's "Use credit": staff only, the profile locked first (two phones cannot spend it twice), refused
--     when there is none or less than asked; all of it when no amount is named. profiles.credit_cents is what is left.
-- Untouched: the referral grant (0013), the crew's member editor (admin_set_member), member_by_code, every reader of
-- points and credit_cents.
--
-- ORDER. Paste it before the deploy that reads it. Until it is pasted the scan screen falls back to member_by_code
-- (no app orders line, no credit button) and nothing else changes.
-- existing rows: none written.
-- changelog: below.

create or replace function public.member_card(p_code text) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare p public.profiles%rowtype; today date := (now() at time zone 'America/New_York')::date; cups int; orders int; packs int;
begin
  if not public.is_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  select * into p from public.profiles where referral_code = p_code or id::text = p_code limit 1;
  if p.id is null then return null; end if;
  select count(*), coalesce(sum(greatest(coalesce(array_length(o.items, 1), 1), 1)), 0) into orders, cups
    from public.orders o
   where o.user_id = p.id and o.status <> 'void' and (o.created_at at time zone 'America/New_York')::date = today;
  select count(*) into packs from public.drop_orders d
   where d.user_id = p.id and d.drop_date = today and d.canceled_at is null;
  return jsonb_build_object('display_name', p.display_name, 'points', coalesce(p.points, 0), 'founding_member', coalesce(p.founding_member, false),
    'credit_cents', greatest(coalesce(p.credit_cents, 0), 0), 'orders_today', orders, 'cups_today', cups, 'packs_today', packs);
end $$;
revoke all on function public.member_card(text) from public, anon, authenticated;
grant execute on function public.member_card(text) to authenticated;
comment on function public.member_card(text) is
  'The crew''s scan screen (0389, app/scan): a member by their card code — name, points, credit, and the app orders of today that stamp themselves. Staff only.';

create or replace function public.award_manual_point(p_code text) returns int
  language plpgsql security definer set search_path = public as $$
declare uid uuid; new_points int;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  select p.id into uid from public.profiles p
    where p.referral_code = p_code or p.id::text = p_code
    limit 1;
  if uid is null then return null; end if;
  insert into public.loyalty_ledger (user_id, channel, kind, points, note, by_user)
    values (uid, 'scan', 'award', 1, 'walk-up purchase, stamped at the window', auth.uid());
  select points into new_points from public.profiles where id = uid;
  return new_points;
end $$;

-- Kept for the books when an account is erased — no longer the member's, with nothing about them in it (0353's rule
-- for orders): the money a discount took off stays counted.
create table if not exists public.credit_spends (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  user_id     uuid references auth.users(id) on delete set null,
  cents       integer not null check (cents > 0),
  by_user     uuid references auth.users(id) on delete set null,   -- the crew member who took it off
  created_at  timestamptz not null default now()
);
create index if not exists credit_spends_user on public.credit_spends (user_id, created_at desc);
comment on table public.credit_spends is
  'Referral credit used at the window (0389): one row each, with who took it off. Written only by spend_credit.';
alter table public.credit_spends enable row level security;
drop policy if exists "credit spends own read" on public.credit_spends;
create policy "credit spends own read" on public.credit_spends for select
  using (user_id = (select auth.uid()) or (select public.is_staff()));
drop trigger if exists stamp_tenant_tg on public.credit_spends;
create trigger stamp_tenant_tg before insert on public.credit_spends for each row execute function public.stamp_tenant();
drop policy if exists "tenant isolation" on public.credit_spends;
create policy "tenant isolation" on public.credit_spends as restrictive for all
  using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
revoke all on public.credit_spends from public, anon;
revoke insert, update, delete, truncate on public.credit_spends from authenticated;
grant select on public.credit_spends to authenticated;

create or replace function public.spend_credit(p_code text, p_cents integer default null) returns integer
  language plpgsql security definer set search_path = public as $$
declare uid uuid; cur int; take int;
begin
  if not public.is_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  select p.id, greatest(coalesce(p.credit_cents, 0), 0) into uid, cur from public.profiles p
   where p.referral_code = p_code or p.id::text = p_code
   limit 1
   for update;
  if uid is null then return null; end if;
  take := coalesce(p_cents, cur);
  if cur <= 0 or take <= 0 then raise exception 'no credit to use' using errcode = 'P0001'; end if;
  if take > cur then raise exception 'not that much credit' using errcode = 'P0001'; end if;
  insert into public.credit_spends (user_id, tenant_id, cents, by_user)
    select uid, p.tenant_id, take, auth.uid() from public.profiles p where p.id = uid;
  update public.profiles set credit_cents = cur - take where id = uid;
  return take;
end $$;
revoke all on function public.spend_credit(text, integer) from public, anon, authenticated;
grant execute on function public.spend_credit(text, integer) to authenticated;
comment on function public.spend_credit(text, integer) is
  'The crew''s scan screen (0389, app/scan): a member''s referral credit taken off at the window — all of it unless an amount is named. Staff only; refused when there is none; the profile locked first. Returns the cents taken off.';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('One purchase, one stamp — and credit you can use','fix','Loyalty',
   'App orders stamp themselves when they''re picked up, and the member card used to say to scan for a stamp too — so one cup could earn two. The card now says scan for walk-up cups, and the crew''s scan screen shows what a member ordered in the app today. Referral credit can be spent now: the crew sees it on the scan screen and takes it off at the window in one tap, and your account says so.',
   '2026-10-12', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select has_function_privilege('anon', 'public.member_card(text)', 'execute');                  -- f
--   select has_function_privilege('anon', 'public.spend_credit(text, integer)', 'execute');        -- f
--   select relrowsecurity from pg_class where oid = 'public.credit_spends'::regclass;              -- t
select public.record_migration('0389_one_purchase_one_stamp_and_credit_at_the_window');

-- ============================================================
-- 0390_a_refund_takes_its_stamps_back.sql
-- ============================================================
-- ── 0390 — A REFUND TAKES ITS STAMPS BACK, AND A CUP KEEPS ITS TIP ─────────────────────────────────────────────────
-- 2026-10-12. H9 of the customer frontend audit, release C1 (the owner approved the release, "yes to all improvements").
--
-- WHY. A refunded cup or pack kept its stamps: a refund issued in Square reached this database (0330, the webhook's
-- refund branch) but was matched to shop orders only, so a cup, a pack or a delivery refunded in full went on
-- counting toward a free cup. And a cup's tip was charged and kept nowhere: orders.total_cents is the goods, so a
-- refund of goods and tip could not be told from a refund of the goods alone, and the books had no tips at all.
--
-- WHAT.
--   · orders.tip_cents — the tip charged with a cup order (/api/checkout writes it; 0 for pay at pickup and for every
--     order before this). The charge was always total_cents + tip_cents.
--   · square_refunds.channel, channel_order_id — every refund matched to its order by the payment it refunds: a shop
--     order, a cup, a pack (its reservation's payment, or a difference a pack change charged — 0388), a delivery.
--     Matched as the row is written (square_refund_match, before insert or update), and once here for the rows
--     already kept.
--   · When a refund completes and the order's money is back — a cup's or a delivery's goods (total_cents), a pack's
--     every payment in (what it holds now, plus what its changes refunded, plus a charge given back) — the stamps that
--     order earned come off, once (the ledger's 'clawback', one per order, as a void takes them: 0229). A partial
--     refund keeps them. A refund of a pack that was never picked up has no stamps to take.
-- Untouched: the webhook's own writes and its shop alert; refund_amount_cents (0313's, the operator's account); every
-- award and clawback rule of 0229. Refunds already kept are matched, not acted on: no balance changes for the past.
--
-- ORDER. Paste it before the deploy that writes tip_cents. Pasted after, nothing breaks: until it is here the cup
-- checkout writes its order without the tip (lib/schemaSkew.writeAcrossSkew, the one column named).
-- existing rows: square_refunds rows get their channel (no stamps move); orders get tip_cents 0.
-- changelog: below.

alter table public.orders add column if not exists tip_cents integer not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_tip_cents_check') then
    alter table public.orders add constraint orders_tip_cents_check check (tip_cents >= 0);
  end if;
end $$;
comment on column public.orders.tip_cents is
  'The tip charged with this cup order (0390). The card was charged total_cents + tip_cents; total_cents is the goods.';

alter table public.square_refunds add column if not exists channel text;
alter table public.square_refunds add column if not exists channel_order_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'square_refunds_channel_check') then
    alter table public.square_refunds add constraint square_refunds_channel_check
      check (channel is null or channel in ('shop', 'cup', 'pickup', 'delivery'));
  end if;
end $$;
create index if not exists square_refunds_channel_order on public.square_refunds (channel, channel_order_id);

-- The order a refund belongs to, by the payment it refunds. Null when no order here carries that payment.
create or replace function public.refund_order_of(p_payment_id text, out channel text, out order_id uuid)
  language plpgsql stable set search_path = public as $$
begin
  select 'shop', s.id into channel, order_id from public.shop_orders s where s.payment_id = p_payment_id limit 1;
  if order_id is not null then return; end if;
  select 'cup', o.id into channel, order_id from public.orders o where o.payment_id = p_payment_id limit 1;
  if order_id is not null then return; end if;
  select 'pickup', d.id into channel, order_id from public.drop_orders d where d.payment_id = p_payment_id limit 1;
  if order_id is not null then return; end if;
  select 'pickup', c.drop_order_id into channel, order_id from public.drop_order_changes c where c.charge_payment_id = p_payment_id limit 1;
  if order_id is not null then return; end if;
  select 'delivery', v.id into channel, order_id from public.delivery_orders v where v.payment_id = p_payment_id limit 1;
  if order_id is null then channel := null; end if;
end $$;

-- What a pack took in, in all: what it holds now, plus what its applied changes refunded, plus any charge a change
-- made and gave back (0388's stale) — so a refund of all of it is "the money is back", and a change's own refund is not.
create or replace function public.pack_paid_in(p_order uuid) returns integer
  language sql stable set search_path = public as $$
  select case when d.paid then d.total_cents else 0 end
       + coalesce((select sum((x->>'cents')::int) from public.drop_order_changes c, jsonb_array_elements(c.refunds) x
                    where c.drop_order_id = d.id and c.state = 'done'), 0)
       + coalesce((select sum(c.diff_cents) from public.drop_order_changes c
                    where c.drop_order_id = d.id and c.state = 'stale' and c.charge_payment_id is not null), 0)
    from public.drop_orders d where d.id = p_order
$$;

-- Both trigger functions are definers: the webhook writes refunds with the service role, and what they read (every
-- order table) and write (the ledger) is no business of whoever wrote the refund row.
create or replace function public.square_refund_match() returns trigger
  language plpgsql security definer set search_path = public as $$
declare m record;
begin
  if new.channel is null and new.payment_id is not null then
    select * into m from public.refund_order_of(new.payment_id);
    new.channel := m.channel;
    new.channel_order_id := m.order_id;
  end if;
  return new;
end $$;

-- A refund that completes: when the order's money is all back, its stamps come off — once.
create or replace function public.square_refund_claws() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_in integer; v_back integer;
begin
  if new.status is distinct from 'COMPLETED' or new.channel is null or new.channel = 'shop' or new.channel_order_id is null then return new; end if;
  if new.channel = 'cup' then
    select o.user_id, o.total_cents into v_user, v_in from public.orders o where o.id = new.channel_order_id;
  elsif new.channel = 'delivery' then
    select v.user_id, v.total_cents into v_user, v_in from public.delivery_orders v where v.id = new.channel_order_id;
  else
    select d.user_id, public.pack_paid_in(d.id) into v_user, v_in from public.drop_orders d where d.id = new.channel_order_id;
  end if;
  if v_user is null or coalesce(v_in, 0) <= 0 then return new; end if;
  select coalesce(sum(r.amount_cents), 0) into v_back from public.square_refunds r
   where r.channel = new.channel and r.channel_order_id = new.channel_order_id and r.status = 'COMPLETED';
  if v_back < v_in then return new; end if;
  insert into public.loyalty_ledger (user_id, order_id, channel, kind, points, note)
  select l.user_id, l.order_id, l.channel, 'clawback', -l.points, 'refunded in Square'
    from public.loyalty_ledger l
   where l.user_id = v_user and l.order_id = new.channel_order_id and l.channel = new.channel and l.kind = 'award'
  on conflict (user_id, order_id, channel, kind) where order_id is not null do nothing;
  return new;
end $$;

drop trigger if exists square_refund_match_tg on public.square_refunds;
create trigger square_refund_match_tg before insert or update on public.square_refunds
  for each row execute function public.square_refund_match();
drop trigger if exists square_refund_claws_tg on public.square_refunds;
create trigger square_refund_claws_tg after insert or update of status, amount_cents on public.square_refunds
  for each row execute function public.square_refund_claws();

revoke all on function public.refund_order_of(text) from public, anon, authenticated;
revoke all on function public.pack_paid_in(uuid) from public, anon, authenticated;
revoke all on function public.square_refund_match() from public, anon, authenticated;
revoke all on function public.square_refund_claws() from public, anon, authenticated;

-- The refunds already kept: matched to their orders, nothing else. Updating the channel alone does not fire the
-- clawback trigger (it watches status and amount), so no balance moves for the past.
update public.square_refunds r set channel = m.channel, channel_order_id = m.order_id
  from (select x.id, (public.refund_order_of(x.payment_id)).* from public.square_refunds x where x.channel is null) m
 where r.id = m.id and m.channel is not null;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A refund takes its stamps back','fix','Loyalty',
   'A cup, a pack or a delivery refunded in full in Square kept the stamps it earned, because refunds reached only shop orders here. Now every refund is matched to its order, and when an order''s money is all back its stamps come off, once — a partial refund keeps them, and refunds from before this are left as they were. A cup''s tip is kept with its order now, so the books can tell the tip from the drinks.',
   '2026-10-12', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from information_schema.columns where table_name = 'orders' and column_name = 'tip_cents';      -- 1
--   select channel, count(*) from public.square_refunds group by 1;                                                  -- matched
--   select count(*) from pg_trigger where tgname in ('square_refund_match_tg', 'square_refund_claws_tg');           -- 2
select public.record_migration('0390_a_refund_takes_its_stamps_back');
