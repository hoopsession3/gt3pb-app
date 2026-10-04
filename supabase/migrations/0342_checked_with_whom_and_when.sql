-- ── CHECKED WITH WHOM, AND WHEN ────────────────────────────────────────────────────────────────
-- 2026-10-04. The second of Ryan's four ("All four, in order"): a permit rule that falls due for a
-- re-check under Needs you could never leave it.
--
-- ── WHAT WAS TRUE ──────────────────────────────────────────────────────────────────────────────
-- 0284 gave every compliance rule a date — verified_on, "the date a human last confirmed this
-- against the issuing authority" — and v_compliance_freshness turned that date into a to-do: no
-- date, over six months, over a year, or never confirmed at all. 0320 put those to-dos under Needs
-- you ("Needs re-checking"). And nothing, anywhere in the app, writes verified_on. The only write
-- the app makes to a rule is the inspection agent's approve (crew page, InspectionPrep), which sets
-- verified without a date — so an approved rule arrived in Needs you at once, as "no date", and
-- stayed. A row on the list could be read, and could never be answered: calling the county, being
-- told the rule still stands, had nowhere to go but the SQL editor. And a row tapped went to the
-- top of Prep, where nothing about the rule is.
--
-- ── WHAT THIS DOES ─────────────────────────────────────────────────────────────────────────────
-- 1. compliance_checks: one row per time a person checked a rule with someone who would know —
--    when, who, what they checked it against, what they found, and the rule as it stood before.
--    Append-only from the app: rows are written by the two functions below and nothing else, the
--    same rule square_refunds keeps, because a check anyone can insert is a check nobody can trust.
-- 2. recheck_compliance_rule(rule, outcome, checked_against, note): any staff member who checked
--    it. 'confirmed' — still true, today — sets verified, verified_on (the ET day) and verified_by,
--    and leaves Needs you. 'changed' — the authority says something else now — does NOT rewrite
--    the rule. It marks it unverified, says what changed and who said so, and tells the owners,
--    because a permit rule is changed by someone who can then be asked about it.
-- 3. correct_compliance_rule(...): owners and admins (0027's "compliance admin write"): the rule's
--    words, link, authority and deadline, rewritten from what the authority said, with where it
--    was checked — and the rule as it stood before kept in the check.
-- 4. compliance_rules.verified_by.
--
-- ── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────────────────────────
-- It writes no rule. Nothing here says what a permit requires; every word a rule carries still
-- comes from a person who names where they got it, and "where you checked" is required — a check
-- with no source is the thing 0284 spent a migration removing. It does not let a re-check touch a
-- rule that is not on the checklist (an agent proposal still waiting for an admin's approval), and
-- it does not change who may approve those. It does not date anything retroactively: a rule nobody
-- has checked stays exactly as stale as it is.

-- ── 1 · WHO CHECKED A RULE, WITH WHOM, AND WHAT THEY FOUND ─────────────────────────────────────
alter table public.compliance_rules add column if not exists verified_by uuid references auth.users(id) on delete set null;
comment on column public.compliance_rules.verified_by is
  'Who last confirmed or corrected this rule (0342). The check itself — when, against what, what was found — is in compliance_checks.';

create table if not exists public.compliance_checks (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  rule_id         uuid not null references public.compliance_rules(id) on delete cascade,
  checked_on      date not null,
  checked_by      uuid references auth.users(id) on delete set null,
  outcome         text not null check (outcome in ('confirmed', 'changed', 'corrected')),
  checked_against text not null check (length(btrim(checked_against)) >= 3),
  note            text,
  before          jsonb not null,
  created_at      timestamptz not null default now()
);
create index if not exists compliance_checks_rule on public.compliance_checks (rule_id, created_at desc);

drop trigger if exists stamp_tenant_tg on public.compliance_checks;
create trigger stamp_tenant_tg before insert on public.compliance_checks
  for each row execute function public.stamp_tenant();

alter table public.compliance_checks enable row level security;
drop policy if exists compliance_checks_read on public.compliance_checks;
create policy compliance_checks_read on public.compliance_checks for select using ((select public.is_staff()));
drop policy if exists "tenant isolation" on public.compliance_checks;
create policy "tenant isolation" on public.compliance_checks as restrictive for all
  using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
-- No insert, update or delete policy for `authenticated`, on purpose — see WHAT THIS DOES (1). The
-- grants say the same thing as the policies, so neither has to be read to know the other.
revoke all on public.compliance_checks from public, anon;
revoke insert, update, delete on public.compliance_checks from authenticated;
grant select on public.compliance_checks to authenticated;

comment on table public.compliance_checks is
  'Every time a person checked a compliance rule with someone who would know: when, who, against what, and what they found (confirmed / changed / corrected), with the rule as it stood before. Written only by recheck_compliance_rule and correct_compliance_rule.';

-- ── 2 · RE-CHECKED: STILL TRUE, OR NOT ─────────────────────────────────────────────────────────
-- existing rows: recheck_compliance_rule — a new producer; nothing has ever written a compliance_changed alert
create or replace function public.recheck_compliance_rule(
  p_rule uuid, p_outcome text, p_checked_against text, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  r public.compliance_rules%rowtype;
  today date := (now() at time zone 'America/New_York')::date;
  src text := btrim(coalesce(p_checked_against, ''));
  note text := nullif(btrim(coalesce(p_note, '')), '');
  who text;
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  if p_outcome is null or p_outcome not in ('confirmed', 'changed') then
    raise exception 'say what you found: confirmed or changed';
  end if;
  if length(src) < 3 then
    raise exception 'say where you checked it — the county, the agency, the page or the person';
  end if;
  if p_outcome = 'changed' and (note is null or length(note) < 3) then
    raise exception 'say what has changed, so the rule can be corrected';
  end if;

  select * into r from public.compliance_rules
   where id = p_rule and tenant_id = public.effective_tenant() for update;
  if not found then raise exception 'that rule does not exist'; end if;
  if not r.active then raise exception 'that rule is not on the checklist — an admin approves it first'; end if;

  select coalesce(nullif(btrim(display_name), ''), 'a crew member') into who
    from public.profiles where id = auth.uid();
  who := coalesce(who, 'a crew member');

  insert into public.compliance_checks (rule_id, checked_on, checked_by, outcome, checked_against, note, before)
  values (r.id, today, auth.uid(), p_outcome, src, note,
          jsonb_build_object('label', r.label, 'link', r.link, 'authority', r.authority,
                             'lead_days', r.lead_days, 'lead_basis', r.lead_basis, 'verified', r.verified,
                             'verified_on', r.verified_on, 'check_note', r.check_note));

  if p_outcome = 'confirmed' then
    update public.compliance_rules
       set verified = true, verified_on = today, verified_by = auth.uid(),
           check_note = 'Re-checked ' || to_char(today, 'Mon FMDD, YYYY') || ' by ' || who
                        || ' against ' || src || '.' || coalesce(' ' || note, '')
     where id = r.id;
    return 'confirmed';
  end if;

  -- CHANGED. The rule's words stay exactly as they were — nobody here gets to write a permit
  -- requirement by summary — but it stops claiming to be confirmed, says what was heard and from
  -- whom, and the people who can correct it are told.
  update public.compliance_rules
     set verified = false, verified_by = auth.uid(),
         check_note = 'CHANGED, per ' || src || ' on ' || to_char(today, 'Mon FMDD, YYYY') || ' (' || who || '): '
                      || note || ' — not to be relied on until an admin corrects the rule.'
   where id = r.id;
  perform public.alert_open_once(
    'compliance_changed', r.id, 'important', 'prep',
    'A permit rule has changed — ' || left(r.label, 80),
    who || ' checked it against ' || src || ' and was told: ' || note || '. Correct the rule so the checklist says what is true.',
    '/crew?s=prep');
  return 'changed';
end $$;
revoke all on function public.recheck_compliance_rule(uuid, text, text, text) from public, anon;
grant execute on function public.recheck_compliance_rule(uuid, text, text, text) to authenticated;

-- ── 3 · CORRECTED, BY SOMEONE WHO MAY CORRECT IT ───────────────────────────────────────────────
-- Owners and admins: 0027's write policy, kept. Every field is what the authority said, and the
-- check that carries it says where. Clearing a deadline is allowed (lead_days null) — a rule with
-- no deadline is a real thing — but a basis with no number, or a number with no basis, is not.
create or replace function public.correct_compliance_rule(
  p_rule uuid, p_label text, p_link text, p_authority text, p_lead_days int, p_lead_basis text,
  p_checked_against text, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  r public.compliance_rules%rowtype;
  today date := (now() at time zone 'America/New_York')::date;
  src text := btrim(coalesce(p_checked_against, ''));
  note text := nullif(btrim(coalesce(p_note, '')), '');
  lbl text := btrim(coalesce(p_label, ''));
begin
  if not public.is_admin() then raise exception 'only an owner or admin can correct a rule'; end if;
  if length(lbl) < 5 then raise exception 'the rule needs its words'; end if;
  if length(src) < 3 then
    raise exception 'say where you checked it — the county, the agency, the page or the person';
  end if;
  if (p_lead_days is null) <> (p_lead_basis is null) then
    raise exception 'a deadline needs both its number of days and whether they are business or calendar days';
  end if;
  if p_lead_basis is not null and p_lead_basis not in ('business', 'calendar') then
    raise exception 'business or calendar days';
  end if;
  if p_lead_days is not null and p_lead_days < 0 then raise exception 'a deadline cannot be negative'; end if;

  select * into r from public.compliance_rules
   where id = p_rule and tenant_id = public.effective_tenant() for update;
  if not found then raise exception 'that rule does not exist'; end if;

  insert into public.compliance_checks (rule_id, checked_on, checked_by, outcome, checked_against, note, before)
  values (r.id, today, auth.uid(), 'corrected', src, note,
          jsonb_build_object('label', r.label, 'link', r.link, 'authority', r.authority,
                             'lead_days', r.lead_days, 'lead_basis', r.lead_basis, 'verified', r.verified,
                             'verified_on', r.verified_on, 'check_note', r.check_note));

  update public.compliance_rules
     set label = lbl,
         link = nullif(btrim(coalesce(p_link, '')), ''),
         authority = nullif(btrim(coalesce(p_authority, '')), ''),
         lead_days = p_lead_days, lead_basis = p_lead_basis,
         verified = true, verified_on = today, verified_by = auth.uid(),
         check_note = 'Corrected ' || to_char(today, 'Mon FMDD, YYYY') || ' against ' || src || '.' || coalesce(' ' || note, '')
   where id = r.id;

  -- The report that asked for this correction has been answered.
  update public.alerts set ack_at = now()
   where kind = 'compliance_changed' and subject_id = r.id and ack_at is null;
  return 'corrected';
end $$;
revoke all on function public.correct_compliance_rule(uuid, text, text, text, int, text, text, text) from public, anon;
grant execute on function public.correct_compliance_rule(uuid, text, text, text, int, text, text, text) to authenticated;


-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A permit rule can be re-checked from the list that asks for it','improvement','Compliance',
   'Permit rules have carried the date someone last confirmed them since September, and the overdue ones appear under Needs you — but nothing in the app could record a new check, so they could never leave. Tapping one now opens the rule: what it says, who issues it, the page to check it against, and when it was last confirmed. Say where you checked and whether it still stands, and it is dated today. If the authority says something different, the rule is not rewritten by summary — it is marked unconfirmed with what was said and by whom, and an owner can correct its wording, link and deadline from the same place. Every check is kept.',
   '2026-10-04', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0342_checked_with_whom_and_when',
  'compliance_checks (append-only from the app: written only by the two definer functions; staff read; tenant-stamped and isolated) + compliance_rules.verified_by. recheck_compliance_rule (staff): confirmed sets verified/verified_on (ET day)/verified_by and leaves v_obligations; changed never rewrites the rule — marks it unverified with what was said and by whom, and raises compliance_changed (alert_open_once) for the owners. correct_compliance_rule (admin, 0027''s write rule): label/link/authority/lead_days+basis from what the authority said, with where it was checked; acks the compliance_changed alert. "Where you checked" is required everywhere (>= 3 chars); a rule not active (an agent proposal awaiting approval) cannot be re-checked; each check keeps the rule as it stood before.');

-- verify:
--   select column_name from information_schema.columns where table_name = 'compliance_rules' and column_name = 'verified_by';   -- 1 row
--   select polname from pg_policy where polrelid = 'public.compliance_checks'::regclass order by 1;   -- compliance_checks_read, tenant isolation
--   select proname from pg_proc where proname in ('recheck_compliance_rule','correct_compliance_rule');   -- 2
--   select freshness, count(*) from public.v_compliance_freshness group by 1;   -- unchanged until someone checks one
