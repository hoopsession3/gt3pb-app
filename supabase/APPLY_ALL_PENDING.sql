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
-- pending-from: 0462
-- generated-at: 2026-10-30
-- pending-count: 2
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- ============================================================
-- 0461_the_experience_library.sql
-- ============================================================
begin;   -- 0461, its own transaction: if it stops, what is above it stays applied and nothing below it runs — paste the file again
-- ── 0461 — THE EXPERIENCE LIBRARY (IMS5b) ─────────────────────────────────────────────────────────────────────────────
-- 2026-10-30. The GT3 Primal Experience Library (Ryan, 2026-10-30: "a comprehensive, reusable visual asset experience
-- using the existing canonical data architecture… Primal qualification is mandatory… Unknown must never equal
-- approved"). A second run changes nothing. Needs 0456 (the Standard) and 0460. Paste it after the deploy that carries
-- the Library screen.
--
-- WHAT. No second catalog: the Standard's material registry (std_materials) becomes the library. Everything GT3 might
-- place in a location — furniture, counters and equipment, floors and wall finishes, paint, adhesives and coatings,
-- plants, lighting, acoustics, air and water, signage and art, menu boards, serviceware, cleaning products — is a row
-- there, judged by the Standard as it already judges materials (criteria, evidence, assessments, reviews).
--   status — candidate → under research → evidence incomplete → qualified → approved, or restricted / rejected. A new
--   asset is a candidate or under research. Qualified needs the Standard's judgement complete: at least one verified,
--   current pass; no fail; no unknown — judged unknown, or a mandatory criterion not judged at all; nothing stale,
--   nothing still a proposal, no not-applicable awaiting an owner, no open review. Approved needs the same, and an owner. Restricted and
--   rejected say why. Every change of status is kept (std_material_status), stamped by the database, never edited.
--   An approved asset whose judgement later goes stale keeps its word on the record, and the screen says it's stale.
--   What it is: the Studio kind it's placed as, its size, finishes, supplier, a cost with its basis (actual / estimated
--   / scenario) and source, how it's installed and kept, the pillars it is meant to serve (intent, not an assessment),
--   and a picture by https link. Nothing here is a certification: those are evidence, judged under the Standard.
--   store_items.library_id — a thing in a room can say which library asset it is.
--   std_specs — a reusable location specification: a named list of assets. Approved only by an owner, and only when
--   every asset on it is approved.
--
-- set lock_timeout (database F16): two tables made, two more for specs; columns added to std_materials (nullable or with
-- constant defaults — no rewrite) and one to store_items; the category check widened (same name, old values kept).
-- existing rows: none changed (every existing material starts a candidate).
-- rollback: drop std_spec_items, std_specs, std_material_status; drop store_items.library_id and the new std_materials
-- columns; re-make the category check as 0456 had it.
-- changelog: none — the owners' planning screen.

set lock_timeout = '5s';

alter table public.std_materials add column if not exists status text not null default 'candidate';
alter table public.std_materials add column if not exists status_reason text;
alter table public.std_materials add column if not exists status_by uuid;
alter table public.std_materials add column if not exists status_at timestamptz;
alter table public.std_materials add column if not exists studio_kind text;
alter table public.std_materials add column if not exists w_in numeric(7,2);
alter table public.std_materials add column if not exists d_in numeric(7,2);
alter table public.std_materials add column if not exists h_in numeric(7,2);
alter table public.std_materials add column if not exists finishes text;
alter table public.std_materials add column if not exists supplier text;
alter table public.std_materials add column if not exists supplier_url text;
alter table public.std_materials add column if not exists cost_cents int;
alter table public.std_materials add column if not exists cost_unit text;
alter table public.std_materials add column if not exists cost_basis text;
alter table public.std_materials add column if not exists cost_source text;
alter table public.std_materials add column if not exists cost_as_of date;
alter table public.std_materials add column if not exists install_notes text;
alter table public.std_materials add column if not exists maintenance_notes text;
alter table public.std_materials add column if not exists pillars text[] not null default '{}';
alter table public.std_materials add column if not exists image_url text;

alter table public.std_materials drop constraint if exists std_materials_category_check;
alter table public.std_materials add constraint std_materials_category_check check (category in (
  'surface','finish','textile','furniture','fixture','lighting','equipment','packaging','ingredient','other',
  'seating','counter','flooring','wall','paint','adhesive','coating','plant','acoustic','air','water','signage',
  'artwork','menu_board','merchandising','serviceware','food_contact','cleaning'));
