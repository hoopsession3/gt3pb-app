-- ── 0411 — A REFERRAL FOLLOWS ITS ORDER: UNDONE, ITS $5 + $5 COME BACK ────────────────────────────────────────────
-- 2026-10-15. R7 of the customer re-audit (Ryan, 2026-10-15: "Keep working to improve to a 10"). Paste into Supabase →
-- SQL Editor → Run. A second run changes nothing.
--
-- WHY. A referred member's first order of $5 or more, handed over, gives them and the member who referred them $5 of
-- credit each (credit_wallet, 0229 — once per referee, ever: referral_events). When that order was voided or refunded in
-- full its stamps came off (claw_wallet, 0229; square_refund_claws, 0390/0400) and the $10 stayed — spendable at the
-- window (0389) — and because the referral was marked converted, the referee's next real order never counted. And a void
-- took the stamps back only from a picked-up order: Recall (done → ready) and then Void kept both the stamps and the
-- referral.
--
-- WHAT.
--   · Whenever the order that converted a referral has its stamps taken back — voided, or refunded in full in Square —
--     the referral is undone with it: each side's $5 comes off, as far as it is still on the card (credit already spent
--     at the window was spent in good faith, and a balance never goes below zero); the referee's referral is open again,
--     so their next real order converts it; the event says when, why and how much came back; and the change log
--     (admin_audit, 0260) has a line.
--   · A converting order after an undone one converts the same referral again (referral_events keeps one row per
--     referee: it is re-stamped with the new order, and the change log keeps the first).
--   · A void takes the stamps back from any order that earned them — a recalled one too (award_points).
-- Nothing else about stamps, credit or referrals changes: the $5 floor, the one conversion per referee at a time, the
-- ledger's once-per-order award and clawback.
-- changelog: below.

alter table public.referral_events add column if not exists reversed_at timestamptz;
alter table public.referral_events add column if not exists reversed_why text;
alter table public.referral_events add column if not exists referrer_back_cents integer;
alter table public.referral_events add column if not exists referee_back_cents integer;
comment on column public.referral_events.reversed_at is
  'When the order that converted this referral was undone — voided, or refunded in full — and its credit taken back (0411). Null: it stands.';

-- ── the referral, undone with its order ────────────────────────────────────────────────────────────────────────────
create or replace function public.referral_follows_its_order() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  e        public.referral_events%rowtype;
  have_fee integer;
  have_ref integer;
  back_fee integer;
  back_ref integer;
begin
  if new.kind <> 'clawback' or new.order_id is null then return new; end if;
  select * into e from public.referral_events
   where referee = new.user_id and converting_order = new.order_id
     and coalesce(converting_channel, 'cup') = new.channel and reversed_at is null
   for update;
  if not found then return new; end if;

  -- What is still there, at most what was given: never below zero.
  select greatest(coalesce(credit_cents, 0), 0) into have_fee from public.profiles where id = e.referee for update;
  select greatest(coalesce(credit_cents, 0), 0) into have_ref from public.profiles where id = e.referrer for update;
  back_fee := least(coalesce(have_fee, 0), coalesce(e.referee_credit_cents, 0));
  back_ref := least(coalesce(have_ref, 0), coalesce(e.referrer_credit_cents, 0));
  update public.profiles set credit_cents = greatest(coalesce(credit_cents, 0) - back_fee, 0), referral_converted = false
   where id = e.referee;
  update public.profiles set credit_cents = greatest(coalesce(credit_cents, 0) - back_ref, 0)
   where id = e.referrer;
  update public.referral_events
     set reversed_at = now(), reversed_why = coalesce(nullif(new.note, ''), 'order undone'),
         referee_back_cents = back_fee, referrer_back_cents = back_ref
   where id = e.id;

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
  'The referral a voided or fully refunded order converted, undone with it (0411): each side''s credit back as far as it is still on the card, the referral open again, the event and the change log saying so.';
drop trigger if exists loyalty_clawback_referral on public.loyalty_ledger;
create trigger loyalty_clawback_referral after insert on public.loyalty_ledger
  for each row when (new.kind = 'clawback') execute function public.referral_follows_its_order();

-- ── a converting order after an undone one converts it again (0229's, the event re-stamped) ─────────────────────────
create or replace function public.credit_wallet(p_user_id uuid, p_points int, p_total_cents int, p_order_id uuid, p_channel text)
returns void language plpgsql security definer set search_path = public as $$
declare ref uuid; ev public.referral_events%rowtype; grant_cents int := 500; floor_cents int := 500;
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
        -- Its first converting order was undone (0411): this one converts it.
        update public.profiles set referral_converted = true, credit_cents = credit_cents + grant_cents where id = p_user_id;
        update public.profiles set credit_cents = credit_cents + grant_cents where id = ref;
        update public.referral_events
           set referrer = ref, converting_order = p_order_id, converting_channel = p_channel,
               referrer_credit_cents = grant_cents, referee_credit_cents = grant_cents,
               reversed_at = null, reversed_why = null, referrer_back_cents = null, referee_back_cents = null
         where id = ev.id;
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

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A referral follows its order', 'fix', 'Loyalty',
   'The $5 you and a friend you referred each get comes from their first order. If that order is canceled or refunded, the $5 comes back off both cards (never below zero), and their next order counts instead.',
   '2026-10-15', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from pg_trigger where tgname = 'loyalty_clawback_referral';                                   -- 1
--   select count(*) from information_schema.columns where table_name = 'referral_events' and column_name like '%back_cents'; -- 2
--   select prosrc like '%old.status is distinct from ''void''%' from pg_proc where proname = 'award_points';      -- true
select public.record_migration('0411_a_referral_follows_its_order');
