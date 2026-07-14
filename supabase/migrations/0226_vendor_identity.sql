-- 0226_vendor_identity.sql — the vendor identity spine: locations, a DB-level look-alike guard,
-- and an owner-gated merge. (The Wine Express fix: one partner, many locations, no more spelling
-- mints a new vendor.)
--
-- Design (three layers): vendors = WHO (one row per partner: POC, status) · vendor_locations =
-- WHERE (1..N places per vendor) · field ops = WHEN (a dated visit at a place — 0222 spine).
--
-- Soak-safety contract: this migration NEVER touches events / stops / field_ops or their mirror
-- and sync triggers (0222/0223). merge_vendors repoints stops.vendor_id / events.vendor_id and
-- lets the existing mirrors carry the change into field_ops themselves — by design, so the
-- nightly drift invariant is untouched.
--
-- ── 1 · fuzzy matching infrastructure ─────────────────────────────────────────────────────────────
create extension if not exists pg_trgm;
-- (No trigram index: similarity(a,b) >= t can't use one — only the % operator can — and the panel
--  proved a gin index here is dead weight at this table's size. Seq scan over dozens of vendors is
--  the optimal plan; revisit % + set_limit only if the book ever grows to thousands.)

-- ── 2 · vendor_locations — a vendor has 1..N places ───────────────────────────────────────────────
create table if not exists public.vendor_locations (
  id            uuid primary key default gen_random_uuid(),
  vendor_id     uuid not null references public.vendors(id) on delete cascade,
  label         text not null default 'Main',   -- "Five Forks", "Downtown", "HQ"
  address       text,
  location_text text,
  lat           double precision,
  lng           double precision,
  is_primary    boolean not null default false,
  sort          int not null default 0,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  tenant_id     uuid
);
create index if not exists vendor_locations_vendor_idx
  on public.vendor_locations (vendor_id) where archived_at is null;
-- ONE primary per vendor, enforced.
create unique index if not exists vendor_locations_one_primary
  on public.vendor_locations (vendor_id) where is_primary and archived_at is null;

alter table public.vendor_locations enable row level security;
drop policy if exists "vendor_locations staff read" on public.vendor_locations;
create policy "vendor_locations staff read" on public.vendor_locations
  for select using ((select public.is_staff()));
drop policy if exists "vendor_locations staff write" on public.vendor_locations;
create policy "vendor_locations staff write" on public.vendor_locations
  for all using ((select public.is_staff())) with check ((select public.is_staff()));
drop policy if exists "tenant isolation" on public.vendor_locations;
create policy "tenant isolation" on public.vendor_locations as restrictive
  for all using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
grant select, insert, update, delete on public.vendor_locations to authenticated;

-- tenant stamp (same convention as the rest of the schema)
drop trigger if exists vendor_locations_tenant_tg on public.vendor_locations;
create trigger vendor_locations_tenant_tg
  before insert on public.vendor_locations
  for each row execute function public.stamp_tenant();

-- realtime: the picker + admin editor stay live like vendors already are (0034)
do $$ begin
  alter publication supabase_realtime add table public.vendor_locations;
exception when duplicate_object or undefined_object then null; end $$;  -- undefined: PGlite test env has no publication

-- Backfill: each vendor's baked-in address becomes its primary location (idempotent).
insert into public.vendor_locations (vendor_id, label, address, location_text, lat, lng, is_primary, tenant_id)
select v.id, 'Main', v.address, v.location_text, v.lat, v.lng, true, v.tenant_id
from public.vendors v
where (v.address is not null or v.location_text is not null or v.lat is not null)
  and not exists (select 1 from public.vendor_locations l where l.vendor_id = v.id);

-- ── 3 · the look-alike guard: DB refuses a ≥40%-similar vendor unless explicitly confirmed ────────
alter table public.vendors add column if not exists confirmed_distinct boolean not null default false;

-- Candidate lookup the app calls BEFORE inserting (and the confirm sheet renders from).
create or replace function public.similar_vendors(p_name text, p_threshold real default 0.4)
returns table (id uuid, name text, status text, sim real)
language sql stable as $$
  select v.id, v.name, v.status, similarity(lower(v.name), lower(p_name))::real as sim
  from public.vendors v
  where v.archived_at is null
    and v.status <> 'archived'
    and similarity(lower(v.name), lower(p_name)) >= p_threshold
  order by sim desc
  limit 5
$$;
grant execute on function public.similar_vendors(text, real) to authenticated;

-- The guard itself. INSERT-only (renames are deliberate owner edits). Raises a structured
-- message the client parses into the confirm sheet; setting confirmed_distinct = true on the
-- insert is the explicit "create anyway" — after which the flag has served its purpose.
create or replace function public.vendor_similarity_guard() returns trigger
language plpgsql as $$
declare best record;
begin
  if new.confirmed_distinct then
    return new;
  end if;
  select v.id, v.name, similarity(lower(v.name), lower(new.name)) as sim into best
  from public.vendors v
  where v.archived_at is null and v.status <> 'archived'
    and v.id is distinct from new.id
    and similarity(lower(v.name), lower(new.name)) >= 0.4
  order by sim desc limit 1;
  if found then
    -- PT409 → PostgREST maps PTxyz to HTTP xyz: a routine look-alike refusal reads as a true
    -- 409 Conflict, never a 5xx (panel finding: P0xxx would surface as HTTP 500 — noise in the
    -- very soak logs being watched for real 500s).
    raise exception 'similar_vendor'
      using detail = json_build_object('id', best.id, 'name', best.name, 'sim', round(best.sim::numeric, 2))::text,
            hint   = 'A vendor with a similar name already exists. Link to it, add a location to it, or re-submit with confirmed_distinct = true to create a distinct vendor.',
            errcode = 'PT409';
  end if;
  return new;
