-- ── 0456 — THE PRIMAL STANDARD, PHASE 1: THE ENGINE ──────────────────────────────────────────────────────────────
-- 2026-10-26. Primal Standard P1 (Ryan, 2026-10-26: S1.1 → link fix → Primal Standard → Expansion; P1 internal; "only
-- owners verify, approve criteria and publish standards").
-- Paste into Supabase → SQL Editor → Run. A second run changes nothing. Needs 0455.
--
-- WHAT.
--   std_versions     — a version of the Standard. Draft, then published (owner only), then retired. A published version
--                      and its criteria never change again: history stays as it was published.
--   std_criteria     — what a version asks, per pillar (stillness, light, fuel, movement): the requirement, what it
--                      applies to (a room, an object, a material), how severe a failure is, the measurements a pass
--                      needs (light can't pass on lumens alone), and whether the task and population must be named.
--   std_materials    — the material registry. A material that declares a watch-list substance opens a review — a
--                      review, never a verdict.
--   std_item_materials — which materials an object in a room is made of. Changing one is a substitution.
--   std_evidence     — one evidence record for everything: what kind (observed, measured, declared, inferred,
--                      illustrative), its source, date, method, coverage, limitations, confidence, measurements and
--                      expiry. It arrives "submitted"; only an owner who didn't submit it can accept it.
--   std_claims       — a sentence someone wants to say. It stays unverified until an owner supports it with accepted
--                      evidence; a prohibited claim (toxin-free, detox, disease prevention, genome…) can never be
--                      supported; medical and scientific claims need measured or observed evidence.
--   std_assessments  — one criterion judged for one room, object or material, by an owner. Hazard, exposure and risk
--                      are separate fields. A pass needs accepted, current, non-illustrative evidence covering the
--                      criterion's measurements, with nothing accepted against it. Unknown is an outcome, never a pass.
--                      A new judgement supersedes the old one; a change to the room, the object or its materials marks
--                      the current judgement stale.
--   std_reviews      — open questions the engine raises (a watch-list match, a rejected piece of evidence an
--                      assessment relied on). Closed by a person.
--   std_subject_summary — per room/object/material: passes, conditionals, fails, unknowns, stale — and whether a
--                      safety-critical fail or a high-severity unknown sits underneath, so a total never hides one.
-- Owners and admins read; admins add materials and submit evidence; owners do everything that verifies. Staff, customers
-- and signed-out callers reach none of it. Nothing here has a commercial column, and nothing commercial writes here.
-- Every change is in Settings › Activity log.
--
-- set lock_timeout (database F16): seven tables, a view, their triggers and policies.
-- existing rows: none changed.
-- rollback: drop view std_subject_summary; drop table std_reviews, std_assessments, std_claims, std_evidence,
--           std_item_materials, std_materials, std_criteria, std_versions cascade; drop the std_* functions.
-- changelog: none — the owners' own screen.

set lock_timeout = '5s';

-- ── tables ──────────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.std_versions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  label        text not null check (length(label) between 1 and 40),
  summary      text check (summary is null or length(summary) <= 2000),
  status       text not null default 'draft' check (status in ('draft','published','retired')),
  published_at timestamptz,
  published_by uuid,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  unique (tenant_id, label)
);

create table if not exists public.std_criteria (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  version_id            uuid not null references public.std_versions(id) on delete cascade,
  pillar                text not null check (pillar in ('stillness','light','fuel','movement')),
  code                  text not null check (length(code) between 1 and 20),
  title                 text not null check (length(title) between 1 and 160),
  requirement           text not null check (length(requirement) between 1 and 2000),
  applies_to            text not null check (applies_to in ('room','object','material')),
  severity              text not null default 'medium' check (severity in ('safety_critical','high','medium','low')),
  evidence_needed       text check (evidence_needed is null or length(evidence_needed) <= 1000),
  required_measures     text[] not null default '{}',
  needs_task_population boolean not null default false,
  sort                  int not null default 0,
  created_at            timestamptz not null default now(),
  unique (version_id, code)
);

create table if not exists public.std_materials (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  name        text not null check (length(name) between 1 and 160),
  category    text not null default 'other' check (category in ('surface','finish','textile','furniture','fixture','lighting','equipment','packaging','ingredient','other')),
  maker       text check (maker is null or length(maker) <= 160),
  product_ref text check (product_ref is null or length(product_ref) <= 160),
  composition text check (composition is null or length(composition) <= 2000),
  watch_list  text[] not null default '{}',
  notes       text check (notes is null or length(notes) <= 2000),
  archived_at timestamptz,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.std_item_materials (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  item_id     uuid not null references public.store_items(id) on delete cascade,
  material_id uuid not null references public.std_materials(id),
  role        text check (role is null or length(role) <= 80),
  created_at  timestamptz not null default now(),
  unique (item_id, material_id)
);
create index if not exists std_item_materials_material on public.std_item_materials (material_id);

create table if not exists public.std_evidence (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  subject_type  text not null check (subject_type in ('room','object','material')),
  subject_id    uuid not null,
  criterion_id  uuid references public.std_criteria(id) on delete set null,
  bearing       text not null default 'supports' check (bearing in ('supports','contradicts','neutral')),
  kind          text not null check (kind in ('observed','measured','declared','inferred','illustrative')),
  summary       text not null check (length(summary) between 1 and 1000),
  source_title  text check (source_title is null or length(source_title) <= 300),
  source_url    text check (source_url is null or (source_url ~ '^https://' and length(source_url) <= 1000)),
  source_date   date,
  method        text check (method is null or length(method) <= 1000),
  coverage      text check (coverage is null or length(coverage) <= 500),
  limitations   text check (limitations is null or length(limitations) <= 1000),
  confidence    text not null default 'low' check (confidence in ('low','medium','high')),
  measures      jsonb not null default '{}' check (jsonb_typeof(measures) = 'object'),
  expires_on    date,
  review_status text not null default 'submitted' check (review_status in ('submitted','accepted','rejected')),
  review_note   text check (review_note is null or length(review_note) <= 1000),
  submitted_by  uuid default auth.uid(),
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists std_evidence_subject on public.std_evidence (subject_type, subject_id);
create index if not exists std_evidence_criterion on public.std_evidence (criterion_id) where criterion_id is not null;

create table if not exists public.std_claims (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  subject_type text check (subject_type is null or subject_type in ('room','object','material','gt3')),
  subject_id   uuid,
  text         text not null check (length(text) between 1 and 600),
  kind         text not null default 'aspiration' check (kind in ('aspiration','marketing','scientific','medical')),
  status       text not null default 'unverified' check (status in ('unverified','supported','not_supported')),
  evidence_ids uuid[] not null default '{}',
  reviewed_by  uuid,
  reviewed_at  timestamptz,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);

create table if not exists public.std_assessments (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  version_id    uuid not null references public.std_versions(id),
  criterion_id  uuid not null references public.std_criteria(id),
  subject_type  text not null check (subject_type in ('room','object','material')),
  subject_id    uuid not null,
  outcome       text not null check (outcome in ('pass','conditional','fail','unknown')),
  hazard        text check (hazard is null or length(hazard) <= 600),
  exposure      text check (exposure is null or length(exposure) <= 600),
  risk          text not null default 'unknown' check (risk in ('low','medium','high','unknown')),
  task          text check (task is null or length(task) <= 300),
  population    text check (population is null or length(population) <= 300),
  evidence_ids  uuid[] not null default '{}',
  notes         text check (notes is null or length(notes) <= 2000),
  assessed_by   uuid default auth.uid(),
  assessed_at   timestamptz not null default now(),
  stale_at      timestamptz,
  stale_reason  text,
  superseded_by uuid references public.std_assessments(id),
  created_at    timestamptz not null default now()
);
create index if not exists std_assessments_criterion on public.std_assessments (criterion_id);
create index if not exists std_assessments_version on public.std_assessments (version_id);
create index if not exists std_assessments_superseded on public.std_assessments (superseded_by) where superseded_by is not null;
create index if not exists std_assessments_subject on public.std_assessments (subject_type, subject_id) where superseded_by is null;

create table if not exists public.std_reviews (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  subject_type text not null check (subject_type in ('room','object','material','evidence','assessment')),
  subject_id   uuid not null,
  reason       text not null check (length(reason) between 1 and 600),
  status       text not null default 'open' check (status in ('open','closed')),
  closed_by    uuid,
  closed_at    timestamptz,
  created_at   timestamptz not null default now()
);
create unique index if not exists std_reviews_one_open on public.std_reviews (subject_type, subject_id, reason) where status = 'open';

-- RLS on from the moment each table exists (the loop below adds the policies, grants and audit).
alter table public.std_versions enable row level security;
alter table public.std_criteria enable row level security;
alter table public.std_materials enable row level security;
alter table public.std_item_materials enable row level security;
alter table public.std_evidence enable row level security;
alter table public.std_claims enable row level security;
alter table public.std_assessments enable row level security;
alter table public.std_reviews enable row level security;

-- ── the words that can never be supported ───────────────────────────────────────────────────────────────────────────
create or replace function public.std_prohibited_claim(p text)
returns boolean language sql immutable set search_path = public as $$
  select lower(coalesce(p, '')) ~ any (array[
    'non[- ]?toxic', 'toxin[- ]?free', 'chemical[- ]?free', 'zero (physiological )?stress', 'universally (harmless|safe)',
    'detox', 'prevents? (disease|illness|cancer)', 'disease prevention', '\mcures?\M', 'genome', 'gene expression',
    'guaranteed (posture|circadian|health|sleep)', '100% safe', 'completely harmless'])
$$;
grant execute on function public.std_prohibited_claim(text) to authenticated;

-- ── guards ──────────────────────────────────────────────────────────────────────────────────────────────────────────
-- A subject belongs to the same tenant as the record about it — no evidence, judgement or material link reaches across.
create or replace function public.std_subject_ok(p_type text, p_id uuid, p_tenant uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_type
    when 'room'     then exists (select 1 from public.store_layouts where id = p_id and tenant_id is not distinct from p_tenant)
    when 'object'   then exists (select 1 from public.store_items  where id = p_id and tenant_id is not distinct from p_tenant)
    when 'material' then exists (select 1 from public.std_materials where id = p_id and tenant_id is not distinct from p_tenant)
    else false end
$$;
revoke all on function public.std_subject_ok(text, uuid, uuid) from public, anon, authenticated;
create or replace function public.std_owner_only(p_what text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_owner() then
    raise exception 'Only an owner can %.', p_what using errcode = 'PT403';
  end if;
end $$;
revoke all on function public.std_owner_only(text) from public, anon, authenticated;

create or replace function public.std_version_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'A published version is kept as it was published.' using errcode = 'PT409'; end if;
    perform public.std_owner_only('delete a version of the Standard');
    return old;
  end if;
  perform public.std_owner_only('write the Standard');
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then raise exception 'A version starts as a draft.' using errcode = 'PT409'; end if;
    return new;
  end if;
  if old.status = 'retired' then raise exception 'A retired version is kept as it was published.' using errcode = 'PT409'; end if;
  if old.status = 'published' then
    if new.status = 'retired' and new.label = old.label and new.summary is not distinct from old.summary
       and new.published_at = old.published_at and new.published_by is not distinct from old.published_by then
      return new;
    end if;
    raise exception 'A published version is kept as it was published.' using errcode = 'PT409';
  end if;
  if new.status = 'published' then
    if not exists (select 1 from public.std_criteria c where c.version_id = new.id) then
      raise exception 'A version needs at least one criterion before it is published.' using errcode = 'PT409';
    end if;
    new.published_at := now();
    new.published_by := auth.uid();
  elsif new.status = 'retired' then
    raise exception 'Only a published version can be retired.' using errcode = 'PT409';
  end if;
  return new;
end $$;
revoke all on function public.std_version_guard() from public, anon, authenticated;
drop trigger if exists std_version_guard_tg on public.std_versions;
create trigger std_version_guard_tg before insert or update or delete on public.std_versions for each row execute function public.std_version_guard();

create or replace function public.std_criterion_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  perform public.std_owner_only('approve the criteria');
  select status into v_status from public.std_versions where id = case when tg_op = 'DELETE' then old.version_id else new.version_id end;
  if v_status is distinct from 'draft' and v_status is not null then
    raise exception 'A published version''s criteria are kept as they were published.' using errcode = 'PT409';
  end if;
  if tg_op = 'UPDATE' and new.version_id <> old.version_id then
    raise exception 'A criterion stays in its version.' using errcode = 'PT409';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.pillar = 'light' and new.applies_to in ('room','object') and cardinality(new.required_measures) > 0
     and new.required_measures <@ array['lumens','lm']::text[] then
    raise exception 'Light can''t be judged on lumens alone — name the other measurements too.' using errcode = 'PT422';
  end if;
  return new;
end $$;
revoke all on function public.std_criterion_guard() from public, anon, authenticated;
drop trigger if exists std_criterion_guard_tg on public.std_criteria;
create trigger std_criterion_guard_tg before insert or update or delete on public.std_criteria for each row execute function public.std_criterion_guard();

create or replace function public.std_evidence_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.review_status <> 'submitted' or new.reviewed_by is not null or new.reviewed_at is not null then
      raise exception 'Evidence arrives submitted; an owner reviews it.' using errcode = 'PT409';
    end if;
    if not public.std_subject_ok(new.subject_type, new.subject_id, new.tenant_id) then
      raise exception 'That % isn''t one of yours.', new.subject_type using errcode = 'PT403';
    end if;
    if auth.uid() is not null then new.submitted_by := auth.uid(); end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.review_status = 'accepted' then raise exception 'Accepted evidence is kept; reject it instead.' using errcode = 'PT409'; end if;
    return old;
  end if;
  if new.subject_type <> old.subject_type or new.subject_id <> old.subject_id or new.kind <> old.kind or new.summary <> old.summary
     or new.source_url is distinct from old.source_url or new.source_title is distinct from old.source_title
     or new.source_date is distinct from old.source_date or new.measures <> old.measures or new.bearing <> old.bearing
     or new.criterion_id is distinct from old.criterion_id or new.confidence <> old.confidence
     or new.expires_on is distinct from old.expires_on or new.submitted_by is distinct from old.submitted_by
     or new.method is distinct from old.method or new.limitations is distinct from old.limitations
     or new.coverage is distinct from old.coverage then
    if old.review_status <> 'submitted' then
      raise exception 'Reviewed evidence is kept as it was reviewed; submit a new piece instead.' using errcode = 'PT409';
    end if;
  end if;
  if new.review_status is distinct from old.review_status then
    perform public.std_owner_only('review evidence');
    if new.review_status = 'submitted' then raise exception 'Evidence can''t be un-reviewed.' using errcode = 'PT409'; end if;
    if auth.uid() is not null and auth.uid() = old.submitted_by then
      raise exception 'Evidence is reviewed by someone other than the person who submitted it.' using errcode = 'PT403';
    end if;
    if old.review_status = 'rejected' then raise exception 'Rejected evidence stays rejected; submit it again.' using errcode = 'PT409'; end if;
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
    if new.review_status = 'rejected' and old.review_status = 'accepted' then
      update public.std_assessments set stale_at = now(), stale_reason = 'Evidence it relied on was rejected.'
       where old.id = any(evidence_ids) and superseded_by is null and stale_at is null;
    end if;
  elsif new.reviewed_by is distinct from old.reviewed_by or new.reviewed_at is distinct from old.reviewed_at then
    raise exception 'Only a review records a reviewer.' using errcode = 'PT409';
  end if;
  return new;
end $$;
revoke all on function public.std_evidence_guard() from public, anon, authenticated;
drop trigger if exists std_evidence_guard_tg on public.std_evidence;
create trigger std_evidence_guard_tg before insert or update or delete on public.std_evidence for each row execute function public.std_evidence_guard();

create or replace function public.std_claim_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ok int;
begin
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'unverified' or new.reviewed_by is not null then
      raise exception 'A claim starts unverified.' using errcode = 'PT409';
    end if;
    return new;
  end if;
  if new.text <> old.text and old.status <> 'unverified' then
    raise exception 'A reviewed claim is kept as worded; write a new one.' using errcode = 'PT409';
  end if;
  if new.status is distinct from old.status or new.evidence_ids is distinct from old.evidence_ids then
    perform public.std_owner_only('verify a claim');
    if new.status = 'supported' then
      if public.std_prohibited_claim(new.text) then
        raise exception 'This claim can''t be supported by GT3 in any form. Reword it as an aspiration or an unverified hypothesis.' using errcode = 'PT422';
      end if;
      select count(*) into v_ok from public.std_evidence e
       where e.id = any(new.evidence_ids) and e.review_status = 'accepted' and (e.expires_on is null or e.expires_on >= current_date)
         and e.bearing = 'supports'
         and (new.kind in ('aspiration','marketing') and e.kind <> 'illustrative' or e.kind in ('measured','observed'));
      if new.kind = 'aspiration' then
        raise exception 'An aspiration stays an aspiration; make it a marketing, scientific or medical claim to support it.' using errcode = 'PT422';
      end if;
      if v_ok = 0 then
        raise exception 'A supported claim needs accepted, current evidence%.',
          case when new.kind in ('scientific','medical') then ' that was measured or observed' else '' end using errcode = 'PT422';
      end if;
    end if;
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;
  return new;
end $$;
revoke all on function public.std_claim_guard() from public, anon, authenticated;
drop trigger if exists std_claim_guard_tg on public.std_claims;
create trigger std_claim_guard_tg before insert or update or delete on public.std_claims for each row execute function public.std_claim_guard();

create or replace function public.std_assessment_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare c record; v_status text; v_good int; v_against int; v_have text[]; m text;
begin
  if tg_op = 'DELETE' then raise exception 'Assessments are history; record a new one instead.' using errcode = 'PT409'; end if;
  if tg_op = 'UPDATE' then
    -- Only the engine's bookkeeping changes a recorded judgement: stale flags and who replaced it.
    if (new.outcome, new.hazard, new.exposure, new.risk, new.task, new.population, new.evidence_ids, new.notes, new.version_id,
        new.criterion_id, new.subject_type, new.subject_id, new.assessed_by, new.assessed_at)
       is distinct from
       (old.outcome, old.hazard, old.exposure, old.risk, old.task, old.population, old.evidence_ids, old.notes, old.version_id,
        old.criterion_id, old.subject_type, old.subject_id, old.assessed_by, old.assessed_at) then
      raise exception 'A recorded assessment is kept as recorded; reassess instead.' using errcode = 'PT409';
    end if;
    if old.stale_at is not null and new.stale_at is null then
      raise exception 'A stale assessment is cleared by reassessing.' using errcode = 'PT409';
    end if;
    return new;
  end if;

  perform public.std_owner_only('assess against the Standard');
  if auth.uid() is not null then new.assessed_by := auth.uid(); end if;
  new.assessed_at := now(); new.stale_at := null; new.stale_reason := null; new.superseded_by := null;

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

-- A new judgement replaces the current one for the same criterion and subject.
create or replace function public.std_assessment_supersede()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.std_assessments set superseded_by = new.id
   where criterion_id = new.criterion_id and subject_type = new.subject_type and subject_id = new.subject_id
     and id <> new.id and superseded_by is null;
  return null;
end $$;
revoke all on function public.std_assessment_supersede() from public, anon, authenticated;
drop trigger if exists std_assessment_supersede_tg on public.std_assessments;
create trigger std_assessment_supersede_tg after insert on public.std_assessments for each row execute function public.std_assessment_supersede();

-- ── stale: a change reaches every judgement that depended on it ─────────────────────────────────────────────────────
create or replace function public.std_mark_stale(p_type text, p_ids uuid[], p_reason text)
returns void language sql security definer set search_path = public as $$
  update public.std_assessments set stale_at = now(), stale_reason = p_reason
   where subject_type = p_type and subject_id = any(p_ids) and superseded_by is null and stale_at is null;
$$;
revoke all on function public.std_mark_stale(text, uuid[], text) from public, anon, authenticated;

create or replace function public.std_item_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if (new.kind, new.w_in, new.d_in, new.h_in) is distinct from (old.kind, old.w_in, old.d_in, old.h_in) then
      perform public.std_mark_stale('object', array[new.id], 'The object changed.');
    end if;
    if (new.kind, new.w_in, new.d_in, new.h_in, new.x_in, new.y_in, new.rot, new.layout_id)
       is distinct from (old.kind, old.w_in, old.d_in, old.h_in, old.x_in, old.y_in, old.rot, old.layout_id) then
      perform public.std_mark_stale('room', array[new.layout_id, old.layout_id], 'An object in the room changed.');
    end if;
  elsif tg_op = 'INSERT' then
    perform public.std_mark_stale('room', array[new.layout_id], 'An object was added to the room.');
  else
    perform public.std_mark_stale('room', array[old.layout_id], 'An object was removed from the room.');
    perform public.std_mark_stale('object', array[old.id], 'The object was removed.');
  end if;
  return null;
end $$;
revoke all on function public.std_item_changed() from public, anon, authenticated;
drop trigger if exists std_item_changed_tg on public.store_items;
create trigger std_item_changed_tg after insert or update or delete on public.store_items for each row execute function public.std_item_changed();

create or replace function public.std_layout_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.width_in, new.depth_in, new.ceiling_in) is distinct from (old.width_in, old.depth_in, old.ceiling_in) then
    perform public.std_mark_stale('room', array[new.id], 'The room''s size changed.');
  end if;
  return null;
end $$;
revoke all on function public.std_layout_changed() from public, anon, authenticated;
drop trigger if exists std_layout_changed_tg on public.store_layouts;
create trigger std_layout_changed_tg after update on public.store_layouts for each row execute function public.std_layout_changed();

create or replace function public.std_item_material_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.std_subject_ok('object', new.item_id, new.tenant_id) or not public.std_subject_ok('material', new.material_id, new.tenant_id) then
    raise exception 'That object or material isn''t one of yours.' using errcode = 'PT403';
  end if;
  return new;
end $$;
revoke all on function public.std_item_material_guard() from public, anon, authenticated;
drop trigger if exists std_item_material_guard_tg on public.std_item_materials;
create trigger std_item_material_guard_tg before insert or update on public.std_item_materials for each row execute function public.std_item_material_guard();

create or replace function public.std_item_material_changed()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_item uuid := case when tg_op = 'DELETE' then old.item_id else new.item_id end; v_layout uuid;
begin
  select layout_id into v_layout from public.store_items where id = v_item;
  perform public.std_mark_stale('object', array[v_item], 'A material in the object was substituted.');
  if v_layout is not null then perform public.std_mark_stale('room', array[v_layout], 'A material in the room was substituted.'); end if;
  return null;
end $$;
revoke all on function public.std_item_material_changed() from public, anon, authenticated;
drop trigger if exists std_item_material_changed_tg on public.std_item_materials;
create trigger std_item_material_changed_tg after insert or update or delete on public.std_item_materials for each row execute function public.std_item_material_changed();

create or replace function public.std_material_changed()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_items uuid[]; v_layouts uuid[];
begin
  if tg_op = 'UPDATE' and (new.name, new.category, new.maker, new.product_ref, new.composition, new.watch_list)
     is not distinct from (old.name, old.category, old.maker, old.product_ref, old.composition, old.watch_list) then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    perform public.std_mark_stale('material', array[new.id], 'The material''s details changed.');
    select coalesce(array_agg(im.item_id), '{}'), coalesce(array_agg(distinct i.layout_id), '{}') into v_items, v_layouts
      from public.std_item_materials im join public.store_items i on i.id = im.item_id where im.material_id = new.id;
    perform public.std_mark_stale('object', v_items, 'A material in the object changed.');
    perform public.std_mark_stale('room', v_layouts, 'A material in the room changed.');
  end if;
  if cardinality(new.watch_list) > 0 and (tg_op = 'INSERT' or new.watch_list is distinct from old.watch_list) then
    insert into public.std_reviews (tenant_id, subject_type, subject_id, reason)
    values (new.tenant_id, 'material', new.id, 'Declares a watch-list substance: ' || array_to_string(new.watch_list, ', ') || '. Review the exposure — a match is not a verdict.')
    on conflict do nothing;
  end if;
  return null;
end $$;
revoke all on function public.std_material_changed() from public, anon, authenticated;
drop trigger if exists std_material_changed_tg on public.std_materials;
create trigger std_material_changed_tg after insert or update on public.std_materials for each row execute function public.std_material_changed();

create or replace function public.std_review_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status = 'closed' and old.status = 'open' then
    new.closed_by := auth.uid(); new.closed_at := now();
  elsif tg_op = 'UPDATE' and (new.subject_type, new.subject_id, new.reason) is distinct from (old.subject_type, old.subject_id, old.reason) then
    raise exception 'A review keeps its question.' using errcode = 'PT409';
  end if;
  return new;
end $$;
revoke all on function public.std_review_guard() from public, anon, authenticated;
drop trigger if exists std_review_guard_tg on public.std_reviews;
create trigger std_review_guard_tg before update on public.std_reviews for each row execute function public.std_review_guard();

-- ── access: owners and admins, one tenant, every change logged ──────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['std_versions','std_criteria','std_materials','std_item_materials','std_evidence','std_claims','std_assessments','std_reviews'] loop
    execute format('drop trigger if exists stamp_tenant_tg on public.%I', t);
    execute format('create trigger stamp_tenant_tg before insert on public.%I for each row execute function public.stamp_tenant()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "std admin" on public.%I', t);
    execute format('create policy "std admin" on public.%I for all using ((select public.is_admin())) with check ((select public.is_admin()))', t);
    execute format('drop policy if exists "tenant isolation" on public.%I', t);
    execute format('create policy "tenant isolation" on public.%I as restrictive for all using (tenant_id = (select public.effective_tenant())) with check (tenant_id = (select public.effective_tenant()))', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop trigger if exists admin_audit_%s on public.%I', t, t);
    execute format('create trigger admin_audit_%s after insert or update or delete on public.%I for each row execute function public.log_admin_audit()', t, t);
  end loop;
end $$;

-- ── the summary that can't hide a failure ───────────────────────────────────────────────────────────────────────────
create or replace view public.std_subject_summary with (security_invoker = true) as
select a.subject_type, a.subject_id,
       count(*) filter (where a.outcome = 'pass' and a.stale_at is null)          as passes,
       count(*) filter (where a.outcome = 'conditional' and a.stale_at is null)   as conditionals,
       count(*) filter (where a.outcome = 'fail')                                 as fails,
       count(*) filter (where a.outcome = 'unknown')                              as unknowns,
       count(*) filter (where a.stale_at is not null)                             as stale,
       bool_or(a.outcome = 'fail' and c.severity = 'safety_critical')             as critical_fail,
       bool_or(a.outcome = 'unknown' and c.severity in ('safety_critical','high')) as serious_unknown,
       max(a.assessed_at)                                                         as last_assessed_at
  from public.std_assessments a join public.std_criteria c on c.id = a.criterion_id
 where a.superseded_by is null
 group by a.subject_type, a.subject_id;
revoke all on public.std_subject_summary from public, anon, authenticated;
grant select on public.std_subject_summary to authenticated;

-- verify (numbers only):
--   select count(*) from public.std_versions;   -- 0 (first run)
select public.record_migration('0456_the_primal_standard_engine');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
