-- ⚠️ NEVER include files from supabase/pending/ in this bundle — those are soak-gated (see
-- supabase/pending/0224_field_ops_contract.sql) and applying them early is irreversible.
--
-- ── GENERATED FILE — DO NOT EDIT BY HAND ─────────────────────────────────────────────────────
-- Regenerate with:  npm run migrations:pending -- --write
--
-- This file is the OUTPUT of comparing supabase/migrations/ against what production's ledger
-- (public.schema_migrations, via /api/migrations) says has actually been applied. Its previous
-- hand-maintained version said "apply all pending migrations" and stopped at 0035 while this
-- directory held 326 files — wrong by 291 migrations, referenced by nothing, checked by nothing.
--
-- The line below is what stops that happening again: scripts/drift.check.mjs fails the release
-- if supabase/migrations/ ever holds a migration numbered above it.
--
-- EACH MIGRATION IS ITS OWN TRANSACTION (R32 — the 10/10 audit, DB11-04 and OPS11-03). A paste runs as one transaction
-- unless it says otherwise, so a lock one migration took was held to the end of all of them, and one that stopped took
-- the others back with it. Each section below is wrapped in its own begin … commit: its locks end with it, and if one
-- stops (a busy table's lock wait ran out), the ones above it stay applied and nothing below it runs — paste the file
-- again a moment later; a migration already applied changes nothing the second time.
-- pending-from: 0458
-- generated-at: 2026-10-28
-- pending-count: 3
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- ============================================================
-- 0456_the_primal_standard_engine.sql
-- ============================================================
begin;   -- 0456, its own transaction: if it stops, what is above it stays applied and nothing below it runs — paste the file again
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
commit;  -- 0456

-- ============================================================
-- 0457_assessed_then_verified.sql
-- ============================================================
begin;   -- 0457, its own transaction: if it stops, what is above it stays applied and nothing below it runs — paste the file again
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
commit;  -- 0457

-- ============================================================
-- 0458_what_was_approved_stays_approved.sql
-- ============================================================
begin;   -- 0458, its own transaction: if it stops, what is above it stays applied and nothing below it runs — paste the file again
-- ── 0458 — WHAT WAS APPROVED STAYS APPROVED ──────────────────────────────────────────────────────────────────────────
-- 2026-10-27. The consolidated baseline challenge (F7, F8): an investor link read the plan's baseline, research and risks
-- LIVE — approving new numbers silently changed what an investor had already been sent — and approving a baseline wrote
-- over the one before, so an earlier approved plan could not be read back. Ryan: "Never rewrite an earlier approved
-- plan… Ensure investor links reference immutable approved snapshots." Paste into Supabase → SQL Editor → Run. A second
-- run changes nothing. Needs 0455.
--
-- WHAT.
--   vision_plan_versions — one row per approval, written by the database when a baseline is approved (or an owner's
--   acknowledgement is recorded with it): the baseline, the case in words, the accepted research and the risks as they
--   stood. Never updated, never deleted (a trigger refuses both, for everyone). Owners and admins read them.
--   vision_shares.pinned_at — the moment a link's case is fixed at. A new link is pinned when it's made; only an owner can
--   move the pin ("update to the latest approval").
--   vision_shared — as 0455, but each plan's money, risks, case words and research come from the latest version approved
--   at or before the pin. The roadmap around the case (status, needs, rooms, asks) stays as it is now.
--   Existing plans with a baseline get version 1 (approved when their baseline was; research and risks as of this run).
--   Existing links are pinned to this run, so each keeps showing exactly what it showed.
--
-- set lock_timeout (database F16): one table, one column with no rewrite (nullable, then backfilled), three triggers,
-- one function replaced (same signature).
-- existing rows: vision_plan_versions — one per approved baseline; vision_shares — pinned_at set once.
-- rollback: re-run 0455's vision_shared; drop trigger vision_money_version_tg on vision_plan_money; drop table
--   vision_plan_versions; alter table vision_shares drop column pinned_at.
-- changelog: none — the owner's plans and links.

set lock_timeout = '5s';

create table if not exists public.vision_plan_versions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  -- No foreign key on purpose: an approved version outlives the plan it was approved for.
  plan_id     uuid not null,
  version     int  not null check (version >= 1),
  baseline    jsonb not null check (jsonb_typeof(baseline) = 'object' and baseline ? 'scenarios' and baseline ? 'structure'),
  plan        jsonb not null default '{}'::jsonb,
  research    jsonb not null default '[]'::jsonb,
  risks       jsonb not null default '[]'::jsonb,
  approved_at timestamptz not null default now(),
  approved_by uuid,
  created_at  timestamptz not null default now(),
  unique (plan_id, version)
);
create index if not exists vision_plan_versions_plan on public.vision_plan_versions (plan_id, version desc);

