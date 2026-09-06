-- 0287 — WHO PAYS FOR SUPPLIES IS NOT WHO BUYS THEM. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- operator_agreements.supply_funding is a number from 0 to 100: the share of supply COST the operator
-- funds. It is the one negotiable input in the deal, it moves the revenue split with it, and it is
-- unit-tested. It answers exactly one question — who pays — and the deal has been treating that as
-- if it answered the whole supply question. It does not.
--
-- The real question, asked plainly: the operator drives to a store and buys Mountain Valley water,
-- coffee and restaurant supply, OR Greenville buys it and ships it to them. Those two arrangements
-- can carry the identical supply_funding number and are not remotely the same deal.
--
--   * Under "operator buys", the operator controls price, timing and substitution. GT3 controls
--     nothing about the cup except the recipe. Cost drifts city to city and so does the product.
--   * Under "GT3 supplies", the product is consistent and the cost is known — and GT3 has taken
--     control of the operator's cost of goods, their vendor relationships and their working capital.
--
-- Both are legitimate. Choosing without naming the choice is what is not.
--
-- WHY THIS IS NOT ONLY AN OPERATIONS FIELD. Two consequences ride on it, and neither is obvious:
--
--   1. REQUIRING an operator to buy from GT3, or from suppliers GT3 designates, is one of the
--      classic marks of a franchise — significant control over the operator's method of operation.
--      Pair it with a trademark and a required payment and you are looking at the three elements the
--      FTC Franchise Rule turns on. Selling supplies to the operator ABOVE cost is itself a form of
--      required payment. A cost-plus markup on required supplies is the single combination most
--      likely to turn a partnership into a franchise nobody registered.
--
--   2. Supplying someone's equipment and consumables is already one of the classification flags the
--      offer-letter module raises against a "contractor" — it speaks to who is running a business.
--      The operator agreement raises exactly the same question and never asked it.
--
-- WHAT THIS ADDS. Sourcing, price basis, and the items GT3 specifies by brand regardless of who buys
-- them — because SPEC control and SOURCING control are different levers and conflating them is how a
-- brand ends up requiring a purchase it only meant to require a standard. Then a view that reads the
-- combination back in plain language, so the posture is a query rather than a memory.
--
-- ZERO REGRESSION. Every new column is nullable or defaults to the arrangement in force today, and
-- 'undecided' is the default sourcing value — because it is true, and a default of 'operator_local'
-- would be me deciding this for you.
--
-- Apply after 0286.

-- ── 1. Who buys, on what basis, and what is specified either way ─────────────────────────────────
alter table public.operator_agreements add column if not exists supply_sourcing text not null default 'undecided'
  check (supply_sourcing in ('undecided','operator_local','gt3_supplied','mixed'));
alter table public.operator_agreements add column if not exists supply_price_basis text
  check (supply_price_basis is null or supply_price_basis in ('at_cost','cost_plus','operator_pays_retail'));
alter table public.operator_agreements add column if not exists supply_markup_pct numeric
  check (supply_markup_pct is null or (supply_markup_pct >= 0 and supply_markup_pct <= 100));
alter table public.operator_agreements add column if not exists spec_items text[] not null default '{}';
alter table public.operator_agreements add column if not exists supply_notes text;

comment on column public.operator_agreements.supply_sourcing is
  'WHO BUYS. Distinct from supply_funding, which is who pays. operator_local = they source it in their city. gt3_supplied = Greenville buys and ships. mixed = spec items from GT3, commodity items local.';
comment on column public.operator_agreements.supply_price_basis is
  'What GT3 charges the operator for anything GT3 supplies. at_cost is the low-risk answer; cost_plus is a markup on a required purchase and is the combination that most looks like a franchise fee.';
comment on column public.operator_agreements.spec_items is
  'Items GT3 requires by brand or specification NO MATTER WHO BUYS THEM — the water, the coffee. Naming a standard is not the same as requiring a purchase from you, and keeping them separate is the whole point of this column.';

-- A markup only means something when GT3 is the one selling.
-- coalesce, not a bare comparison: with supply_price_basis NULL the expression would evaluate to
-- NULL, and a CHECK constraint accepts NULL. The first version of this line let a markup through on
-- a deal with no price basis at all — caught by scripts/db.market.test.mjs.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'operator_agreements_markup_needs_basis') then
    alter table public.operator_agreements add constraint operator_agreements_markup_needs_basis
      check (supply_markup_pct is null or coalesce(supply_price_basis, '') = 'cost_plus');
  end if;
end $$;

