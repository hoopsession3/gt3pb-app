-- 0286 — THE THINGS AN OFFER LETTER IS LEGALLY REQUIRED TO SAY. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- 0281 built the machinery: an owner drafts, every other owner approves unanimously, only then can it
-- reach the candidate. What it did not build is the LETTER. The record carries a title, a role, pay
-- and a start date — and South Carolina requires more than that, in writing, at the time of hiring.
--
--   S.C. Code § 41-10-30 — every employer, no size threshold — the employee must be notified in
--   writing of "the normal hours and wages agreed upon, the time and place of payment, and the
--   deductions which will be made from the wages, including payments to insurance programs."
--
-- Wages we have. Normal hours, time and place of payment, and deductions we do not. Greenville is
-- South Carolina and has been the only live market since day one, so every offer written so far
-- would have been short of the statute. Those three become required fields, and the submit path
-- refuses to send an incomplete letter for review — a co-owner should be approving a finished offer,
-- not a form with holes in it.
--
-- THE DISCLAIMER IS HANDLED DIFFERENTLY, ON PURPOSE.
-- S.C. Code § 41-1-110 says a document an employer issues does not create an employment contract if
-- it is conspicuously disclaimed — underlined capital letters, first page. Georgia adds its own
-- reason to want that sentence: under O.C.G.A. § 34-7-1, stating wages for a period raises a
-- presumption that the hiring is FOR that period, so an annual salary with no at-will language hands
-- a candidate an argument they were hired for a year.
--
-- That sentence has to be drafted by a lawyer. I am not writing it, and I am not shipping a
-- placeholder that reads like one — a disclaimer that fails is worse than an absent disclaimer,
-- because it looks handled. So markets.offer_disclaimer ships NULL, an owner sets it once from
-- counsel, and until then every submitted offer writes a visible line into its own approval trail
-- saying the market has no disclaimer on file. It does not block the offer. It makes the co-owner
-- approving it see the gap at the moment they are deciding — which is what the approval step is for.
--
-- ZERO REGRESSION: the new columns are nullable and no existing row moves. The only behaviour change
-- is on the NEXT submit, and it is a refusal with an instruction rather than a silent failure.
--
-- Apply after 0285.

-- ── 1. What the statute asks for ─────────────────────────────────────────────────────────────────
alter table public.offer_letters add column if not exists normal_hours  text;
alter table public.offer_letters add column if not exists pay_schedule  text;
alter table public.offer_letters add column if not exists pay_method    text;
alter table public.offer_letters add column if not exists deductions    text;

comment on column public.offer_letters.normal_hours is
  'The normal hours agreed upon — S.C. Code 41-10-30. Free text: "Tue-Sat, 6am-2pm, ~38 hrs/week".';
comment on column public.offer_letters.pay_schedule is
  'The TIME of payment — 41-10-30. "Every other Friday, in arrears".';
comment on column public.offer_letters.pay_method is
  'The PLACE of payment — 41-10-30. "Direct deposit to the account on file".';
comment on column public.offer_letters.deductions is
  'The deductions that will be made, including payments to insurance programs — 41-10-30. "Federal and state withholding, FICA. No other deductions." counts, and is the honest answer for most hires.';

-- ── 2. Where the disclaimer lives ────────────────────────────────────────────────────────────────
-- On the market, because the sentence is state-specific and each market sits in exactly one state.
-- Null on purpose. Nothing in this file writes a value into it.
alter table public.markets add column if not exists offer_disclaimer text;
comment on column public.markets.offer_disclaimer is
  'The at-will disclaimer for this state, drafted by counsel. SC requires underlined capital letters on the first page (41-1-110); GA needs the sentence to defeat the 34-7-1 salary-period presumption. Null = none on file, and the approval trail says so.';