-- Never rewritten: no update, no delete — for an owner, an admin or the service role alike.
create or replace function public.vision_version_frozen()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'An approved version is never changed or removed — approve a new one.' using errcode = 'PT403';
end $$;
drop trigger if exists vision_version_frozen_tg on public.vision_plan_versions;
create trigger vision_version_frozen_tg before update or delete on public.vision_plan_versions for each row execute function public.vision_version_frozen();

alter table public.vision_plan_versions enable row level security;
drop policy if exists "vision versions admin read" on public.vision_plan_versions;
create policy "vision versions admin read" on public.vision_plan_versions for select using ((select public.is_admin()));
drop policy if exists "tenant isolation" on public.vision_plan_versions;
create policy "tenant isolation" on public.vision_plan_versions as restrictive for all
  using (tenant_id = (select public.effective_tenant())) with check (tenant_id = (select public.effective_tenant()));
revoke all on public.vision_plan_versions from public, anon, authenticated;
grant select on public.vision_plan_versions to authenticated;

-- The snapshot of a plan at an approval: its case in words, its accepted research, its risks. One function, used by the
-- trigger and the backfill, so the two can't differ.
create or replace function public.vision_version_write(p_plan uuid, p_baseline jsonb, p_at timestamptz, p_by uuid, p_tenant uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.vision_plan_versions (tenant_id, plan_id, version, baseline, plan, research, risks, approved_at, approved_by)
  select coalesce(p_tenant, v.tenant_id), p_plan,
    coalesce((select max(x.version) from public.vision_plan_versions x where x.plan_id = p_plan), 0) + 1,
    p_baseline,
    jsonb_build_object('name', v.name, 'format', v.format, 'deal', v.deal, 'place', v.place, 'summary', v.summary, 'why', v.why,
      'gate', v.gate, 'customer', v.customer, 'market', v.market, 'positioning', v.positioning),
    coalesce((select jsonb_agg(jsonb_build_object(
        'topic', r.topic, 'claim', r.claim, 'figure', r.figure, 'source_url', r.source_url, 'source_title', r.source_title,
        'published', r.published, 'bearing', r.bearing, 'retrieved_at', r.retrieved_at) order by r.topic, r.retrieved_at desc)
      from public.vision_research r where r.plan_id = p_plan and r.status = 'accepted'), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object(
        'kind', k.kind, 'words', k.words, 'likelihood', k.likelihood, 'impact', k.impact, 'mitigation', k.mitigation,
        'evidence', k.evidence, 'status', k.status) order by k.sort, k.created_at)
      from public.vision_plan_risks k where k.plan_id = p_plan), '[]'::jsonb),
    coalesce(p_at, now()), p_by
  from public.vision_plans v where v.id = p_plan;
end $$;
revoke all on function public.vision_version_write(uuid, jsonb, timestamptz, uuid, uuid) from public, anon, authenticated;

-- Every approval is a version. 0449's guard has already refused a non-owner and stamped who and when.
create or replace function public.vision_money_version()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.baseline is not null and (tg_op = 'INSERT' or new.baseline is distinct from old.baseline) then
    perform public.vision_version_write(new.plan_id, new.baseline, new.baseline_at, new.baseline_by, new.tenant_id);
  end if;
  return null;
end $$;
revoke all on function public.vision_money_version() from public, anon, authenticated;
drop trigger if exists vision_money_version_tg on public.vision_plan_money;
create trigger vision_money_version_tg after insert or update on public.vision_plan_money for each row execute function public.vision_money_version();