end $$;
drop trigger if exists vendor_similarity_guard_tg on public.vendors;
create trigger vendor_similarity_guard_tg
  before insert on public.vendors
  for each row execute function public.vendor_similarity_guard();

-- Duplicate-pair report for the admin "Possible duplicates" panel (and the merge pre-flight):
-- every active pair ≥ threshold, strongest first, each pair once.
create or replace function public.vendor_dupe_candidates(p_threshold real default 0.4)
returns table (a uuid, a_name text, b uuid, b_name text, sim real)
language sql stable as $$
  select v1.id, v1.name, v2.id, v2.name,
         similarity(lower(v1.name), lower(v2.name))::real as sim
  from public.vendors v1
  join public.vendors v2
    on v1.id < v2.id
   and similarity(lower(v1.name), lower(v2.name)) >= p_threshold
  where v1.archived_at is null and v1.status <> 'archived'
    and v2.archived_at is null and v2.status <> 'archived'
  order by sim desc
$$;
grant execute on function public.vendor_dupe_candidates(real) to authenticated;

-- ── 4 · merge_vendors — owner-gated, repoints every reference, archives the dupes ─────────────────
-- The mirror triggers on stops/events carry vendor_id changes into field_ops automatically;
-- this function deliberately never writes field_ops (soak contract).
create or replace function public.merge_vendors(p_keep uuid, p_dupes uuid[])
returns json
language plpgsql security definer set search_path = public as $$
declare
  n_stops int := 0; n_events int := 0; n_opps int := 0; n_notes int := 0; n_exp int := 0; n_locs int := 0;
  keep_rec public.vendors;
begin
  if not (select public.is_admin()) then
    raise exception 'merge_vendors: admin only';
  end if;
  select * into keep_rec from public.vendors where id = p_keep;
  if not found then
    raise exception 'merge_vendors: keep vendor % not found', p_keep;
  end if;
  if p_keep = any(p_dupes) then
    raise exception 'merge_vendors: keep id is in the dupe list';
  end if;
  -- SECURITY DEFINER runs above RLS, so tenancy is enforced HERE (panel finding: without this, an
  -- admin of tenant A could repoint tenant B's stops + absorb B's POC PII by passing a B vendor id).
  if exists (select 1 from public.vendors d where d.id = any(p_dupes)
             and d.tenant_id is distinct from keep_rec.tenant_id) then
    raise exception 'merge_vendors: cross-tenant dupe refused';
  end if;

  -- Repoint every reference (mirrors carry stops/events changes into field_ops on their own).
  update public.stops         set vendor_id = p_keep where vendor_id = any(p_dupes); get diagnostics n_stops  = row_count;
  update public.events        set vendor_id = p_keep where vendor_id = any(p_dupes); get diagnostics n_events = row_count;
  update public.opportunities set vendor_id = p_keep where vendor_id = any(p_dupes); get diagnostics n_opps   = row_count;
  update public.meeting_notes set vendor_id = p_keep where vendor_id = any(p_dupes); get diagnostics n_notes  = row_count;
  update public.expenses      set vendor_id = p_keep where vendor_id = any(p_dupes); get diagnostics n_exp    = row_count;

  -- Locations: move the dupes' locations under the kept vendor (never a second primary).
  update public.vendor_locations set vendor_id = p_keep, is_primary = false
    where vendor_id = any(p_dupes); get diagnostics n_locs = row_count;

  -- Fill any blank identity fields on the kept vendor from the dupes (first non-null wins).
  update public.vendors k set
    poc_name      = coalesce(k.poc_name,      (select d.poc_name      from public.vendors d where d.id = any(p_dupes) and d.poc_name      is not null limit 1)),
    poc_phone     = coalesce(k.poc_phone,     (select d.poc_phone     from public.vendors d where d.id = any(p_dupes) and d.poc_phone     is not null limit 1)),
    poc_email     = coalesce(k.poc_email,     (select d.poc_email     from public.vendors d where d.id = any(p_dupes) and d.poc_email     is not null limit 1)),
    service_dates = coalesce(k.service_dates, (select d.service_dates from public.vendors d where d.id = any(p_dupes) and d.service_dates is not null limit 1))
  where k.id = p_keep;

  -- Dupes archive (reversible), never deleted.
  update public.vendors set status = 'archived', archived_at = now() where id = any(p_dupes);

  return json_build_object('kept', p_keep, 'dupes', p_dupes,
    'repointed', json_build_object('stops', n_stops, 'events', n_events, 'opportunities', n_opps,
                                   'meeting_notes', n_notes, 'expenses', n_exp, 'locations', n_locs));
end $$;
revoke all on function public.merge_vendors(uuid, uuid[]) from public, anon;
grant execute on function public.merge_vendors(uuid, uuid[]) to authenticated;  -- self-guards: is_admin inside

-- ── 5 · panel-flagged perf ride-along: My Day / all_tasks reads filter todos by assignee ──────────
create index if not exists todos_assignee_open_idx on public.todos (assignee) where not done;

-- verify:
--   select count(*) from vendor_locations;                                    -- ≥ vendors-with-address
--   select * from similar_vendors('Wine Xpress');                            -- finds Wine Express
--   insert into vendors (name) values ('Wine Expres');                       -- raises similar_vendor
--   select merge_vendors('<keep>', array['<dupe>']);                         -- admin only
