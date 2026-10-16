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
-- pending-from: 0414
-- generated-at: 2026-10-16
-- pending-count: 6
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- held: 0376_nobody_on_the_pass_during_service_is_an_alert.sql — NOT in this file; applied by hand once the condition in its header is met
-- ============================================================
-- 0409_money_back_is_all_of_it.sql
-- ============================================================
-- ── 0409 — MONEY BACK IS ALL OF IT: A CANCELED ORDER'S REFUND NAMES THE TIP ─────────────────────────────────────────
-- 2026-10-15. R7 of the customer re-audit — the money that went back short (Ryan, 2026-10-15: "Keep working to improve
-- to a 10"). Paste into Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY. A card pays for a cup order's drinks and its tip in one charge (orders.total_cents + orders.tip_cents, 0390), and
-- a canceled order is refunded by hand in Square, from the alert that says how much. Both alerts the database raises
-- said the drinks' total: a member's cancel (cancel_own_order, 0341) and a guest's, from the order page
-- (cancel_by_ticket, 0396). The crew refunded what they were told and the tip stayed on the card — and the order page,
-- which counts the tip, said "The refund is on its way to your card" for good: a refund short of the charge is never
-- "in full", which is what the page, the email and the Terms promise.
--
-- WHAT. Both alerts say what the card was charged — the drinks and the tip, and which is which (refund_words) — and are
-- the alert the Pass's void raises (components/pass/ThePass): kind refund_needed, about the order, one per order
-- (alert_open_once), with Marked refunded on its card and Money › Get paid behind it. The guest's says who canceled from
-- where, as it did. Who may cancel, and when, are 0341's and 0396's, unchanged — and so is the unpaid cancel's FYI.
--
-- existing rows: cancel_own_order — the refund alerts it already wrote carry no order to read a tip from (no subject);
-- an open one is closed by whoever refunds it, in Square, where the charge shows in full.
-- existing rows: cancel_by_ticket — the same: its alerts name an order by its four characters only, and Square shows
-- the charge in full.
-- changelog: below.

-- ── what the card was charged, said one way ────────────────────────────────────────────────────────────────────────
create or replace function public.refund_words(p_drinks integer, p_tip integer) returns text
  language sql immutable set search_path = public as $$
  select '$' || to_char(((coalesce(p_drinks, 0) + greatest(coalesce(p_tip, 0), 0)) / 100.0)::numeric, 'FM999990.00')
      || case when coalesce(p_tip, 0) > 0
              then ' (drinks $' || to_char((coalesce(p_drinks, 0) / 100.0)::numeric, 'FM999990.00')
                   || ' + tip $' || to_char((p_tip / 100.0)::numeric, 'FM999990.00') || ')'
              else '' end
$$;
comment on function public.refund_words(integer, integer) is
  'What a cup order''s card was charged, for a refund alert (0409): "$11.50 (drinks $10.00 + tip $1.50)", or "$10.00" with no tip.';
revoke all on function public.refund_words(integer, integer) from public, anon, authenticated;

-- ── a member's cancel (0341's, the alert restated) ─────────────────────────────────────────────────────────────────
create or replace function public.cancel_own_order(p_order uuid) returns boolean
  language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  -- FOR UPDATE added: cancel_own_reservation (0136) and cancel_own_delivery (0139) already lock
  -- their row here; this one didn't, so two concurrent cancels (double-tap / client retry) could
  -- both read status='new' before either write landed and both insert a refund alert.
  select * into o from public.orders where id = p_order and user_id = auth.uid() for update;
  if not found then return false; end if;      -- not yours (or doesn't exist)
  if o.status <> 'new' then return false; end if;  -- too late: already preparing / ready / done / void
  if o.collected_at is not null then return false; end if;  -- paid at the window (0341): the crew cancels it

  update public.orders set status = 'void' where id = p_order;

  -- A card-paid order that's canceled needs a refund in Square — all of what the card was charged (0409). One alert
  -- per order, the Pass's kind: Marked refunded on its card.
  if o.paid then
    perform public.alert_open_once('refund_needed', o.id, 'critical', 'money',
      'Customer canceled a paid order — refund needed',
      'A member canceled order #' || upper(substr(o.id::text, 1, 4)) || '. Refund '
        || public.refund_words(o.total_cents, o.tip_cents) || ' in Square — all of the charge.',
      '/crew?s=money&a=pay');
  end if;
  return true;
end $$;
revoke all on function public.cancel_own_order(uuid) from public, anon, authenticated;
grant execute on function public.cancel_own_order(uuid) to authenticated;

-- ── a guest's cancel, from the ticket (0396's, the alert restated) ────────────────────────────────────────────────────
create or replace function public.cancel_by_ticket(p_ticket uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o     public.orders;
  v_no  text;
  v_who text;
begin
  select * into o from public.orders where ticket = p_ticket for update;
  if not found then
    raise exception 'That ticket isn''t one of ours.' using errcode = 'PT404';   -- a 4xx, never a 5xx (0360)
  end if;
  -- the member's rule (cancel_own_order, 0341): only while it is In, never once paid at the window
  if o.status <> 'new' then return jsonb_build_object('ok', false, 'outcome', 'too_late', 'now', o.status); end if;
  if o.collected_at is not null then return jsonb_build_object('ok', false, 'outcome', 'at_window'); end if;

  update public.orders set status = 'void' where id = o.id;

  v_no  := '#' || upper(substr(o.id::text, 1, 4));
  v_who := coalesce(nullif(split_part(btrim(coalesce(o.customer, '')), ' ', 1), ''), 'A guest');
  if coalesce(o.paid, false) then
    perform public.alert_open_once('refund_needed', o.id, 'critical', 'money',
      'Customer canceled a paid order — refund needed',
      v_who || ' canceled order ' || v_no || ' from its order page. Refund '
        || public.refund_words(o.total_cents, o.tip_cents) || ' in Square — all of the charge.',
      '/crew?s=money&a=pay');
  else
    insert into public.alerts (severity, category, title, body, link)
    values ('fyi', 'order', 'Canceled: ' || v_who || '''s cup order',
            v_who || ' canceled order ' || v_no || ' from its order page. Nothing was charged — no refund needed.',
            '/crew');
  end if;
  return jsonb_build_object('ok', true, 'outcome', 'canceled', 'paid', coalesce(o.paid, false));
end $$;
revoke all on function public.cancel_by_ticket(uuid) from public, anon, authenticated;
grant execute on function public.cancel_by_ticket(uuid) to anon, authenticated;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A canceled order is refunded in full — the tip too', 'fix', 'Ordering',
   'When a card-paid cup order is canceled — by you, from the app or its order page, or by the crew — the crew is told the whole amount the card was charged, the tip included, so that is what comes back. It used to name the drinks only.',
   '2026-10-15', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select public.refund_words(1000, 150) = '$11.50 (drinks $10.00 + tip $1.50)';                              -- true
--   select prosrc like '%refund_words(o.total_cents, o.tip_cents)%' from pg_proc where proname = 'cancel_own_order'; -- true
--   select prosrc like '%refund_words(o.total_cents, o.tip_cents)%' from pg_proc where proname = 'cancel_by_ticket'; -- true
--   select has_function_privilege('anon', 'public.cancel_by_ticket(uuid)', 'execute');                          -- true
select public.record_migration('0409_money_back_is_all_of_it');

-- ============================================================
-- 0410_your_own_card_is_another_crew_members.sql
-- ============================================================
-- ── 0410 — YOUR OWN CARD IS ANOTHER CREW MEMBER'S: ITS FREE CUP AND ITS CREDIT TOO ──────────────────────────────────
-- 2026-10-15. R7 of the customer re-audit (Ryan, 2026-10-15: "Keep working to improve to a 10"). Paste into Supabase →
-- SQL Editor → Run. A second run changes nothing.
--
-- WHY. 0392 (A1 of the account audit) refused a crew member stamping their own card: award_manual_point says "your own
-- card: another crew member stamps it". Giving a card's free cup (redeem_free_cup, 0387) and taking its referral credit
-- off at the window (spend_credit, 0389) were written before that rule and never took it: anyone on the crew could give
-- themselves a free cup, or ring up their own credit, with nobody else at the window.
--
-- WHAT. Both refuse the caller's own card, in 0392's words — another crew member gives its free cup and takes its
-- credit off — before anything is read or written. Everything else is 0387's and 0389's, unchanged: staff only, the
-- profile locked first, a free cup only at ten points, credit only up to what the card holds, and the amount the crew
-- names (the scan screen names it now: the order's total, never more than the card holds).
-- changelog: below.

create or replace function public.redeem_free_cup(p_code text) returns int
  language plpgsql security definer set search_path = public as $$
declare uid uuid; cur int; after int;
begin
  if not public.is_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  select p.id, coalesce(p.points, 0) into uid, cur from public.profiles p
   where p.referral_code = p_code or p.id::text = p_code
   limit 1
   for update;
  if uid is null then return null; end if;
  -- 0392's rule, for a free cup (0410): never your own card.
  if uid = auth.uid() then
    raise exception 'your own card: another crew member gives its free cup' using errcode = '42501';
  end if;
  if cur < 10 then raise exception 'no free cup to redeem' using errcode = 'P0001'; end if;
  insert into public.loyalty_ledger (user_id, channel, kind, points, note, by_user)
    values (uid, 'scan', 'redeem', -10, 'free cup redeemed at the window', auth.uid());
  select coalesce(points, 0) into after from public.profiles where id = uid;
  return after;
end $$;
revoke all on function public.redeem_free_cup(text) from public, anon, authenticated;
grant execute on function public.redeem_free_cup(text) to authenticated;
comment on function public.redeem_free_cup(text) is
  'The crew''s scan screen (0387, app/scan): a free cup given at the window — one loyalty_ledger row of −10, written by who redeemed it. Staff only, never on the caller''s own card (0410); refused under ten points; the profile locked first.';

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
  -- 0392's rule, for credit (0410): never your own card.
  if uid = auth.uid() then
    raise exception 'your own card: another crew member takes its credit off' using errcode = '42501';
  end if;
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
  'The crew''s scan screen (0389, app/scan): a member''s referral credit taken off at the window — the amount named (the order''s total, at most what the card holds; app/scan names it since 0410), else all of it. Staff only, never on the caller''s own card (0410); refused when there is none; the profile locked first. Returns the cents taken off.';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Credit is spent by the order, and never on your own card', 'fix', 'Loyalty',
   'At the window the crew enters the order''s total and only that much of your credit is used — the rest stays on your card. It used to take the whole balance. And no one on the crew can give their own card a free cup or use its credit: another crew member does, as with stamps.',
   '2026-10-15', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select prosrc like '%uid = auth.uid()%' from pg_proc where proname = 'redeem_free_cup';                     -- true
--   select prosrc like '%uid = auth.uid()%' from pg_proc where proname = 'spend_credit';                        -- true
--   select has_function_privilege('anon', 'public.spend_credit(text, integer)', 'execute');                    -- false
select public.record_migration('0410_your_own_card_is_another_crew_members');

-- ============================================================
-- 0411_a_referral_follows_its_order.sql
-- ============================================================
-- ── 0411 — A REFERRAL FOLLOWS ITS ORDER: UNDONE, ITS $5 + $5 COME BACK ────────────────────────────────────────────
-- 2026-10-15. R7 of the customer re-audit (Ryan, 2026-10-15: "Keep working to improve to a 10"). Paste into Supabase →
-- SQL Editor → Run. A second run changes nothing.
--
-- WHY. A referred member's first order of $5 or more, handed over, gives them and the member who referred them $5 of
-- credit each (credit_wallet, 0229 — once per referee: referral_events). When that order was voided or refunded in full
-- its stamps came off (claw_wallet, 0229; square_refund_claws, 0390/0400) and the $10 stayed — spendable at the window
-- (0389) — and because the referral was marked converted, the referee's next real order never counted. A void took the
-- stamps back only from a picked-up order: Recall (done → ready) and then Void kept both. And a link from a friend,
-- opened by a member who had been buying for months, made their next order a "first order": $5 each.
--
-- WHAT.
--   · Whenever the order that converted a referral has its stamps taken back — voided, refunded in full in Square, or a
--     pickup or delivery marked back (0229: an order whose stamps came off nets zero until the owner says otherwise) —
--     the referral is undone with it: each side's $5 comes off, as far as it is still on the card (credit already spent
--     at the window was spent in good faith, and a balance never goes below zero); the referee's referral is open again;
--     the event says when; and the change log (admin_audit, 0260) has a line with the amounts.
--   · The next converting order gives back what came off — no more: a $5 already spent is not paid out a second time,
--     however many times an order is undone (referral_stakes: what each side's next conversion gives and the most an
--     undoing takes — private, the database's own, so neither side reads the other's balance from it).
--   · A void takes the stamps back from any order that earned them — a recalled one too (award_points). A take-back is
--     never refused: stamps already given as a free cup leave the balance below zero until they are earned back, as the
--     ledger was built to (0229: "the counter is the sum"). 0042's guard refused the void instead — the stop canceled
--     with it, a refund that never recorded.
--   · A referral attaches to an account that has not bought yet (attach_referral): a first order is a first order.
-- Nothing else about stamps, credit or referrals changes: the $5 floor, one conversion per referee at a time, the
-- ledger's once-per-order award and clawback.
-- changelog: below.

alter table public.referral_events add column if not exists reversed_at timestamptz;
comment on column public.referral_events.reversed_at is
  'When the order that converted this referral was undone — voided, refunded in full, or marked back — and its credit taken back (0411). Null: it stands.';

-- What each side's next conversion gives back, and the most an undoing takes: the $5 the first time (no row), then what
-- the last undoing took. The database's own — RLS on, no policy, nothing granted: the two sides read referral_events,
-- and what came off one card is not the other's to read.
create table if not exists public.referral_stakes (
  event_id       uuid primary key references public.referral_events(id) on delete cascade,
  referee_cents  integer not null check (referee_cents between 0 and 500),
  referrer_cents integer not null check (referrer_cents between 0 and 500),
  updated_at     timestamptz not null default now()
);
alter table public.referral_stakes enable row level security;
revoke all on table public.referral_stakes from public, anon, authenticated;
comment on table public.referral_stakes is
  'A referral''s stake per side (0411): what its next conversion gives back and the most an undoing takes. No row: the $5 grant. Private to the database — written and read only by referral_follows_its_order and credit_wallet.';

-- ── the referral, undone with its order ────────────────────────────────────────────────────────────────────────────
create or replace function public.referral_follows_its_order() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  e         public.referral_events%rowtype;
  stake_fee integer;
  stake_ref integer;
  have_fee  integer;
  have_ref  integer;
  back_fee  integer;
  back_ref  integer;
begin
  if new.kind <> 'clawback' or new.order_id is null then return new; end if;
  select * into e from public.referral_events
   where referee = new.user_id and converting_order = new.order_id
     and coalesce(converting_channel, 'cup') = new.channel and reversed_at is null
   for update;
  if not found then return new; end if;

  -- The most this undoing takes from each side: what this conversion gave.
  select s.referee_cents, s.referrer_cents into stake_fee, stake_ref from public.referral_stakes s where s.event_id = e.id for update;
  stake_fee := coalesce(stake_fee, e.referee_credit_cents, 500);
  stake_ref := coalesce(stake_ref, e.referrer_credit_cents, 500);
  -- What is still there, at most that: never below zero.
  select greatest(coalesce(credit_cents, 0), 0) into have_fee from public.profiles where id = e.referee for update;
  select greatest(coalesce(credit_cents, 0), 0) into have_ref from public.profiles where id = e.referrer for update;
  back_fee := least(coalesce(have_fee, 0), stake_fee);
  back_ref := least(coalesce(have_ref, 0), stake_ref);
  update public.profiles set credit_cents = greatest(coalesce(credit_cents, 0) - back_fee, 0), referral_converted = false
   where id = e.referee;
  update public.profiles set credit_cents = greatest(coalesce(credit_cents, 0) - back_ref, 0)
   where id = e.referrer;
  -- The next conversion gives back what came off, and no more.
  insert into public.referral_stakes as s (event_id, referee_cents, referrer_cents, updated_at)
  values (e.id, back_fee, back_ref, now())
  on conflict (event_id) do update set referee_cents = excluded.referee_cents, referrer_cents = excluded.referrer_cents, updated_at = now();
  update public.referral_events set reversed_at = now() where id = e.id;

  insert into public.admin_audit (actor, action, table_name, row_pk, summary, old_row, new_row)
  values (auth.uid(), 'UPDATE', 'referral_events', e.id::text,
          format('referral undone with its order (%s): $%s back from the referee, $%s from the referrer',
                 coalesce(nullif(new.note, ''), 'order undone'),
                 to_char((back_fee / 100.0)::numeric, 'FM999990.00'), to_char((back_ref / 100.0)::numeric, 'FM999990.00')),
          jsonb_build_object('converting_order', e.converting_order, 'converting_channel', e.converting_channel, 'reversed', false),
          jsonb_build_object('converting_order', e.converting_order, 'converting_channel', e.converting_channel, 'reversed', true,
                             'referee_back_cents', back_fee, 'referrer_back_cents', back_ref));
  return new;
end $$;
revoke all on function public.referral_follows_its_order() from public, anon, authenticated;
comment on function public.referral_follows_its_order() is
  'The referral an undone order converted, undone with it (0411): each side''s credit back as far as it is still on the card and no more than this conversion gave, the referral open again, its stake kept for the next conversion, the change log saying so.';
drop trigger if exists loyalty_clawback_referral on public.loyalty_ledger;
create trigger loyalty_clawback_referral after insert on public.loyalty_ledger
  for each row when (new.kind = 'clawback') execute function public.referral_follows_its_order();

-- ── a converting order after an undone one gives back what came off (0229's, the event re-stamped) ─────────────────
create or replace function public.credit_wallet(p_user_id uuid, p_points int, p_total_cents int, p_order_id uuid, p_channel text)
returns void language plpgsql security definer set search_path = public as $$
declare ref uuid; ev public.referral_events%rowtype; give_fee int; give_ref int; grant_cents int := 500; floor_cents int := 500;
begin
  if p_user_id is null then return; end if;

  insert into public.loyalty_ledger (user_id, order_id, channel, kind, points)
  values (p_user_id, p_order_id, coalesce(p_channel, 'unknown'), 'award', greatest(coalesce(p_points, 1), 1))
  on conflict (user_id, order_id, channel, kind) where order_id is not null do nothing;
  if not found then return; end if;  -- already awarded for this order+channel: a replay, not a sale

  if p_total_cents >= floor_cents then
    select referred_by into ref from public.profiles where id = p_user_id and referred_by is not null and referral_converted = false;
    if ref is not null then
      select * into ev from public.referral_events where referee = p_user_id for update;
      if not found then
        update public.profiles set referral_converted = true, credit_cents = credit_cents + grant_cents where id = p_user_id;
        update public.profiles set credit_cents = credit_cents + grant_cents where id = ref;
        insert into public.referral_events (referrer, referee, converting_order, converting_channel, referrer_credit_cents, referee_credit_cents)
          values (ref, p_user_id, p_order_id, p_channel, grant_cents, grant_cents);
      elsif ev.reversed_at is not null then
        -- Its converting order was undone (0411): this one converts it again, giving back what the undoing took.
        select s.referee_cents, s.referrer_cents into give_fee, give_ref from public.referral_stakes s where s.event_id = ev.id for update;
        give_fee := coalesce(give_fee, 0);
        give_ref := coalesce(give_ref, 0);
        update public.profiles set referral_converted = true, credit_cents = credit_cents + give_fee where id = p_user_id;
        update public.profiles set credit_cents = credit_cents + give_ref where id = ev.referrer;
        update public.referral_events
           set converting_order = p_order_id, converting_channel = p_channel, reversed_at = null
         where id = ev.id;
        insert into public.admin_audit (actor, action, table_name, row_pk, summary, old_row, new_row)
        values (auth.uid(), 'UPDATE', 'referral_events', ev.id::text,
                format('referral converted again: $%s back to the referee, $%s to the referrer',
                       to_char((give_fee / 100.0)::numeric, 'FM999990.00'), to_char((give_ref / 100.0)::numeric, 'FM999990.00')),
                jsonb_build_object('converting_order', ev.converting_order, 'reversed', true),
                jsonb_build_object('converting_order', p_order_id, 'reversed', false, 'referee_given_cents', give_fee, 'referrer_given_cents', give_ref));
      end if;
    end if;
  end if;
end $$;
revoke execute on function public.credit_wallet(uuid, int, int, uuid, text) from public, anon, authenticated;

-- ── a void takes the stamps back however it got there (0229's, one condition wider) ─────────────────────────────────
create or replace function public.award_points() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' and new.user_id is not null then
    perform public.credit_wallet(new.user_id, coalesce(array_length(new.items, 1), 1), new.total_cents, new.id, 'cup');
  elsif new.status = 'void' and old.status is distinct from 'void' and new.user_id is not null then
    -- A void takes the points back — from a picked-up order, and from one recalled first (done → ready → void), which
    -- kept them until 0411. An order never handed over earned nothing, and claw_wallet writes nothing for it.
    -- done -> preparing/ready corrections keep the award (it can never double on the way back to done — the ledger refuses).
    perform public.claw_wallet(new.user_id, new.id, 'cup');
  end if;
  return new;
end $$;
-- the trigger already exists (0012) — redefining the function is enough.

-- ── a take-back is never refused (0229: the counter is the sum; readers show an empty card below zero) ──────────────
alter table public.profiles drop constraint if exists profiles_points_nonneg;

-- ── a first order is a first order: a referral attaches before an account has bought (0013's, one condition more) ───
create or replace function public.attach_referral(code text)
returns void language plpgsql security definer set search_path = public as $$
declare ref uuid;
begin
  if code is null or btrim(code) = '' then return; end if;
  select id into ref from public.profiles where referral_code = upper(btrim(code));
  if ref is null or ref = auth.uid() then return; end if;
  -- Already a customer — a stamp for any purchase, by any channel — is not a friend's first order (0411).
  if exists (select 1 from public.loyalty_ledger l where l.user_id = auth.uid() and l.kind = 'award') then return; end if;
  update public.profiles
    set referred_by = ref
    where id = auth.uid() and referred_by is null and referral_converted = false;
end; $$;
revoke all on function public.attach_referral(text) from public, anon, authenticated;
grant execute on function public.attach_referral(text) to authenticated;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A referral follows its order', 'fix', 'Loyalty',
   'The $5 you and a friend you referred each get comes from their first order. If that order is canceled or refunded, the $5 comes back off both cards (what''s still there), and their next order gives it back — a $5 already spent is never paid twice. And a friend''s link counts only for someone who hasn''t bought from us yet.',
   '2026-10-15', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from pg_trigger where tgname = 'loyalty_clawback_referral';                                   -- 1
--   select relrowsecurity from pg_class where oid = 'public.referral_stakes'::regclass;                           -- true
--   select has_table_privilege('authenticated', 'public.referral_stakes', 'select');                              -- false
--   select count(*) from pg_constraint where conname = 'profiles_points_nonneg';                                  -- 0
--   select prosrc like '%l.kind = ''award''%' from pg_proc where proname = 'attach_referral';                     -- true
select public.record_migration('0411_a_referral_follows_its_order');

-- ============================================================
-- 0412_go_offline_stops_every_order.sql
-- ============================================================
-- ── 0412 — GO OFFLINE STOPS EVERY ORDER: A CITY'S SWITCH HOLDS IT CLOSED, AND NEVER KEEPS IT OPEN ────────────────
-- 2026-10-15. R7 of the customer re-audit (Ryan, 2026-10-15: "Keep working to improve to a 10"). Paste into Supabase →
-- SQL Editor → Run. A second run changes nothing.
--
-- WHY. Whether a city takes orders is market_live (0285): the city's own switch (markets.is_live) when it has one, else
-- the truck's (live_status — Live Ops' Go live and Go offline). The city's switch won. So once an owner had put a city
-- "live" from Settings › Locations & markets — an easy tap: a city that follows the truck showed "Not live" there — Go
-- offline cleared the truck and the city stayed live: with no stop to pour at, Pay took cards ("Ready in ~8 min", "At
-- the truck") while Live Ops said the truck was off the road, Find Us said it wasn't live and the concierge said it was
-- closed — until an owner found the city's switch and turned it off. An admin, who may Go offline, could not.
--
-- WHAT. A city's switch can hold it closed (false), and nothing more: null — and true, as an owner may have left it —
-- follow the truck. Taking orders is the truck live AND the city not held closed AND its opening day reached. Every
-- column of the view is 0285's, in its order; only is_live's rule changes — and one column more, at the end: held_closed,
-- the city's switch at false. Held closed is closed to every order, not only the "truck is live" kind: a stop under way
-- that nobody flipped live, and a stop's pre-order window, are open on their own (lib/ordering), and the ordering read
-- closes them for a held city — or one whose opening day has not come — with this. A city that runs its own truck one day
-- needs its own live pointer too (lib/orderingRead says so) — the day it does, its switch can mean "open" again.
-- changelog: below.

create or replace view public.market_live as
select m.slug                                                    as market,
       ((m.is_live is distinct from false)
         and coalesce(ls.is_live, false)
         and (m.opens_on is null or m.opens_on <= current_date))  as is_live,
       coalesce(m.preorder_lead_h, ls.preorder_lead_h, 4)         as preorder_lead_h,
       coalesce(m.pay_at_pickup,   ls.pay_at_pickup,   true)      as pay_at_pickup,
       m.opens_on,
       (m.opens_on is not null and m.opens_on > current_date)     as pre_launch,
       (m.is_live is not distinct from false)                     as held_closed
  from public.markets m
  left join (select is_live, preorder_lead_h, pay_at_pickup
               from public.live_status where id = 1) ls on true;

-- ── the readiness board's storefront check (0297's view, its first check only) ────────────────────────────────────
-- 0297 read market_live.is_live for "Storefront switched on", a blocking launch check — which, with is_live now the
-- truck's switch too, would block every city whenever the truck is offline and say "the company-wide switch is off and
-- this market has no override" of a city set to follow it. The check asks what a launch needs: the city is not held
-- closed and its day has come. Every other check is 0297's, word for word; security_invoker as 0321 set it.
create or replace view public.v_market_readiness with (security_invoker = on) as
with mk as (
  select m.slug, m.name, m.state, m.opens_on,
         -- Whether this city can take orders at all (0412): not held closed, and its opening day come. Whether the truck
         -- is live right now is Live Ops' to say, every hour of every day — not a launch check's.
         coalesce(ml.held_closed, false) as held,
         coalesce(ml.pre_launch, false)  as pre
    from public.markets m
    left join public.market_live ml on ml.market = m.slug
   where coalesce(m.active, true))

select m.slug as market, 'Launch' as area, 'Storefront switched on' as check_name,
       case when m.held or m.pre then 'blocked' else 'ready' end as status,
       case when m.held then 'Held closed in Settings › Locations & markets — no orders here until it is let go.'
            when m.pre
              then 'Not live yet — held until ' || to_char(m.opens_on, 'Mon FMDD, YYYY') || '.'
            else 'Takes orders whenever the truck is live (Live Ops).' end as detail,
       true as blocking
  from mk m

union all
select m.slug, 'Crew', 'Someone leads this market',
       case when count(c.id) > 0 then 'ready' else 'blocked' end,
       case when count(c.id) > 0
            then string_agg(coalesce(c.display_name, 'unnamed'), ', ') || ' leads it.'
            else 'No lead. Set one with set_market_lead so role changes and equity have an owner.' end,
       true
  from mk m
  left join public.v_market_crew c on c.leads_market = m.slug
 group by m.slug

union all
select m.slug, 'Compliance', 'Critical rules confirmed',
       -- count(f.id), never count(*): this is a LEFT JOIN, so a market with no matching rule still
       -- produces one row and count(*) would report 1. Counting the joined column is what makes
       -- "nothing recorded" distinguishable from "recorded and failing", which is the whole point.
       case when count(f.id) = 0 then 'unknown'
            when count(f.id) filter (where f.freshness <> 'fresh') > 0 then 'blocked'
            else 'ready' end,
       case when count(f.id) = 0
            then 'No critical rules recorded for ' || coalesce(m.state, 'this state') || ' at all.'
            when count(f.id) filter (where f.freshness <> 'fresh') > 0
            then count(f.id) filter (where f.freshness <> 'fresh')::text || ' of ' || count(f.id)::text ||
                 ' need re-checking: ' || string_agg(f.label, '; ') filter (where f.freshness <> 'fresh')
            else 'All ' || count(f.id)::text || ' confirmed within the last six months.' end,
       true
  from mk m
  left join public.v_compliance_freshness f
         on f.critical and (f.state = m.state or f.state is null)
 group by m.slug, m.state

union all
select m.slug, 'Prep', 'Every recipe line can be drawn',
       case when count(g.ingredient) = 0 then 'ready' else 'blocked' end,
       case when count(g.ingredient) = 0
            then 'Every ingredient in every live recipe resolves to a shelf here.'
            else count(g.ingredient)::text || ' cannot: ' || string_agg(g.ingredient, '; ') end,
       true
  from mk m
  left join public.v_recipe_ingredient_gaps g on g.market = m.slug
 group by m.slug

union all
select m.slug, 'Equipment', 'A vessel to brew in',
       case when coalesce(c.vessels, 0) > 0 then 'ready' else 'unknown' end,
       case when coalesce(c.vessels, 0) > 0
            then c.vessels::text || ' vessel(s); biggest single batch ' || c.largest_gal::text ||
                 ' gal, ' || c.total_gal::text || ' gal across all of them.'
            else 'No vessel recorded here. If the Toddys have arrived, add them so the planner knows the ceiling.' end,
       true
  from mk m
  left join lateral public.market_brew_capacity(m.slug) c on true

union all
select m.slug, 'Packaging', 'Bottles on the shelf',
       case when count(i.id) = 0 then 'unknown'
            when count(i.id) filter (where s.effective_on_hand > 0) > 0 then 'ready'
            else 'blocked' end,
       case when count(i.id) = 0 then 'No packaging item exists for this market.'
            when count(i.id) filter (where s.effective_on_hand > 0) = 0
            then 'Every packaging line is at zero.'
            else count(i.id) filter (where s.effective_on_hand > 0)::text || ' packaging line(s) in stock.' end,
       true
  from mk m
  left join public.inventory_items i on i.market = m.slug and i.kind = 'packaging'
  left join public.inventory_status s on s.name = i.name and s.market = i.market
 group by m.slug

union all
select m.slug, 'Prep', 'Ingredient shelves have stock',
       case when count(i.id) = 0 then 'unknown'
            when count(i.id) filter (where coalesce(s.effective_on_hand, 0) <= 0) > 0 then 'blocked'
            else 'ready' end,
       case when count(i.id) = 0 then 'No ingredient shelves exist for this market yet.'
            when count(i.id) filter (where coalesce(s.effective_on_hand, 0) <= 0) > 0
            then count(i.id) filter (where coalesce(s.effective_on_hand, 0) <= 0)::text || ' of ' ||
                 count(i.id)::text || ' at zero: ' ||
                 string_agg(i.name, '; ') filter (where coalesce(s.effective_on_hand, 0) <= 0)
            else 'All ' || count(i.id)::text || ' have stock.' end,
       true
  from mk m
  left join public.inventory_items i on i.market = m.slug and i.kind = 'ingredient'
  left join public.inventory_status s on s.name = i.name and s.market = i.market
 group by m.slug

union all
select m.slug, 'Prep', 'Every item says what kind it is',
       case when count(g.id) = 0 then 'ready' else 'blocked' end,
       case when count(g.id) = 0 then 'All items classified.'
            else count(g.id)::text || ' unclassified: ' || string_agg(g.name, '; ') end,
       false
  from mk m
  left join public.v_item_kind_gaps g on g.market = m.slug
 group by m.slug

union all
select m.slug, 'Prep', 'Every batch accounted for',
       case when count(u.batch_id) = 0 then 'ready' else 'blocked' end,
       case when count(u.batch_id) = 0 then 'Every batch says what it drank.'
            else count(u.batch_id)::text || ' batch(es) brewed without being fully logged.' end,
       false
  from mk m
  left join public.v_unaccounted_batches u on u.market = m.slug
 group by m.slug;;

-- security_invoker: market_live — definer on purpose, as 0285 made it: markets is the crew's to read (its RLS is staff
-- only), and a signed-out menu has to know whether its city is taking orders. The view carries that answer and the
-- checkout's own settings — the lead time, pay at pickup, the opening day, whether it is held closed — and nothing else of
-- a city.
revoke all on public.market_live from public;
grant select on public.market_live to anon, authenticated;

comment on view public.market_live is
  'Is this city taking orders right now (0412): the truck is live (live_status — Live Ops'' Go live and Go offline), the city is not held closed (markets.is_live = false), and its opening day has come. A city''s switch holds it closed and never keeps it open. held_closed: the switch at false — no orders here of any kind, a scheduled stop''s included (lib/orderingRead).';
comment on column public.markets.is_live is
  'False holds this city closed whatever the truck does (0412). Null — or true, which reads the same — follows the truck: Go live and Go offline are every city''s until a city runs its own truck with its own live pointer.';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Go offline stops every order', 'fix', 'Service',
   'Going offline in Live Ops now stops orders in every city it serves, every time. A city''s own switch in Settings › Locations & markets can hold that city closed — no orders at all there, scheduled stops included — and it can no longer keep a city taking orders while the truck is off the road.',
   '2026-10-15', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select pg_get_viewdef('public.market_live'::regclass) like '%IS DISTINCT FROM false%';                       -- true
--   select count(*) from public.market_live ml join public.live_status ls on true where ml.is_live and not ls.is_live; -- 0
--   select has_table_privilege('anon', 'public.market_live', 'select');                                           -- true
--   select count(*) from information_schema.columns where table_name = 'market_live' and column_name = 'held_closed'; -- 1
select public.record_migration('0412_go_offline_stops_every_order');

-- ============================================================
-- 0413_a_shared_link_shows_the_order.sql
-- ============================================================
-- ── 0413 — A SHARED LINK SHOWS THE ORDER, AND ONLY THE PHONE THAT PLACED IT CHANGES IT ────────────────────────────
-- 2026-10-15. R7 of the customer re-audit (Ryan, 2026-10-15: "Keep working to improve to a 10"). Paste into Supabase →
-- SQL Editor → Run. A second run changes nothing.
--
-- WHY. An order's ticket (0395) is the key of its page: whoever holds /order?t=… reads the order — the first name, the
-- drinks and their prices, the tip, the card's brand and last four, what was refunded — tells the truck "I'm outside"
-- (0395 ticket_eta), and cancels it while it is In (0396 cancel_by_ticket), the crew told the customer canceled it.
-- And the page's Share link sent that same key. Sharing an order with the friend picking it up gave them its Cancel,
-- the card's last four and the truck's chime.
--
-- WHAT.
--   · orders.share — a second key for each order, made with it, for its shared link (/order?s=…).
--   · order_shared(s) — what a shared link opens: the order's number, where it is, its drinks (no prices), whether it is
--     paid or what is due at the window, the first name it is for, and the stop — nothing that changes it, and nothing
--     about the card, the tip or refunds. An unknown link is refused in words, as a 4xx (PT404, 0360).
--   · order_ticket(t) — 0396's view, and the share key, so the ticket's Share link sends that one.
-- The ticket stays the key to its order for whoever already holds it — links shared before this keep working.
-- Adding the key writes every order once and builds its index under the table's lock: run it outside service hours.
-- changelog: below.

alter table public.orders add column if not exists share uuid default gen_random_uuid();
update public.orders set share = gen_random_uuid() where share is null;
alter table public.orders alter column share set not null;
create unique index if not exists orders_share_key on public.orders (share);
comment on column public.orders.share is
  'The order''s shared link (0413): /order?s=… shows the order — where it is, its drinks, what is due — and changes nothing. The ticket (0395) is the key to change it.';

-- ── the ticket's view (0396's), and its share key ────────────────────────────────────────────────────────────────
create or replace function public.order_ticket(p_ticket uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  o record;
  s record;
begin
  select id, items, status, created_at, status_changed_at, total_cents, tip_cents, paid, payment_status, collected_at,
         ready_from, eta_status, customer, stop_id, lines, card_brand, card_last4, payment_id, share
    into o from public.orders where ticket = p_ticket;
  if o.id is null then
    raise exception 'That ticket isn''t one of ours.' using errcode = 'PT404';   -- a 4xx, never a 5xx (0360)
  end if;
  select name, coalesce(address, location_text) as place, starts_at, ends_at, lat, lng, canceled_at, cancel_reason
    into s from public.stops where id = o.stop_id;
  return jsonb_build_object(
    'no',          '#' || upper(left(o.id::text, 4)),
    'status',      o.status,
    'items',       to_jsonb(o.items),
    'lines',       o.lines,
    'total_cents', o.total_cents,
    'tip_cents',   coalesce(o.tip_cents, 0),
    'paid',        coalesce(o.paid, false) or o.collected_at is not null or coalesce(o.payment_status = 'paid', false),
    'card',        case when o.card_last4 is not null then coalesce(nullif(o.card_brand, ''), 'Card') || ' ··' || o.card_last4 end,
    -- paid at the window (0341): the crew's to cancel there, so the ticket offers no Cancel (0396)
    'at_window',   o.collected_at is not null,
    -- what Square says left for it (0330) — money back is a fact Square reports, never this view's guess
    'refunded_cents', coalesce((select sum(r.amount_cents) from public.square_refunds r
                                 where o.payment_id is not null and r.payment_id = o.payment_id and r.status = 'COMPLETED'), 0),
    'refund_pending', exists (select 1 from public.square_refunds r
                                where o.payment_id is not null and r.payment_id = o.payment_id and r.status = 'PENDING'),
    'placed_at',   o.created_at,
    'moved_at',    o.status_changed_at,
    'ready_from',  o.ready_from,
    'eta',         o.eta_status,
    'for',         nullif(split_part(btrim(coalesce(o.customer, '')), ' ', 1), ''),
    -- the key its Share link sends (0413): a view of the order, never its ticket
    'share',       o.share,
    'stop',        case when s.name is not null then jsonb_build_object(
                     'name', s.name, 'place', s.place, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
                     'lat', s.lat, 'lng', s.lng, 'canceled', s.canceled_at is not null, 'cancel_reason', s.cancel_reason) end
  );
end $$;
revoke all on function public.order_ticket(uuid) from public, anon, authenticated;
grant execute on function public.order_ticket(uuid) to anon, authenticated;

-- ── what a shared link opens ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.order_shared(p_share uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  o      record;
  s      record;
  v_paid boolean;
begin
  select id, items, status, created_at, status_changed_at, total_cents, paid, payment_status, collected_at, ready_from,
         customer, stop_id, lines
    into o from public.orders where share = p_share;
  if o.id is null then
    raise exception 'That link isn''t one of ours.' using errcode = 'PT404';   -- a 4xx, never a 5xx (0360)
  end if;
  v_paid := coalesce(o.paid, false) or o.collected_at is not null or coalesce(o.payment_status = 'paid', false);
  select name, coalesce(address, location_text) as place, starts_at, ends_at, lat, lng, canceled_at, cancel_reason
    into s from public.stops where id = o.stop_id;
  return jsonb_build_object(
    'no',         '#' || upper(left(o.id::text, 4)),
    'status',     o.status,
    'items',      to_jsonb(o.items),
    -- the drinks and how many, never what they cost
    'lines',      (select jsonb_agg(jsonb_build_object('slug', l->>'slug', 'name', l->>'name', 'qty', case when (l->>'qty') ~ '^[0-9]{1,4}$' then (l->>'qty')::int else 1 end))
                     from jsonb_array_elements(case when jsonb_typeof(o.lines) = 'array' then o.lines else '[]'::jsonb end) l),
    'paid',       v_paid,
    -- what the person picking it up pays at the window, if anything
    'due_cents',  case when v_paid or o.status = 'void' then 0 else o.total_cents end,
    'placed_at',  o.created_at,
    'moved_at',   o.status_changed_at,
    'ready_from', o.ready_from,
    'for',        nullif(split_part(btrim(coalesce(o.customer, '')), ' ', 1), ''),
    'stop',       case when s.name is not null then jsonb_build_object(
                    'name', s.name, 'place', s.place, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
                    'lat', s.lat, 'lng', s.lng, 'canceled', s.canceled_at is not null, 'cancel_reason', s.cancel_reason) end
  );
end $$;
comment on function public.order_shared(uuid) is
  'What an order''s shared link opens (0413): its number, where it is, its drinks, what is due at the window, the first name and the stop — nothing that changes it, nothing about the card, the tip or refunds. Anyone with the link.';
revoke all on function public.order_shared(uuid) from public, anon, authenticated;
grant execute on function public.order_shared(uuid) to anon, authenticated;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Sharing an order shares where it is, not its Cancel', 'fix', 'Ordering',
   'Share link on an order now sends a link that shows the order — where it is, what''s in it, what''s due at the window — and nothing that changes it: no Cancel, no "I''m outside", nothing about your card. Only the phone that placed the order can change it.',
   '2026-10-15', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from public.orders where share is null;                                                     -- 0
--   select has_function_privilege('anon', 'public.order_shared(uuid)', 'execute');                              -- true
--   select prosrc like '%''share'',       o.share%' from pg_proc where proname = 'order_ticket';                -- true
select public.record_migration('0413_a_shared_link_shows_the_order');

-- ============================================================
-- 0414_founding_is_one_switch.sql
-- ============================================================
-- ── 0414 — FOUNDING IS ONE SWITCH: THE CARD AND THE PRICE AGREE ───────────────────────────────────────────────────
-- 2026-10-15. R7 of the customer re-audit (Ryan, 2026-10-15: "Keep working to improve to a 10"). Paste into Supabase →
-- SQL Editor → Run. A second run changes nothing.
--
-- WHY. A founding member is said in two places: profiles.founding_member — the card, the scan screen, the account say
-- "Founding Member" from it — and customers.tier — the prices read it (lib/benefits: the founding $8 latte, the free
-- refills). The crew's tier picker writes both (admin_set_customer_tier, 0176). The owner's member editor wrote only the
-- first (admin_set_member, 0229/0392): a member the owner made founding read "Founding Member" on their card and paid the
-- member's price; one the owner took off it kept the founding price.
--
-- WHAT.
--   · admin_set_member — the owner's edit (0392's, verbatim but for this): a change to Founding sets the tier with it —
--     founding on is the founding tier; off is the member tier, where it was founding.
--   · Where the two already disagree, they are made one — the card's way. Every other way a tier is set (the crew's tier
--     picker, the VIP queue: admin_set_customer_tier) writes the card with it; only the owner's edit wrote the card alone.
--     So a card that disagrees is the owner's latest word: on, the price comes up to founding; off, it comes down to
--     member. Each change is a line in the change log (admin_audit, 0260, by 0392's own trigger: audit_customers_tier).
--   · The owner's edit locks the member's row while it writes, and the editors send only what was changed — a save of the
--     points no longer writes back a credit balance read before a spend at the window, or a referral's undoing (0411).
-- changelog: below.

-- ── one founding: the card's, where the two disagree ───────────────────────────────────────────────────────────────
-- The price follows the card: its line in the change log is 0392's trigger's ("tier: member → founding", or back).
update public.customers c
   set tier = case when coalesce(p.founding_member, false) then 'founding' else 'member' end, updated_at = now()
  from public.profiles p
 where p.id = c.user_id and coalesce(p.founding_member, false) <> (coalesce(c.tier, '') = 'founding');

-- ── the owner's edit sets the tier with the switch (0392's, one statement more) ──────────────────────────────────────
create or replace function public.admin_set_member(member uuid, new_points int, new_credit_cents int, new_founding boolean)
returns void language plpgsql security definer set search_path = public as $$
declare cur int; delta int; was boolean;
begin
  if not public.is_owner() then raise exception 'not authorized'; end if;
  -- One edit at a time, and none between a read and its write (0414): the member's row is held for this one.
  perform 1 from public.profiles where id = member for update;
  if new_points is not null then
    select coalesce(points, 0) into cur from public.profiles where id = member;
    delta := new_points - coalesce(cur, 0);
    if delta <> 0 then
      insert into public.loyalty_ledger (user_id, channel, kind, points, note, by_user)
        values (member, 'admin', 'adjust', delta, 'owner set points to ' || new_points, auth.uid());
    end if;
  end if;
  select founding_member into was from public.profiles where id = member;
  update public.profiles
     set credit_cents    = coalesce(new_credit_cents, credit_cents),
         founding_member = coalesce(new_founding, founding_member)
   where id = member;
  if found and new_founding is not null and was is distinct from new_founding then
    -- The price follows the switch (0414): the tier the prices read (lib/benefits), set with it.
    update public.customers
       set tier = case when new_founding then 'founding' when tier = 'founding' then 'member' else tier end,
           updated_at = now()
     where user_id = member;
    insert into public.admin_audit (actor, action, table_name, row_pk, summary, old_row, new_row)
    values (auth.uid(), 'UPDATE', 'customers', member::text,
            format('Founding member: %s → %s', case when coalesce(was, false) then 'on' else 'off' end,
                                               case when new_founding then 'on' else 'off' end),
            jsonb_build_object('founding_member', was), jsonb_build_object('founding_member', new_founding));
  end if;
end; $$;
revoke all on function public.admin_set_member(uuid, int, int, boolean) from public, anon, authenticated;
grant execute on function public.admin_set_member(uuid, int, int, boolean) to authenticated;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Founding is one switch', 'fix', 'Loyalty',
   'Making someone a founding member from their profile now gives them the founding prices too, and taking it off takes them away — the card and the price always agree. Where the two disagreed, the card (the last word from a profile) now sets the price.',
   '2026-10-15', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from public.customers c join public.profiles p on p.id = c.user_id
--    where coalesce(p.founding_member, false) <> (c.tier = 'founding');                                       -- 0
--   select prosrc like '%tier = case when new_founding%' from pg_proc where proname = 'admin_set_member';      -- true
select public.record_migration('0414_founding_is_one_switch');
