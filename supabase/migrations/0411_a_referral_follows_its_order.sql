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
