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