-- ── 2. Sourcing is a TERM, so it freezes on acceptance like every other term ─────────────────────
-- Rewritten from 0280's live body. Every column 0280 froze is still frozen, in the same order, with
-- the same message and the same deliberate-correction escape hatch. The four supply columns join them
-- — a signed deal whose sourcing model can be changed afterwards is not a signed deal.
create or replace function public.guard_agreement_terms() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if old.status not in ('accepted','active','ended') then return new; end if;
  if current_setting('gt3.allow_hard_delete', true) = 'on' then return new; end if;

  if new.operator_pct   is distinct from old.operator_pct
  or new.royalty_pct    is distinct from old.royalty_pct
  or new.market_pct     is distinct from old.market_pct
  or new.supply_funding is distinct from old.supply_funding
  or new.tier           is distinct from old.tier
  or new.stage          is distinct from old.stage
  or new.package        is distinct from old.package
  or new.market         is distinct from old.market
  or new.supply_sourcing    is distinct from old.supply_sourcing
  or new.supply_price_basis is distinct from old.supply_price_basis
  or new.supply_markup_pct  is distinct from old.supply_markup_pct
  or new.spec_items         is distinct from old.spec_items then
    raise exception 'This agreement was already accepted — its terms are final. End it and draft a new version instead. (Deliberate correction: select set_config(''gt3.allow_hard_delete'',''on'',false); first.)';
  end if;
  return new;
end $$;

drop trigger if exists guard_terms_operator_agreements on public.operator_agreements;
create trigger guard_terms_operator_agreements before update on public.operator_agreements
  for each row execute function public.guard_agreement_terms();

-- ── 3. The posture, read back in plain language ──────────────────────────────────────────────────
-- Same idea as v_tenant_isolation_gaps: turn a thing you have to remember into a thing you can ask.
-- It states what the arrangement IS and what it most resembles. It is not legal advice and it does
-- not block anything — it makes sure nobody reaches the signing table without having seen the shape.
create or replace view public.v_operator_supply_posture as
select a.id, a.market, a.operator_name, a.status,
       a.supply_funding, a.supply_sourcing, a.supply_price_basis, a.supply_markup_pct,
       coalesce(array_length(a.spec_items, 1), 0) as spec_item_count,
       case a.supply_sourcing
         when 'undecided'      then 'Not decided yet — the agreement does not say who buys the supplies.'
         when 'operator_local' then 'The operator sources their own supplies in their own city.'
         when 'gt3_supplied'   then 'GT3 buys and ships. GT3 controls their cost of goods and their vendors.'
         when 'mixed'          then 'GT3 supplies the specified items; the operator buys the rest locally.'
       end as who_buys,
       case
         when a.supply_sourcing = 'undecided'
           then 'DECIDE THIS — an unstated supply arrangement becomes whatever happened, and whatever happened is what a court would look at.'
         when a.supply_sourcing in ('gt3_supplied','mixed') and a.supply_price_basis = 'cost_plus'
           then 'HIGHEST EXPOSURE — a required purchase from GT3 at a markup. Marked-up required supplies read as a franchise fee, and combined with the brand and the operator''s payment that is the shape the FTC Franchise Rule turns on. Have a franchise lawyer look at this specific combination before it is signed.'
         when a.supply_sourcing in ('gt3_supplied','mixed') and a.supply_price_basis = 'at_cost'
           then 'MODERATE — GT3 controls sourcing but takes no margin on it. Weaker as a required payment, still control over the operator''s method. Worth a lawyer''s eye if the brand is also licensed.'
         when a.supply_sourcing = 'operator_local' and coalesce(array_length(a.spec_items, 1), 0) > 0
           then 'LOWEST — the operator buys their own supplies and GT3 specifies standards only. Specifying a brand is not requiring a purchase from you; keep it that way in writing.'
         when a.supply_sourcing = 'operator_local'
           then 'LOWEST — the operator sources and pays for everything. Note that nothing currently holds the product to a standard, which is a brand risk rather than a legal one.'
         else 'Review manually.'
       end as read_on_it
  from public.operator_agreements a
 where a.status <> 'ended';

revoke all on public.v_operator_supply_posture from public, anon;
grant select on public.v_operator_supply_posture to authenticated;

comment on view public.v_operator_supply_posture is
  'What each live operator deal actually says about supplies, and what that arrangement most resembles. Plain-language orientation, not legal advice — the cost/markup combination in particular deserves a franchise lawyer.';

-- ── the record (no-drift gate) ───────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Operator deals now say who buys the supplies','improvement','Operators',
   'The agreement recorded how much of the supply cost an operator funds, but never who actually buys the supplies — and those are different deals even at the same number. An operator sourcing coffee and water in their own city is not the same arrangement as Greenville buying it and shipping it out, and the second one puts GT3 in control of their costs and their suppliers. The agreement now records which it is, what GT3 charges for anything it supplies, and which items are specified by brand no matter who buys them. Once a deal is accepted, all of that is final along with the rest of the terms.',
   '2026-09-06', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- ── verify (run after) ────────────────────────────────────────────────────────────────────────────
--   -- every live deal and what its supply arrangement amounts to:
--   select market, operator_name, status, who_buys, read_on_it from public.v_operator_supply_posture;
--
--   -- nothing was decided on your behalf (expect: every row 'undecided'):
--   select supply_sourcing, count(*) from public.operator_agreements group by 1;
--
--   -- an accepted deal refuses a sourcing change: expect EXCEPTION
--   -- update public.operator_agreements set supply_sourcing = 'gt3_supplied' where status = 'accepted';