alter table public.std_materials drop constraint if exists std_materials_lib_status;
alter table public.std_materials add constraint std_materials_lib_status check (status in ('candidate','under_research','evidence_incomplete','qualified','approved','restricted','rejected'));
alter table public.std_materials drop constraint if exists std_materials_lib_said;
alter table public.std_materials add constraint std_materials_lib_said check (
      (status_reason is null or length(status_reason) <= 500)
  and (studio_kind is null or studio_kind ~ '^[a-z0-9_]{1,40}$')
  and (w_in is null or (w_in > 0 and w_in <= 2400)) and (d_in is null or (d_in > 0 and d_in <= 2400)) and (h_in is null or (h_in > 0 and h_in <= 2400))
  and (finishes is null or length(finishes) <= 500)
  and (supplier is null or length(supplier) <= 160)
  and (supplier_url is null or (supplier_url ~ '^https://' and length(supplier_url) <= 1000))
  and (image_url is null or (image_url ~ '^https://' and length(image_url) <= 1000))
  and (cost_cents is null or (cost_cents >= 0 and cost_cents <= 100000000))
  and (cost_unit is null or length(cost_unit) <= 40)
  and (cost_basis is null or cost_basis in ('actual','estimated','scenario'))
  and (cost_source is null or length(cost_source) <= 300)
  and (install_notes is null or length(install_notes) <= 1000)
  and (maintenance_notes is null or length(maintenance_notes) <= 1000)
  and pillars <@ array['movement','stillness','light','fuel']::text[]);
-- A cost is said with its basis and where it came from.
alter table public.std_materials drop constraint if exists std_materials_cost_said;
alter table public.std_materials add constraint std_materials_cost_said check (cost_cents is null or (cost_basis is not null and length(btrim(coalesce(cost_source, ''))) > 0));
-- Restricted or rejected says why.
alter table public.std_materials drop constraint if exists std_materials_no_said;
alter table public.std_materials add constraint std_materials_no_said check (status not in ('restricted','rejected') or length(btrim(coalesce(status_reason, ''))) > 0);
create index if not exists std_materials_status on public.std_materials (status);

alter table public.store_items add column if not exists library_id uuid references public.std_materials(id) on delete set null;
create index if not exists store_items_library on public.store_items (library_id) where library_id is not null;

create table if not exists public.std_material_status (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  material_id uuid not null references public.std_materials(id) on delete cascade,
  from_status text,
  to_status   text not null,
  reason      text check (reason is null or length(reason) <= 500),
  changed_by  uuid,
  changed_at  timestamptz not null default now()
);
alter table public.std_material_status enable row level security;
create index if not exists std_material_status_material on public.std_material_status (material_id, changed_at desc);

create table if not exists public.std_specs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  name        text not null check (length(name) between 1 and 160),
  notes       text check (notes is null or length(notes) <= 2000),
  status      text not null default 'draft' check (status in ('draft','approved','retired')),
  decided_by  uuid,
  decided_at  timestamptz,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.std_specs enable row level security;
create table if not exists public.std_spec_items (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  spec_id     uuid not null references public.std_specs(id) on delete cascade,
  material_id uuid not null references public.std_materials(id),
  qty         numeric(10,2) check (qty is null or (qty > 0 and qty <= 100000)),
  unit        text check (unit is null or length(unit) <= 40),
  note        text check (note is null or length(note) <= 300),
  created_at  timestamptz not null default now(),
  unique (spec_id, material_id)
);
alter table public.std_spec_items enable row level security;
create index if not exists std_spec_items_material on public.std_spec_items (material_id);

-- ── the word on an asset ────────────────────────────────────────────────────────────────────────────────────────────
-- Why an asset can't be qualified yet, in words; empty when the Standard's judgement is complete. Read as the caller
-- (security invoker): what it counts is what the caller may read — one tenant, owners and admins.
create or replace function public.std_material_blockers(p_id uuid)
returns text[] language sql stable security invoker set search_path = public as $$
  with cur as (
    select a.* from public.std_assessments a where a.subject_type = 'material' and a.subject_id = p_id and a.superseded_by is null),
  s as (
    select count(*) filter (where outcome = 'pass' and stale_at is null and verification in ('independent','self')) passes,
           count(*) filter (where outcome = 'fail') fails,
           count(*) filter (where outcome = 'unknown') unknowns,
           count(*) filter (where stale_at is not null) stale,
           count(*) filter (where verification = 'proposed' and stale_at is null) waiting,
           count(*) filter (where outcome = 'not_applicable' and na_approved_by is null) na_open
      from cur),
  m as (
    -- a mandatory criterion for materials, in a published version, with no current judgement of this asset: unknown
    select count(*) n from public.std_criteria c join public.std_versions v on v.id = c.version_id
     where v.status = 'published' and c.applies_to = 'material' and c.mandatory
       and not exists (select 1 from cur where cur.criterion_id = c.id))
  select array_remove(array[
    case when s.passes = 0 then 'No verified, current pass under the Standard yet.' end,
    case when s.fails > 0 then s.fails || ' criterion failed.' end,
    case when s.unknowns > 0 then s.unknowns || ' criterion judged unknown — unknown is never approved.' end,
    case when m.n > 0 then m.n || ' mandatory criterion not yet judged — unknown is never approved.' end,
    case when s.stale > 0 then s.stale || ' judgement stale — reassess.' end,
    case when s.waiting > 0 then s.waiting || ' judgement proposed, not yet verified by an owner.' end,
    case when s.na_open > 0 then s.na_open || ' not-applicable awaiting an owner.' end,
    case when exists (select 1 from public.std_reviews r where r.subject_type = 'material' and r.subject_id = p_id and r.status = 'open') then 'An open review.' end
  ], null) from s, m
