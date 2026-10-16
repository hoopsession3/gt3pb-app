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
