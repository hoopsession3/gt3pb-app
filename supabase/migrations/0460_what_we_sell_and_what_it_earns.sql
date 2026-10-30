-- ── 0460 — WHAT WE SELL AND WHAT IT EARNS (MEN1) ────────────────────────────────────────────────────────────────────
-- 2026-10-30. Menu & economics in the Studio (Ryan, 2026-10-30: "one master product catalog… connecting the interactive
-- menu, Primal Health Standard, location capabilities and business economics"). A second run changes nothing. Needs 0459.
-- Paste it after the deploy that carries the Menu screen.
--
-- WHAT.
--   products — the one catalog stays public.products. It gains the size it is sold in (serving_oz) and whether that size
--   is the actual one or an estimate. Nothing about cost goes here: the menu is read by anyone.
--   product_unit_assumptions — per product, what a serving costs beyond its ingredients (packaging and the vessel, the
--   share wasted) and how long it takes to make and hand over, each with its basis (actual / estimated / scenario; the
--   service time measured / estimated / unvalidated), its source and the date it was true. Owners and admins only.
--   Ingredient cost is never stored here: it is worked out from product_components and inventory (lib/cogs).
--   product_requirements — what a product needs from a place, as explicit capabilities (cold dispensing, cold storage,
--   hot holding…), never matched by an object's name. The Studio maps its objects to the same capabilities in code.
--   location_assortments — which products a plan's location offers, and how far each is: planned → approved to offer
--   → operationally ready, or temporarily unavailable / retired, with the reason. Only an owner approves or calls a
--   product ready; a planned assortment is a scenario until then.
--   The Standard can judge a product: 'product' joins room, object and material as a subject (criteria, evidence,
--   claims, assessments, reviews). A product's assessment is an internal Primal qualification — never a food-safety
--   approval, never a health claim.
--
-- set lock_timeout (database F16): three tables made; one column pair added to products (nullable — no rewrite); five
-- check constraints widened (each re-made with the same name, the old values still allowed); one function replaced.
-- existing rows: none changed.
-- rollback: drop table location_assortments, product_requirements, product_unit_assumptions; drop products.serving_oz,
-- serving_basis; re-make the five checks without 'product'.
-- changelog: none — the owners' planning screen.

set lock_timeout = '5s';

alter table public.products add column if not exists serving_oz numeric(5,2);
alter table public.products add column if not exists serving_basis text;
alter table public.products drop constraint if exists products_serving_oz;
alter table public.products add constraint products_serving_oz check (serving_oz is null or (serving_oz >= 1 and serving_oz <= 64));
alter table public.products drop constraint if exists products_serving_basis;
alter table public.products add constraint products_serving_basis check (serving_basis is null or serving_basis in ('actual','estimated','scenario'));

create table if not exists public.product_unit_assumptions (
  product_id        uuid primary key references public.products(id) on delete cascade,
  tenant_id         uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  packaging_cents   int check (packaging_cents is null or packaging_cents between 0 and 10000),
  packaging_basis   text check (packaging_basis is null or packaging_basis in ('actual','estimated','scenario')),
  vessel            text check (vessel is null or length(vessel) <= 200),
  reusable          boolean not null default false,
  return_pct        numeric(5,2) check (return_pct is null or return_pct between 0 and 100),
  loss_pct          numeric(5,2) check (loss_pct is null or loss_pct between 0 and 100),
  wash_cents        int check (wash_cents is null or wash_cents between 0 and 10000),
  vessel_cents      int check (vessel_cents is null or vessel_cents between 0 and 100000),
  waste_pct         numeric(5,2) check (waste_pct is null or waste_pct between 0 and 90),
  waste_basis       text check (waste_basis is null or waste_basis in ('actual','estimated','scenario')),
  service_seconds   int check (service_seconds is null or service_seconds between 1 and 3600),
  service_basis     text check (service_basis is null or service_basis in ('measured','estimated','unvalidated')),
  source            text check (source is null or length(source) <= 300),
  as_of             date,
  updated_by        uuid default auth.uid(),
  updated_at        timestamptz not null default now(),
  -- a basis is said whenever a number is
  constraint pua_packaging_said check (packaging_cents is null or packaging_basis is not null),
  constraint pua_waste_said check (waste_pct is null or waste_basis is not null),
  constraint pua_service_said check (service_seconds is null or service_basis is not null),
  constraint pua_source_said check ((packaging_cents is null and waste_pct is null and service_seconds is null) or length(btrim(coalesce(source, ''))) > 0)
);
alter table public.product_unit_assumptions enable row level security;

create table if not exists public.product_requirements (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  product_id  uuid not null references public.products(id) on delete cascade,
  capability  text not null check (capability in ('cold_dispense','nitro_dispense','cold_storage','cold_hold_bottles','hot_hold','batch_brew','prep_surface','ice','dish_wash','hand_wash','dry_storage','order_point','pickup_point')),
  note        text check (note is null or length(note) <= 300),
  created_at  timestamptz not null default now(),
  unique (product_id, capability)
);
alter table public.product_requirements enable row level security;

create table if not exists public.location_assortments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  plan_id     uuid not null references public.vision_plans(id) on delete cascade,
  product_id  uuid not null references public.products(id) on delete cascade,
  state       text not null default 'planned' check (state in ('planned','approved','ready','unavailable','retired')),
  reason      text check (reason is null or length(reason) <= 500),
  decided_by  uuid,
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (plan_id, product_id),
  constraint la_unavailable_said check (state not in ('unavailable','retired') or length(btrim(coalesce(reason, ''))) > 0)
);
alter table public.location_assortments enable row level security;
create index if not exists product_requirements_product on public.product_requirements (product_id);
create index if not exists location_assortments_plan on public.location_assortments (plan_id);
create index if not exists location_assortments_product on public.location_assortments (product_id);