$$;
revoke all on function public.std_material_blockers(uuid) from public, anon, authenticated;
grant execute on function public.std_material_blockers(uuid) to authenticated;

create or replace function public.std_material_status_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_blockers text[];
begin
  if tg_op = 'INSERT' then
    if new.status not in ('candidate','under_research') then raise exception 'A new asset starts as a candidate or under research.' using errcode = 'PT409'; end if;
    new.status_by := auth.uid(); new.status_at := now();
    return new;
  end if;
  if new.status is distinct from old.status then
    if new.status in ('qualified','approved') then
      v_blockers := public.std_material_blockers(new.id);
      if cardinality(v_blockers) > 0 then
        raise exception 'Not yet %: %', replace(new.status, '_', ' '), array_to_string(v_blockers, ' ') using errcode = 'PT409';
      end if;
    end if;
    if new.status = 'approved' or old.status = 'approved' then perform public.std_owner_only('approve an asset, or take an approval back'); end if;
    new.status_by := auth.uid(); new.status_at := now();
  elsif (new.status_by, new.status_at) is distinct from (old.status_by, old.status_at) then
    raise exception 'Only a change of status records who changed it.' using errcode = 'PT409';
  end if;
  return new;
end $$;
revoke all on function public.std_material_status_guard() from public, anon, authenticated;
drop trigger if exists std_material_status_guard_tg on public.std_materials;
create trigger std_material_status_guard_tg before insert or update on public.std_materials for each row execute function public.std_material_status_guard();

create or replace function public.std_material_status_log()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.std_material_status (tenant_id, material_id, from_status, to_status, reason, changed_by)
    values (new.tenant_id, new.id, case when tg_op = 'UPDATE' then old.status end, new.status, new.status_reason, auth.uid());
  end if;
  return null;
end $$;
revoke all on function public.std_material_status_log() from public, anon, authenticated;
drop trigger if exists std_material_status_log_tg on public.std_materials;
create trigger std_material_status_log_tg after insert or update on public.std_materials for each row execute function public.std_material_status_log();

-- A spec is approved by an owner, and only when every asset on it is approved; an approved spec keeps its list.
create or replace function public.std_spec_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then raise exception 'A spec starts as a draft.' using errcode = 'PT409'; end if;
    new.decided_by := null; new.decided_at := null; return new;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'approved' then
      perform public.std_owner_only('approve a location spec');
      if not exists (select 1 from public.std_spec_items where spec_id = new.id) then raise exception 'An empty spec has nothing to approve.' using errcode = 'PT409'; end if;
      if exists (select 1 from public.std_spec_items i join public.std_materials m on m.id = i.material_id where i.spec_id = new.id and m.status <> 'approved') then
        raise exception 'Every asset on a spec is approved before the spec is.' using errcode = 'PT409';
      end if;
    end if;
    new.decided_by := auth.uid(); new.decided_at := now();
  elsif (new.decided_by, new.decided_at) is distinct from (old.decided_by, old.decided_at) then
    raise exception 'Only a decision records who decided.' using errcode = 'PT409';
  end if;
  return new;
end $$;
revoke all on function public.std_spec_guard() from public, anon, authenticated;
drop trigger if exists std_spec_guard_tg on public.std_specs;
create trigger std_spec_guard_tg before insert or update on public.std_specs for each row execute function public.std_spec_guard();

create or replace function public.std_spec_item_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_spec uuid := coalesce(new.spec_id, old.spec_id);
begin
  if exists (select 1 from public.std_specs where id = v_spec and status = 'approved') then
    raise exception 'An approved spec keeps its list — make a new draft to change it.' using errcode = 'PT409';
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.std_spec_item_guard() from public, anon, authenticated;
drop trigger if exists std_spec_item_guard_tg on public.std_spec_items;
create trigger std_spec_item_guard_tg before insert or update or delete on public.std_spec_items for each row execute function public.std_spec_item_guard();

