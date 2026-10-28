-- ── 0457 — ASSESSED, THEN VERIFIED (P1.1) ───────────────────────────────────────────────────────────────────────────
-- 2026-10-28. Primal Standard P1.1 (Ryan, 2026-10-26: "only owners verify, approve criteria and publish standards"; the
-- Primal Significance Score approved as a draft — "provisional, owners-only, unpublished until you approve the method
-- version"). Paste into Supabase → SQL Editor → Run, together with 0456 — never 0456 alone. A second run changes nothing.
-- Needs 0456.
--
-- WHAT.
--   A judgement is PROPOSED, then VERIFIED. An owner or an admin proposes one (std_assessments, verification
--   'proposed'); only an owner verifies it. The database says which: 'independent' when the owner verifying it is not
--   the one who proposed it, 'self' when they are — allowed, and labelled, never passed off as independent. A
--   verified judgement is never un-verified; a stale one is reassessed, not verified.
--   Not applicable: an outcome only with a reason, and it counts as excluded only once an owner approves it (the
--   verifying owner is its approver). Until then it scores as unknown.
--   Confidence (low, medium, high) on a judgement, beside the evidence's own.
--   std_criteria: weight within its pillar (1 = equal; up to 10), mandatory (not met → "not certifiable" whatever the
--   number), and the operating models it applies to (empty = every one). Set on a draft; a published version keeps them.
--   std_subject_summary — as 0456, plus how many current judgements are not applicable, and how many await verification.
--
-- set lock_timeout (database F16): new columns on two empty-in-production tables (0456 arrives in the same paste), one
-- check replaced, one guard replaced, one view replaced (columns added at the end).
-- existing rows: none (0456's tables are new).
-- rollback: re-run 0456's std_assessment_guard and std_subject_summary; drop the columns named here.
-- changelog: none — the owners' own screen.

set lock_timeout = '5s';

alter table public.std_criteria add column if not exists weight numeric(4,2) not null default 1;
alter table public.std_criteria add column if not exists mandatory boolean not null default false;
alter table public.std_criteria add column if not exists models text[] not null default '{}';
alter table public.std_criteria drop constraint if exists std_criteria_weight;
alter table public.std_criteria add constraint std_criteria_weight check (weight > 0 and weight <= 10);
alter table public.std_criteria drop constraint if exists std_criteria_models;
alter table public.std_criteria add constraint std_criteria_models check (
  models <@ array['gym_bar','kiosk','partner_menu','pop_up','storefront_lease','storefront_buy','shared_space','other']::text[]);

alter table public.std_assessments add column if not exists verification text not null default 'proposed';
alter table public.std_assessments add column if not exists verified_by uuid;
alter table public.std_assessments add column if not exists verified_at timestamptz;
alter table public.std_assessments add column if not exists na_reason text;
alter table public.std_assessments add column if not exists na_approved_by uuid;
alter table public.std_assessments add column if not exists confidence text;
alter table public.std_assessments drop constraint if exists std_assessments_outcome_check;
alter table public.std_assessments add constraint std_assessments_outcome_check check (outcome in ('pass','conditional','fail','unknown','not_applicable'));
alter table public.std_assessments drop constraint if exists std_assessments_verification;
alter table public.std_assessments add constraint std_assessments_verification check (
  (verification = 'proposed' and verified_by is null and verified_at is null)
  or (verification in ('independent','self') and verified_at is not null));
alter table public.std_assessments drop constraint if exists std_assessments_na;
alter table public.std_assessments add constraint std_assessments_na check (
  (outcome = 'not_applicable' and length(btrim(coalesce(na_reason, ''))) between 1 and 600)
  or (outcome <> 'not_applicable' and na_reason is null and na_approved_by is null));
alter table public.std_assessments drop constraint if exists std_assessments_confidence;
alter table public.std_assessments add constraint std_assessments_confidence check (confidence is null or confidence in ('low','medium','high'));
create index if not exists std_assessments_waiting on public.std_assessments (verification) where verification = 'proposed' and superseded_by is null;

create or replace function public.std_assessment_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare c record; v_status text; v_good int; v_against int; v_have text[]; m text;
begin
  if tg_op = 'DELETE' then raise exception 'Assessments are history; record a new one instead.' using errcode = 'PT409'; end if;
  if tg_op = 'UPDATE' then
    -- What was judged is kept as judged: only the engine's bookkeeping (stale, replaced) and an owner's verification change.
    if (new.outcome, new.hazard, new.exposure, new.risk, new.task, new.population, new.evidence_ids, new.notes, new.version_id,
        new.criterion_id, new.subject_type, new.subject_id, new.assessed_by, new.assessed_at, new.na_reason, new.confidence)
       is distinct from
       (old.outcome, old.hazard, old.exposure, old.risk, old.task, old.population, old.evidence_ids, old.notes, old.version_id,
        old.criterion_id, old.subject_type, old.subject_id, old.assessed_by, old.assessed_at, old.na_reason, old.confidence) then
      raise exception 'A recorded assessment is kept as recorded; reassess instead.' using errcode = 'PT409';
    end if;
    if old.stale_at is not null and new.stale_at is null then
      raise exception 'A stale assessment is cleared by reassessing.' using errcode = 'PT409';
    end if;
    if (new.verification, new.verified_by, new.verified_at, new.na_approved_by)
       is distinct from (old.verification, old.verified_by, old.verified_at, old.na_approved_by) then
      if old.verification <> 'proposed' then
        raise exception 'A verified judgement stays verified; reassess to change it.' using errcode = 'PT409';
      end if;
      if new.verification = 'proposed' then
        raise exception 'Verify it, or leave it proposed.' using errcode = 'PT409';
      end if;
      perform public.std_owner_only('verify a judgement');
      if old.stale_at is not null or old.superseded_by is not null then
        raise exception 'This judgement is stale or replaced — reassess it instead of verifying it.' using errcode = 'PT409';
      end if;
      -- The database says whose verification it is; the screen can't call a self-verification independent.
      new.verified_by := auth.uid();
      new.verified_at := now();
      new.verification := case when auth.uid() is not null and auth.uid() is not distinct from old.assessed_by then 'self' else 'independent' end;
      new.na_approved_by := case when new.outcome = 'not_applicable' then auth.uid() else null end;
    end if;
    return new;
  end if;

  -- A proposal: an owner or an admin (the policy keeps everyone else out). Nobody arrives verified.
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Only an owner or an admin can propose a judgement.' using errcode = 'PT403';
  end if;
  if auth.uid() is not null then new.assessed_by := auth.uid(); end if;
  new.assessed_at := now(); new.stale_at := null; new.stale_reason := null; new.superseded_by := null;
  new.verification := 'proposed'; new.verified_by := null; new.verified_at := null; new.na_approved_by := null;

  if not public.std_subject_ok(new.subject_type, new.subject_id, new.tenant_id) then
    raise exception 'That % isn''t one of yours.', new.subject_type using errcode = 'PT403';
  end if;
  select * into c from public.std_criteria where id = new.criterion_id;
  select status into v_status from public.std_versions where id = new.version_id;
  if c.id is null or c.version_id <> new.version_id then raise exception 'That criterion isn''t in that version.' using errcode = 'PT422'; end if;
  if v_status <> 'published' then raise exception 'Assess against a published version.' using errcode = 'PT409'; end if;
  if c.applies_to <> new.subject_type then
    raise exception 'That criterion applies to a %, not a %.', c.applies_to, new.subject_type using errcode = 'PT422';
  end if;
  if new.outcome = 'not_applicable' then
    if length(btrim(coalesce(new.na_reason, ''))) = 0 then
      raise exception 'Say why it doesn''t apply — not applicable needs a reason, and an owner approves it.' using errcode = 'PT422';
    end if;
    return new;
  end if;
  new.na_reason := null;
  if c.needs_task_population and new.outcome <> 'unknown' and (coalesce(trim(new.task), '') = '' or coalesce(trim(new.population), '') = '') then
    raise exception 'Name the task and who it''s for — this criterion is judged for a task and a population.' using errcode = 'PT422';
  end if;

  if new.outcome in ('pass','conditional') then
    select count(*), coalesce(array_agg(distinct k), '{}') into v_good, v_have
      from public.std_evidence e left join lateral jsonb_object_keys(e.measures) k on true
     where e.id = any(new.evidence_ids) and e.review_status = 'accepted' and e.bearing = 'supports'
       and e.kind <> 'illustrative' and (e.expires_on is null or e.expires_on >= current_date)
       and e.subject_type = new.subject_type and e.subject_id = new.subject_id;
    if v_good = 0 then
      raise exception 'A % needs accepted, current evidence about this %. Without it the outcome is unknown.', new.outcome, new.subject_type using errcode = 'PT422';
    end if;
    if new.outcome = 'pass' then
      foreach m in array c.required_measures loop
        if not (m = any(v_have)) then
          raise exception 'A pass needs the measurement "%" in its evidence.', m using errcode = 'PT422';
        end if;
      end loop;
      select count(*) into v_against from public.std_evidence e
       where e.subject_type = new.subject_type and e.subject_id = new.subject_id and e.review_status = 'accepted'
         and e.bearing = 'contradicts' and (e.criterion_id is null or e.criterion_id = new.criterion_id)
         and (e.expires_on is null or e.expires_on >= current_date);
      if v_against > 0 then
        raise exception 'Accepted evidence contradicts this — the evidence conflicts, so it can''t pass. Record conditional or unknown.' using errcode = 'PT422';
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.std_assessment_guard() from public, anon, authenticated;
drop trigger if exists std_assessment_guard_tg on public.std_assessments;
create trigger std_assessment_guard_tg before insert or update or delete on public.std_assessments for each row execute function public.std_assessment_guard();

-- The summary that can't hide a failure — as 0456, with not applicable kept apart and the unverified counted.
create or replace view public.std_subject_summary with (security_invoker = true) as
select a.subject_type, a.subject_id,
       count(*) filter (where a.outcome = 'pass' and a.stale_at is null)          as passes,
       count(*) filter (where a.outcome = 'conditional' and a.stale_at is null)   as conditionals,
       count(*) filter (where a.outcome = 'fail')                                 as fails,
       count(*) filter (where a.outcome = 'unknown')                              as unknowns,
       count(*) filter (where a.stale_at is not null)                             as stale,
       bool_or(a.outcome = 'fail' and c.severity = 'safety_critical')             as critical_fail,
       bool_or(a.outcome = 'unknown' and c.severity in ('safety_critical','high')) as serious_unknown,
       max(a.assessed_at)                                                         as last_assessed_at,
       count(*) filter (where a.outcome = 'not_applicable')                       as not_applicable,
       count(*) filter (where a.verification = 'proposed')                        as unverified
  from public.std_assessments a join public.std_criteria c on c.id = a.criterion_id
 where a.superseded_by is null
 group by a.subject_type, a.subject_id;
revoke all on public.std_subject_summary from public, anon, authenticated;
grant select on public.std_subject_summary to authenticated;

-- verify (numbers only):
--   select count(*) from public.std_assessments where verification <> 'proposed' and verified_by is null;   -- 0
select public.record_migration('0457_assessed_then_verified');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