-- ── guards ──────────────────────────────────────────────────────────────────────────────────────────────────────────
-- An assortment starts planned. Approving it, or calling it ready, is an owner's word, stamped with who and when.
create or replace function public.location_assortment_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.state in ('approved','ready') then perform public.std_owner_only('approve a product for a location'); end if;
    if new.state <> 'planned' then new.decided_by := auth.uid(); new.decided_at := now(); else new.decided_by := null; new.decided_at := null; end if;
    return new;
  end if;
  new.updated_at := now();
  if new.state is distinct from old.state then
    if new.state in ('approved','ready') then perform public.std_owner_only('approve a product for a location'); end if;
    new.decided_by := auth.uid(); new.decided_at := now();
  elsif (new.decided_by, new.decided_at) is distinct from (old.decided_by, old.decided_at) then
    raise exception 'Only a decision records who decided.' using errcode = 'PT409';
  end if;
  return new;
end $$;
revoke all on function public.location_assortment_guard() from public, anon, authenticated;
drop trigger if exists location_assortment_guard_tg on public.location_assortments;
create trigger location_assortment_guard_tg before insert or update on public.location_assortments for each row execute function public.location_assortment_guard();

-- Who changed a serving's assumptions, and when — stamped by the database.
create or replace function public.product_unit_assumptions_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  return new;
end $$;
revoke all on function public.product_unit_assumptions_stamp() from public, anon, authenticated;
drop trigger if exists product_unit_assumptions_stamp_tg on public.product_unit_assumptions;
create trigger product_unit_assumptions_stamp_tg before insert or update on public.product_unit_assumptions for each row execute function public.product_unit_assumptions_stamp();

-- ── the Standard can judge a product ────────────────────────────────────────────────────────────────────────────────
alter table public.std_criteria drop constraint if exists std_criteria_applies_to_check;
alter table public.std_criteria add constraint std_criteria_applies_to_check check (applies_to in ('room','object','material','product'));
alter table public.std_evidence drop constraint if exists std_evidence_subject_type_check;
alter table public.std_evidence add constraint std_evidence_subject_type_check check (subject_type in ('room','object','material','product'));
alter table public.std_claims drop constraint if exists std_claims_subject_type_check;
alter table public.std_claims add constraint std_claims_subject_type_check check (subject_type is null or subject_type in ('room','object','material','product','gt3'));
alter table public.std_assessments drop constraint if exists std_assessments_subject_type_check;
alter table public.std_assessments add constraint std_assessments_subject_type_check check (subject_type in ('room','object','material','product'));
alter table public.std_reviews drop constraint if exists std_reviews_subject_type_check;
alter table public.std_reviews add constraint std_reviews_subject_type_check check (subject_type in ('room','object','material','product','evidence','assessment'));

create or replace function public.std_subject_ok(p_type text, p_id uuid, p_tenant uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_type
    when 'room'     then exists (select 1 from public.store_layouts where id = p_id and tenant_id is not distinct from p_tenant)
    when 'object'   then exists (select 1 from public.store_items  where id = p_id and tenant_id is not distinct from p_tenant)
    when 'material' then exists (select 1 from public.std_materials where id = p_id and tenant_id is not distinct from p_tenant)
    when 'product'  then exists (select 1 from public.products     where id = p_id and tenant_id is not distinct from p_tenant)
    else false end
$$;
revoke all on function public.std_subject_ok(text, uuid, uuid) from public, anon, authenticated;

-- ── access ──────────────────────────────────────────────────────────────────────────────────────────────────────────
-- The assumptions and the assortments: owners and admins. What a product needs: owners and admins write it, the crew
-- read it (it says what a station must have).
do $$
declare t text;
begin
  foreach t in array array['product_unit_assumptions','product_requirements','location_assortments'] loop
    execute format('drop trigger if exists stamp_tenant_tg on public.%I', t);
    execute format('create trigger stamp_tenant_tg before insert on public.%I for each row execute function public.stamp_tenant()', t);
    execute format('drop policy if exists "tenant isolation" on public.%I', t);
    execute format('create policy "tenant isolation" on public.%I as restrictive for all using (tenant_id = (select public.effective_tenant())) with check (tenant_id = (select public.effective_tenant()))', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('drop trigger if exists admin_audit_%s on public.%I', t, t);
    execute format('create trigger admin_audit_%s after insert or update or delete on public.%I for each row execute function public.log_admin_audit()', t, t);
  end loop;
end $$;
drop policy if exists "unit assumptions admin" on public.product_unit_assumptions;
create policy "unit assumptions admin" on public.product_unit_assumptions for all using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.product_unit_assumptions to authenticated;
drop policy if exists "requirements admin" on public.product_requirements;
create policy "requirements admin" on public.product_requirements for all using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "requirements staff read" on public.product_requirements;
create policy "requirements staff read" on public.product_requirements for select using ((select public.is_staff()));
grant select, insert, update, delete on public.product_requirements to authenticated;
drop policy if exists "assortments admin" on public.location_assortments;
create policy "assortments admin" on public.location_assortments for all using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.location_assortments to authenticated;

-- verify (numbers only):
--   select count(*) from public.location_assortments;    -- 0 (first run)
--   select count(*) from public.products where serving_oz is not null;  -- 0 (first run: sizes unknown until said)
select public.record_migration('0460_what_we_sell_and_what_it_earns');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