-- ── access: as the Standard — owners and admins, one tenant, every change logged; the status log is read-only ───────
do $$
declare t text;
begin
  foreach t in array array['std_material_status','std_specs','std_spec_items'] loop
    execute format('drop trigger if exists stamp_tenant_tg on public.%I', t);
    execute format('create trigger stamp_tenant_tg before insert on public.%I for each row execute function public.stamp_tenant()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "std admin" on public.%I', t);
    execute format('create policy "std admin" on public.%I for all using ((select public.is_admin())) with check ((select public.is_admin()))', t);
    execute format('drop policy if exists "tenant isolation" on public.%I', t);
    execute format('create policy "tenant isolation" on public.%I as restrictive for all using (tenant_id = (select public.effective_tenant())) with check (tenant_id = (select public.effective_tenant()))', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('drop trigger if exists admin_audit_%s on public.%I', t, t);
    execute format('create trigger admin_audit_%s after insert or update or delete on public.%I for each row execute function public.log_admin_audit()', t, t);
  end loop;
end $$;
grant select on public.std_material_status to authenticated;
grant select, insert, update, delete on public.std_specs to authenticated;
grant select, insert, update, delete on public.std_spec_items to authenticated;

-- verify (numbers only):
--   select count(*) from public.std_materials where status <> 'candidate';   -- 0 (first run)
--   select count(*) from public.std_material_status;                           -- 0 (first run: nothing changed)
select public.record_migration('0461_the_experience_library');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
commit;  -- 0461

-- ============================================================
-- 0462_gt3_researches_a_human_decides.sql
-- ============================================================
begin;   -- 0462, its own transaction: if it stops, what is above it stays applied and nothing below it runs — paste the file again
-- ── 0462 — GT3 RESEARCHES, A HUMAN DECIDES (IMS6 Phase A1) ───────────────────────────────────────────────────────────
-- 2026-10-30. Intake for the Experience Library (Ryan, 2026-10-30: "Ask → Research → Populate → Review exceptions →
-- Save candidate… No manual transcription as the default. No fabricated evidence."). A second run changes nothing.
-- Needs 0461. Paste it after the deploy that carries the intake screens.
--
-- TWO LAYERS. What research finds is a draft fact (std_asset_facts): one value for one field of one asset, with where it
-- came from (source class: manufacturer specification, supplier claim, independent evidence, GT3 measurement, AI
-- inference), the page or section, the document's revision, a hash of what was read, when, how (quoted / extracted /
-- inferred), how sure, and how risky the field is. The authoritative specification stays std_materials, and it changes
-- only when a person accepts facts through std_accept_facts:
--   · a fact arrives pending, whoever writes it, and is never edited — nobody is granted UPDATE or DELETE on facts;
--   · bulk acceptance takes only low-risk, sourced (quoted or extracted), non-conflicting facts — never an AI inference,
--     never a health or safety field (composition, emissions, food contact, care chemicals, certification, claims);
--   · those are accepted one at a time, and an accepted inference says so for good;
--   · accepting writes the column and supersedes the fact accepted before it; nothing is deleted; a supplier's new value
--     is a new pending fact (a difference to review), never an overwrite — and the Standard's own trigger
--     (std_material_changed, 0456) marks the judgements stale when what it's made of changes.
-- Accepting a fact never changes an asset's status, an assessment or an approval: 0461's gate is untouched.
--
-- INTAKE AND RESEARCH. std_intakes: one ask (a URL, a file, a description, or manual), deduplicated by a hash.
-- std_research_runs: each model run, metered. std_research_budget: per run and per day, in cents (start: 25 and 300).
-- std_research_reserve locks the tenant's budget, refuses when today's reserved + spent + this run's ceiling won't fit,
-- and holds the full ceiling; std_research_settle writes what the run actually used and releases the rest. A run that
-- never reports (or reports in part) stays charged at its full reservation; one left open past its timeout is closed
-- at full reservation by the next reserve. ai_usage (0190) gains searches and fetches, so the existing meter is whole.
--
-- MATCHING. std_materials.source_url_norm (the page a product was read from, normalised) and family_id (a variant —
-- another finish or formulation — names its family; it inherits nothing: no evidence, no assessment, no approval).
-- THE STANDARD SAYS WHAT EACH CATEGORY NEEDS. std_criteria.categories: the library categories a material criterion
-- applies to (empty: all). No second assessment engine.
-- FILES. A private bucket, library-intake: PDF, JPEG, PNG, WebP, HEIC up to 20 MB; a file lives at
-- <tenant>/<intake>/<name>, read and written only by that tenant's owners and admins.
--
-- set lock_timeout (database F16): four tables; columns added (nullable or constant defaults — no rewrite) to
-- std_materials, std_criteria and ai_usage; one bucket and its four policies. existing rows: none changed.
-- rollback: drop std_asset_facts, std_research_runs, std_research_budget, std_intakes; drop the added columns; delete
-- the bucket (and its objects) and its policies.
-- changelog: none — the owners' planning screen.

set lock_timeout = '5s';

alter table public.std_criteria add column if not exists categories text[] not null default '{}';
alter table public.std_materials add column if not exists family_id uuid references public.std_materials(id) on delete set null;
alter table public.std_materials add column if not exists source_url_norm text;
alter table public.std_materials drop constraint if exists std_materials_source_url_norm;
alter table public.std_materials add constraint std_materials_source_url_norm check (source_url_norm is null or (length(source_url_norm) <= 1000 and source_url_norm ~ '^[a-z0-9.-]+/'));
alter table public.std_materials drop constraint if exists std_materials_not_own_family;
alter table public.std_materials add constraint std_materials_not_own_family check (family_id is null or family_id <> id);
create index if not exists std_materials_url_norm on public.std_materials (source_url_norm) where source_url_norm is not null;
create index if not exists std_materials_family on public.std_materials (family_id) where family_id is not null;
create index if not exists std_materials_maker_ref on public.std_materials (lower(maker), lower(product_ref)) where maker is not null and product_ref is not null;
alter table public.ai_usage add column if not exists searches int not null default 0;
alter table public.ai_usage add column if not exists fetches int not null default 0;

create table if not exists public.std_intakes (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  kind         text not null check (kind in ('url','upload','describe','manual')),
  input        text check (input is null or length(input) <= 2000),
  file_path    text check (file_path is null or length(file_path) <= 500),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  status       text not null default 'queued' check (status in ('queued','researching','ready','failed','budget_exhausted','cancelled')),
  material_id  uuid references public.std_materials(id) on delete set null,
  matches      jsonb not null default '[]' check (jsonb_typeof(matches) = 'array'),
  error        text check (error is null or length(error) <= 500),
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint std_intakes_said check ((kind = 'url' and input ~ '^https://') or (kind = 'upload' and file_path is not null) or (kind = 'describe' and length(btrim(coalesce(input, ''))) between 3 and 2000) or kind = 'manual')
);
alter table public.std_intakes enable row level security;
create index if not exists std_intakes_hash on public.std_intakes (request_hash, created_at desc);
create index if not exists std_intakes_material on public.std_intakes (material_id) where material_id is not null;

create table if not exists public.std_asset_facts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  material_id     uuid not null references public.std_materials(id) on delete cascade,
  intake_id       uuid references public.std_intakes(id) on delete set null,
  field           text not null check (field in ('maker','product_ref','model','w_in','d_in','h_in','composition','finishes','supplier','supplier_url',
                    'cost_cents','install_notes','maintenance_notes','image_url','certification','emissions','food_contact','care_chemicals','claim','discontinued')),
  value           jsonb not null,
  unit            text check (unit is null or length(unit) <= 40),
  source_class    text not null check (source_class in ('manufacturer','supplier','independent','gt3','ai_inference')),
  source_kind     text not null check (source_kind in ('url','document','image','description','manual')),
  source_ref      text check (source_ref is null or length(source_ref) <= 1000),
  source_title    text check (source_title is null or length(source_title) <= 300),
  source_locator  text check (source_locator is null or length(source_locator) <= 200),
  source_revision text check (source_revision is null or length(source_revision) <= 120),
  content_hash    text check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  retrieved_at    timestamptz not null default now(),
  method          text not null check (method in ('quoted','extracted','inferred')),
  confidence      text not null default 'low' check (confidence in ('low','medium','high')),
  risk            text not null default 'low' check (risk in ('low','high')),
  review          text not null default 'pending' check (review in ('pending','accepted','corrected','rejected','superseded')),
  corrected_value jsonb,
  review_note     text check (review_note is null or length(review_note) <= 500),
  reviewed_by     uuid,
  reviewed_at     timestamptz,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  -- An inference is the AI's, said so; anything else names where it came from.
  constraint std_facts_inference_said check ((method = 'inferred') = (source_class = 'ai_inference')),
  constraint std_facts_sourced check (method = 'inferred' or source_kind = 'manual' or length(btrim(coalesce(source_ref, ''))) > 0),
  constraint std_facts_url check (source_kind <> 'url' or source_ref ~ '^https://'),
  -- Health and safety fields are high risk, whoever says otherwise.
  constraint std_facts_risk check (field not in ('composition','emissions','food_contact','care_chemicals','certification','claim') or risk = 'high')
);
alter table public.std_asset_facts enable row level security;
create index if not exists std_asset_facts_material on public.std_asset_facts (material_id, field, review);
create index if not exists std_asset_facts_intake on public.std_asset_facts (intake_id);