-- Backfill: a plan approved before this migration gets version 1, dated when its baseline was approved.
do $$
declare m record;
begin
  for m in select * from public.vision_plan_money mm where mm.baseline is not null
             and not exists (select 1 from public.vision_plan_versions x where x.plan_id = mm.plan_id) loop
    perform public.vision_version_write(m.plan_id, m.baseline, m.baseline_at, m.baseline_by, m.tenant_id);
  end loop;
end $$;

-- The pin. Existing links: this run (they keep showing what they showed). A new link: the moment it's made.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vision_shares' and column_name = 'pinned_at') then
    alter table public.vision_shares add column pinned_at timestamptz;
    update public.vision_shares set pinned_at = now();
    alter table public.vision_shares alter column pinned_at set default now();
    alter table public.vision_shares alter column pinned_at set not null;
  end if;
end $$;

-- Only an owner moves a pin; anyone who makes a link pins it to the moment it's made.
create or replace function public.vision_share_pin_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and not public.is_owner() then new.pinned_at := now(); end if;
    if new.pinned_at is null or new.pinned_at > now() then new.pinned_at := now(); end if;
  elsif new.pinned_at is distinct from old.pinned_at then
    if auth.uid() is not null and not public.is_owner() then
      raise exception 'Only an owner can move what a link shows to a newer approval.' using errcode = 'PT403';
    end if;
    if new.pinned_at > now() then new.pinned_at := now(); end if;
  end if;
  return new;
end $$;
revoke all on function public.vision_share_pin_guard() from public, anon, authenticated;
drop trigger if exists vision_share_pin_guard_tg on public.vision_shares;
create trigger vision_share_pin_guard_tg before insert or update on public.vision_shares for each row execute function public.vision_share_pin_guard();

