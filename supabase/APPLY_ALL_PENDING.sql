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
-- pending-from: 0461
-- generated-at: 2026-10-30
-- pending-count: 1
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
