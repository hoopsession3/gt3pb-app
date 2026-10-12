-- ── 0387 — A FREE CUP IS REDEEMED ONCE ──────────────────────────────────────────────────────────────────────────────
-- 2026-10-12. C6 of the customer frontend audit; the owner approved its R1 on 2026-10-12, with the redeem button on the
-- crew's scan screen (decision 3) and the free-cup balance counted from launch (decision 2).
--
-- WHY. Every tenth cup is on us, and nothing recorded a free cup as given. The ledger (0229) knows award, clawback and
-- adjust; the card counts every ten points as a free cup, forever — so a member with 20 points was owed two free cups
-- after drinking both, and the crew had no way to say one was used. Counting from launch is clean: nobody in production
-- holds ten points today (read-only count, 2026-10-12), so no free cup is owed from before this.
--
-- WHAT.
--   · loyalty_ledger.kind gains 'redeem': a free cup given at the window is one row of −10. profiles.points stays the
--     ledger's sum (0229's apply trigger), so a card shows what is left: points % 10 stamps, points / 10 free cups ready.
--   · loyalty_ledger.by_user: who wrote a row by hand at the window — the crew member who redeemed (and, once the
--     scan is changed, who scanned). Null for rows the system writes.
--   · redeem_free_cup(code): the crew's scan screen, after a confirm. Staff only (is_staff, as award_manual_point asks);
--     the member by their card code; refused unless they hold ten points; the profile row locked first, so two crew
--     phones redeeming at once cannot give two cups for one. Returns the member's points after.
-- Untouched: award_manual_point, credit_wallet, the apply trigger, every reader of profiles.points.
--
-- ORDER. Paste it before the deploy that carries the Redeem button: before it is pasted the button answers "Couldn't
-- redeem — try again" (the function is missing, PGRST202), and nothing else changes.
--
-- existing rows: none written; the check constraint is widened, and a nullable column added.
-- changelog: below.

alter table public.loyalty_ledger drop constraint if exists loyalty_ledger_kind_check;
alter table public.loyalty_ledger add constraint loyalty_ledger_kind_check
  check (kind in ('award', 'clawback', 'adjust', 'redeem'));
alter table public.loyalty_ledger add column if not exists by_user uuid references auth.users(id) on delete set null;
comment on column public.loyalty_ledger.by_user is
  'Who wrote this row by hand at the window (0387): the crew member who redeemed a free cup. Null for system rows.';

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
  if cur < 10 then raise exception 'no free cup to redeem' using errcode = 'P0001'; end if;
  insert into public.loyalty_ledger (user_id, channel, kind, points, note, by_user)
    values (uid, 'scan', 'redeem', -10, 'free cup redeemed at the window', auth.uid());
  select coalesce(points, 0) into after from public.profiles where id = uid;
  return after;
end $$;
revoke all on function public.redeem_free_cup(text) from public, anon, authenticated;
grant execute on function public.redeem_free_cup(text) to authenticated;
comment on function public.redeem_free_cup(text) is
  'The crew''s scan screen (0387, app/scan): a free cup given at the window — one loyalty_ledger row of −10, written by who redeemed it. Staff only; refused under ten points; the profile locked first.';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A free cup is redeemed once','fix','Loyalty',
   'Every tenth cup is on us, and now the crew can say one was given. Scanning a member''s card shows Redeem a free cup when they have one; it asks first, then takes ten points off the card, and the member''s card shows what is left. Two phones cannot give two cups for one, and every redemption says who gave it.',
   '2026-10-12', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select pg_get_constraintdef(oid) like '%redeem%' from pg_constraint where conname = 'loyalty_ledger_kind_check';  -- t
--   select count(*) from information_schema.columns where table_name = 'loyalty_ledger' and column_name = 'by_user'; -- 1
--   select has_function_privilege('anon', 'public.redeem_free_cup(text)', 'execute');                              -- f
select public.record_migration('0387_a_free_cup_is_redeemed_once');