-- vision_shared, the case from the pinned version.
create or replace function public.vision_shared(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.vision_shares;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'This link isn''t live.' using errcode = 'PT404';
  end if;
  select * into s from public.vision_shares
   where token = p_token and revoked_at is null and (expires_at is null or expires_at > now());
  if not found then
    raise exception 'This link isn''t live.' using errcode = 'PT404';
  end if;
  update public.vision_shares set opens = opens + 1, last_opened_at = now() where id = s.id;
  return jsonb_build_object(
    'label', s.label,
    'show_asks', s.show_asks,
    'expires_at', s.expires_at,
    -- 0458: the case this link shows is the one approved by this moment — an approval after it doesn't change the link.
    'pinned_at', s.pinned_at,
    'programs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'lane', p.lane, 'title', p.title, 'summary', p.summary, 'why', p.why, 'pillars', p.pillars,
        'horizon', p.horizon, 'status', p.status, 'start_on', p.start_on, 'target_on', p.target_on, 'emoji', p.emoji,
        'layout_id', p.layout_id, 'sort', p.sort) order by p.horizon, p.sort, p.created_at)
      from public.vision_programs p where p.tenant_id = s.tenant_id and p.id = any(s.program_ids)), '[]'::jsonb),
    -- 0455: the programs this link was given, and no others.
    'asks', case when s.show_asks then coalesce((select jsonb_agg(jsonb_build_object(
        'program_id', a.program_id, 'plan_id', a.plan_id, 'label', a.label, 'amount_cents', a.amount_cents, 'state', a.state,
        'note', a.note, 'sort', a.sort) order by a.sort, a.created_at)
      from public.vision_asks a
      where a.tenant_id = s.tenant_id
        -- 0455: an ask on a program shows only with that program; an ask on a plan, only with a plan marked to show.
        and ((a.plan_id is null and a.program_id = any(s.program_ids)) or exists (select 1 from public.vision_plans x where x.id = a.plan_id and x.shareable))), '[]'::jsonb)
      else '[]'::jsonb end,
    'plans', coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id, 'program_id', v.program_id, 'name', v.name, 'format', v.format, 'phase', v.phase, 'status', v.status,
        'sqft', v.sqft, 'deal', v.deal, 'place', v.place, 'summary', v.summary, 'why', v.why, 'gate', v.gate,
        'layout_id', v.layout_id, 'sort', v.sort,
        -- 0454: who it's for, the market, how it stands apart. 0458: as approved with the pinned version, when there is one.
        'customer', coalesce(pv.plan->>'customer', v.customer), 'market', coalesce(pv.plan->>'market', v.market),
        'positioning', coalesce(pv.plan->>'positioning', v.positioning),
        'needs', coalesce((select jsonb_agg(jsonb_build_object('label', n.label, 'kind', n.kind, 'due_on', n.due_on, 'done_on', n.done_on, 'sort', n.sort)
            order by n.sort, n.created_at) from public.vision_plan_needs n where n.plan_id = v.id), '[]'::jsonb),
        'waits_on', coalesce((select jsonb_agg(d.needs_plan_id) from public.vision_plan_deps d
            join public.vision_plans w on w.id = d.needs_plan_id and w.shareable where d.plan_id = v.id), '[]'::jsonb),
        -- 0451: the plan's money, only its owner-approved baseline, only where an owner chose this link to show it.
        -- 0458: the approved VERSION in force when the link was pinned — never the baseline as it stands now.
        'money', case when v.id = any(s.money_plans) and pv.id is not null then jsonb_build_object('baseline', pv.baseline, 'approved_at', pv.approved_at, 'version', pv.version) end,
        -- 0451: its research — accepted findings only, each with its source — where an owner chose this link to show it.
        -- 0458: the findings accepted when the pinned version was approved; with no version, those read by the pin.
        'research', case when v.id = any(s.research_plans) then coalesce(pv.research, (select jsonb_agg(jsonb_build_object(
            'topic', r.topic, 'claim', r.claim, 'figure', r.figure, 'source_url', r.source_url, 'source_title', r.source_title,
            'published', r.published, 'bearing', r.bearing, 'retrieved_at', r.retrieved_at) order by r.topic, r.retrieved_at desc)
          from public.vision_research r where r.plan_id = v.id and r.status = 'accepted' and r.retrieved_at <= s.pinned_at), '[]'::jsonb) end,
        -- 0454: its risks and assumptions — with the case, where an owner chose this link to show it.
        -- 0458: the risks as they stood at the pinned approval.
        'risks', case when v.id = any(s.money_plans) and pv.id is not null then pv.risks end)
        order by v.phase, v.sort, v.created_at)
      from public.vision_plans v
      -- 0458: each plan's latest approved version at or before the link's pin (none if it wasn't approved by then).
      left join lateral (select x.* from public.vision_plan_versions x
                          where x.plan_id = v.id and x.approved_at <= s.pinned_at order by x.version desc limit 1) pv on true
      where v.tenant_id = s.tenant_id and v.shareable), '[]'::jsonb),
    'layouts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'name', l.name, 'width_in', l.width_in, 'depth_in', l.depth_in, 'ceiling_in', l.ceiling_in, 'notes', l.notes,
        'items', coalesce((select jsonb_agg(jsonb_build_object(
            'id', i.id, 'kind', i.kind, 'label', i.label, 'x_in', i.x_in, 'y_in', i.y_in, 'rot', i.rot,
            'w_in', i.w_in, 'd_in', i.d_in, 'h_in', i.h_in, 'why', i.why, 'pillars', i.pillars, 'sort', i.sort) order by i.sort, i.created_at)
          from public.store_items i where i.layout_id = l.id), '[]'::jsonb)) order by l.created_at)
      from public.store_layouts l where l.tenant_id = s.tenant_id and l.id = any(s.layout_ids)), '[]'::jsonb)
    -- 0455: the rooms this link was given, and no others.
  );
end $$;
revoke all on function public.vision_shared(text) from public, anon, authenticated;
grant execute on function public.vision_shared(text) to anon, authenticated;

-- verify (numbers only):
--   select count(*) from public.vision_plan_versions;                       -- one per approved baseline
--   select count(*) from public.vision_shares where pinned_at is null;      -- 0
select public.record_migration('0458_what_was_approved_stays_approved');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
commit;  -- 0458