create or replace function public.set_market_offer_disclaimer(p_market text, p_text text)
returns public.markets language plpgsql security definer set search_path = public as $$
declare m public.markets;
begin
  if not public.is_owner() then raise exception 'Only an owner can set the offer disclaimer.'; end if;
  update public.markets set offer_disclaimer = nullif(btrim(p_text), '')
   where slug = p_market returning * into m;
  if not found then raise exception 'No such market: %', p_market; end if;
  return m;
end $$;
revoke all on function public.set_market_offer_disclaimer(text, text) from public;
grant execute on function public.set_market_offer_disclaimer(text, text) to authenticated;

-- ── 3. The trail can say a disclaimer is missing ─────────────────────────────────────────────────
-- A new event kind rather than a note on an existing one, so it is queryable and so the review
-- screen can render it as a warning instead of burying it in prose.
do $$ begin
  alter table public.offer_events drop constraint if exists offer_events_kind_check;
  alter table public.offer_events add constraint offer_events_kind_check
    check (kind in ('drafted','edited','submitted','approved','changes_requested',
                    'sent','accepted','declined','countered','withdrawn','expired',
                    'disclaimer_missing'));
end $$;

-- ── 4. Submit refuses an incomplete letter ───────────────────────────────────────────────────────
-- Rewritten from 0281's live body. Everything about the approval logic is preserved exactly — the
-- owner gate, the status guard, the snapshot of every other owner, the cleared prior decisions, the
-- sole-owner path that says so in the trail rather than staging a unanimous vote of nobody. What is
-- added is the completeness check ahead of all of it, and the disclaimer note after.
create or replace function public.submit_offer_for_review(p_id uuid)
returns public.offer_letters language plpgsql security definer set search_path = public as $$
declare o public.offer_letters; n int; missing text[] := '{}'; disc text;
begin
  if not public.is_owner() then raise exception 'Only an owner can submit an offer for review.'; end if;
  select * into o from public.offer_letters where id = p_id;
  if not found then raise exception 'No such offer.'; end if;
  if o.status not in ('draft','changes_requested','countered') then
    raise exception 'This offer is % — only a draft can go for review.', o.status;
  end if;

  -- Every problem at once. A form that reveals its objections one at a time wastes the afternoon.
  -- array_append, not the || operator: with an untyped literal on the right, || resolves to
  -- array || array and Postgres tries to parse the sentence as an array literal. Caught by
  -- scripts/db.market.test.mjs, which is the entire argument for that file existing.
  if coalesce(btrim(o.normal_hours), '') = '' then missing := array_append(missing, 'the normal hours'); end if;
  if coalesce(btrim(o.pay_schedule), '') = '' then missing := array_append(missing, 'when they get paid'); end if;
  if coalesce(btrim(o.pay_method),   '') = '' then missing := array_append(missing, 'how they get paid'); end if;
  if coalesce(btrim(o.deductions),   '') = '' then missing := array_append(missing, 'the deductions'); end if;
  if array_length(missing, 1) > 0 then
    raise exception 'This letter is missing %. South Carolina requires all four in writing at the time of hiring, and they belong in every offer regardless of city.',
      array_to_string(missing, ', ');
  end if;

  -- Snapshot every OTHER owner as a required approver. Re-submitting after changes clears prior
  -- decisions: an approval was given to a specific set of terms, and the terms just moved.
  --
  -- AND A BUG FIX. 0281 shipped this insert naming two columns and selecting one value:
  --     insert into public.offer_approvals (offer_id, approver_id) select p.id from ...
  -- Postgres parse-analyses a statement inside plpgsql on first EXECUTION, not at create time, so
  -- the function was created cleanly, the migration reported success, and the defect sat in
  -- production waiting for the first real submission — which would have failed with "INSERT has
  -- more target columns than expressions" and left the offer stuck in draft. It has never fired
  -- because no offer has been submitted yet. Found by scripts/db.market.test.mjs on its first run.
  delete from public.offer_approvals where offer_id = p_id;
  insert into public.offer_approvals (offer_id, approver_id)
  select p_id, p.id from public.profiles p
   where p.role = 'owner' and p.id is distinct from coalesce(o.author_id, auth.uid());

  select count(*) into n from public.offer_approvals where offer_id = p_id;

  if n = 0 then
    update public.offer_letters
       set status = 'approved', submitted_at = now(), approved_at = now(), updated_at = now()
     where id = p_id returning * into o;
    insert into public.offer_events (offer_id, actor, kind, from_status, to_status, note)
    values (p_id, auth.uid(), 'approved', 'draft', 'approved', 'No co-owners to review — approved by default.');
  else
    update public.offer_letters
       set status = 'in_review', submitted_at = now(), approved_at = null, updated_at = now()
     where id = p_id returning * into o;
  end if;

  -- Said once, into the trail, where the approver reads it. Not a block: whether to send a letter
  -- without an at-will disclaimer is an owner's decision, and this makes sure it is a decision
  -- rather than an oversight.
  select offer_disclaimer into disc from public.markets where slug = o.market;
  if coalesce(btrim(disc), '') = '' then
    insert into public.offer_events (offer_id, actor, kind, note)
    values (p_id, auth.uid(), 'disclaimer_missing',
      'No at-will disclaimer on file for this market. South Carolina wants it in underlined capitals on the first page (41-1-110); Georgia needs it to defeat the salary-period presumption (34-7-1). Get the sentence from counsel, then: select public.set_market_offer_disclaimer(''' || o.market || ''', ''…'');');
  end if;

  return o;
end $$;
revoke all on function public.submit_offer_for_review(uuid) from public;
grant execute on function public.submit_offer_for_review(uuid) to authenticated;

-- ── 5. The letter, as a letter ───────────────────────────────────────────────────────────────────
-- The record is not the document. This assembles the document — every statutory field in one row,
-- with the market's disclaimer attached, so the print view renders from one read and cannot
-- accidentally omit the part that has to be on the first page.
create or replace view public.v_offer_letter as
select o.id, o.status, o.market, m.name as market_label,
       o.candidate_name, o.candidate_email, o.title, o.role, o.employment_type,
       o.base_cents, o.rate_per, o.commission_pct, o.starts_on, o.reports_to, o.package, o.notes,
       o.normal_hours, o.pay_schedule, o.pay_method, o.deductions,
       m.offer_disclaimer,
       (coalesce(btrim(m.offer_disclaimer), '') = '') as disclaimer_missing,
       o.expires_on, o.sent_at, o.responded_at, o.created_at
  from public.offer_letters o
  left join public.markets m on m.slug = o.market;

revoke all on public.v_offer_letter from public, anon;
grant select on public.v_offer_letter to authenticated;

comment on view public.v_offer_letter is
  'One row per offer with everything the printed letter needs, including the market disclaimer. Inherits offer_letters RLS: owners write, admins read, the candidate sees only their own.';

-- ── the record (no-drift gate) ───────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Offer letters now carry what the law asks for','improvement','Crew',
   'South Carolina requires an employer to put four things in writing when someone is hired: the normal hours, the wages, when and where they get paid, and what will be deducted. The offer letter carried the wages and none of the rest. All four are now required before an offer can go to the co-owners for approval, so nobody reviews a letter with holes in it. The at-will wording is a separate matter for a lawyer to draft once — until it is on file, every offer sent for approval says so in its own record where the approving owner will see it.',
   '2026-09-06', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- ── verify (run after) ────────────────────────────────────────────────────────────────────────────
--   -- the four fields exist and the letter view assembles (expect: 0 rows, no error):
--   select id, disclaimer_missing from public.v_offer_letter;
--
--   -- no disclaimer has been invented (expect: both null):
--   select slug, offer_disclaimer from public.markets order by slug;
--
--   -- when counsel gives you the sentence, owner-only:
--   -- select public.set_market_offer_disclaimer('greenville', 'THIS LETTER IS NOT A CONTRACT …');