create table if not exists public.std_research_budget (
  tenant_id     uuid primary key references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  per_run_cents int not null default 25 check (per_run_cents between 1 and 1000),
  daily_cents   int not null default 300 check (daily_cents between 1 and 10000),
  per_run_searches int not null default 5 check (per_run_searches between 0 and 20),
  per_run_fetches  int not null default 3 check (per_run_fetches between 0 and 20),
  per_run_tokens   int not null default 60000 check (per_run_tokens between 1000 and 400000),
  run_timeout_s    int not null default 90 check (run_timeout_s between 10 and 600),
  updated_by    uuid,
  updated_at    timestamptz not null default now()
);
alter table public.std_research_budget enable row level security;

create table if not exists public.std_research_runs (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  intake_id      uuid not null references public.std_intakes(id) on delete cascade,
  depth          text not null check (depth in ('light','standard','deep')),
  reserved_cents int not null check (reserved_cents >= 0),
  charged_cents  numeric(10,2) not null check (charged_cents >= 0),
  searches       int, fetches int, input_tokens int, output_tokens int, cache_write_tokens int, cache_read_tokens int,
  outcome        text not null default 'running' check (outcome in ('running','done','failed','timed_out','unreported','cancelled')),
  error          text check (error is null or length(error) <= 500),
  started_by     uuid default auth.uid(),
  started_at     timestamptz not null default now(),
  deadline_at    timestamptz not null,
  settled_at     timestamptz
);
alter table public.std_research_runs enable row level security;
create index if not exists std_research_runs_day on public.std_research_runs (tenant_id, started_at desc);
create index if not exists std_research_runs_intake on public.std_research_runs (intake_id);

-- ── the budget: reserve before, settle after ────────────────────────────────────────────────────────────────────────
create or replace function public.std_research_reserve(p_intake uuid, p_depth text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := public.effective_tenant(); b public.std_research_budget; v_day numeric; v_id uuid;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Only an owner or admin starts research.' using errcode = 'PT403'; end if;
  if not exists (select 1 from public.std_intakes where id = p_intake and tenant_id = v_tenant) then raise exception 'No such intake.' using errcode = 'PT404'; end if;
  if p_depth not in ('light','standard','deep') then raise exception 'A depth is light, standard or deep.' using errcode = 'PT422'; end if;
  insert into public.std_research_budget (tenant_id) values (v_tenant) on conflict (tenant_id) do nothing;
  -- One reservation at a time per tenant: the budget row is the lock.
  select * into b from public.std_research_budget where tenant_id = v_tenant for update;
  -- A run left open past its deadline is closed, charged in full.
  update public.std_research_runs set outcome = 'unreported', charged_cents = reserved_cents, settled_at = now()
   where tenant_id = v_tenant and outcome = 'running' and deadline_at < now();
  select coalesce(sum(charged_cents), 0) into v_day from public.std_research_runs where tenant_id = v_tenant and started_at >= date_trunc('day', now());
  if v_day + b.per_run_cents > b.daily_cents then
    -- (A refusal rolls back this call: the route marks the intake budget_exhausted when it reads PT429.)
    raise exception 'Today''s research budget is spent (% of % cents).', round(v_day), b.daily_cents using errcode = 'PT429';
  end if;
  insert into public.std_research_runs (tenant_id, intake_id, depth, reserved_cents, charged_cents, deadline_at)
  values (v_tenant, p_intake, p_depth, b.per_run_cents, b.per_run_cents, now() + make_interval(secs => b.run_timeout_s))
  returning id into v_id;
  update public.std_intakes set status = 'researching', updated_at = now() where id = p_intake;
  return v_id;
end $$;
revoke all on function public.std_research_reserve(uuid, text) from public, anon, authenticated;
grant execute on function public.std_research_reserve(uuid, text) to authenticated;

-- What a run used. A partial report (any count missing) is charged in full; a complete one is charged what it cost, never
-- more than it reserved (the caps are enforced by the API: searches, fetches, output tokens).
create or replace function public.std_research_settle(p_run uuid, p_usage jsonb, p_cost_cents numeric, p_outcome text, p_error text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare r public.std_research_runs; v_complete boolean; v_charge numeric;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Only an owner or admin settles research.' using errcode = 'PT403'; end if;
  select * into r from public.std_research_runs where id = p_run and tenant_id = public.effective_tenant() for update;
  if not found then raise exception 'No such run.' using errcode = 'PT404'; end if;
  if r.outcome <> 'running' then raise exception 'This run is already settled.' using errcode = 'PT409'; end if;
  if p_outcome not in ('done','failed','timed_out','cancelled') then raise exception 'An outcome is done, failed, timed_out or cancelled.' using errcode = 'PT422'; end if;
  v_complete := p_usage is not null and p_cost_cents is not null and p_cost_cents >= 0
    and (select bool_and(p_usage ? k and jsonb_typeof(p_usage -> k) = 'number') from unnest(array['searches','fetches','input_tokens','output_tokens']) k);
  -- Complete: charged what it cost, even past its reservation (an overrun is shown, never hidden, and counts today).
  v_charge := case when v_complete then p_cost_cents else r.reserved_cents end;
  update public.std_research_runs set
    searches = (p_usage ->> 'searches')::int, fetches = (p_usage ->> 'fetches')::int,
    input_tokens = (p_usage ->> 'input_tokens')::int, output_tokens = (p_usage ->> 'output_tokens')::int,
    cache_write_tokens = (p_usage ->> 'cache_write_tokens')::int, cache_read_tokens = (p_usage ->> 'cache_read_tokens')::int,
    charged_cents = v_charge, outcome = case when v_complete then p_outcome else 'unreported' end,
    error = left(p_error, 500), settled_at = now()
  where id = p_run;
  return v_charge;
end $$;
revoke all on function public.std_research_settle(uuid, jsonb, numeric, text, text) from public, anon, authenticated;
grant execute on function public.std_research_settle(uuid, jsonb, numeric, text, text) to authenticated;

-- ── facts: arrive pending; never edited — reviewed only through std_accept_facts / std_reject_facts ─────────────────
-- No one is granted UPDATE or DELETE on facts: the two review functions (security definer) are the only writers of a
-- review, and they check the caller's role and tenant themselves.
create or replace function public.std_fact_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- One tenant's fact is about one tenant's asset (a foreign key alone would let another tenant's id in).
  if not exists (select 1 from public.std_materials m where m.id = new.material_id and m.tenant_id is not distinct from new.tenant_id)
     or (new.intake_id is not null and not exists (select 1 from public.std_intakes i where i.id = new.intake_id and i.tenant_id is not distinct from new.tenant_id)) then
    raise exception 'That asset or intake isn''t this tenant''s.' using errcode = 'PT403';
  end if;
  new.review := 'pending'; new.corrected_value := null; new.reviewed_by := null; new.reviewed_at := null; new.review_note := null;
  new.created_by := auth.uid(); new.retrieved_at := coalesce(new.retrieved_at, now());
  if new.field in ('composition','emissions','food_contact','care_chemicals','certification','claim') then new.risk := 'high'; end if;
  return new;
end $$;
revoke all on function public.std_fact_guard() from public, anon, authenticated;
drop trigger if exists std_fact_guard_tg on public.std_asset_facts;
create trigger std_fact_guard_tg before insert on public.std_asset_facts for each row execute function public.std_fact_guard();

-- Where facts about one field of one asset disagree (pending or accepted, not superseded or rejected).
create or replace view public.std_fact_conflicts with (security_invoker = true) as
select f.material_id, f.field, count(distinct coalesce(f.corrected_value, f.value)) as values_seen, array_agg(f.id order by f.retrieved_at) as fact_ids
  from public.std_asset_facts f
 where f.review in ('pending','accepted','corrected')
 group by f.material_id, f.field
having count(distinct coalesce(f.corrected_value, f.value)) > 1;
revoke all on public.std_fact_conflicts from public, anon, authenticated;
grant select on public.std_fact_conflicts to authenticated;

create or replace function public.std_accept_facts(p_ids uuid[], p_corrections jsonb default '{}', p_bulk boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare f public.std_asset_facts; v jsonb; n int := 0; v_tenant uuid := public.effective_tenant();
  spec_cols text[] := array['maker','product_ref','w_in','d_in','h_in','composition','finishes','supplier','supplier_url','install_notes','maintenance_notes','image_url'];
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Only an owner or admin accepts facts.' using errcode = 'PT403'; end if;
  if jsonb_typeof(coalesce(p_corrections, '{}')) <> 'object' then raise exception 'Corrections are an object of fact id to value.' using errcode = 'PT422'; end if;
  for f in select * from public.std_asset_facts where id = any(p_ids) and tenant_id = v_tenant order by retrieved_at for update loop
    if f.review <> 'pending' then raise exception 'A fact already reviewed (%) is kept as it was.', f.review using errcode = 'PT409'; end if;
    if p_bulk then
      if f.risk = 'high' or f.method = 'inferred' or f.source_class = 'ai_inference' then
        raise exception 'Bulk acceptance takes only low-risk, sourced facts — % needs its own decision.', f.field using errcode = 'PT409';
      end if;
      if exists (select 1 from public.std_fact_conflicts c where c.material_id = f.material_id and c.field = f.field) then
        raise exception 'The facts about % disagree — decide them one at a time.', f.field using errcode = 'PT409';
      end if;
      if p_corrections ? f.id::text then raise exception 'A correction is its own decision, not part of a bulk acceptance.' using errcode = 'PT409'; end if;
    end if;
    v := coalesce(p_corrections -> f.id::text, f.value);
    -- What was accepted before for this field is superseded; the new value is the specification.
    update public.std_asset_facts set review = 'superseded' where material_id = f.material_id and field = f.field and review in ('accepted','corrected') and id <> f.id;
    update public.std_asset_facts set review = case when p_corrections ? f.id::text then 'corrected' else 'accepted' end,
      corrected_value = case when p_corrections ? f.id::text then v end, reviewed_by = auth.uid(), reviewed_at = now()
     where id = f.id;
    if f.field in ('w_in','d_in','h_in') then
      execute format('update public.std_materials set %I = ($1)::numeric where id = $2', f.field) using v #>> '{}', f.material_id;
    elsif f.field = any(spec_cols) then
      execute format('update public.std_materials set %I = $1 where id = $2', f.field) using v #>> '{}', f.material_id;
    elsif f.field = 'cost_cents' then
      update public.std_materials set cost_cents = (v #>> '{}')::numeric::int, cost_unit = coalesce(f.unit, cost_unit),
        cost_basis = case when f.source_class in ('manufacturer','supplier') then 'actual' else 'estimated' end,
        cost_source = left(coalesce(f.source_title, f.source_ref, 'Accepted fact'), 300), cost_as_of = f.retrieved_at::date
       where id = f.material_id;
    end if;
    n := n + 1;
  end loop;
  if n <> coalesce(cardinality(p_ids), 0) then raise exception 'Some of those facts aren''t this tenant''s or don''t exist.' using errcode = 'PT404'; end if;
  return n;
end $$;
revoke all on function public.std_accept_facts(uuid[], jsonb, boolean) from public, anon, authenticated;
grant execute on function public.std_accept_facts(uuid[], jsonb, boolean) to authenticated;

create or replace function public.std_reject_facts(p_ids uuid[], p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Only an owner or admin rejects facts.' using errcode = 'PT403'; end if;
  update public.std_asset_facts set review = 'rejected', review_note = left(p_note, 500), reviewed_by = auth.uid(), reviewed_at = now()
   where id = any(p_ids) and tenant_id = public.effective_tenant() and review = 'pending';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.std_reject_facts(uuid[], text) from public, anon, authenticated;
grant execute on function public.std_reject_facts(uuid[], text) to authenticated;

-- The same for every reference into the library across a tenant line: an intake's asset, a spec's asset (0461), a placed
-- thing's asset (0461), a variant's family.
create or replace function public.std_library_ref_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(new);
  v_ref uuid := (j ->> case tg_table_name when 'store_items' then 'library_id' when 'std_materials' then 'family_id' else 'material_id' end)::uuid;
begin
  if v_ref is not null and not exists (select 1 from public.std_materials m where m.id = v_ref and m.tenant_id is not distinct from (j ->> 'tenant_id')::uuid) then
    raise exception 'That library asset isn''t this tenant''s.' using errcode = 'PT403';
  end if;
  return new;
end $$;
revoke all on function public.std_library_ref_guard() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['std_intakes','std_spec_items','store_items','std_materials'] loop
    execute format('drop trigger if exists z_library_ref_tg on public.%I', t);
    execute format('create trigger z_library_ref_tg before insert or update on public.%I for each row execute function public.std_library_ref_guard()', t);
  end loop;
end $$;

-- The budget is an owner's to change.
create or replace function public.std_research_budget_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and tg_op = 'UPDATE' then perform public.std_owner_only('change the research budget'); end if;
  new.updated_by := auth.uid(); new.updated_at := now();
  return new;
end $$;
revoke all on function public.std_research_budget_guard() from public, anon, authenticated;
drop trigger if exists std_research_budget_guard_tg on public.std_research_budget;
create trigger std_research_budget_guard_tg before insert or update on public.std_research_budget for each row execute function public.std_research_budget_guard();

-- ── access: owners and admins of one tenant; runs are written only by reserve/settle; budgets changed by owners ─────
do $$
declare t text;
begin
  foreach t in array array['std_intakes','std_asset_facts','std_research_runs','std_research_budget'] loop
    execute format('drop trigger if exists stamp_tenant_tg on public.%I', t);
    execute format('create trigger stamp_tenant_tg before insert on public.%I for each row execute function public.stamp_tenant()', t);
    execute format('drop policy if exists "std admin" on public.%I', t);
    execute format('create policy "std admin" on public.%I for all using ((select public.is_admin())) with check ((select public.is_admin()))', t);
    execute format('drop policy if exists "tenant isolation" on public.%I', t);
    execute format('create policy "tenant isolation" on public.%I as restrictive for all using (tenant_id = (select public.effective_tenant())) with check (tenant_id = (select public.effective_tenant()))', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('drop trigger if exists admin_audit_%s on public.%I', t, t);
    execute format('create trigger admin_audit_%s after insert or update or delete on public.%I for each row execute function public.log_admin_audit()', t, t);
  end loop;
end $$;
grant select, insert, update on public.std_intakes to authenticated;
grant select, insert on public.std_asset_facts to authenticated;           -- reviewed only through the review functions
grant select on public.std_research_runs to authenticated;                -- written only by reserve and settle
grant select, update on public.std_research_budget to authenticated;      -- the guard: an owner's

-- ── the intake files ───────────────────────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('library-intake', 'library-intake', false, 20971520, array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do update set public = false, file_size_limit = 20971520, allowed_mime_types = array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif'];
drop policy if exists "library intake read" on storage.objects;
create policy "library intake read" on storage.objects for select to authenticated
  using (bucket_id = 'library-intake' and (select public.is_admin()) and (storage.foldername(name))[1] = (select public.effective_tenant())::text);
drop policy if exists "library intake write" on storage.objects;
create policy "library intake write" on storage.objects for insert to authenticated
  with check (bucket_id = 'library-intake' and (select public.is_admin()) and (storage.foldername(name))[1] = (select public.effective_tenant())::text);
drop policy if exists "library intake delete" on storage.objects;
create policy "library intake delete" on storage.objects for delete to authenticated
  using (bucket_id = 'library-intake' and (select public.is_owner()) and (storage.foldername(name))[1] = (select public.effective_tenant())::text);

-- verify (numbers only):
--   select count(*) from public.std_asset_facts;                                     -- 0 (first run)
--   select public from storage.buckets where id = 'library-intake';                   -- false
select public.record_migration('0462_gt3_researches_a_human_decides');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
commit;  -- 0462
